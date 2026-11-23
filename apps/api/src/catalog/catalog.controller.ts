import { markAgentKnowledgeChanged } from '../ai/agent-documents.mjs';
import { agentIncluded, requireCatalogFeature } from '../billing/plan-features.mjs';
import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { access, all, get, run, transaction, uid } from '../db/store.mjs';
import type { AppRequest } from '../http/session.guard.js';
import { choicesOf, ensure, string } from '../http/validation.mjs';
import { json, jsonBody } from '../http/wire.mjs';

const maxProducts=60;
const maxFiles=12;

@Controller('api/catalog')
export class CatalogController {
  @Get()
  async list(@Req() req: AppRequest, @Res() res: Response, @Query('channel') id: string) {
    const channel = await access(req.actor, string(id, 50, {required:true}));
    const ai=agentIncluded(await requireCatalogFeature(channel.shop_id));
    const products=await listProducts(channel.id);
    return json(res,200,{purpose:channel.page_purpose,knowledge:ai?channel.page_knowledge:null,
      mode:ai?channel.catalog_mode:null,products,files:await listFiles(channel.id)});
  }

  @Post('settings')
  async settings(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req);
    const channel = await access(req.actor, string(body.channel, 50, {required:true}));
    const purpose = choicesOf(body.purpose,['sales','news','entertainment']);
    const ai=agentIncluded(await requireCatalogFeature(channel.shop_id));
    ensure(ai||(body.knowledge===undefined&&(body.mode===undefined||body.mode==='off')),403,'Gói hiện tại không có AI agent.');
    const mode=ai?choicesOf(body.mode,['off','review','auto']):null;
    ensure(!mode||mode==='off'||(channel.platform==='fb'&&purpose==='sales'),400,'Tra ảnh dùng cho Messenger của Facebook Page bán hàng.');
    await run(`UPDATE channels SET page_purpose=$2,page_knowledge=COALESCE($3,page_knowledge),
      catalog_mode=CASE WHEN $2<>'sales' THEN 'off' ELSE COALESCE($4,catalog_mode) END,
      orders_enabled=CASE WHEN $2<>'sales' THEN FALSE ELSE orders_enabled END WHERE id=$1`,
      channel.id,purpose,ai?string(body.knowledge,5000):null,mode);
    return json(res,200,{ok:true});
  }

  @Post('files')
  async files(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req,8*1024*1024);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    await requireCatalogFeature(channel.shop_id);
    await transaction(async()=>{
      const current=await lockChannel(channel.id);
      if(body.remove){
        const deleted=await run('DELETE FROM catalog_files WHERE channel_id=$1 AND id=$2',
          channel.id,string(body.remove,50,{required:true}));
        ensure(deleted.changes,404,'Không tìm thấy tệp.');
        await markAgentKnowledgeChanged(channel.id);
        return;
      }
      ensure(current.page_purpose==='sales',400,'Chọn danh mục Bán hàng để nhập tệp sản phẩm.');
      ensure(Array.isArray(body.files)&&body.files.length>0&&body.files.length<=maxFiles,
        400,'Chọn từ 1 đến 12 tệp danh mục.');
      const files=body.files.map((file)=>{
        const filename=string(file?.filename,180,{required:true});
        ensure(/\.(xlsx|csv)$/i.test(filename),400,'Chọn tệp .xlsx hoặc .csv.');
        return {id:uid(),filename,category:string(file.category,80,{required:true}),items:productItems(file.items)};
      });
      const existing=await all('SELECT sku FROM catalog_products WHERE channel_id=$1',channel.id);
      const skus=new Set(existing.map(({sku})=>sku));
      const {count}=await get('SELECT count(*) FROM catalog_files WHERE channel_id=$1',channel.id);
      ensure(count+files.length<=maxFiles,400,'Mỗi Page lưu tối đa 12 tệp danh mục.');
      for(const file of files){
        for(const {sku} of file.items){
          ensure(!skus.has(sku),409,'Mã sản phẩm đã tồn tại trong danh mục hoặc trong các tệp đang nhập.');
          skus.add(sku);
        }
      }
      ensure(skus.size<=maxProducts,400,'Mỗi Page hỗ trợ tối đa 60 sản phẩm.');
      for(const file of files){
        await run('INSERT INTO catalog_files(channel_id,id,filename,category,created) VALUES($1,$2,$3,$4,$5)',
          channel.id,file.id,file.filename,file.category,Date.now());
        for(const item of file.items)await saveProduct(channel.id,item,file.id);
      }
      await markAgentKnowledgeChanged(channel.id);
    });
    return json(res,200,{products:await listProducts(channel.id),files:await listFiles(channel.id)});
  }

  @Post('products')
  async products(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req,2*1024*1024);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    await requireCatalogFeature(channel.shop_id);
    await transaction(async()=>{
      await lockChannel(channel.id);
      if(body.remove){
        await run('DELETE FROM catalog_products WHERE channel_id=$1 AND sku=$2',channel.id,productSku(body.remove));
        return;
      }
      for(const item of productItems(body.items))await saveProduct(channel.id,item);
      const {count}=await get('SELECT count(*) FROM catalog_products WHERE channel_id=$1',channel.id);
      ensure(count<=maxProducts,400,'Mỗi Page hỗ trợ tối đa 60 sản phẩm.');
    });
    return json(res,200,{ok:true});
  }
}

function lockChannel(channelId: string) {
  return get('SELECT page_purpose FROM channels WHERE id=$1 FOR UPDATE',channelId)
    .then((channel)=>ensure(channel,404,'Không tìm thấy Page.'));
}

function listProducts(channelId: string) {
  return all(`SELECT sku,name,price,in_stock,image_url,description,detail_images,source_file_id
    FROM catalog_products WHERE channel_id=$1 ORDER BY created_at DESC NULLS LAST,sku`,channelId);
}

function listFiles(channelId: string) {
  return all('SELECT id,filename,category,created FROM catalog_files WHERE channel_id=$1 ORDER BY created DESC,id DESC',channelId);
}

function productItems(items: unknown) {
  ensure(Array.isArray(items)&&items.length>0&&items.length<=maxProducts,400,'Nhập từ 1 đến 60 sản phẩm.');
  return (items as any[]).map((item)=>{
    const sku=productSku(item?.sku);
    const name=string(item.name,140,{required:true});
    const price=item.price;
    ensure(Number.isInteger(price)&&price>=0&&price<=2147483647,400,'Giá phải là số nguyên VNĐ.');
    ensure(typeof item.in_stock==='boolean',400,'Chọn tình trạng tồn hàng.');
    const image=string(item.image_url,2048,{required:true});
    let url;
    try {url=new URL(image);} catch {}
    ensure(url?.protocol==='https:'&&!url.username&&!url.password&&!url.port,400,'Nhập URL ảnh HTTPS công khai.');
    return {sku,name,price,stock:item.in_stock,image:url.href,detailImages:detailImages(item.detail_images),
      description:item.description===undefined?null:string(item.description,700)};
  });
}

function saveProduct(channelId: string,item: ReturnType<typeof productItems>[number],fileId: string|null=null) {
  return run(`INSERT INTO catalog_products(channel_id,sku,name,price,in_stock,image_url,description,detail_images,source_file_id)
    VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::text,''),COALESCE($8::jsonb,'[]'),$9)
    ON CONFLICT(channel_id,sku) DO UPDATE SET name=excluded.name,price=excluded.price,
    in_stock=excluded.in_stock,image_url=excluded.image_url,description=COALESCE($7::text,catalog_products.description),
    detail_images=COALESCE($8::jsonb,catalog_products.detail_images)`,
    channelId,item.sku,item.name,item.price,item.stock,item.image,item.description,item.detailImages,fileId);
}

function productSku(value: unknown) {
  const sku=string(value,50,{required:true}).toUpperCase();
  return ensure(/^[A-Z0-9_-]+$/.test(sku)&&sku,400,'Mã sản phẩm chỉ dùng chữ không dấu, số, gạch ngang hoặc gạch dưới.');
}

function detailImages(value: unknown) {
  if(value===undefined)return null;
  if(!Array.isArray(value))return ensure(false,400,'Danh sách ảnh chi tiết không hợp lệ.');
  ensure(value.length===0||value.length===3,400,'Nhập đủ ba ảnh chi tiết hoặc để trống cả ba.');
  return JSON.stringify(value.map((item)=>{
    const source=string(item,32767,{required:true});
    const encoded=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
    if(encoded){
      const data=Buffer.from(encoded[2],'base64');
      const signatures={
        jpeg:()=>data[0]===255&&data[1]===216&&data[2]===255,
        png:()=>data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
        webp:()=>data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP',
      };
      ensure(data.toString('base64')===encoded[2]&&signatures[encoded[1]](),400,'Dữ liệu ảnh chi tiết không hợp lệ.');
      return source;
    }
    let url;
    try {url=new URL(source);}catch {}
    ensure(url?.protocol==='https:'&&!url.username&&!url.password&&!url.port&&source.length<=2048,
      400,'Ảnh chi tiết cần URL HTTPS hoặc dữ liệu JPEG, PNG, WebP hợp lệ.');
    return url.href;
  }));
}
