import { all, get } from '../db/store.mjs';
import { catalogSignature, closestImage } from './image-similarity.mjs';

export const catalogQuestion=(text)=>{
  const normalized=text.toLocaleLowerCase('vi').normalize('NFD').replace(/\p{M}/gu,'').replaceAll('đ','d').trim();
  return /(?:\bbao nhieu\b|\bgia (?:bao|nhieu|bn|sao|la|san|mau|ban)\b|\b(?:hoi|xin|bao|cho) gia\b|\bcon hang\b|\bhet hang\b|\bton kho\b|^gia[?!. ]*$)/.test(normalized);
};

export async function catalogImage({channel_id,sender_id,created,attachments,inbound_quote_mid}) {
  const images=(files)=>(files??[]).filter((file)=>file.type==='image');
  const uniqueUrl=(files)=>files.length===1?files[0].url:null;
  const current=images(attachments);
  if(current.length)return uniqueUrl(current);
  const previous=await get(`SELECT attachments FROM inbox_messages WHERE channel_id=$1 AND sender_id=$2 AND created<=$3
    AND (($4::text IS NOT NULL AND remote_id=$4) OR ($4::text IS NULL AND created>=$5))
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(attachments) file WHERE file->>'type'='image')
    ORDER BY created DESC,id DESC LIMIT 1`,channel_id,sender_id,created,inbound_quote_mid,created-600_000);
  return uniqueUrl(images(previous?.attachments));
}

export async function matchCatalogImage(channelId, url) {
  const products=await all('SELECT sku,image_url FROM catalog_products WHERE channel_id=$1 ORDER BY sku',channelId);
  const exact=products.filter((product)=>product.image_url===url);
  if(exact.length)return exact.length===1?exact[0]:null;
  if(!products.length)return null;
  const query=await catalogSignature(url);
  const candidates=[];
  for(let index=0;index<products.length;index+=3){
    const group=products.slice(index,index+3);
    candidates.push(...await Promise.all(group.map(async(product)=>({
      product,signature:await catalogSignature(product.image_url),
    }))));
  }
  return closestImage(query,candidates);
}
