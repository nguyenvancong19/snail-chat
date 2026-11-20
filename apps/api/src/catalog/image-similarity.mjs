import { lookup } from 'node:dns';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';
import sharp from 'sharp';

const maxBytes=4*1024*1024;
const edge=48;
const backgrounds={r:255,g:255,b:255};

function publicLookup(hostname,options,callback){
  lookup(hostname,{all:true},(error,addresses)=>{
    if(error)return callback(error);
    const publicAddresses=addresses.filter(({address})=>{
      const ip=ipaddr.process(address);
      return ip.range()==='unicast'&&(ip.kind()==='ipv4'||ip.match(ipaddr.parse('2000::'),3));
    });
    if(!publicAddresses.length)return callback(new Error('Image host has no public address.'));
    if(options.all)return callback(null,publicAddresses);
    const selected=publicAddresses[0];
    return callback(null,selected.address,selected.family);
  });
}

async function imageBytes(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||
    ipaddr.isValid(url.hostname.replace(/^\[|\]$/g,'')))throw new Error('Invalid image URL.');
  return new Promise((resolve,reject)=>{
    const req=request(url,{agent:false,lookup:publicLookup,signal:AbortSignal.timeout(5_000)},(res)=>{
      res.on('error',reject);
      if(res.statusCode!==200||Number(res.headers['content-length'])>maxBytes){
        res.destroy();
        reject(new Error('Image download failed.'));
        return;
      }
      const chunks=[];
      let length=0;
      res.on('data',(chunk)=>{
        length+=chunk.length;
        if(length>maxBytes){
          res.destroy(new Error('Image is too large.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end',()=>resolve(Buffer.concat(chunks,length)));
      res.on('aborted',()=>reject(new Error('Image download interrupted.')));
    });
    req.on('error',reject);
    req.end();
  });
}

export async function imageSignature(bytes){
  const source=sharp(bytes,{limitInputPixels:16_000_000});
  const metadata=await source.metadata();
  if(!['jpeg','png','webp','gif','avif','heif'].includes(metadata.format))throw new Error('Unsupported image.');
  return source.rotate().flatten({background:backgrounds}).trim({threshold:12})
    .resize(edge,edge,{fit:'contain',background:backgrounds}).toColourspace('srgb').removeAlpha().raw().toBuffer();
}

export async function catalogSignature(url){
  return imageSignature(await imageBytes(url));
}

export function closestImage(query,candidates){
  if(!query||!candidates.length||candidates.some((item)=>item.signature?.length!==query.length))return null;
  const ranked=candidates.map(({product,signature})=>{
    let sum=0;
    for(let i=0;i<query.length;i++)sum+=Math.abs(query[i]-signature[i]);
    return {product,distance:sum/query.length/255};
  }).sort((a,b)=>a.distance-b.distance);
  const [best,next]=ranked;
  return best.distance<=0.045&&(!next||next.distance-best.distance>=0.025)?best.product:null;
}
