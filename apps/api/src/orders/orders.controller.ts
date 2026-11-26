import { displayWorkActor, recordWorkEvent, workActor } from '../shops/work-activity.mjs';
import { pageNumber, pageSize, readPage } from '../db/pagination.mjs';
import { ownerOnly } from '../shops/tenant.mjs';
import { agentIncluded, requireAgentFeature, requireOrderFeature } from '../billing/plan-features.mjs';
import { ghnPrintUrl, manageGhnOrder, recipient } from './ghn-actions.mjs';
import { canonicalPhone, checkoutTemplates, caseFields, caseRequired, createShopOrder, currentOrderItems, orderItems, salesReply } from './order-flow.mjs';
import { seal } from '../auth/crypto.mjs';
import { readShipment } from './shipping.mjs';
import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { access as accessChannel, all, get, run, throttle, transaction } from '../db/store.mjs';
import type { AppRequest } from '../http/session.guard.js';
import { choicesOf, ensure, string } from '../http/validation.mjs';
import { json, jsonBody } from '../http/wire.mjs';

async function readOrders(actor: AppRequest['actor'], id: string, permission: string) {
  const channel=await accessChannel(actor,id,permission);
  const plan=await requireOrderFeature(channel.shop_id);
  ensure(channel.platform==='fb'&&(channel.page_purpose==='sales'||await get(
    'SELECT 1 FROM shop_orders WHERE channel_id=$1 LIMIT 1',channel.id)),403,'Page này chưa bật bán hàng và không có đơn để tra cứu.');
  return {channel,plan};
}

async function access(actor: AppRequest['actor'], id: string) {
  ownerOnly(actor);
  return (await readOrders(actor,id,'OWNER')).channel;
}

const states = ['new','packing','shipping','delivered','cancelled'];
const transitions = {new:['packing','cancelled'],packing:['shipping','cancelled'],shipping:['delivered','cancelled'],delivered:[],cancelled:[]};

@Controller('api/orders')
export class OrdersController {
  @Get()
  async list(@Req() req: AppRequest, @Res() res: Response, @Query('channel') id: string,
    @Query('day') rawDay?: string, @Query('archived') archived?: string, @Query('status') rawStatus?: string, @Query('before') rawBefore?: string, @Query('code') rawCode?: string, @Query('page') rawPage?: string) {
    const {channel,plan} = await readOrders(req.actor,string(id,50,{required:true}), 'order:manage');
    const status = rawStatus ? choicesOf(rawStatus,states) : '';
    const code = string(rawCode,16).toUpperCase();
    const cursor = string(rawBefore,40);
    const before = cursor ? /^(\d{1,15}):([A-F0-9]{16})$/.exec(cursor) : null;
    ensure(!cursor||before,400,'Vị trí phân trang không hợp lệ.');
    const day=string(rawDay,10);
    const start=day?Date.parse(day+'T00:00:00+07:00'):null;
    ensure(!day||(/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(start)&&
      new Date(start+7*60*60_000).toISOString().slice(0,10)===day),400,'Ngày tạo đơn không hợp lệ.');
    const sql=`SELECT code,sku,product_name,quantity,unit_price,items,customer,phone,address,status,tracking,created,updated,history,carrier,shipment,ghn_shop,ghn_next,ghn_error,archived_at
      ${req.actor.memberRole==='OWNER'?',bot_created,created_actor':''}
      FROM shop_orders WHERE channel_id=$1 AND (archived_at IS NOT NULL)=$6 AND ($2='' OR status=$2) AND ($5='' OR code=$5)
      AND ($7::bigint IS NULL OR (created>=$7 AND created<$7+86400000))
      AND (created,code)<($3,$4)`;
    const args=[channel.id,status,before?Number(before[1]):Number.MAX_SAFE_INTEGER,before?.[2]??'',code,archived==='1',start];
    const sort='created DESC,code DESC';
    const list=rawPage!==undefined?await readPage(sql,sort,args,pageNumber(rawPage)):null;
    const rows=list?list.items:await all(sql+' ORDER BY '+sort+' LIMIT '+(pageSize+1),...args);
    const last=rows[pageSize-1];
    const items=rows.slice(0,pageSize).map(({created_actor,...row})=>created_actor
      ?{...row,createdBy:displayWorkActor(created_actor)}:row);
    return json(res,200,{items,next:rows.length>pageSize?last.created+':'+last.code:null,
      ...(list?{page:list.page,total:list.total}:{}),...(req.actor.memberRole==='OWNER'&&agentIncluded(plan)?{enabled:channel.orders_enabled,aiMode:channel.order_ai_mode,
      templates:channel.order_templates,cases:channel.order_cases}:{})});
  }

  @Post('ghn/print')
  async printGhn(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    ensure(Array.isArray(body.codes)&&body.codes.length>=1&&body.codes.length<=50,400,'Chọn từ 1 đến 50 đơn để in.');
    const codes=[...new Set<string>(body.codes.map((value)=>string(value,16,{required:true}).toUpperCase()))];
    ensure(codes.every((code)=>/^[A-F0-9]{16}$/.test(code)),400,'Mã đơn không hợp lệ.');
    await throttle('ghn-print:'+channel.id,20,60_000);
    const rows=await all(`SELECT code,tracking,ghn_shop FROM shop_orders WHERE channel_id=$1
      AND code=ANY($2::text[]) AND archived_at IS NULL AND carrier='ghn' AND tracking<>''`,channel.id,codes);
    ensure(rows.length===codes.length,404,'Có đơn không khả dụng để in nhãn GHN.');
    const connection=ensure(await get(`SELECT * FROM shop_carriers WHERE channel_id=$1 AND carrier='ghn'`,channel.id),
      409,'Kết nối Shop ID GHN trước khi in.');
    ensure(rows.every((row)=>!row.ghn_shop||row.ghn_shop===connection.account_ref),409,'Các vận đơn cần thuộc cùng Shop ID GHN đang kết nối.');
    const tracking=new Map(rows.map((row)=>[row.code,row.tracking]));
    const orderCodes=[...new Set(codes.map((code)=>tracking.get(code)))];
    return json(res,200,{url:await ghnPrintUrl(connection,orderCodes,body.format)});
  }

  @Post('create')
  async create(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req);
    const {channel}=await readOrders(req.actor,string(body.channel,50,{required:true}),'order:create');
    if(body.sendToGhn===true)ownerOnly(req.actor);
    ensure(channel.platform==='fb'&&channel.page_purpose==='sales',400,'Chọn Facebook Page bán hàng.');
    const code=string(body.code,16,{required:true}).toUpperCase();
    ensure(/^[A-F0-9]{16}$/.test(code),400,'Mã yêu cầu không hợp lệ.');
    const sku=string(body.sku,50,{required:true}).toUpperCase();
    const {quantity}=body;
    ensure(Number.isInteger(quantity)&&quantity>=1&&quantity<=99,400,'Số lượng cần từ 1 đến 99.');
    const details=recipient(body);
    await transaction(async()=>{
      await get('SELECT id FROM channels WHERE id=$1 FOR UPDATE',channel.id);
      const existing=await get('SELECT * FROM shop_orders WHERE channel_id=$1 AND code=$2',channel.id,code);
      if(existing){
        ensure(existing.sender_id===''&&existing.sku===sku&&existing.quantity===quantity&&
          (!existing.created_actor||existing.created_actor.id===req.actor.id)&&existing.customer===details.customer&&existing.phone===details.phone&&existing.address===details.address,409,'Mã yêu cầu đã được sử dụng.');
        return;
      }
      const product=await get('SELECT sku,name,price,in_stock FROM catalog_products WHERE channel_id=$1 AND sku=$2 FOR SHARE',channel.id,sku);
      ensure(product?.in_stock,400,'Mã sản phẩm chưa có trong danh mục hoặc đã hết hàng.');
      if(body.sendToGhn===true)ensure(await get(`SELECT 1 FROM shop_carriers WHERE channel_id=$1
        AND carrier='ghn' AND auto_config IS NOT NULL FOR SHARE`,channel.id),409,'Bật và lưu cấu hình tự tạo vận đơn GHN trước.');
      const actor=await workActor(channel.shop_id,req.actor.id);
      const now=Date.now();
      ensure(await createShopOrder(channel.id,'',{code,quantity,...details},product,now,false,body.sendToGhn===true,actor),
        409,'Page không còn đủ điều kiện tạo đơn.');
      await recordWorkEvent(channel,{id:'order:'+channel.id+':'+code,kind:'order',subject:code,at:now,actor});
    });
    return json(res,200,{code});
  }

  @Post('recipient')
  async updateRecipient(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    const code=string(body.code,16,{required:true}).toUpperCase();
    ensure(Number.isSafeInteger(body.updated),400,'Thông tin phiên bản đơn không hợp lệ.');
    const {customer,phone,address}=recipient(body);
    const result=await run(`UPDATE shop_orders SET customer=$3,phone=$4,address=$5,updated=GREATEST(updated+1,$6)
      WHERE channel_id=$1 AND code=$2 AND updated=$7 AND archived_at IS NULL AND tracking=''
        AND ghn_next IS NULL AND status IN ('new','packing')`,channel.id,code,customer,phone,address,Date.now(),body.updated);
    ensure(result.changes,409,'Đơn đã thay đổi hoặc đang có vận đơn. Hãy làm mới và kiểm tra trạng thái.');
    return json(res,200,{ok:true});
  }

  @Post('archive')
  async archive(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    const code=string(body.code,16,{required:true}).toUpperCase();
    ensure(Number.isSafeInteger(body.updated),400,'Thông tin phiên bản đơn không hợp lệ.');
    const now=Date.now();
    const result=await run(`UPDATE shop_orders SET archived_at=CASE WHEN $4 THEN NULL ELSE $3::bigint END,
      updated=GREATEST(updated+1,$3)
      WHERE channel_id=$1 AND code=$2 AND updated=$5
        AND ($4 OR (ghn_next IS NULL AND (tracking='' OR status IN ('cancelled','delivered'))))`,
      channel.id,code,now,body.restore===true,body.updated);
    ensure(result.changes,409,'Đơn đã thay đổi hoặc vận đơn vẫn đang xử lý. Hãy làm mới và kiểm tra trạng thái.');
    return json(res,200,{ok:true});
  }

  @Post('ghn/action')
  async ghnAction(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    const code=string(body.code,16,{required:true}).toUpperCase();
    await throttle('ghn-action:'+channel.id,30,60_000);
    return json(res,200,await manageGhnOrder(channel.id,code,body));
  }

  @Post('cases')
  async cases(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req,256*1024);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    await requireAgentFeature(channel.shop_id);
    ensure(channel.page_purpose==='sales',400,'Chọn Page bán hàng.');
    const cases=body.cases;
    ensure(Array.isArray(cases),400,'Danh sách trường hợp không hợp lệ.');
    const rules=cases.map((item)=>{
      const event=choicesOf(item?.event,Object.keys(caseFields));
      const match=string(item?.match,120,{required:event==='incoming'});
      const reply=string(item?.reply,400,{required:true});
      ensure(!match||(/[\p{L}\p{N}]/u.test(match)&&event!=='verified'),400,'Cụm từ kích hoạt không hợp lệ.');
      ensure((caseRequired[event]??[]).every((token)=>reply.includes('{'+token+'}')),400,
        'Câu trả lời cần có '+(caseRequired[event]??[]).map((token)=>'{'+token+'}').join(', ')+'.');
      ensure([...reply.matchAll(/\{([^{}]+)\}/g)].every(([,token])=>caseFields[event].includes(token)),400,
        'Câu trả lời có biến chưa được hỗ trợ cho trường hợp này.');
      return {event,match,reply};
    });
    const aiMode=body.aiMode===undefined?null:choicesOf(body.aiMode,['off','review','auto']);
    await run(`UPDATE channels SET order_cases=$2,order_templates='{}',order_ai_mode=COALESCE($4,order_ai_mode)
      WHERE id=$1 AND shop_id=$3`,channel.id,JSON.stringify(rules),req.actor.currentShop.id,aiMode);
    return json(res,200,{ok:true});
  }

  @Get('verification')
  async verification(@Req() req: AppRequest, @Res() res: Response, @Query('channel') id: string,
    @Query('q') query?: string, @Query('before') cursor?: string) {
    const channel=await access(req.actor,string(id,50,{required:true}));
    ensure(channel.page_purpose==='sales',403,'Page này đã ngừng nhận đơn mới.');
    const search=string(query,40);
    const position=string(cursor,40);
    const before=position?/^(\d{1,15}):([A-F0-9]{16})$/.exec(position):null;
    ensure(!position||before,400,'Vị trí phân trang không hợp lệ.');
    const phone=canonicalPhone(search);
    const rows=await all(`SELECT v.code,v.sender_id,v.sku,v.quantity,v.unit_price,v.items,v.customer,v.phone,v.address,v.confirmed_at,v.status,m.status AS message_status
      FROM order_verifications v LEFT JOIN inbox_messages m ON m.id=v.notice_message_id
      WHERE v.channel_id=$1 AND v.status IN ('pending','verified')
        AND ($2='' OR v.sender_id=$2 OR v.phone=$3)
        AND (v.confirmed_at,v.code)<($4,$5) ORDER BY v.confirmed_at DESC,v.code DESC LIMIT ${pageSize+1}`,
      channel.id,search,phone,before?Number(before[1]):Number.MAX_SAFE_INTEGER,before?.[2]??'');
    const customers=search?await all(`SELECT o.sender_id,
      regexp_replace(regexp_replace(o.phone,'[^0-9]','','g'),'^84(?=[0-9]{9}$)','0') AS phone,
      (array_agg(o.customer ORDER BY o.created DESC))[1] AS customer,count(*) FILTER (WHERE o.status<>'cancelled') AS purchases,
      max(o.created) AS last_order,b.verified_at
      FROM shop_orders o LEFT JOIN verified_buyers b ON b.channel_id=o.channel_id AND b.sender_id=o.sender_id
        AND b.phone=regexp_replace(regexp_replace(o.phone,'[^0-9]','','g'),'^84(?=[0-9]{9}$)','0')
      WHERE o.channel_id=$1 AND (o.sender_id=$2 OR
        regexp_replace(regexp_replace(o.phone,'[^0-9]','','g'),'^84(?=[0-9]{9}$)','0')=$3)
      GROUP BY o.sender_id,2,b.verified_at ORDER BY last_order DESC LIMIT 30`,channel.id,search,phone):[];
    const verified=search?await all(`SELECT sender_id,phone,verified_at FROM verified_buyers
      WHERE channel_id=$1 AND (sender_id=$2 OR phone=$3) ORDER BY verified_at DESC LIMIT 30`,channel.id,search,phone):[];
    for(const buyer of verified){
      if(!customers.some((item)=>item.sender_id===buyer.sender_id&&item.phone===buyer.phone))
        customers.push({...buyer,customer:'Khách Messenger',purchases:0});
    }
    const last=rows[pageSize-1];
    return json(res,200,{items:rows.slice(0,pageSize),customers,next:rows.length>pageSize?last.confirmed_at+':'+last.code:null});
  }

  @Post('verification')
  async reviewVerification(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    const code=string(body.code,16,{required:true}).toUpperCase();
    const action=choicesOf(body.action,['approve','reject']);
    ensure(action==='reject'||channel.page_purpose==='sales',403,'Page này đã ngừng nhận đơn mới.');
    ensure(action==='reject'||body.verified===true,400,'Tích xác nhận đã xác minh khách hàng để lên đơn.');
    await transaction(async()=>{
      const identity=ensure(await get('SELECT sender_id FROM order_verifications WHERE channel_id=$1 AND code=$2',
        channel.id,code),404,'Không tìm thấy yêu cầu xác minh.');
      await get('SELECT 1 FROM messenger_contacts WHERE channel_id=$1 AND sender_id=$2 FOR UPDATE',channel.id,identity.sender_id);
      const pending=ensure(await get('SELECT * FROM order_verifications WHERE channel_id=$1 AND code=$2 FOR UPDATE',
        channel.id,code),404,'Không tìm thấy yêu cầu xác minh.');
      if(action==='approve'&&['verified','approved'].includes(pending.status))return;
      if(action==='reject'&&pending.status==='rejected')return;
      ensure(pending.status==='pending',409,'Yêu cầu xác minh đã được xử lý.');
      if(action==='reject'){
        await run("UPDATE order_verifications SET status='rejected' WHERE channel_id=$1 AND code=$2",channel.id,code);
        return;
      }
      const cart=orderItems(pending);
      ensure(!cart.some((line)=>line.size&&!line.variant_reviewed)||body.sizeVerified===true,400,
        'Kiểm tra tồn kho của size đã chọn trước khi duyệt đơn.');
      const currentItems=await currentOrderItems(channel.id,cart);
      ensure(currentItems.every((line,index)=>line.available&&line.unit_price===cart[index].unit_price),409,
        'Sản phẩm đã đổi giá hoặc hết hàng. Hãy từ chối yêu cầu này và đề nghị khách đặt lại.');
      const config=ensure(await get(`SELECT order_templates,order_cases,message_bot_policy FROM channels
        WHERE id=$1 AND page_purpose='sales' AND orders_enabled FOR SHARE`,channel.id),409,'Page này đã tắt chốt đơn.');
      await requireOrderFeature(channel.shop_id);
      const now=Date.now();
      const values={code,customer:pending.customer};
      const notice=ensure(salesReply(checkoutTemplates(config.message_bot_policy,config.order_templates),'verified',values,config.message_bot_policy?.unifiedAgent?[]:config.order_cases),409,
        'Thêm trường hợp Xác minh thành công trong cấu hình bot rồi duyệt lại.');
      await run(`INSERT INTO verified_buyers(channel_id,sender_id,phone,verified_at) VALUES($1,$2,$3,$4)
        ON CONFLICT DO NOTHING`,channel.id,pending.sender_id,pending.phone,now);
      await run(`UPDATE order_verifications SET status='verified',notice=$3,approved_product_name=$4
        WHERE channel_id=$1 AND code=$2`,channel.id,code,notice,currentItems[0].name);
    });
    return json(res,200,{ok:true});
  }

  @Get('verification/contacts')
  async verificationContacts(@Req() req: AppRequest, @Res() res: Response, @Query('channel') id: string) {
    const channel=await access(req.actor,string(id,50,{required:true}));
    const items=await all(`SELECT sender_id,display_name FROM messenger_contacts WHERE channel_id=$1
      ORDER BY last_inbound DESC,sender_id LIMIT 30`,channel.id);
    return json(res,200,{items});
  }

  @Post('verification/manual')
  async verifyManually(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    ensure(channel.platform==='fb'&&channel.page_purpose==='sales',400,'Chọn Facebook Page bán hàng.');
    const sender=string(body.sender,40,{required:true});
    const phone=canonicalPhone(string(body.phone,30,{required:true}));
    ensure(phone&&/^\d{1,40}$/.test(sender)&&body.verified===true,400,'Nhập PSID, số điện thoại và tích xác nhận.');
    await transaction(async()=>{
      ensure(await get('SELECT 1 FROM messenger_contacts WHERE channel_id=$1 AND sender_id=$2 FOR UPDATE',
        channel.id,sender),404,'Khách cần nhắn tin cho Page này trước. Kiểm tra lại PSID trong mục Tin nhắn.');
      ensure(!await get(`SELECT 1 FROM order_verifications WHERE channel_id=$1 AND sender_id=$2
        AND status IN ('pending','verified')`,channel.id,sender),409,'Khách đã có yêu cầu. Xử lý trong danh sách chờ xác minh.');
      await run(`INSERT INTO verified_buyers(channel_id,sender_id,phone,verified_at) VALUES($1,$2,$3,$4)
        ON CONFLICT DO NOTHING`,channel.id,sender,phone,Date.now());
    });
    return json(res,200,{ok:true});
  }

  @Post('verification/revoke')
  async revokeVerification(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    const sender=string(body.sender,40,{required:true});
    const phone=canonicalPhone(string(body.phone,25,{required:true}));
    ensure(phone&&/^\d{1,40}$/.test(sender),400,'Thông tin khách hàng không hợp lệ.');
    await transaction(async()=>{
      await get('SELECT 1 FROM messenger_contacts WHERE channel_id=$1 AND sender_id=$2 FOR UPDATE',channel.id,sender);
      ensure(!await get(`SELECT 1 FROM order_verifications WHERE channel_id=$1 AND sender_id=$2
        AND phone=$3 AND status='verified'`,channel.id,sender,phone),409,'Đang chờ bot gửi xác nhận. Hãy xử lý yêu cầu này trước.');
      await run('DELETE FROM verified_buyers WHERE channel_id=$1 AND sender_id=$2 AND phone=$3',channel.id,sender,phone);
    });
    return json(res,200,{ok:true});
  }

  @Get('carriers')
  async carriers(@Req() req: AppRequest, @Res() res: Response, @Query('channel') id: string) {
    const channel = await access(req.actor,string(id,50,{required:true}));
    const items = await all('SELECT carrier,account_ref,auto_config FROM shop_carriers WHERE channel_id=$1 ORDER BY carrier',channel.id);
    return json(res,200,{items:items.map(({auto_config,...row})=>auto_config?{...row,auto_config}:row)});
  }

  @Post('carriers')
  async saveCarrier(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req);
    const channel = await access(req.actor,string(body.channel,50,{required:true}));
    const carrier = choicesOf(body.carrier,['ghn','ghtk']);
    if(body.remove===true){
      await run('DELETE FROM shop_carriers WHERE channel_id=$1 AND carrier=$2',channel.id,carrier);
      return json(res,200,{ok:true});
    }
    const token = string(body.token,500);
    const ref = string(body.accountRef,80);
    ensure(!token||/^[!-~]+$/.test(token),400,'API token chứa ký tự không hợp lệ.');
    ensure(carrier==='ghn'?/^[1-9]\d{0,12}$/.test(ref):!ref||/^[a-z0-9_.-]+$/i.test(ref),400,
      carrier==='ghn'?'Nhập Shop ID GHN hợp lệ.':'Mã đối tác GHTK không hợp lệ.');
    if(token){
      await run(`INSERT INTO shop_carriers(channel_id,carrier,sealed_token,account_ref) VALUES($1,$2,$3,$4)
        ON CONFLICT(channel_id,carrier) DO UPDATE SET sealed_token=excluded.sealed_token,account_ref=excluded.account_ref,
          auto_config=CASE WHEN shop_carriers.account_ref=excluded.account_ref THEN shop_carriers.auto_config END`,
        channel.id,carrier,seal(token),ref);
    }else{
      const result=await run('UPDATE shop_carriers SET auto_config=CASE WHEN account_ref=$3 THEN auto_config END,account_ref=$3 WHERE channel_id=$1 AND carrier=$2',channel.id,carrier,ref);
      ensure(result.changes,400,'Nhập API token của hãng vận chuyển.');
    }
    return json(res,200,{ok:true});
  }

  @Post('ghn/settings')
  async ghnSettings(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    ensure(typeof body.enabled==='boolean',400,'Chọn trạng thái tự tạo vận đơn.');
    let config=null;
    if(body.enabled){
      ensure(channel.platform==='fb'&&channel.page_purpose==='sales',400,'Chọn Facebook Page bán hàng.');
      const {weight,length,width,height,payment,note,cod}=body;
      ensure(Number.isInteger(weight)&&weight>=1&&weight<20_000,400,'Nhập khối lượng kiện từ 1 đến 19.999 g.');
      ensure([length,width,height].every((value)=>Number.isInteger(value)&&value>=1&&value<=200),
        400,'Kích thước mỗi chiều cần từ 1 đến 200 cm.');
      ensure([1,2].includes(payment)&&typeof cod==='boolean',400,'Chọn bên trả phí và cách thu hộ.');
      choicesOf(note,['KHONGCHOXEMHANG','CHOXEMHANGKHONGTHU','CHOTHUHANG']);
      config={weight,length,width,height,payment,note,cod};
    }
    const saved=await run(`UPDATE shop_carriers SET auto_config=$2 WHERE channel_id=$1 AND carrier='ghn' AND account_ref=$3`,
      channel.id,config&&JSON.stringify(config),string(body.shop,80,{required:true}));
    ensure(saved.changes,409,'Kết nối GHN đã thay đổi. Tải lại rồi thử lại.');
    return json(res,200,{ok:true});
  }

  @Post('ghn/submit')
  async submitGhn(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    const code=string(body.code,16,{required:true}).toUpperCase();
    const address=string(body.address,350,{required:true,min:8});
    ensure(Number.isSafeInteger(body.updated),400,'Thông tin phiên bản đơn không hợp lệ.');
    const updated=await run(`UPDATE shop_orders o SET address=$3,ghn_config=c.auto_config,ghn_shop=c.account_ref,
      ghn_next=$4,ghn_error=NULL,ghn_attempts=0,updated=GREATEST(o.updated+1,$4)
      FROM shop_carriers c WHERE o.channel_id=$1 AND o.code=$2 AND o.archived_at IS NULL AND o.updated=$5
        AND o.tracking='' AND o.ghn_next IS NULL AND o.status IN ('new','packing')
        AND c.channel_id=o.channel_id AND c.carrier='ghn' AND c.auto_config IS NOT NULL
        AND (o.ghn_shop IS NULL OR o.ghn_shop=c.account_ref)`,channel.id,code,address,Date.now(),body.updated);
    ensure(updated.changes,409,'Đơn đã thay đổi, đang xử lý hoặc GHN chưa được bật tự tạo vận đơn.');
    return json(res,200,{ok:true});
  }

  @Post('shipment')
  async shipment(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req);
    const channel = await access(req.actor,string(body.channel,50,{required:true}));
    const carrier = choicesOf(body.carrier,['ghn','ghtk']);
    const code = string(body.code,16,{required:true}).toUpperCase();
    const tracking = string(body.tracking,100,{required:true});
    ensure(/^[a-z0-9][a-z0-9._-]*$/i.test(tracking),400,'Mã vận đơn không hợp lệ.');
    ensure(Number.isSafeInteger(body.updated),400,'Thông tin phiên bản đơn không hợp lệ.');
    const order = ensure(await get('SELECT updated,ghn_shop FROM shop_orders WHERE channel_id=$1 AND code=$2 AND archived_at IS NULL',channel.id,code),
      404,'Không tìm thấy đơn hàng.');
    ensure(!order.ghn_shop,409,'Đơn được hệ thống quản lý vận đơn GHN tự động.');
    ensure(order.updated===body.updated,409,'Đơn đã thay đổi. Tải lại rồi thử lại.');
    const connection=ensure(await get('SELECT * FROM shop_carriers WHERE channel_id=$1 AND carrier=$2',channel.id,carrier),
      409,'Lưu thông tin hãng vận chuyển trước khi đồng bộ.');
    await throttle('shipment-sync:'+channel.id,30,60_000);
    const shipment=await readShipment(connection,tracking);
    const updated=Math.max(Date.now(),order.updated+1);
    const saved=await get(`UPDATE shop_orders o SET carrier=$3,tracking=$4,shipment=$5,updated=$6
      WHERE channel_id=$1 AND code=$2 AND updated=$7 AND EXISTS(
        SELECT 1 FROM shop_carriers c WHERE c.channel_id=o.channel_id AND c.carrier=$3
          AND c.sealed_token=$8 AND c.account_ref=$9) RETURNING updated`,
      channel.id,code,carrier,shipment.code,JSON.stringify(shipment),updated,order.updated,connection.sealed_token,connection.account_ref);
    ensure(saved,409,'Đơn hoặc tài khoản hãng vừa thay đổi. Tải lại rồi thử lại.');
    return json(res,200,{shipment,carrier,tracking:shipment.code,updated});
  }

  @Post('settings')
  async settings(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req);
    const channel = await access(req.actor,string(body.channel,50,{required:true}));
    await requireAgentFeature(channel.shop_id);
    ensure(typeof body.enabled==='boolean',400,'Chọn trạng thái chốt đơn hợp lệ.');
    const updated=await run(`UPDATE channels SET orders_enabled=$2 WHERE id=$1
      AND (NOT $2 OR (platform='fb' AND page_purpose='sales' AND messenger=1 AND message_bot_mode='rules'))`,channel.id,body.enabled);
    ensure(updated.changes,400,'Chọn Facebook Page bán hàng và bật bot Messenger theo quy tắc trước.');
    return json(res,200,{ok:true});
  }

  @Post('status')
  async status(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req);
    const channel = await access(req.actor,string(body.channel,50,{required:true}));
    const code = string(body.code,16,{required:true}).toUpperCase();
    const previous = choicesOf(body.previous,states);
    const status = choicesOf(body.status,states);
    ensure(status===previous||transitions[previous].includes(status),400,'Không thể chuyển đơn sang trạng thái này.');
    const tracking = string(body.tracking,100);
    ensure(Number.isSafeInteger(body.updated),400,'Thông tin phiên bản đơn không hợp lệ.');
    const now = Math.max(Date.now(),body.updated+1);
    const row = await get(`UPDATE shop_orders SET status=$3,tracking=$4,updated=$5,
      carrier=CASE WHEN tracking=$4 THEN carrier END,shipment=CASE WHEN tracking=$4 THEN shipment END,
      history=CASE WHEN status<>$3 THEN history||jsonb_build_array(jsonb_build_object('status',$3::text,'at',$5::bigint)) ELSE history END
      WHERE channel_id=$1 AND code=$2 AND status=$6 AND updated=$7 AND archived_at IS NULL AND (carrier IS DISTINCT FROM 'ghn' OR tracking='' OR (tracking=$4 AND $3=$6)) AND (ghn_shop IS NULL OR (tracking=$4 AND ($3<>'cancelled' OR status='cancelled' OR (tracking='' AND ghn_next IS NULL)))) RETURNING code`,
      channel.id,code,status,tracking,now,previous,body.updated);
    ensure(row,409,'Đơn đã thay đổi. Tải lại danh sách và thử lại.');
    return json(res,200,{ok:true});
  }
}
