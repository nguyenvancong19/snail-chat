import { randomBytes } from 'node:crypto';
import { all, get, run } from '../db/store.mjs';

export const orderLabels={new:'Đơn mới',packing:'Đang đóng gói',shipping:'Đang giao',delivered:'Đã giao',cancelled:'Đã hủy'};
const money=(value)=>new Intl.NumberFormat('vi-VN').format(value)+'đ';
const draftLifetime=30*60_000;
const orderCode=()=>randomBytes(8).toString('hex').toUpperCase();

export function orderCommand(text) {
  const value=text.trim();
  const command=value.normalize('NFC');
  const multi=/^(?:mua|đặt hàng|dat hang)\s+([\s\S]*,[\s\S]*)$/iu.exec(command);
  if(multi){
    const entries=multi[1].split(',').map((part)=>/^([a-z0-9_-]{1,50})\s+x\s*(\d{1,3})$/iu.exec(part.trim()));
    if(entries.every(Boolean))return {kind:'buy',items:entries.map((entry)=>({sku:entry[1].toUpperCase(),quantity:Number(entry[2])}))};
  }
  const buy=/^(?:mua|đặt hàng|dat hang)\s+([a-z0-9_-]{1,50})(?:\s+(?:x\s*)?(\d{1,3}))?$/iu.exec(command);
  if(buy)return {kind:'buy',sku:buy[1].toUpperCase(),quantity:Number(buy[2]??1)};
  const quote=/^(?:giá|gia|báo giá|bao gia)\s+([a-z0-9_-]{1,50})$/iu.exec(command);
  if(quote&&!/^(?:bao|nhieu|sao|la|bn)$/i.test(quote[1]))return {kind:'quote',sku:quote[1].toUpperCase()};
  const confirm=/^(?:xác nhận|xac nhan)\s+([a-f0-9]{16})$/iu.exec(command);
  if(confirm)return {kind:'confirm',code:confirm[1].toUpperCase()};
  const track=/^(?:tra đơn|tra don)\s+([a-f0-9]{16})$/iu.exec(command);
  if(track)return {kind:'track',code:track[1].toUpperCase()};
  if(/^(?:hủy nháp|huy nhap)$/iu.test(command))return {kind:'cancel'};
  if(/^(?:mua|đặt hàng|dat hang)$/iu.test(command))return {kind:'help'};
  if(value.includes('|'))return {kind:'details',parts:value.split('|').map((part)=>part.trim())};
  return null;
}

export const caseFields={
  incoming:[],buyIdentify:[],buyResume:['code','name','sku','quantity','total'],productDetails:['name','sku','description'],identifyProduct:[],quote:['name','sku','price','stock'],buy:['name','sku','price','stock','quantity'],
  confirm:['name','sku','price','stock','quantity','total','code'], waiting:['code','customer'],
  verified:['code','customer'],placed:['code'],track:['code','status','tracking'],
  help:[],unknownProduct:[],quantity:[],noOrder:['code'],expired:[],cancelled:[],
  invalidCode:[],unavailable:['name','sku','stock','price'],invalidDetails:[],missingDetails:[],
  priceChanged:['name','sku','price','stock','quantity','total','code'],sendingVerification:['code','customer'],
  unknownImage:[],
};
export const caseRequired={quote:caseFields.quote,productDetails:['description'],confirm:['name','quantity','total','code'],priceChanged:['total','code'],track:['status']};
const words=(value)=>value.normalize('NFC').toLocaleLowerCase('vi').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function canonicalPhone(value) {
  const compact=value?.replace(/[\s().-]/g,'');
  if(!/^\+?\d{8,15}$/.test(compact??''))return '';
  return compact.replace(/^\+?84(\d{9})$/,'0$1').replace(/^\+/,'');
}
const agentCheckoutTemplates={
  quote:'{name} ({sku}) hiện {stock}, giá {price}.',
  buy:'Bạn chọn {quantity} × {name} ({sku}). Bạn gửi Họ tên | Số điện thoại | Địa chỉ để shop lên đơn và giao đúng nơi nhé.',
  confirm:'Đơn của bạn gồm {quantity} × {name} ({sku}), tiền hàng {total}. Nếu thông tin đúng, gửi XÁC NHẬN {code}.',
  waiting:'Shop đã nhận xác nhận cho đơn {code} và đang kiểm tra thông tin nhận hàng.',
  verified:'Thông tin nhận hàng của bạn đã được xác minh. Shop đang tạo đơn {code}.',
  placed:'Shop đã tạo đơn {code} cho bạn.',
  sendingVerification:'Shop đã xác minh thông tin đơn {code} và đang xử lý.',
  unavailable:'Sản phẩm {name} ({sku}) hiện chưa có sẵn.',
  unknownProduct:'Shop chưa tìm thấy mã sản phẩm này. Bạn gửi lại mã hoặc tên sản phẩm nhé.',
  invalidDetails:'Bạn gửi theo mẫu Họ tên | Số điện thoại | Địa chỉ nhé.',
  missingDetails:'Shop cần Họ tên | Số điện thoại | Địa chỉ trước khi xác nhận đơn.',
  invalidCode:'Mã xác nhận chưa đúng. Bạn kiểm tra mã mới nhất shop đã gửi nhé.',
  expired:'Đơn nháp đã hết hạn. Bạn gửi lại sản phẩm và số lượng muốn đặt nhé.',
  priceChanged:'Giá đã thay đổi. {quantity} × {name}, tiền hàng {total}. Nếu đồng ý, gửi XÁC NHẬN {code}.',
  track:'Đơn {code} hiện có trạng thái {status}.{tracking}',
  noOrder:'Shop chưa tìm thấy đơn {code} trong cuộc trò chuyện này.',
  cancelled:'Shop đã hủy đơn nháp.',
  quantity:'Bạn cho shop số lượng từ 1 đến 99 nhé.',
};
export const checkoutTemplates=(policy,templates)=>policy?.unifiedAgent
  ?agentCheckoutTemplates:templates;

export function salesReply(templates,key,values,cases=[],text='') {
  const input=' '+words(text)+' ';
  const custom=cases.find((item)=>item.event===key&&item.match&&input.includes(' '+words(item.match)+' '))??
    cases.find((item)=>item.event===key&&!item.match);
  const saved=custom?.reply??templates?.[key];
  const template=key==='confirm'&&saved&&!saved.includes('{code}')?saved+' {code}':saved;
  return template?.replace(/\{([a-z]+)\}/g,
    (placeholder,name)=>Object.hasOwn(values,name)?String(values[name]):placeholder)??null;
}
export const productValues=(p)=>({name:p.name,sku:p.sku,stock:p.in_stock?'còn hàng':'hết hàng',price:money(p.price)});
export const quoteFor=(product,templates,cases=[],text='')=>salesReply(templates,'quote',productValues(product),cases,text);

export function orderItems(order){
  return order.items?.length?order.items:[{sku:order.sku,name:order.product_name??order.sku,
    quantity:order.quantity,unit_price:order.unit_price}];
}

export const orderTotal=(order)=>orderItems(order).reduce((sum,line)=>sum+line.unit_price*line.quantity,0);
const lineTitle=(line)=>line.quantity+' × '+line.name+' ('+line.sku+')'+(line.color?' · màu '+line.color:'')+(line.size?' · size '+line.size:'');
const lineSummary=(items)=>items.map(lineTitle).join('\n');

export async function currentOrderItems(channelId,items){
  const products=await all(`SELECT sku,name,price,in_stock FROM catalog_products
    WHERE channel_id=$1 AND sku=ANY($2::text[]) ORDER BY sku FOR SHARE`,channelId,items.map(({sku})=>sku));
  return items.map((line)=>{
    const product=products.find(({sku})=>sku===line.sku);
    return {...line,name:product?.name??line.name??line.sku,unit_price:product?.price??0,available:product?.in_stock===true};
  });
}

async function startMultiOrder(channelId,senderId,items,now){
  if(!items.length||items.length>12||new Set(items.map(({sku})=>sku)).size!==items.length||
    items.some(({quantity})=>!Number.isInteger(quantity)||quantity<1||quantity>99)){
    return 'Bạn gửi mỗi mã sản phẩm một lần cùng số lượng từ 1 đến 99 nhé.';
  }
  const cart=await currentOrderItems(channelId,items);
  const unavailable=cart.filter(({available})=>!available);
  if(unavailable.length)return 'Shop chưa thể đặt các mã '+unavailable.map(({sku})=>sku).join(', ')+
    '. Bạn kiểm tra lại danh sách mẫu muốn mua giúp shop nhé.';
  const previous=await get('SELECT * FROM order_drafts WHERE channel_id=$1 AND sender_id=$2 AND expires>$3 FOR UPDATE',
    channelId,senderId,now);
  const code=orderCode();
  const [first]=cart;
  await run(`INSERT INTO order_drafts(channel_id,sender_id,code,sku,quantity,unit_price,expires,items,customer,phone,address)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(channel_id,sender_id) DO UPDATE SET
    code=excluded.code,sku=excluded.sku,quantity=excluded.quantity,unit_price=excluded.unit_price,
    expires=excluded.expires,items=excluded.items,customer=excluded.customer,phone=excluded.phone,address=excluded.address`,
  channelId,senderId,code,first.sku,first.quantity,first.unit_price,now+draftLifetime,JSON.stringify(cart),
  previous?.customer??null,previous?.phone??null,previous?.address??null);
  return previous?.customer?multiRecap(cart,code):
    'Shop đã ghi nhận cùng một đơn:\n'+lineSummary(cart)+'\nBạn gửi Họ tên | Số điện thoại | Địa chỉ để shop lên đơn và giao đúng nơi nhé.';
}

function multiRecap(items,code){
  const lines=items.map((line)=>lineTitle(line)+' · '+money(line.unit_price*line.quantity));
  return 'Đơn của bạn gồm:\n'+lines.join('\n')+'\nTổng tiền hàng '+money(orderTotal({items}))+'. Nếu đúng, gửi XÁC NHẬN '+code+'.';
}

export async function createShopOrder(channelId,senderId,draft,product,now,automatic,enqueue=true,actor=null) {
  const result=await run(`WITH selling_page AS (
    SELECT page.id FROM channels page JOIN entitled_shop_channels entitlement ON entitlement.id=page.id
    JOIN shops shop ON shop.id=page.shop_id AND shop.status='ACTIVE'
      AND (shop.expired_at IS NULL OR shop.expired_at>extract(epoch FROM clock_timestamp())*1000)
    JOIN subscription_plans plan ON plan.code=shop.subscription_plan
    JOIN users owner ON owner.id=shop.owner_id AND owner.active=1
    WHERE page.id=$1 AND page.platform='fb' AND page.page_purpose='sales'
      AND COALESCE((plan.feature_flags->>'orders')::boolean,plan.order_management)
      AND ($3='' OR (page.orders_enabled AND page.messenger=1))
    FOR SHARE OF page
  )
  INSERT INTO shop_orders(channel_id,code,sender_id,sku,product_name,quantity,unit_price,
    customer,phone,address,status,created,updated,history,bot_created,ghn_config,ghn_shop,ghn_next,items,created_actor)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new',$11::bigint,$11::bigint,$12,$13,c.auto_config,
      CASE WHEN c.auto_config IS NOT NULL THEN c.account_ref END,
      CASE WHEN c.auto_config IS NOT NULL THEN $11::bigint END,$15::jsonb,$16::jsonb
    FROM selling_page LEFT JOIN shop_carriers c ON c.channel_id=selling_page.id AND c.carrier='ghn' AND $14::boolean`,
    channelId,draft.code,senderId,product.sku,product.name,draft.quantity,product.price,
    draft.customer,draft.phone,draft.address,now,JSON.stringify([{status:'new',at:now}]),automatic,enqueue,draft.items?.length?JSON.stringify(draft.items):null,actor?JSON.stringify(actor):null);
  return result.changes===1;
}
function trackingQuestion(text){
  const input=words(text).normalize('NFD').replace(/\p{M}/gu,'').replaceAll('đ','d');
  return /\b(?:ma van don|tra cuu don|tra don|don hang.{0,24}(?:o dau|den dau|toi dau|chua den)|don.{0,20}(?:di den dau|toi dau|den dau|o dau|chua nhan)|du kien.{0,16}(?:nhan|giao)|(?:bao gio|khi nao|may ngay).{0,16}(?:nhan|giao)|(?:giao|nhan hang).{0,12}(?:khi nao|bao gio|may ngay|ngay nao)|trang thai don|theo doi don)\b/.test(input);
}

function trackingCode(text,question){
  const tokens=text.match(/[A-Za-z0-9][A-Za-z0-9._-]{3,49}/g)??[];
  if(!question&&tokens.length!==1)return null;
  return tokens.find((token)=>(/[0-9]/.test(token)&&(/[A-Za-z]/.test(token)||token.length>=8))||
    /^[A-Z]{5,12}$/.test(token))??null;
}

export async function shipmentCustomerReply(channelId,senderId,text,history=[]){
  const question=trackingQuestion(text);
  const code=trackingCode(text,question);
  const recentTracking=/(?:bạn gửi|kiểm tra lại) mã vận đơn hoặc mã đơn/iu.test(history[0]?.reply??'');
  if(!question&&(!recentTracking||!code))return null;
  const orders=await all(`SELECT code,tracking,carrier,shipment,status FROM shop_orders
    WHERE channel_id=$1 AND sender_id=$2 AND archived_at IS NULL
      AND ($3::text IS NULL OR UPPER(code)=UPPER($3) OR UPPER(tracking)=UPPER($3))
    ORDER BY created DESC,code DESC LIMIT 2`,channelId,senderId,code??null);
  if(!orders.length&&!code&&!/\b(?:đơn|vận đơn)\b/iu.test(text))return null;
  if(!orders.length)return code?'Shop chưa tìm được đơn khớp mã bạn gửi. Bạn kiểm tra lại mã vận đơn hoặc mã đơn để shop tra giúp nhé.':
    'Shop chưa thấy đơn trong cuộc trò chuyện này. Bạn gửi mã vận đơn hoặc mã đơn để shop kiểm tra nhé.';
  if(orders.length>1)return 'Bạn có nhiều đơn. Bạn gửi mã vận đơn hoặc mã đơn cần xem để shop tra đúng kiện hàng nhé.';
  const [order]=orders;
  const data=order.shipment;
  const tracking=data?.code||order.tracking;
  if(!tracking)return 'Đơn '+order.code+' đang ở trạng thái '+(orderLabels[order.status]??'chờ shop cập nhật')+
    '. Hãng vận chuyển chưa cấp mã, nên shop chưa có ngày giao dự kiến ạ.';
  const carrier={ghn:'Giao Hàng Nhanh (GHN)',ghtk:'Giao Hàng Tiết Kiệm (GHTK)'}[order.carrier]??'Hãng chưa được cập nhật';
  const status=data?.label||orderLabels[order.status]||'Chờ cập nhật';
  const expected=Date.parse(data?.expected??'');
  const eta=Number.isFinite(expected)?new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeZone:'Asia/Ho_Chi_Minh'}).format(expected):null;
  const terminal=['delivered','cancelled'].includes(order.status)||['delivered','cancel','returned','lost','damage'].includes(data?.status);
  return 'Mã vận đơn '+tracking+' · '+carrier+'.\nTrạng thái: '+status+'.'+
    (terminal?'':eta?'\nDự kiến giao ngày '+eta+' theo hãng vận chuyển.':'\nHãng chưa cập nhật ngày giao dự kiến ạ.');
}

export async function orderReply(channelId,senderId,text,templates,cases=[],command=orderCommand(text)) {
  const reply=(key,values)=>salesReply(templates,key,values,cases,text);
  if(!command)return reply('incoming',{});
  const recap=(product,draft,event='confirm')=>reply(event,{
    ...productValues(product),quantity:draft.quantity,total:money(product.price*draft.quantity),code:draft.code,
  });
  const pending=await get(`SELECT code,customer,status FROM order_verifications
    WHERE channel_id=$1 AND sender_id=$2 AND status IN ('pending','verified')`,channelId,senderId);
  if(pending&&(command.kind==='buy'||command.kind==='buyIdentify'||command.kind==='details'||
    (['confirm','track'].includes(command.kind)&&command.code===pending.code))){
    return reply(pending.status==='verified'?'sendingVerification':'waiting',pending);
  }
  const now=Date.now();
  if(command.kind==='help')return reply('help',{});
  if(command.kind==='buyIdentify')return reply('buyIdentify',{})??reply('identifyProduct',{})??reply('help',{});
  if(command.kind==='track'){
    const order=await get('SELECT status,tracking,shipment FROM shop_orders WHERE channel_id=$1 AND sender_id=$2 AND code=$3',channelId,senderId,command.code);
    return order?reply('track',{code:command.code,status:order.shipment?.label??orderLabels[order.status],tracking:order.tracking?' Mã vận đơn: '+order.tracking+'.':''}):
      reply('noOrder',{code:command.code});
  }
  if(command.kind==='buy'&&command.items)return startMultiOrder(channelId,senderId,command.items,now);
  if(command.kind==='buy'||command.kind==='quote'){
    const product=await get('SELECT sku,name,price,in_stock FROM catalog_products WHERE channel_id=$1 AND sku=$2',channelId,command.sku);
    if(!product)return reply('unknownProduct',{});
    if(command.kind==='quote')return reply('quote',productValues(product));
    if(!product.in_stock)return reply('unavailable',productValues(product));
    if(command.quantity<1||command.quantity>99)return reply('quantity',{});
    const response=reply('buy',{...productValues(product),quantity:command.quantity});
    if(!response)return null;
    if(command.natural){
      const draft=await get(`SELECT * FROM order_drafts WHERE channel_id=$1 AND sender_id=$2
        AND items IS NULL AND sku=$3 AND quantity=$4 AND expires>$5`,channelId,senderId,product.sku,command.quantity,now);
      if(draft?.customer){
        if(product.price!==draft.unit_price){
          const code=orderCode();
          const refreshed={...draft,code};
          const response=recap(product,refreshed,'priceChanged')??recap(product,refreshed);
          if(!response)return null;
          await run('UPDATE order_drafts SET code=$3,unit_price=$4,expires=$5 WHERE channel_id=$1 AND sender_id=$2',
            channelId,senderId,code,product.price,now+draftLifetime);
          return response;
        }
        return reply('buyResume',{...productValues(product),quantity:draft.quantity,code:draft.code,
          total:money(product.price*draft.quantity)})??recap(product,draft);
      }
    }
    const code=orderCode();
    await run(`INSERT INTO order_drafts(channel_id,sender_id,code,sku,quantity,unit_price,expires)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(channel_id,sender_id) DO UPDATE SET
      code=excluded.code,sku=excluded.sku,quantity=excluded.quantity,unit_price=excluded.unit_price,
      expires=excluded.expires,items=NULL,customer=NULL,phone=NULL,address=NULL`,
      channelId,senderId,code,product.sku,command.quantity,product.price,now+draftLifetime);
    return response;
  }

  if(command.kind==='confirm'){
    const placed=await get('SELECT code FROM shop_orders WHERE channel_id=$1 AND sender_id=$2 AND code=$3',channelId,senderId,command.code);
    if(placed)return reply('placed',{code:placed.code});
  }
  const draft=await get('SELECT * FROM order_drafts WHERE channel_id=$1 AND sender_id=$2 FOR UPDATE',channelId,senderId);
  if(!draft||draft.expires<=now)return command.kind==='details'?null:reply('expired',{});
  if(command.kind==='cancel'){
    await run('DELETE FROM order_drafts WHERE channel_id=$1 AND sender_id=$2',channelId,senderId);
    return reply('cancelled',{});
  }
  if(command.kind==='confirm'&&command.code!==draft.code)return reply('invalidCode',{});
  const multi=!!draft.items?.length;
  const items=await currentOrderItems(channelId,orderItems(draft));
  const unavailable=items.find((line)=>!line.available);
  if(unavailable){
    await run('DELETE FROM order_drafts WHERE channel_id=$1 AND sender_id=$2',channelId,senderId);
    const missing={sku:unavailable.sku,name:unavailable.name,price:unavailable.unit_price,in_stock:false};
    return reply('unavailable',productValues(missing));
  }
  const [first]=items;
  const product={sku:first.sku,name:first.name,price:first.unit_price,in_stock:true};
  const updatedItems=multi?JSON.stringify(items):null;
  if(command.kind==='details'){
    const [customer,rawPhone,address]=command.parts;
    const phone=canonicalPhone(rawPhone);
    if(command.parts.length!==3||customer.length<2||customer.length>100||!phone||
      !address||address.length<8||address.length>350)return reply('invalidDetails',{});
    const code=orderCode();
    const response=multi?multiRecap(items,code):recap(product,{...draft,code});
    if(!response)return null;
    await run(`UPDATE order_drafts SET customer=$3,phone=$4,address=$5,unit_price=$6,expires=$7,code=$8,items=$9
      WHERE channel_id=$1 AND sender_id=$2`,channelId,senderId,customer,phone,address,product.price,now+draftLifetime,code,updatedItems);
    return response;
  }
  if(!draft.customer)return reply('missingDetails',{});
  if(items.some((line,index)=>line.unit_price!==orderItems(draft)[index].unit_price)){
    const code=orderCode();
    const response=multi?'Giá đã thay đổi. '+multiRecap(items,code):
      recap(product,{...draft,code},'priceChanged')??recap(product,{...draft,code});
    if(!response)return null;
    await run('UPDATE order_drafts SET unit_price=$3,code=$4,expires=$5,items=$6 WHERE channel_id=$1 AND sender_id=$2',
      channelId,senderId,product.price,code,now+draftLifetime,updatedItems);
    return response;
  }
  const phone=canonicalPhone(draft.phone);
  const verified=await get('SELECT 1 FROM verified_buyers WHERE channel_id=$1 AND sender_id=$2 AND phone=$3',
    channelId,senderId,phone);
  const needsSizeReview=items.some((line)=>line.size&&!line.variant_reviewed);
  const canPlace=verified&&!needsSizeReview&&!command.forceVerification;
  const response=needsSizeReview?'Shop đã nhận xác nhận đơn '+draft.code+'. Shop sẽ kiểm tra size bạn chọn trước khi lên đơn ạ.':
    canPlace?reply('placed',{code:draft.code}):reply('waiting',{code:draft.code,customer:draft.customer});
  if(canPlace){
    if(!await createShopOrder(channelId,senderId,{...draft,items:multi?items:null},product,now,true))return null;
  }else{
    await run(`INSERT INTO order_verifications(channel_id,code,sender_id,sku,quantity,unit_price,customer,phone,address,confirmed_at,items,customer_check_required)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,channelId,draft.code,senderId,product.sku,draft.quantity,
      product.price,draft.customer,phone,draft.address,now,updatedItems,!verified||!!command.forceVerification);
  }
  await run('DELETE FROM order_drafts WHERE channel_id=$1 AND sender_id=$2',channelId,senderId);
  return response;
}
