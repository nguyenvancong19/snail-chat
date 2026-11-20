import { access, all, get, run, transaction } from '../db/store.mjs';
import { agentIncluded, requirePlanFeature } from '../billing/plan-features.mjs';
import { choicesOf, ensure, string } from '../http/validation.mjs';
import { messageWindow, messengerEnabled, queueReply } from '../meta/meta.mjs';
import { checkoutTemplates, currentOrderItems, orderReply } from '../orders/order-flow.mjs';

const lineText=({name,sku,color,size,quantity})=>quantity+' × '+name+' ('+sku+')'+
  (color?' · màu '+color:'')+(size?' · size '+size:'');

async function reviewScope(user,id) {
  const plan=await requirePlanFeature(user.currentShop.id,'messages');
  ensure(agentIncluded(plan),403,'Gói hiện tại không hỗ trợ Agent.');
  const message=ensure(await get(`SELECT m.* FROM inbox_messages m JOIN channels c ON c.id=m.channel_id
    WHERE m.id=$1 AND c.shop_id=$2 AND m.order_review IS NOT NULL`,id,user.currentShop.id),
  404,'Không tìm thấy yêu cầu xác nhận sản phẩm.');
  const channel=await access(user,message.channel_id,'chat:reply');
  ensure(messengerEnabled&&channel.platform==='fb'&&channel.messenger,409,'Kênh chưa bật Messenger.');
  return {channel,message,plan};
}

export async function reviewProducts(user,id) {
  const {channel}=await reviewScope(user,id);
  return {products:await all('SELECT sku,name,in_stock FROM catalog_products WHERE channel_id=$1 ORDER BY name,sku',channel.id)};
}

function approvedItems(input) {
  ensure(Array.isArray(input)&&input.length>=1&&input.length<=12,400,'Chọn từ 1 đến 12 sản phẩm.');
  const items=input.map(line=>{
    ensure(line&&typeof line==='object'&&Number.isInteger(line.quantity)&&line.quantity>=1&&line.quantity<=99,
      400,'Số lượng mỗi sản phẩm phải từ 1 đến 99.');
    return {sku:string(line.sku,50,{required:true}).toUpperCase(),quantity:line.quantity,
      size:string(line.size,32),color:string(line.color,48),variant_reviewed:true};
  });
  ensure(new Set(items.map(({sku})=>sku)).size===items.length,400,'Chọn mỗi mã sản phẩm một lần.');
  return items;
}

export async function resolveProductReview(user,id,body) {
  const action=choicesOf(body.action,['confirm','clarify']);
  const requested=action==='confirm'?approvedItems(body.items):[];
  const {channel,message,plan}=await reviewScope(user,id);
  return transaction(async()=>{
    // Match takeover and incoming message lock order before touching the draft.
    await run(`INSERT INTO messenger_contacts(channel_id,sender_id,last_inbound) VALUES($1,$2,$3)
      ON CONFLICT(channel_id,sender_id) DO NOTHING`,channel.id,message.sender_id,message.created);
    const contact=await get(`SELECT last_inbound,agent_resume_at FROM messenger_contacts
      WHERE channel_id=$1 AND sender_id=$2 FOR UPDATE`,channel.id,message.sender_id);
    const current=await get('SELECT * FROM inbox_messages WHERE id=$1 FOR UPDATE',message.id);
    if(current.order_review.decision){
      ensure(current.order_review.decision===action,409,'Yêu cầu đã được Shop xử lý.');
      return {orderReview:current.order_review};
    }
    const now=Date.now();
    ensure(current.created>now-messageWindow&&current.status==='review',409,'Tin nhắn đã hết hạn hoặc đã được xử lý.');
    ensure(contact.last_inbound<=current.created&&!await get(`SELECT 1 FROM inbox_messages
      WHERE channel_id=$1 AND sender_id=$2 AND (created,id)>($3,$4) LIMIT 1`,
      channel.id,current.sender_id,current.created,current.id),409,'Khách đã nhắn thêm. Hãy xem tin mới nhất trước khi xác nhận.');
    ensure(contact.agent_resume_at<=now,409,'Hãy bật lại Agent trước khi chuyển yêu cầu này.');
    let reply='Dạ, bạn cho shop xin tên mẫu, màu, size (nếu có) và số lượng bạn muốn lấy để shop kiểm tra giúp nhé.';
    let items=[];
    if(action==='confirm'){
      items=await currentOrderItems(channel.id,requested);
      ensure(items.every(item=>item.available),409,'Có sản phẩm đã hết hàng hoặc không còn trong danh mục.');
      if(channel.orders_enabled&&channel.page_purpose==='sales'&&plan.order_management){
        ensure(!await get(`SELECT 1 FROM order_verifications WHERE channel_id=$1 AND sender_id=$2 AND status IN ('pending','verified')`,
          channel.id,current.sender_id),409,'Hội thoại đang có đơn chờ xử lý. Hãy hoàn thành đơn đó trước.');
        reply=await orderReply(channel.id,current.sender_id,current.text,checkoutTemplates(channel.message_bot_policy,channel.order_templates),
          channel.message_bot_policy?.unifiedAgent?[]:channel.order_cases,{kind:'buy',items:requested});
      }else reply='Dạ, shop đã kiểm tra các sản phẩm sau:\n'+items.map(lineText).join('\n')+
        '\nBạn cho shop xin khu vực nhận hàng để mình kiểm tra phí giao nhé.';
    }
    ensure(reply&&reply.length<=1000,400,'Nội dung xác nhận quá dài. Hãy xác nhận ít sản phẩm hơn hoặc nhờ Agent hỏi lại.');
    const orderReview={items:action==='confirm'?items:current.order_review.items,decision:action,at:now};
    await queueReply(current,reply,true,'product-review-'+id,{actorId:user.id});
    await run('UPDATE inbox_messages SET order_review=$2, sales_sku=COALESCE($3,sales_sku) WHERE id=$1',id,orderReview,items[0]?.sku??null);
    return {orderReview};
  });
}
