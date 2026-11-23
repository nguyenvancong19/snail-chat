import { pageSize } from '../db/pagination.mjs';
import { agentCanAnswer, agentTakeoverNote } from '../workspace/inbox-workflow.mjs';
import { agentIncluded, automationAllowed, automationPauseNote, shopFeatures, withoutFaqs } from '../billing/plan-features.mjs';
import { lockBillingShop, requirePageSlot } from '../billing/limits.mjs';
import { activePage, canSendQueuedReply, ownerOnly, requireShop } from '../shops/tenant.mjs';
import { publicProductInvitation, runSalesAgent } from '../ai/sales-agent.mjs';
import { understandConversation } from '../ai/conversation.mjs';
import { classifySalesMessage, naturalBuyCommand } from '../orders/order-intent.mjs';
import { checkoutTemplates, createShopOrder, orderCommand, orderReply, quoteFor, salesReply, shipmentCustomerReply } from '../orders/order-flow.mjs';
import { catalogImage, catalogQuestion, matchCatalogImage } from '../catalog/catalog-vision.mjs';
import { acknowledgementTemplates, commentDecision, containsBlockedPhrase, decideBotReply, messengerGreeting, renderBotReply } from '@reeldesk/bot-rules';
import { createHmac } from 'node:crypto';
import { AppError, ensure } from '../http/validation.mjs';
import { get, all, run, transaction, uid, access } from '../db/store.mjs';
import { seal, unseal, safeEqual } from '../auth/crypto.mjs';
import { receivedMessengerAttachments } from './messenger-media.mjs';

export const origin = new URL(process.env.APP_URL||'http://127.0.0.1:3000').origin;
const version=process.env.META_GRAPH_VERSION||'v26.0';
ensure(/^v\d+\.0$/.test(version),500,'META_GRAPH_VERSION không hợp lệ.');
const settings = {
  fb:{id:process.env.FB_APP_ID,secret:process.env.FB_APP_SECRET,verify:process.env.FB_WEBHOOK_TOKEN,base:'https://graph.facebook.com/'+version},
  ig:{id:process.env.IG_APP_ID,secret:process.env.IG_APP_SECRET,verify:process.env.IG_WEBHOOK_TOKEN,base:'https://graph.instagram.com/'+version}
};
const insightsEnabled=process.env.META_INSIGHTS_ENABLED==='1';
export const messengerEnabled=process.env.FB_MESSENGER_ENABLED==='1';
export const queueEnabled=process.env.QUEUE_ENABLED!=='0';
const fbScopes='pages_show_list,pages_read_engagement,pages_manage_metadata,pages_read_user_content,pages_manage_engagement'+(messengerEnabled?',pages_messaging':'');
const igScopes='instagram_business_basic,instagram_business_manage_comments';
export const configured=(p)=>!!(settings[p]?.id&&settings[p]?.secret&&settings[p]?.verify);
class MetaError extends Error {
  constructor(message,{retry=false,ambiguous=false,code=0,subcode=0,traceId='',httpStatus=0}={}){
    super(message);
    Object.assign(this,{retry,ambiguous,code,subcode,traceId,httpStatus});
  }
}
async function request(url,{token,fields,params,method='GET',body,headers={},timeout=30_000}={}) {
  const target=new URL(url);
  if(params)for(const [k,v] of Object.entries(params))target.searchParams.set(k,String(v));
  if(fields)target.searchParams.set('fields',fields);
  const opts={method,headers:{...headers,...(token?{Authorization:'Bearer '+token}:{})},signal:AbortSignal.timeout(timeout),redirect:'error'};
  if(body){opts.body=body;opts.duplex='half';}
  let resp;
  try {resp=await fetch(target,opts);}
  catch {throw new MetaError('Không nhận được phản hồi từ Meta.',{retry:true,ambiguous:method==='POST'});}
  let result;
  try{result=await resp.json();}
  catch{throw new MetaError('Meta trả phản hồi không hợp lệ ('+resp.status+').',{retry:resp.status>=500||resp.status===429,ambiguous:method==='POST'&&(resp.ok||resp.status>=500)});}
  if(!resp.ok||result?.error){
    const code=Number(result?.error?.code||result?.code||0);
    const retry=resp.status>=500||resp.status===429||!!result?.error?.is_transient||[4,17,32,613].includes(code);
    const message=code===190?'Phiên Meta hết hạn hoặc đã bị thu hồi. Hãy kết nối lại kênh.':'Meta từ chối yêu cầu'+(code?' (mã '+code+')':' (HTTP '+resp.status+')')+'.';
    const subcode=Number(result?.error?.error_subcode)||0;
    const traceId=String(result?.error?.fbtrace_id??'');
    throw new MetaError(message,{retry,ambiguous:method==='POST'&&resp.status>=500,code,subcode,
      traceId:/^[A-Za-z0-9_-]{1,100}$/.test(traceId)?traceId:'',httpStatus:resp.status});
  }
  return result;
}
const graph=(p,path,opts)=>request(settings[p].base+'/'+path,opts);
const postGraph=(p,path,token,params)=>graph(p,path,{token,method:'POST',body:new URLSearchParams(params)});
const callback=(p)=>origin+'/api/meta/callback/'+p;
const pathId=(value)=>encodeURIComponent(String(value));
export async function oauthStart(user,p,channel) {
  ownerOnly(user);
  const cfg=settings[p];
  ensure(configured(p),503,'Máy chủ chưa có cấu hình Meta cho kênh.');
  ensure(new URL(origin).protocol==='https:',503,'Kết nối Meta cần URL công khai dùng HTTPS.');
  const state=uid();
  await run('INSERT INTO oauth(state,session_id,channel_id,platform,expires,shop_id) VALUES($1,$2,$3,$4,$5,$6)',
    state,user.session_id,channel?.id??null,p,Date.now()+10*60000,user.currentShop.id);
  const params={client_id:cfg.id,redirect_uri:callback(p),state,response_type:'code',scope:p==='fb'?fbScopes+(insightsEnabled?',read_insights':''):igScopes+(insightsEnabled?',instagram_business_manage_insights':'')};
  const url=new URL(p==='fb'?'https://www.facebook.com/'+version+'/dialog/oauth':'https://www.instagram.com/oauth/authorize');
  if(p==='ig')Object.assign(params,{enable_fb_login:'0',force_authentication:'1'});
  url.search=new URLSearchParams(params).toString();
  return url.toString();
}
export async function oauthCallback(user,p,params) {
  const state=params.get('state'), code=params.get('code'), cfg=settings[p];
  ensure(configured(p),503,'Máy chủ chưa có cấu hình Meta.');
  const row=await get('DELETE FROM oauth WHERE state=$1 AND session_id=$2 AND platform=$3 AND expires>$4 RETURNING *',state,user.session_id,p,Date.now());
  ensure(row,400,'Phiên kết nối Meta đã hết hạn hoặc không hợp lệ.');
  user=await requireShop(user,row.shop_id);
  ownerOnly(user);
  ensure(code,400,'Bạn chưa cấp quyền trên Meta. Hãy thử kết nối lại khi sẵn sàng.');
  await checkConnectionAccess(user,row.channel_id);
  if(p==='ig') {
    const short=await request('https://api.instagram.com/oauth/access_token',{method:'POST',body:new URLSearchParams({client_id:cfg.id,client_secret:cfg.secret,grant_type:'authorization_code',redirect_uri:callback(p),code})});
    ensure(short.access_token,502,'Instagram không trả access token.');
    const token=await request('https://graph.instagram.com/access_token',{params:{grant_type:'ig_exchange_token',client_secret:cfg.secret,access_token:short.access_token}});
    ensure(token.access_token,502,'Instagram không trả token dài hạn.');
    const profile=await graph('ig','me',{token:token.access_token,fields:'user_id,username'});
    ensure(profile.user_id||profile.id,502,'Không xác định được tài khoản Instagram.');
    await attach(user,row.channel_id,p,{id:String(profile.user_id||profile.id),token:token.access_token,name:profile.username,handle:profile.username,expires:Date.now()+Number(token.expires_in||5184000)*1000});
    return '/dashboard?meta=ok&shop='+encodeURIComponent(row.shop_id)+'#channels';
  }
  const short=await graph('fb','oauth/access_token',{params:{client_id:cfg.id,client_secret:cfg.secret,redirect_uri:callback(p),code}});
  ensure(short.access_token,502,'Facebook không trả access token.');
  const long=await graph('fb','oauth/access_token',{params:{grant_type:'fb_exchange_token',client_id:cfg.id,client_secret:cfg.secret,fb_exchange_token:short.access_token}});
  ensure(long.access_token,502,'Facebook không trả token dài hạn.');
  const pages=new Map();
  let after;
  for(let i=0;i<10;i++){
    const page=await graph('fb','me/accounts',{token:long.access_token,fields:'id,name,access_token,tasks',params:{limit:100,...(after?{after}:{})}});
    for(const item of page.data??[]){
      const id=String(item.id??'');
      if(id&&item.access_token)pages.set(id,{id,name:item.name,token:item.access_token});
    }
    after=page.paging?.next&&page.paging?.cursors?.after;
    if(!after)break;
  }
  const previous=await checkConnectionAccess(user,row.channel_id);
  const eligible=[...pages.values()].filter(({id})=>!previous?.meta_id||previous.meta_id===id);
  ensure(eligible.length,400,previous?.meta_id
    ?'Facebook chưa cấp lại quyền cho Page của kênh này.'
    :'Facebook chưa cấp quyền cho Page nào. Hãy đăng nhập bằng tài khoản quản lý Page và chọn Page khi cấp quyền.');
  const choice=uid();
  await run('INSERT INTO meta_choices(id,session_id,channel_id,expires,choices,shop_id) VALUES($1,$2,$3,$4,$5,$6)',choice,user.session_id,row.channel_id,Date.now()+10*60000,seal(JSON.stringify(eligible)),row.shop_id);
  return '/dashboard?meta=choose&flow='+choice+'&shop='+encodeURIComponent(row.shop_id)+'#channels';
}
export async function pageChoices(user,flow) {
  const row=await get('SELECT * FROM meta_choices WHERE id=$1 AND session_id=$2 AND expires>$3 AND shop_id=$4',flow??'',user.session_id,Date.now(),user.currentShop.id);
  ensure(row,404,'Phiên chọn Facebook Page đã hết hạn.');
  await checkConnectionAccess(user,row.channel_id);
  return {row,options:JSON.parse(unseal(row.choices))};
}
export async function choosePages(user,flow,ids) {
  const {row,options}=await pageChoices(user,flow);
  ensure(!row.channel_id||ids.length===1,400,'Mỗi kênh hiện có chỉ có thể kết nối một Page.');
  const requested=ids.map((id)=>ensure(options.find((page)=>page.id===id),400,'Page chưa được Facebook cấp quyền.'));
  const results=await Promise.all(requested.map(async(choice)=>{
    try {
      await attach(user,row.channel_id,'fb',choice);
      return {id:choice.id};
    } catch(error){
      if(!(error instanceof AppError||error instanceof MetaError))throw error;
      return {id:choice.id,name:choice.name||choice.id,message:error.message};
    }
  }));
  // Keep the grant available until it expires so partial failures can be retried.
  return {connected:results.filter((page)=>!page.message).map((page)=>page.id),failed:results.filter((page)=>page.message)};
}
async function checkConnectionAccess(user,channelId) {
  ownerOnly(await requireShop(user,user.currentShop?.id));
  ensure(await get("SELECT 1 FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id=$1 AND users.id=$2 AND users.active=1 AND users.email_verified_at IS NOT NULL AND sessions.expires>$3",user.session_id,user.id,Date.now()),403,'Phiên kết nối đã hết hiệu lực.');
  return channelId?await access(user,channelId):null;
}
async function connectionTarget(user,channelId,p,id){
  const previous=await checkConnectionAccess(user,channelId);
  ensure(!previous||previous.platform===p,404,'Không tìm thấy kênh.');
  ensure(!previous?.meta_id||previous.meta_id===id,409,'Kênh này đã gắn với một tài khoản Meta khác.');
  const linked=await get('SELECT id,shop_id FROM channels WHERE platform=$1 AND meta_id=$2',p,id);
  ensure(!linked||(linked.shop_id===user.currentShop.id&&(!previous||linked.id===previous.id)),409,
    'Tài khoản Meta này đã được liên kết với một kênh khác.');
  return previous?.id??linked?.id;
}
async function attach(user,channelId,p,choice){
  if(!await connectionTarget(user,channelId,p,choice.id)){
    const shop=await get('SELECT * FROM shops WHERE id=$1',user.currentShop.id);
    await requirePageSlot(shop);
  }
  const messenger=p==='fb'&&messengerEnabled;
  const fields=p==='ig'?'comments':messenger?'feed,messages,message_echoes':'feed';
  const subscribed=await postGraph(p,pathId(choice.id)+'/subscribed_apps',choice.token,{subscribed_fields:fields});
  ensure(subscribed.success===true||subscribed.success==='true',502,'Meta chưa xác nhận đăng ký webhook. Hãy kiểm tra cấu hình ứng dụng.');
  await transaction(async()=>{
    const shop=await lockBillingShop(user.currentShop.id);
    await run('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',p+':'+choice.id);
    if(channelId)await get('SELECT id FROM channels WHERE id=$1 FOR UPDATE',channelId);
    const target=await connectionTarget(user,channelId,p,choice.id);
    const name=String(choice.name||choice.id).slice(0,200);
    const handle=String(choice.handle||choice.id).slice(0,200);
    const token=seal(choice.token);
    if(target){
      await run('UPDATE channels SET name=$1,handle=$2,meta_id=$3,token=$4,expires=$5,webhook=1,messenger=$6 WHERE id=$7',
        name,handle,choice.id,token,choice.expires??null,Number(messenger),target);
    }else{
      await requirePageSlot(shop);
      await run('INSERT INTO channels(id,name,handle,platform,owner_id,meta_id,token,expires,webhook,messenger,shop_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10)',
        uid(),name,handle,p,user.id,choice.id,token,choice.expires??null,Number(messenger),user.currentShop.id);
    }
  });
}
export function verifySubscription(p,params) {
  const value=params.get('hub.verify_token');
  ensure(configured(p)&&params.get('hub.mode')==='subscribe'&&value&&safeEqual(value,settings[p].verify),403,'Webhook không được xác thực.');
  return ensure(params.get('hub.challenge'),400,'Thiếu thử thách webhook.');
}
export function signedWebhook(p,bytes,signature) {
  ensure(configured(p)&&signature,403,'Webhook không được xác thực.');
  const expected='sha256='+createHmac('sha256',settings[p].secret).update(bytes).digest('hex');
  ensure(safeEqual(expected,signature),403,'Chữ ký webhook không hợp lệ.');
}
function validToken(c){
  return unseal(ensure(c?.token&&(!c.expires||c.expires>Date.now())&&c.token,
    409,'Kết nối Meta chưa có hoặc đã hết hạn. Hãy cấp lại quyền cho kênh.'));
}
export const privateReplyWindow=7*24*60*60_000;
export async function sendFacebookPrivateReply(channel,comment,text,automatic=false,sku=null){
  ensure(await activePage(channel.id),403,'Shop đang bị khóa hoặc đã hết hạn.');
  ensure(messengerEnabled&&channel.platform==='fb'&&channel.messenger&&channel.meta_id,
    409,'Hãy cấp quyền Messenger cho Facebook Page này.');
  ensure(comment.created>Date.now()-privateReplyWindow,409,'Đã quá 7 ngày kể từ lúc khách bình luận.');
  ensure(/^\d+(?:_\d+)?$/.test(comment.remote_id),400,'Mã bình luận Facebook không hợp lệ.');
  const plan=await shopFeatures(channel.shop_id);
  ensure(plan?.feature_flags.comments&&plan.feature_flags.messages,403,'Gói hiện tại cần có Tin nhắn và Bình luận.');
  if(automatic){
    ensure(automationAllowed(plan,comment.created),403,automationPauseNote(plan));
  }
  const token=validToken(channel);
  const key=comment.facebook_key;
  const claimed=await get(`INSERT INTO facebook_private_replies(channel_id,comment_key,status,started)
    VALUES($1,$2,'sending',$3) ON CONFLICT(channel_id,comment_key) DO UPDATE
    SET status='sending',started=excluded.started,error=NULL WHERE facebook_private_replies.status='failed'
    RETURNING started`,channel.id,key,Date.now());
  ensure(claimed,409,'Bình luận này đã gửi tin riêng hoặc đang chờ đối chiếu.');
  const finish=(status,error,mid=null)=>run(`UPDATE facebook_private_replies SET status=$3,error=$4,message_id=$5,automatic=$7
    WHERE channel_id=$1 AND comment_key=$2 AND started=$6 AND status='sending'`,
    channel.id,key,status,error,mid,claimed.started,automatic);
  let result;
  try{
    result=await graph('fb',pathId(channel.meta_id)+'/messages',{
      token,method:'POST',headers:{'Content-Type':'application/json'},timeout:12_000,
      body:JSON.stringify({recipient:{comment_id:comment.remote_id},message:{text}}),
    });
  }catch(error){
    const uncertain=!(error instanceof MetaError)||error.ambiguous;
    const message=uncertain?'Chưa xác định Meta đã gửi. Hãy kiểm tra Meta Business Suite.':error.message;
    await finish(uncertain?'uncertain':'failed',message);
    throw new AppError(502,message);
  }
  const mid=s(result?.message_id),recipient=s(result?.recipient_id);
  if(!mid){
    const message='Meta chưa trả mã tin nhắn. Hãy đối chiếu trong Meta Business Suite.';
    await finish('uncertain',message);
    throw new AppError(502,message);
  }
  await transaction(async()=>{
    await finish('sent',null,mid);
    if(/^\d{1,40}$/.test(recipient)){
      await run(`INSERT INTO messenger_page_messages(channel_id,remote_id,recipient_id,created,text,sales_sku)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(channel_id,remote_id) DO NOTHING`,channel.id,mid,recipient,Date.now(),text,sku);
    }
  });
}
function idMatches(a,b){
  if(!a||!b)return false;
  return a===b||a.split('_').at(-1)===b.split('_').at(-1);
}
const s=(value)=>typeof value==='string'||typeof value==='number'?String(value):'';
export const messageWindow=24*60*60_000;

export function postKey(channel,id) {
  const prefix=channel.meta_id+'_';
  return channel.platform==='fb'&&id.startsWith(prefix)?id.slice(prefix.length):id;
}

function facebookCommentKey(id) {
  return /^\d+_\d+$/.test(id)?id.split('_')[1]:id;
}

async function rememberFacebookCommentLink(channelId,media,comment,parent,observed=true) {
  if(!media||!comment||!parent||facebookCommentKey(comment)===facebookCommentKey(parent))return;
  await run(`INSERT INTO facebook_comment_links(channel_id,media_key,comment_key,parent_remote_id) VALUES($1,$2,$3,$4)
    ON CONFLICT(channel_id,media_key,comment_key) ${observed
      ?'DO UPDATE SET parent_remote_id=excluded.parent_remote_id WHERE facebook_comment_links.parent_remote_id<>excluded.parent_remote_id'
      :'DO NOTHING'}`,channelId,facebookCommentKey(media),facebookCommentKey(comment),parent);
}

export function facebookCommentRoot(channelId,media,remoteId) {
  if(!media)return null;
  return get(`WITH RECURSIVE ancestors(key) AS (
      SELECT $3::text
      UNION
      SELECT link.parent_key FROM ancestors a
      JOIN facebook_comment_links link ON link.channel_id=$1 AND link.media_key=$2 AND link.comment_key=a.key
    )
    SELECT a.key FROM ancestors a WHERE NOT EXISTS (
      SELECT 1 FROM facebook_comment_links l WHERE l.channel_id=$1 AND l.media_key=$2 AND l.comment_key=a.key
    ) LIMIT 1`,channelId,facebookCommentKey(media),facebookCommentKey(remoteId));
}

export async function postBot(channel,mediaId,altId='',legacyId=null) {
  if(mediaId){
    const rule=await get('SELECT bot_mode,comment_policy FROM post_bot_settings WHERE channel_id=$1 AND media_id=$2',
      channel.id,postKey(channel,mediaId));
    if(rule)return rule;
  }
  const ids=[...new Set([mediaId,altId].filter(Boolean).flatMap((id)=>{
    const key=postKey(channel,id);
    return channel.platform==='fb'?[key,channel.meta_id+'_'+key]:[key];
  }))];
  return get(`SELECT id,bot_mode FROM posts WHERE channel_id=$1 AND status='published'
    AND (id=$2 OR remote_id=ANY($3::text[]) OR alias_id=ANY($3::text[]))
    ORDER BY (id=$2) DESC NULLS LAST, scheduled DESC LIMIT 1`,channel.id,legacyId,ids);
}

const agentEnabled=(policy)=>!!(policy?.agentMarkdown||policy?.unifiedAgent)&&['review','auto'].includes(policy.agentMode);
const buyerIntent=(text)=>/(?:muốn mua|muon mua|đặt mua|đặt hàng|dat hang|chốt|chot|lấy|lay|\bmua\b)/iu.test(text)&&
  !/[?]|(?:không|chưa|có nên|nếu|cân nhắc|hỏi thử|ko mua|k mua|ko lấy|k lấy|chưa chốt)/iu.test(text);

async function storeComment(c,event) {
  if(c.platform==='fb'&&event.parent)await rememberFacebookCommentLink(c.id,event.media,event.comment,event.parent);
  if(!event.comment||!event.media||idMatches(event.by,c.meta_id))return 'filtered';
  const created=event.created??Date.now();
  const plan=await shopFeatures(c.shop_id);
  const permitted=plan?.feature_flags.comments&&automationAllowed(plan,created);
  const text=event.text.trim().slice(0,4000);
  const unavailable='Meta không cung cấp nội dung văn bản.';
  const rule=await postBot(c,event.media,event.video);
  const unified=c.platform==='fb'&&c.message_bot_policy?.unifiedAgent;
  const policy=withoutFaqs(unified?c.message_bot_policy:rule?.bot_mode==='inherit'||!rule?c.comment_policy:rule.comment_policy,plan);
  const mode=unified?policy.agentMode:rule?.bot_mode&&rule.bot_mode!=='inherit'?rule.bot_mode:c.bot_mode;
  const custom=mode!=='off'&&policy?.version===2;
  const decision=mode!=='off'&&!custom&&containsBlockedPhrase(text,policy?.blocked)
    ?{category:'Nội dung bị chặn',action:'blocked',reply:''}:custom
    ?decideBotReply(policy,text,{manualOnly:!permitted||mode!=='auto'||!!event.parent||event.reviewOnly})
    :event.parent?{category:'Phản hồi trong luồng',reply:''}:commentDecision(mode==='auto'?policy:null,text);
  const reply=permitted&&queueEnabled&&mode==='auto'&&!unified&&!agentEnabled(policy)&&!event.reviewOnly&&text&&
    (custom?decision.action==='auto':true)&&decision.reply||null;
  const suggestion=!unified&&custom&&decision.reply||null;
  const blocked=decision.action==='blocked';
  let category=decision.category;
  if(unified&&!blocked){
    if(mode==='off')category='AI agent đang tắt.';
    else if(!permitted)category=automationPauseNote(plan);
    else if(!queueEnabled)category='Hàng đợi AI agent chưa được bật.';
    else if(event.reviewOnly)category='Bình luận được đồng bộ để shop kiểm tra.';
    else if(text)category='Đang chờ AI agent xử lý.';
  }
  const saved=await run(`INSERT INTO comments(id,channel_id,media_id,post_id,remote_id,author,text,status,reply,automatic,automatic_ack,created,bot_category,bot_suggestion,bot_blocked)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14) ON CONFLICT (channel_id,remote_id) DO NOTHING`,
    uid(),c.id,event.media,rule?.id??null,event.comment,event.author.slice(0,100),text||unavailable,reply?'queued':'review',
    reply,Number(!!reply),created,category,suggestion,blocked);
  if(saved.changes){
    if(permitted&&queueEnabled&&c.platform==='fb'&&(unified||(messengerEnabled&&c.messenger))&&text&&!blocked&&mode!=='off'&&
      (agentEnabled(policy)||['review','auto'].includes(policy?.conversationAi))&&!event.reviewOnly){
      await run('UPDATE comments SET private_ai_job=0 WHERE channel_id=$1 AND remote_id=$2',c.id,event.comment);
    }
    return 'stored';
  }
  if(text&&text!==unavailable){
    const updated=await run(`UPDATE comments SET text=$1,bot_category=$2,bot_suggestion=$6,bot_blocked=$7
      WHERE channel_id=$3 AND remote_id=$4 AND text=$5`,text,category,c.id,event.comment,unavailable,suggestion,blocked);
    if(updated.changes)return 'updated';
  }
  return 'duplicate';
}

async function messengerBotDecision(policy, {channel_id,sender_id,created,text,inbound_quote_mid}) {
  const previous=await get(`SELECT text FROM inbox_messages
    WHERE channel_id=$1 AND sender_id=$2 AND created<$3
      AND (remote_id=$4 OR ($4::text IS NULL AND created>=$5))
    ORDER BY created DESC,id DESC LIMIT 1`,channel_id,sender_id,created,inbound_quote_mid,created-600_000);
  return decideBotReply(policy,text,{context:previous?.text});
}

async function storePageMessage(channel,event) {
  const message=event?.message;
  const mid=s(message?.mid);
  const recipient=s(event?.recipient?.id);
  const created=Number(event?.timestamp);
  const appId=s(message?.app_id);
  if(message?.is_echo!==true||s(event?.sender?.id)!==channel.meta_id||appId===settings.fb.id||
    !mid||mid.length>512||recipient===channel.meta_id||!/^\d{1,40}$/.test(recipient)||
    !Number.isSafeInteger(created)||created<=0||created>Date.now()+60_000)return;
  const text=s(message.text).trim().slice(0,4000);
  const attachments=receivedMessengerAttachments(message.attachments);
  if(!text&&!attachments.length)return;
  await run(`INSERT INTO messenger_page_messages(channel_id,remote_id,recipient_id,created,text,attachments,quote_mid,app_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(channel_id,remote_id) DO NOTHING`,
    channel.id,mid,recipient,created,text,JSON.stringify(attachments),
    s(message.reply_to?.mid).slice(0,512)||null,appId.slice(0,40)||null);
}

async function storeMessage(c,event) {
  const message=event?.message;
  const id=s(message?.mid), sender=s(event?.sender?.id);
  const text=s(message?.text).trim().slice(0,4000);
  const attachments=receivedMessengerAttachments(message?.attachments);
  const quoteMid=s(message?.reply_to?.mid).slice(0,512)||null;
  const created=Number(event?.timestamp);
  if(!id||message.is_echo||(!text&&!attachments.length)||!/^\d{1,40}$/.test(sender)||sender===c.meta_id||
    s(event?.recipient?.id)!==c.meta_id||!Number.isSafeInteger(created)||created<=0||created>Date.now()+60_000)return;

  const expired=created<=Date.now()-messageWindow;
  const item=await get(`INSERT INTO inbox_messages(id,channel_id,remote_id,sender_id,text,status,created,attachments,inbound_quote_mid,sales_inquiry)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (channel_id,remote_id) DO NOTHING RETURNING id`,
    uid(),c.id,id,sender,text,expired?'expired':'review',created,JSON.stringify(attachments),quoteMid,
    c.page_purpose==='sales'&&(catalogQuestion(text)||orderCommand(text)?.kind==='quote'));
  if(!item)return;

  await run(`INSERT INTO messenger_contacts(channel_id,sender_id,last_inbound)
    VALUES($1,$2,COALESCE((SELECT MAX(created) FROM inbox_messages
      WHERE channel_id=$1 AND sender_id=$2 AND id<>$3),0))
    ON CONFLICT (channel_id,sender_id) DO NOTHING`,c.id,sender,item.id);
  const contact=await get('SELECT last_inbound,agent_resume_at FROM messenger_contacts WHERE channel_id=$1 AND sender_id=$2 FOR UPDATE',c.id,sender);
  await run('UPDATE messenger_contacts SET last_inbound=GREATEST(last_inbound,$3) WHERE channel_id=$1 AND sender_id=$2',c.id,sender,created);
  if(expired||c.message_bot_mode==='off')return;
  if(!agentCanAnswer(created,contact?.agent_resume_at)){
    await run('UPDATE inbox_messages SET bot_category=$2 WHERE id=$1',item.id,agentTakeoverNote);
    return;
  }
  const plan=await shopFeatures(c.shop_id);
  if(!plan?.feature_flags.messages||!automationAllowed(plan,created)){
    await run('UPDATE inbox_messages SET bot_category=$2 WHERE id=$1',item.id,automationPauseNote(plan));
    return;
  }
  if(c.message_bot_mode==='rules'&&c.message_bot_policy?.version===2){
    const decision=await messengerBotDecision(withoutFaqs(c.message_bot_policy,plan),{
      channel_id:c.id,sender_id:sender,created,text,inbound_quote_mid:quoteMid,
    });
    const orderReady=plan.order_management&&!expired&&queueEnabled&&created>=contact.last_inbound&&decision.action!=='blocked'&&
      c.orders_enabled&&c.page_purpose==='sales'&&!!text;
    const agent=agentEnabled(c.message_bot_policy);
    const checkoutAllowed=orderReady&&(!agent||c.message_bot_policy.agentMode==='auto');
    const checkoutCommand=orderCommand(text)??(checkoutAllowed&&!agent&&await naturalBuyCommand(c.id,{
      id:item.id,text,sender_id:sender,created,
    }));
    const staffReviewedDraft=orderReady&&agent&&!checkoutAllowed&&['details','confirm','cancel'].includes(checkoutCommand?.kind)&&
      await get(`SELECT 1 FROM order_drafts WHERE channel_id=$1 AND sender_id=$2 AND expires>$3
        AND items @> '[{"variant_reviewed":true}]'::jsonb`,c.id,sender,Date.now());
    if((checkoutAllowed||staffReviewedDraft)&&!(agent&&checkoutCommand?.kind==='track')&&(checkoutCommand||!agent&&c.order_cases?.some((item)=>item.event==='incoming'))){
      const enabled=await get(`SELECT order_templates,order_cases FROM channels WHERE id=$1 AND orders_enabled AND page_purpose='sales'
        AND message_bot_mode='rules' AND message_bot_policy IS NOT DISTINCT FROM $2::jsonb FOR SHARE`,c.id,c.message_bot_policy);
      const currentPlan=await shopFeatures(c.shop_id);
      const reply=enabled&&currentPlan?.order_management&&automationAllowed(currentPlan,created)&&await orderReply(c.id,sender,text,checkoutTemplates(c.message_bot_policy,enabled.order_templates),c.message_bot_policy.unifiedAgent?[]:enabled.order_cases,staffReviewedDraft?{...checkoutCommand,forceVerification:true}:checkoutCommand||null);
      if(reply){
        await run(`UPDATE inbox_messages SET status='queued',reply=$2,automatic=1,automatic_ack=1,
          bot_category=$4,order_auto=TRUE,sales_sku=$3 WHERE id=$1`,item.id,reply,checkoutCommand?.sku??null,
          checkoutCommand?.kind==='buyIdentify'?'Chốt đơn · Hỏi sản phẩm':'Trợ lý bán hàng');
        return;
      }
      if(enabled&&checkoutCommand&&(!agent||checkoutCommand.kind!=='quote'))return;
    }
    if(!expired&&queueEnabled&&created>=contact.last_inbound&&decision.action!=='blocked'&&
      c.catalog_mode!=='off'&&c.page_purpose==='sales'&&catalogQuestion(text)){
      const image=await catalogImage({channel_id:c.id,sender_id:sender,created,attachments,inbound_quote_mid:quoteMid});
      if(image){
        await run(`UPDATE inbox_messages SET status='queued',automatic=1,automatic_ack=1,
          bot_category='Tra sản phẩm theo ảnh',catalog_image_url=$2 WHERE id=$1`,item.id,image);
        return;
      }
    }
    if(agent&&!expired&&queueEnabled&&created>=contact.last_inbound&&text&&decision.action!=='blocked'){
      await run(`UPDATE inbox_messages SET status='queued',automatic=1,automatic_ack=1,conversation_ai=TRUE
        WHERE id=$1`,item.id);
      return;
    }
    if(!expired&&queueEnabled&&created>=contact.last_inbound&&decision.action!=='blocked'&&text&&!checkoutCommand&&
      plan.order_management&&c.orders_enabled&&c.page_purpose==='sales'&&c.order_ai_mode!=='off'){
      await run(`UPDATE inbox_messages SET status='queued',automatic=1,automatic_ack=1,sales_ai=TRUE,
        reply=$2,bot_suggestion=$3,bot_category=$4 WHERE id=$1`,item.id,
        decision.action==='auto'?decision.reply:null,decision.reply||null,decision.category);
      return;
    }
    const reply=!expired&&queueEnabled&&created>=contact.last_inbound&&decision.action==='auto'?decision.reply:null;
    if(!expired&&queueEnabled&&created>=contact.last_inbound&&text&&!checkoutCommand&&decision.action!=='blocked'&&
      ['review','auto'].includes(c.message_bot_policy.conversationAi)){
      await run(`UPDATE inbox_messages SET status='queued',automatic=1,automatic_ack=1,conversation_ai=TRUE,reply=$2
        WHERE id=$1`,item.id,reply);
      return;
    }
    await run(`UPDATE inbox_messages SET bot_category=$1,bot_suggestion=$2,bot_blocked=$3,
      status=CASE WHEN $4::text IS NOT NULL THEN 'queued' ELSE status END,reply=$4,
      automatic=$5,automatic_ack=$5 WHERE id=$6`,
      decision.category,decision.reply||null,decision.action==='blocked',reply,Number(!!reply),item.id);
    return;
  }
  if(c.message_bot_mode==='greeting'&&containsBlockedPhrase(text,c.message_bot_policy?.blocked)){
    await run("UPDATE inbox_messages SET bot_blocked=TRUE,bot_category='Nội dung bị chặn' WHERE id=$1",item.id);
    return;
  }
  const greeting=queueEnabled&&c.message_bot_mode==='greeting'&&acknowledgementTemplates[c.message_greeting];
  if(expired||!greeting||created<contact.last_inbound)return;

  // The contact lock serializes competing inbound events. Start a new waiting
  // round after a successful manual reply or a day without customer messages.
  const {last_human,last_ack}=await get(`SELECT
      MAX(GREATEST(
        CASE WHEN status='replied' AND automatic=0 THEN COALESCE(sent_at,created) END,
        (previous_replies->-1->>'sentAt')::bigint
      )) AS last_human,
      MAX(created) FILTER (WHERE greeting IS NOT NULL
        OR (automatic_ack=1 AND status IN ('queued','sending','uncertain'))) AS last_ack
    FROM inbox_messages WHERE channel_id=$1 AND sender_id=$2`,c.id,sender);
  if(created<(last_human??0))return;
  if(last_ack!==null&&last_ack>=(last_human??0)&&created-contact.last_inbound<messageWindow)return;
  await run(`UPDATE inbox_messages SET status='queued',reply=$1,automatic=1,automatic_ack=1,
    bot_category='Lời chào tự động' WHERE id=$2`,greeting,item.id);
}

async function facebookFeedComment(channel,value) {
  const comment=s(value.comment_id);
  const parent=s(value.parent_id);
  const objectId=/^\d+_\d+$/.test(comment)?comment.split('_')[0]:'';
  if(value.is_hidden===true)return 'filtered';
  let media=s(value.post_id||value.video_id||value.photo_id);
  const isPostParent=[media,s(value.video_id),s(value.photo_id),objectId].some((id)=>idMatches(parent,id));
  media||=isPostParent?parent:objectId;
  if(!media&&parent){
    const original=await get(`SELECT MIN(media_id) AS media_id FROM comments
      WHERE channel_id=$1 AND remote_id=$2`,channel.id,parent);
    media=original?.media_id??'';
  }
  const timestamp=Number(value.created_time)*1000;
  return storeComment(channel,{
    comment,media,video:s(value.video_id||value.photo_id),parent:isPostParent?'':parent,
    by:s(value.from?.id||value.sender_id),author:s(value.from?.name||value.sender_name)||'Người xem',
    text:s(value.message),created:Number.isSafeInteger(timestamp)&&timestamp>0?timestamp:undefined,
  });
}
export async function webhookEvents(p,body){
  ensure(body?.object===(p==='fb'?'page':'instagram'),400,'Đối tượng webhook không hợp lệ.');
  await transaction(async()=>{
    for(const entry of body.entry??[]){
      const c=await get(`SELECT c.* FROM channels c JOIN entitled_shop_channels entitlement ON entitlement.id=c.id JOIN shops tenant ON tenant.id=c.shop_id AND tenant.status='ACTIVE'
        AND (tenant.expired_at IS NULL OR tenant.expired_at>extract(epoch FROM clock_timestamp())*1000)
      JOIN users u ON u.id=tenant.owner_id
        WHERE c.platform=$1 AND c.meta_id=$2 AND c.webhook=1 AND c.token IS NOT NULL
          AND u.active=1 AND u.email_verified_at IS NOT NULL FOR SHARE OF tenant`,p,s(entry.id));
      if(!c)continue;
      if(p==='fb'&&messengerEnabled&&c.messenger){
        for(const event of entry.messaging??[]){
          if(event?.message?.is_echo===true)await storePageMessage(c,event);
          else await storeMessage(c,event);
        }
      }
      for(const change of entry.changes??[]){
        const v=change.value;
        if(!v)continue;
        if(p==='ig'&&change.field==='comments'){
          if(v.parent_id||idMatches(s(v.from?.id),c.meta_id)||s(v.from?.username).toLowerCase()===c.handle.replace(/^@/,'').toLowerCase())continue;
          await storeComment(c,{comment:s(v.id),media:s(v.media?.id||v.media_id),by:s(v.from?.id),author:s(v.from?.username)||'Người xem',text:s(v.text)});
        }
        if(p==='fb'&&change.field==='feed'&&v.item==='comment'&&v.verb==='add'){
          const result=await facebookFeedComment(c,v);
          await run('UPDATE channels SET facebook_feed_comment_at=$1,facebook_feed_comment_result=$2 WHERE id=$3',
            Date.now(),result,c.id);
        }
      }
    }
  });
}
const commentSyncInterval=8_000;

async function readRecentFacebookComments(channel, postId, syncedAt, timeout, after='') {
  const comments=[];
  const token=validToken(channel);
  // Read the latest page on first use. Later scans can resume after a burst.
  for(let page=0;page<3;page++){
    const params={filter:'stream',order:'reverse_chronological',limit:50};
    if(after)params.after=after;
    const result=await graph('fb',pathId(postId)+'/comments',{
      token,fields:'id,message,from,created_time,is_hidden,parent{id}',params,timeout,
    });
    ensure(Array.isArray(result?.data),502,'Meta chưa trả danh sách bình luận hợp lệ.');
    comments.push(...result.data);
    const overlapsLastSync=result.data.some((item)=>Date.parse(item?.created_time)<=syncedAt-60_000);
    const next=result.paging?.next&&s(result.paging?.cursors?.after);
    if(!syncedAt||overlapsLastSync||!next||next===after)return {comments,after:null};
    after=next;
  }
  return {comments,after};
}

async function importFacebookComments(channel, postId, comments, enabledAt) {
  let imported=0;
  for(const comment of comments){
    if(comment.is_hidden)continue;
    const created=Date.parse(comment.created_time);
    const parent=s(comment.parent?.id||comment.parent);
    const result=await storeComment(channel,{
      comment:s(comment.id),media:postId,parent:idMatches(parent,postId)?'':parent,
      by:s(comment.from?.id),author:s(comment.from?.name)||'Người xem',
      text:s(comment.message),created:Number.isFinite(created)?created:undefined,
      reviewOnly:!enabledAt||!Number.isFinite(created)||created<enabledAt,
    });
    if(result==='stored'||result==='updated')imported++;
  }
  return imported;
}

export async function checkFacebookComments(channel,postId) {
  const token=validToken(channel);
  const [subscription,reading]=await Promise.allSettled([
    graph('fb',pathId(channel.meta_id)+'/subscribed_apps',{token,params:{limit:100},timeout:12_000}),
    readRecentFacebookComments(channel,postId,null,12_000),
  ]);
  const summary=(error)=>error instanceof MetaError||error instanceof AppError
    ?error.message:'SnailChat gặp lỗi khi xử lý yêu cầu.';
  let feed=null, subscriptionError=null;
  if(subscription.status==='fulfilled'&&Array.isArray(subscription.value?.data)){
    const app=subscription.value.data.find((entry)=>s(entry.id)===settings.fb.id);
    if(Array.isArray(app?.subscribed_fields))feed=app.subscribed_fields.includes('feed');
    if(!app&&!subscription.value.paging?.next)feed=false;
  }else{
    subscriptionError=subscription.status==='rejected'?summary(subscription.reason):'Meta chưa trả danh sách ứng dụng hợp lệ.';
  }
  let received=null, imported=null, readError=null, importError=null;
  if(reading.status==='rejected')readError=summary(reading.reason);
  else{
    received=reading.value.comments.length;
    try{
      imported=await transaction(async()=>{
        const current=ensure(await get(`SELECT * FROM channels
          WHERE id=$1 AND owner_id=$2 AND meta_id=$3 AND token=$4`,
          channel.id,channel.owner_id,channel.meta_id,channel.token),409,'Kết nối vừa thay đổi. Hãy kiểm tra lại.');
        const watch=await get('SELECT enabled_at FROM facebook_comment_sync WHERE channel_id=$1 AND media_id=$2',
          channel.id,postKey(channel,postId));
        return importFacebookComments(current,postId,reading.value.comments,watch?.enabled_at);
      });
    }catch(error){
      console.error('Facebook diagnostic import error:',error.code??error.name);
      importError='Meta đã trả dữ liệu nhưng SnailChat chưa lưu được bình luận.';
    }
  }
  const last=await get('SELECT facebook_feed_comment_at,facebook_feed_comment_result FROM channels WHERE id=$1',channel.id);
  return {feed,subscriptionError,received,imported,readError,importError,
    lastFeed:last?.facebook_feed_comment_at??null,feedResult:last?.facebook_feed_comment_result??null};
}

async function syncFacebookPost(job, claimedUntil, startedAt) {
  const postId=job.meta_id+'_'+job.media_id;
  const {comments,after}=await readRecentFacebookComments(job,postId,job.synced_at,8_000,job.scan_after??'');
  const scanStarted=job.scan_started_at??startedAt;
  await transaction(async()=>{
    const current=await get(`SELECT sync.enabled_at,c.* FROM facebook_comment_sync sync
      JOIN channels c ON c.id=sync.channel_id JOIN entitled_shop_channels entitlement ON entitlement.id=c.id JOIN shops tenant ON tenant.id=c.shop_id AND tenant.status='ACTIVE'
        AND (tenant.expired_at IS NULL OR tenant.expired_at>extract(epoch FROM clock_timestamp())*1000)
      JOIN users u ON u.id=tenant.owner_id
      WHERE sync.channel_id=$1 AND sync.media_id=$2 AND sync.next_check=$3 AND sync.enabled_at=$4
        AND u.active=1 AND u.email_verified_at IS NOT NULL
      FOR UPDATE OF sync`,job.channel_id,job.media_id,claimedUntil,job.enabled_at);
    if(!current)return;
    await importFacebookComments(current,postId,comments,current.enabled_at);
    await run(`UPDATE facebook_comment_sync SET next_check=$1,synced_at=$2,scan_after=$3,scan_started_at=$4,
      last_error=NULL,failures=0 WHERE channel_id=$5 AND media_id=$6`,
      Date.now()+(after?0:commentSyncInterval),after?job.synced_at:scanStarted,after,after?scanStarted:null,job.channel_id,job.media_id);
  });
}

export async function syncFacebookComments() {
  const startedAt=Date.now();
  const claimedUntil=startedAt+120_000;
  const jobs=await all(`WITH due AS (
    SELECT sync.channel_id,sync.media_id FROM facebook_comment_sync sync
    JOIN channels c ON c.id=sync.channel_id JOIN entitled_shop_channels entitlement ON entitlement.id=c.id JOIN shops tenant ON tenant.id=c.shop_id AND tenant.status='ACTIVE'
        AND (tenant.expired_at IS NULL OR tenant.expired_at>extract(epoch FROM clock_timestamp())*1000)
      JOIN users u ON u.id=tenant.owner_id
    WHERE sync.next_check<=$1 AND c.platform='fb' AND c.token IS NOT NULL
      AND (c.expires IS NULL OR c.expires>$1)
      AND u.active=1 AND u.email_verified_at IS NOT NULL
    ORDER BY sync.next_check,sync.channel_id,sync.media_id LIMIT 4 FOR UPDATE OF sync SKIP LOCKED
  ) UPDATE facebook_comment_sync sync SET next_check=$2 FROM due,channels c
    WHERE sync.channel_id=due.channel_id AND sync.media_id=due.media_id AND c.id=due.channel_id
    RETURNING sync.*,c.meta_id,c.token,c.expires`,startedAt,claimedUntil);
  await Promise.allSettled(jobs.map(async(job)=>{
    try{
      await syncFacebookPost(job,claimedUntil,startedAt);
    }catch(error){
      const message=error instanceof MetaError||error instanceof AppError
        ?error.message:'SnailChat chưa lưu được bình luận từ Meta.';
      const failures=Math.min(job.failures+1,7);
      const delay=Math.min(5*60_000,commentSyncInterval*2**failures);
      // Meta may reject a paging cursor that has expired. Retry from the last completed scan.
      const restart=!!job.scan_after&&error instanceof MetaError&&error.code===100;
      await run(`UPDATE facebook_comment_sync SET next_check=$1,last_error=$2,failures=$3,
        scan_after=CASE WHEN $4 THEN NULL ELSE scan_after END,
        scan_started_at=CASE WHEN $4 THEN NULL ELSE scan_started_at END
        WHERE channel_id=$5 AND media_id=$6 AND next_check=$7 AND enabled_at=$8`,
        Date.now()+delay,message,failures,restart,job.channel_id,job.media_id,claimedUntil,job.enabled_at);
    }
  }));
}

async function messengerQuote(item,mid) {
  const source=await get(`SELECT remote_id,text,attachments,greeting,greeting_remote_id,reply,reply_remote_id,reply_payload,previous_replies
    FROM inbox_messages WHERE channel_id=$1 AND sender_id=$2 AND (
      remote_id=$3 OR greeting_remote_id=$3 OR (status='replied' AND reply_remote_id=$3)
      OR previous_replies @> jsonb_build_array(jsonb_build_object('mid',$3::text))
    ) LIMIT 1`,item.channel_id,item.sender_id,mid);
  if(!source){
    const page=ensure(await get(`SELECT text,attachments FROM messenger_page_messages
      WHERE channel_id=$1 AND recipient_id=$2 AND remote_id=$3`,item.channel_id,item.sender_id,mid),
      404,'Tin được trích dẫn không có trong cuộc trò chuyện này.');
    return {mid,by:'page',text:(page.text||page.attachments?.[0]?.name||'Tin nhắn').slice(0,240)};
  }
  let text, by='page';
  if(source.remote_id===mid){
    by='customer';
    text=source.text||source.attachments?.[0]?.name;
  }else if(source.greeting_remote_id===mid)text=source.greeting;
  else if(source.reply_remote_id===mid)text=source.reply||source.reply_payload?.attachment?.name;
  else{
    const previous=source.previous_replies?.find((entry)=>entry.mid===mid);
    text=previous?.text||previous?.attachment?.name;
  }
  return {mid,by,text:(text||'Tin nhắn').slice(0,240)};
}

export async function queueReply(item,reply,messaging=false,requestId=null,{quoteMid='',attachment=null,actorId=null}={}) {
  ensure(queueEnabled,503,'Hàng đợi phản hồi đang tắt. Hãy bật QUEUE_ENABLED=1 rồi khởi động lại API.');
  if(!messaging){
    const result=await run(`UPDATE comments SET status='queued',reply=$1,automatic=0,automatic_ack=0,reply_error=NULL,queued_by=$3
      WHERE id=$2 AND status='review' AND handled_at IS NULL`,reply,item.id,actorId);
    ensure(result.changes,409,'Bình luận đã có phản hồi hoặc đang chờ xác nhận từ Meta.');
    return;
  }
  const cutoff=Date.now()-messageWindow;
  ensure(messengerEnabled&&item.created>cutoff,409,'Đã quá 24 giờ để trả lời hoặc Messenger đang tắt.');
  const quote=quoteMid?await messengerQuote(item,quoteMid):null;
  const media=attachment?{type:attachment.type,name:attachment.name,size:attachment.size}:null;
  const payload=quote||media?JSON.stringify({quote,attachment:media}):null;
  await transaction(async()=>{
    const result=await run(`UPDATE inbox_messages SET status='queued',reply=$1,automatic=0,automatic_ack=0,reply_error=NULL,
      previous_replies=CASE WHEN status='replied' AND reply IS NOT NULL THEN
        previous_replies||jsonb_build_array(jsonb_build_object('text',reply,'sentAt',COALESCE(sent_at,created),
          'requestId',reply_request_id,'mid',reply_remote_id,'quote',reply_payload->'quote','attachment',reply_payload->'attachment'))
        ELSE previous_replies END,reply_request_id=$4,sent_at=NULL,reply_remote_id=NULL,reply_payload=$5,queued_by=$6
      WHERE id=$2 AND status IN ('review','replied') AND created>$3
        AND ($4::text IS NULL OR (reply_request_id IS DISTINCT FROM $4 AND
          NOT previous_replies @> jsonb_build_array(jsonb_build_object('requestId',$4))))`,reply,item.id,cutoff,requestId,payload,actorId);
    if(result.changes){
      if(attachment)await run('INSERT INTO messenger_uploads(message_id,request_id,content_type,data) VALUES($1,$2,$3,$4)',
        item.id,requestId,attachment.contentType,attachment.data);
      return;
    }
    const replay=requestId&&await get(`SELECT 1 FROM inbox_messages WHERE id=$1 AND
      (reply_request_id=$2 OR previous_replies @> jsonb_build_array(jsonb_build_object('requestId',$2::text)))`,item.id,requestId);
    ensure(replay,409,'Tin nhắn đang chờ xác nhận từ Meta.');
  });
}

async function sendMessengerPayload(channel,sender,token,message,quoteMid=null){
  ensure(await activePage(channel.id),403,'Shop đang bị khóa hoặc đã hết hạn.');
  const result=await graph('fb',pathId(channel.meta_id)+'/messages',{
    token,method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({messaging_type:'RESPONSE',recipient:{id:sender},message,...(quoteMid?{reply_to:{mid:quoteMid}}:{})}),
    timeout:12_000,
  });
  return s(result?.message_id);
}

async function sendCatalogPhotos(channel,item,token){
  const {sku,images}=item.catalogPhotoBundle;
  const payloads=await Promise.all(images.map(async(source,index)=>{
    if(source.startsWith('https://'))return {url:source};
    const [,type,encoded]=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(source);
    const form=new FormData();
    form.set('message',JSON.stringify({attachment:{type:'image',payload:{is_reusable:true}}}));
    form.set('filedata',new Blob([Buffer.from(encoded,'base64')],{type}),sku+'-'+(index+1)+'.'+type.split('/')[1]);
    const uploaded=await graph('fb',pathId(channel.meta_id)+'/message_attachments',{token,method:'POST',body:form,timeout:15_000})
      .catch(()=>null);
    return {attachment_id:ensure(s(uploaded?.attachment_id),502,'Chưa tải được bộ ảnh lên Messenger.')};
  }));

  let introId='';
  let delivered=0;
  try{
    introId=await sendMessengerPayload(channel,item.sender_id,token,{text:item.reply});
    if(!introId)throw Object.assign(new Error('Meta chưa xác nhận tin nhắn.'),{ambiguous:true});
    const sentAt=Date.now();
    for(const [index,payload] of payloads.entries()){
      ensure(item.created>Date.now()-messageWindow,409,'Đã hết thời gian nhắn tin Messenger.');
      const mid=await sendMessengerPayload(channel,item.sender_id,token,{attachment:{type:'image',payload}});
      if(!mid)throw Object.assign(new Error('Meta chưa xác nhận ảnh.'),{ambiguous:true});
      delivered++;
      await run(`INSERT INTO messenger_page_messages(channel_id,remote_id,recipient_id,created,text,attachments)
        VALUES($1,$2,$3,$4,'',$5) ON CONFLICT(channel_id,remote_id) DO NOTHING`,channel.id,mid,item.sender_id,Date.now(),
      JSON.stringify([{type:'image',name:sku+' · Ảnh '+(index+1),url:images[index]}]));
    }
    return {id:introId,sentAt};
  }catch(error){
    if(!introId&&!error.ambiguous)throw error;
    throw Object.assign(new AppError(502,'Meta đã xác nhận '+delivered+'/3 ảnh. Kiểm tra Messenger trước khi gửi lại.'),{ambiguous:true});
  }
}

async function sendReply(c,item,messaging) {
  ensure(await activePage(c.id),403,'Shop đang bị khóa hoặc đã hết hạn.');
  const token=validToken(c);
  if(!messaging){
    const facebook=c.platform==='fb';
    const nested=facebook&&item.facebook_media_key&&await get(`SELECT 1 FROM facebook_comment_links
      WHERE channel_id=$1 AND media_key=$2 AND comment_key=$3`,c.id,item.facebook_media_key,item.facebook_key);
    const result=await postGraph(c.platform,pathId(item.remote_id)+(facebook?'/comments':'/replies'),token,{message:item.reply});
    const id=s(result?.id);
    const sentAt=Date.now();
    // A failed read after Meta accepted the POST does not make the write retryable.
    const posted=nested&&id&&await graph('fb',pathId(id),{token,fields:'parent{id}',timeout:2_500}).catch(()=>null);
    return {id,sentAt,parent:facebook?item.remote_id:null,checkParent:!!nested,observedParent:s(posted?.parent?.id||posted?.parent)};
  }
  if(item.catalogPhotoBundle)return sendCatalogPhotos(c,item,token);
  const attachment=item.reply_payload?.attachment;
  let message={text:item.reply};
  if(attachment){
    const upload=ensure(await get('SELECT content_type,data FROM messenger_uploads WHERE message_id=$1 AND request_id=$2',
      item.id,item.reply_request_id),409,'Tệp đính kèm đã hết hạn. Hãy chọn lại tệp.');
    const form=new FormData();
    form.set('message',JSON.stringify({attachment:{type:attachment.type,payload:{is_reusable:true}}}));
    form.set('filedata',new Blob([upload.data],{type:upload.content_type}),attachment.name);
    let uploaded;
    try{
      uploaded=await graph('fb',pathId(c.meta_id)+'/message_attachments',{token,method:'POST',body:form,timeout:60_000});
    }catch(error){
      if(!(error instanceof MetaError))throw error;
      // The upload alone cannot deliver a message to the customer.
      throw new AppError(502,'Chưa gửi được tệp đính kèm. '+error.message);
    }
    const attachmentId=ensure(s(uploaded?.attachment_id),502,'Meta chưa trả mã tệp đính kèm. Hãy gửi lại tệp.');
    message={attachment:{type:attachment.type,payload:{attachment_id:attachmentId}}};
  }
  return {id:await sendMessengerPayload(c,item.sender_id,token,message,item.reply_payload?.quote?.mid)};
}

const singleLine=(value)=>s(value).replace(/\s+/gu,' ').trim().slice(0,160);

async function lookupMessengerName(channel,sender) {
  const token=validToken(channel);
  try{
    const result=await graph('fb',pathId(channel.meta_id)+'/conversations',{
      token,fields:'participants',params:{platform:'messenger',user_id:sender,limit:1},timeout:2_000,
    });
    const participant=result?.data?.[0]?.participants?.data?.find((entry)=>s(entry.id)===sender);
    const name=singleLine(participant?.name);
    if(name)return name;
  }catch(error){
    if(!(error instanceof MetaError))throw error;
  }
  const profile=await graph('fb',pathId(sender),{token,fields:'first_name,last_name',timeout:1_500});
  const first=singleLine(profile?.first_name),last=singleLine(profile?.last_name);
  return first&&last?singleLine(first+' '+last):'';
}

async function messengerName(channel,sender) {
  const contact=await get('SELECT display_name,profile_refresh_at FROM messenger_contacts WHERE channel_id=$1 AND sender_id=$2',
    channel.id,sender);
  if(contact?.profile_refresh_at>Date.now())return contact.display_name;
  let name='';
  try{name=await lookupMessengerName(channel,sender);}
  catch(error){if(!(error instanceof MetaError||error instanceof AppError))throw error;}
  const refreshAfter=name?messageWindow:15*60_000;
  await run(`UPDATE messenger_contacts SET display_name=$1,profile_refresh_at=$2
    WHERE channel_id=$3 AND sender_id=$4`,name||null,Date.now()+refreshAfter,channel.id,sender);
  return name;
}

async function queueVerificationNotices() {
  const cutoff=Date.now()-messageWindow;
  await transaction(async()=>{
    const jobs=await all(`SELECT v.channel_id,v.code,v.notice,v.sender_id
      FROM order_verifications v JOIN channels c ON c.id=v.channel_id JOIN entitled_shop_channels entitlement ON entitlement.id=c.id JOIN shops tenant ON tenant.id=c.shop_id AND tenant.status='ACTIVE'
        AND (tenant.expired_at IS NULL OR tenant.expired_at>extract(epoch FROM clock_timestamp())*1000)
      JOIN users u ON u.id=tenant.owner_id
      JOIN subscription_plans plan ON plan.code=tenant.subscription_plan AND COALESCE((plan.feature_flags->>'orders')::boolean,plan.order_management)
      JOIN messenger_contacts contact ON contact.channel_id=v.channel_id AND contact.sender_id=v.sender_id
      LEFT JOIN inbox_messages previous ON previous.id=v.notice_message_id
      WHERE v.status='verified' AND v.notice IS NOT NULL AND contact.last_inbound>$1
        AND (v.notice_message_id IS NULL OR (previous.status IN ('review','expired') AND contact.last_inbound>previous.created))
        AND c.messenger=1 AND c.page_purpose='sales' AND c.orders_enabled
        AND u.active=1 AND u.email_verified_at IS NOT NULL
        AND EXISTS(SELECT 1 FROM inbox_messages m WHERE m.channel_id=v.channel_id AND m.sender_id=v.sender_id
          AND m.created=contact.last_inbound AND m.status IN ('review','replied'))
      ORDER BY v.confirmed_at LIMIT 8 FOR UPDATE OF v SKIP LOCKED`,cutoff);
    for(const job of jobs){
      const item=await get(`SELECT id,created FROM inbox_messages WHERE channel_id=$1 AND sender_id=$2 AND created>$3
        ORDER BY created DESC,id DESC LIMIT 1 FOR UPDATE`,job.channel_id,job.sender_id,cutoff);
      if(!item)continue;
      try {
        await queueReply(item,job.notice,true,'verification-'+job.code);
      }catch(error){
        if(error.status===409)continue;
        throw error;
      }
      await run('UPDATE order_verifications SET notice_message_id=$3 WHERE channel_id=$1 AND code=$2',
        job.channel_id,job.code,item.id);
    }
  });
}

export async function privateCommentAiTick(){
  const now=Date.now();
  await run('UPDATE comments SET private_ai_job=NULL WHERE private_ai_job IS NOT NULL AND created<=$1',now-privateReplyWindow);
  const batch=await all(`SELECT m.id FROM comments m JOIN channels c ON c.id=m.channel_id JOIN entitled_shop_channels entitlement ON entitlement.id=c.id JOIN shops tenant ON tenant.id=c.shop_id AND tenant.status='ACTIVE'
        AND (tenant.expired_at IS NULL OR tenant.expired_at>extract(epoch FROM clock_timestamp())*1000)
      JOIN users u ON u.id=tenant.owner_id
    WHERE m.private_ai_job<=$1 AND m.handled_at IS NULL AND c.platform='fb' AND u.active=1
      AND u.email_verified_at IS NOT NULL ORDER BY m.created LIMIT 4`,now);
  await Promise.all(batch.map(async({id})=>{
    const claim=Date.now()+120_000;
    const item=await get('UPDATE comments SET private_ai_job=$2 WHERE id=$1 AND private_ai_job<=$3 AND handled_at IS NULL RETURNING *',id,claim,now);
    if(!item)return;
    const finish=(draft=item.private_ai_draft,category=null)=>run(`UPDATE comments SET private_ai_job=NULL,private_ai_draft=$3,
      bot_category=COALESCE($4,bot_category) WHERE id=$1 AND private_ai_job=$2`,id,claim,draft,category);
    async function privateReceipt(){
      return get(`SELECT status FROM facebook_private_replies WHERE channel_id=$1 AND comment_key=$2
        AND status IN ('sent','sending','uncertain')`,item.channel_id,item.facebook_key);
    }
    async function current(){
      const channel=await get(`SELECT c.* FROM channels c JOIN entitled_shop_channels entitlement ON entitlement.id=c.id JOIN shops tenant ON tenant.id=c.shop_id AND tenant.status='ACTIVE'
        AND (tenant.expired_at IS NULL OR tenant.expired_at>extract(epoch FROM clock_timestamp())*1000)
      JOIN users u ON u.id=tenant.owner_id
        WHERE c.id=$1 AND c.platform='fb' AND c.token IS NOT NULL AND u.active=1
          AND u.email_verified_at IS NOT NULL`,item.channel_id);
      if(!channel)return null;
      if(channel.message_bot_policy?.unifiedAgent)return {
        channel,policy:channel.message_bot_policy,mode:channel.message_bot_policy.agentMode,
      };
      if(!messengerEnabled||!channel.messenger)return null;
      const post=await postBot(channel,item.media_id,'',item.post_id);
      const inherited=!post||post.bot_mode==='inherit';
      return {channel,policy:inherited?channel.comment_policy:post.comment_policy,mode:inherited?channel.bot_mode:post.bot_mode};
    }
    try{
      const state=await current();
      if(item.agent_public_policy&&item.private_ai_draft){
        const receipt=await privateReceipt();
        return await finish(receipt?.status==='sent'?null:item.private_ai_draft,
          receipt?.status==='sent'?'AI agent đã xử lý cả bình luận và tin nhắn riêng.':
            'Phản hồi công khai đã được đưa vào hàng đợi. Shop kiểm tra tin nhắn riêng trước khi gửi lại.');
      }
      if(!state||state.mode==='off'||state.policy?.version!==2||
        (state.policy.unifiedAgent&&item.status!=='review')||
        (!agentEnabled(state.policy)&&!['review','auto'].includes(state.policy.conversationAi))||item.bot_blocked)return await finish();
      if(!state.policy.unifiedAgent&&await privateReceipt())return await finish();
      const plan=await shopFeatures(state.channel.shop_id);
      if(!plan?.feature_flags.comments||!automationAllowed(plan,item.created))return await finish(null,automationPauseNote(plan));
      const post=await postContext(state.channel,item.media_id);
      const context=post?.text??'';
      const agent=agentEnabled(state.policy);
      const result=agent
        ?await runSalesAgent(state.channel,withoutFaqs(state.policy,plan),item.text,{context,type:'comment',
          resolvePhoto:post?.thumbnail?()=>matchCatalogImage(state.channel.id,post.thumbnail):undefined})
        :await understandConversation(state.channel,withoutFaqs(state.policy,plan),item.text,{context,type:'comment',
          manualOnly:state.mode!=='auto'||state.policy.conversationAi!=='auto'});
      if(agent&&result?.action!=='reply')return await finish(null,result?.action==='ignore'?'AI agent bỏ qua':
        result?.reason??'AI agent chưa có phản hồi hợp lệ.');
      if(!result||result.abstain)return await finish();
      const latest=await current();
      if(!latest||state.mode!==latest.mode||JSON.stringify(state.policy)!==JSON.stringify(latest.policy))return await finish();
      const currentPlan=await shopFeatures(latest.channel.shop_id);
      if(!currentPlan?.feature_flags.comments||!automationAllowed(currentPlan,item.created))return await finish(null,automationPauseNote(currentPlan));
      const names={customerName:item.author==='Người xem'?'':item.author,pageName:latest.channel.name};
      const draft=renderBotReply(result.draft??result.reply,names);
      const auto=agent?state.mode==='auto'&&state.policy.agentMode==='auto':result.action==='auto';
      const both=latest.policy.unifiedAgent&&result.route==='both';
      const publicReply=both?publicProductInvitation:draft;
      const stagePublic=(privateDraft,category,keepClaim=false)=>run(`UPDATE comments m
          SET private_ai_job=CASE WHEN $9 THEN m.private_ai_job ELSE NULL END,private_ai_draft=$7,bot_category=$8,
          bot_suggestion=$3,reply=CASE WHEN $4 THEN $3 ELSE NULL END,
          status=CASE WHEN $4 THEN 'queued' ELSE 'review' END,automatic=$5,automatic_ack=$5,
          agent_public_policy=CASE WHEN $4 THEN $6::jsonb ELSE NULL END
          FROM channels c WHERE m.id=$1 AND m.private_ai_job=$2 AND m.status='review' AND m.handled_at IS NULL AND c.id=m.channel_id
            AND c.message_bot_policy=$6::jsonb`,id,claim,publicReply,auto,Number(auto),JSON.stringify(latest.policy),privateDraft,category,keepClaim);
      if(latest.policy.unifiedAgent&&result.route==='public'){
        await stagePublic(null,'AI agent');
        return await finish();
      }
      if(!auto){
        if(both){
          const staged=await stagePublic(draft,'AI agent đã soạn phản hồi công khai và tin riêng, chờ duyệt.');
          if(staged.changes)return;
        }
        return await finish(draft,'AI agent đã soạn tin nhắn riêng, chờ duyệt.');
      }
      if(both){
        const staged=await stagePublic(draft,'AI agent đã đưa phản hồi công khai vào hàng đợi, đang gửi tin riêng.',true);
        if(!staged.changes)return await finish();
      }
      const receipt=await privateReceipt();
      if(receipt){
        return await finish(receipt.status==='sent'?null:draft,receipt.status==='sent'?
          'Khách đã nhận tin nhắn riêng cho bình luận này.':'Tin nhắn riêng đang chờ đối chiếu. Shop kiểm tra trước khi gửi lại.');
      }
      if(!messengerEnabled||!latest.channel.messenger){
        return await finish(draft,'Chưa nhắn riêng được. Hãy cấp lại quyền Messenger cho Page.');
      }
      try{
        await sendFacebookPrivateReply(latest.channel,item,renderBotReply(result.reply,names),true,result.sku??null);
      }catch(error){
        return await finish(draft,error instanceof AppError?error.message:
          'Chưa gửi được tin nhắn riêng. Shop kiểm tra quyền Messenger hoặc trạng thái gửi.');
      }
      return await finish(null,both?'AI agent đã nhắn riêng. Xem trạng thái phản hồi công khai ở bình luận.':'AI agent đã nhắn riêng.');
    }catch(error){
      const latest=await get('SELECT private_ai_draft FROM comments WHERE id=$1 AND private_ai_job=$2',id,claim);
      return await finish(latest?.private_ai_draft??null,error instanceof AppError?error.message:
        'AI agent chưa xử lý được bình luận. Kiểm tra kết nối Meta và OpenRouter.');
    }
  }));
}

function manuallyAnswered(item){
  return get(`SELECT 1 FROM inbox_messages WHERE channel_id=$1 AND sender_id=$2 AND automatic=0 AND reply IS NOT NULL
    AND (status IN ('queued','sending') OR (status='replied' AND COALESCE(sent_at,created)>=$3)) LIMIT 1`,
  item.channel_id,item.sender_id,item.created);
}

export async function replyTick(messaging=false) {
  if(messaging&&!messengerEnabled)return;
  if(messaging&&queueEnabled)await queueVerificationNotices();
  const table=messaging?'inbox_messages':'comments';
  const now=Date.now();
  await run(`UPDATE ${table} SET status='uncertain',reply_error='Chưa có xác nhận gửi. Hãy đối chiếu trên Meta.'
    WHERE status='sending' AND reply_claim_until<=$1`,now);
  if(messaging){
    await run("UPDATE inbox_messages SET status='expired',reply=NULL,automatic=0 WHERE status='queued' AND created<=$1",now-messageWindow);
    await run(`DELETE FROM messenger_uploads f USING inbox_messages m WHERE f.message_id=m.id
      AND (m.status NOT IN ('queued','sending') OR f.request_id IS DISTINCT FROM m.reply_request_id)`);
  }
  const queued=await all(`SELECT m.id FROM ${table} m JOIN channels c ON c.id=m.channel_id JOIN entitled_shop_channels entitlement ON entitlement.id=c.id JOIN shops tenant ON tenant.id=c.shop_id AND tenant.status='ACTIVE'
        AND (tenant.expired_at IS NULL OR tenant.expired_at>extract(epoch FROM clock_timestamp())*1000)
      JOIN users u ON u.id=tenant.owner_id
    WHERE u.active=1 AND u.email_verified_at IS NOT NULL AND m.status='queued' ORDER BY m.created LIMIT 8`);
  const results=await Promise.allSettled(queued.map(async({id})=>{
    const claimUntil=Date.now()+120_000;
    const item=await get(`UPDATE ${table} SET status='sending',reply_claim_until=$1 WHERE id=$2 AND status='queued' RETURNING *`,claimUntil,id);
    if(!item)return;
    const finish=(status,error=null,review=null)=>run(`UPDATE ${table} SET status=$1,
      ${messaging?'order_review=COALESCE($5::jsonb,order_review),':''}
      reply=CASE WHEN $1 IN ('review','expired') THEN NULL ELSE reply END,
      automatic=CASE WHEN $1 IN ('review','expired') THEN 0 ELSE automatic END,
      reply_error=$4 WHERE id=$2 AND status='sending' AND reply_claim_until=$3`,status,id,claimUntil,error,...(messaging?[review]:[]));
    const c=await get(`SELECT c.* FROM channels c JOIN entitled_shop_channels entitlement ON entitlement.id=c.id JOIN shops tenant ON tenant.id=c.shop_id AND tenant.status='ACTIVE'
        AND (tenant.expired_at IS NULL OR tenant.expired_at>extract(epoch FROM clock_timestamp())*1000)
      JOIN users u ON u.id=tenant.owner_id
      WHERE c.id=$1 AND u.active=1 AND u.email_verified_at IS NOT NULL`,item.channel_id);
    if(!c||(messaging&&!c.messenger))return finish('review');
    const entitled=await shopFeatures(c.shop_id);
    if(!entitled?.feature_flags[messaging?'messages':'comments'])return finish('review','Gói hiện tại không bao gồm tính năng này.');
    const customMessage=messaging&&c.message_bot_mode==='rules'&&c.message_bot_policy?.version===2;
    const verificationNotice=messaging&&item.reply_request_id?.startsWith('verification-');
    const productReviewNotice=messaging&&item.reply_request_id?.startsWith('product-review-');
    if(productReviewNotice&&c.page_purpose!=='sales')return finish('review');
    const requiresOrders=messaging&&item.automatic&&(item.order_auto||item.sales_ai);
    if((requiresOrders||verificationNotice)&&(c.page_purpose!=='sales'||!c.orders_enabled))
      return finish('review');
    if(messaging&&item.automatic){
      const contact=await get('SELECT agent_resume_at FROM messenger_contacts WHERE channel_id=$1 AND sender_id=$2',c.id,item.sender_id);
      if(!agentCanAnswer(item.created,contact?.agent_resume_at))return finish('review');
    }
    if(item.automatic||verificationNotice){
      const plan=await shopFeatures(c.shop_id);
      if(item.automatic&&!automationAllowed(plan,item.created))return finish('review',automationPauseNote(plan));
      if((requiresOrders||verificationNotice)&&!plan?.order_management)
        return finish('review','Gói hiện tại không có Quản lý đơn hàng.');
    }
    const catalogLookup=messaging&&item.automatic&&item.catalog_image_url;
    let orderLookup=messaging&&item.automatic&&item.order_auto;
    let aiReply=false;
    let conversationReply=false;
    const agent=customMessage&&agentEnabled(c.message_bot_policy);
    const conversationEnabled=customMessage&&(agent||['review','auto'].includes(c.message_bot_policy.conversationAi));
    if(!agent&&messaging&&item.automatic&&item.sales_ai&&customMessage&&c.orders_enabled&&c.page_purpose==='sales'&&c.order_ai_mode!=='off'){
      if((await messengerBotDecision(withoutFaqs(c.message_bot_policy,entitled),item)).action==='blocked')return finish('review');
      const outcome=await classifySalesMessage(c,item);
      if(outcome?.reply||outcome?.category){
        const applied=await run(`UPDATE inbox_messages m SET bot_category=$5,bot_suggestion=$6,sales_sku=$7,
          sales_inquiry=m.sales_inquiry OR $8 FROM channels c,messenger_contacts contact
          WHERE m.id=$1 AND m.status='sending' AND m.reply_claim_until=$2 AND c.id=m.channel_id
            AND c.orders_enabled AND c.page_purpose='sales' AND c.order_ai_mode=$3
            AND c.message_bot_policy IS NOT DISTINCT FROM $4::jsonb
            AND c.order_cases IS NOT DISTINCT FROM $9::jsonb
            AND contact.channel_id=m.channel_id AND contact.sender_id=m.sender_id AND contact.last_inbound<=m.created`,
        id,claimUntil,c.order_ai_mode,JSON.stringify(c.message_bot_policy),outcome.category,outcome.reply??null,
        outcome.sku??null,!!outcome.inquiry,JSON.stringify(c.order_cases));
        if(!applied.changes||!outcome.reply||c.order_ai_mode!=='auto')return finish('review');
        item.reply=outcome.reply;
        aiReply=true;
        orderLookup=true;
      }else if(!item.reply&&outcome?.error&&!conversationEnabled)return finish('review',outcome.error);
    }
    if(conversationEnabled&&item.automatic&&!orderLookup&&!catalogLookup&&(item.conversation_ai||item.sales_ai)){
      const policy=withoutFaqs(c.message_bot_policy,entitled);
      const history=await all(`SELECT text,reply,created,sales_sku FROM inbox_messages WHERE channel_id=$1 AND sender_id=$2
        AND id<>$3 AND created<=$4 AND created>$5
        ORDER BY (remote_id=$6) DESC NULLS LAST,created DESC,id DESC LIMIT 4`,
      c.id,item.sender_id,item.id,item.created,item.created-10*60_000,item.inbound_quote_mid);
      const outbound=await all(`SELECT '' AS text,text AS reply,created,sales_sku FROM messenger_page_messages
        WHERE channel_id=$1 AND recipient_id=$2 AND created<=$3 AND created>$4 ORDER BY created DESC LIMIT 3`,
      c.id,item.sender_id,item.created,item.created-10*60_000);
      const currentDecision=decideBotReply(policy,item.text,{context:history[0]?.text});
      if(currentDecision.action==='blocked')return finish('review');
      if(agent){
        let result;
        try{
          const plan=await shopFeatures(c.shop_id);
          if(!automationAllowed(plan,item.created))return finish('review',automationPauseNote(plan));
          const tracking=c.page_purpose==='sales'&&plan.order_management&&await shipmentCustomerReply(c.id,item.sender_id,item.text,history);
          result=tracking?{action:'reply',reply:tracking}:
            await runSalesAgent(c,policy,item.text,{context:history[0]?.text,
              history:[...history,...outbound].sort((a,b)=>a.created-b.created)});
        }catch(error){
          return finish('review',error instanceof AppError?error.message:
            'AI agent chưa xử lý được tin nhắn. Shop có thể trả lời thủ công.');
        }
        if(result?.action==='buy'){
          const requested=result.items??[result];
          const review={items:requested.map(({sku,quantity,size})=>({sku,quantity,size}))};
          if(policy.agentMode!=='auto'||!c.orders_enabled||c.page_purpose!=='sales'||!buyerIntent(item.text)){
            return finish('review','Khách quan tâm đặt hàng. Shop kiểm tra sản phẩm và số lượng.',review);
          }
          const cleaned=requested.reduce((text,{sku})=>text.replace(new RegExp(sku,'giu'),' '),item.text);
          const quantityInText=requested.every(({quantity})=>
            new RegExp('(?:^|[^0-9])'+quantity+'(?:[^0-9]|$)','u').test(cleaned));
          if(!quantityInText)return finish('review','Shop kiểm tra số lượng khách muốn đặt.',review);
          const ordered=await transaction(async()=>{
            const contact=await get('SELECT last_inbound,agent_resume_at FROM messenger_contacts WHERE channel_id=$1 AND sender_id=$2 FOR UPDATE',c.id,item.sender_id);
            if(!contact||contact.last_inbound>item.created||item.created<=Date.now()-messageWindow||
              !agentCanAnswer(item.created,contact.agent_resume_at))return null;
            const latest=await get(`SELECT order_cases,order_templates FROM channels WHERE id=$1 AND orders_enabled
              AND page_purpose='sales' AND message_bot_mode='rules' AND message_bot_policy=$2::jsonb FOR SHARE`,c.id,JSON.stringify(policy));
            const plan=await shopFeatures(c.shop_id);
            if(!latest||!plan?.order_management||!automationAllowed(plan,item.created)||await manuallyAnswered(item))return null;
            return orderReply(c.id,item.sender_id,item.text,checkoutTemplates(policy,latest.order_templates),policy.unifiedAgent?[]:latest.order_cases,
              {...result,kind:'buy',natural:true});
          });
          if(!ordered)return finish('review','Kiểm tra cấu hình Hướng dẫn đặt hàng trong Đơn hàng.');
          item.reply=ordered;
          orderLookup=true;
          conversationReply=true;
        }else if(result?.action==='reply'||result?.action==='photos'){
          const plan=await shopFeatures(c.shop_id);
          if(!automationAllowed(plan,item.created))return finish('review',automationPauseNote(plan));
          const changed=await run(`UPDATE inbox_messages m SET bot_category='AI agent',bot_suggestion=$3,sales_sku=$5
            FROM channels c,messenger_contacts contact WHERE m.id=$1 AND m.status='sending' AND m.reply_claim_until=$2
              AND c.id=m.channel_id AND c.message_bot_policy=$4::jsonb AND contact.channel_id=m.channel_id
              AND contact.sender_id=m.sender_id AND contact.last_inbound<=m.created`,
          id,claimUntil,result.reply,JSON.stringify(policy),result.sku??null);
          if(!changed.changes||policy.agentMode!=='auto')return finish('review');
          if(result.action==='photos'){
            const product=await get('SELECT detail_images FROM catalog_products WHERE channel_id=$1 AND sku=$2',c.id,result.sku);
            if(product?.detail_images?.length!==3)return finish('review','Sản phẩm chưa đủ ba ảnh chi tiết.');
            item.catalogPhotoBundle={sku:result.sku,images:product.detail_images};
          }
          item.reply=result.reply;
          conversationReply=true;
        }else return finish('review',result?.action==='handoff'?result.reason??'AI agent chuyển shop xử lý.':null);
      }else{
        let semantic;
        try{
          semantic=await understandConversation(c,policy,item.text,{context:history[0]?.text,
            history:[...history,...outbound].sort((a,b)=>a.created-b.created),manualOnly:policy.conversationAi!=='auto'});
        }catch{
          if(!item.reply||policy.conversationAi==='review')return finish('review','OpenRouter chưa xử lý được tin nhắn. Shop có thể trả lời thủ công.');
        }
        if(semantic?.abstain)return finish('review');
        if(semantic){
          const updated=await run(`UPDATE inbox_messages m SET bot_category=$3,bot_suggestion=$4
            FROM channels c,messenger_contacts contact WHERE m.id=$1 AND m.status='sending' AND m.reply_claim_until=$2
              AND c.id=m.channel_id AND c.message_bot_mode='rules' AND c.message_bot_policy=$5::jsonb
              AND contact.channel_id=m.channel_id AND contact.sender_id=m.sender_id AND contact.last_inbound<=m.created`,
          id,claimUntil,'OpenRouter · '+semantic.category,semantic.draft,JSON.stringify(policy));
          if(!updated.changes||semantic.action!=='auto')return finish('review');
          item.reply=renderBotReply(semantic.reply,{pageName:c.name,customerName:semantic.reply.includes('{{customer_name}}')
            ?await messengerName(c,item.sender_id):''});
          conversationReply=true;
        }else if(policy.conversationAi==='review'||!item.reply){
          if(currentDecision.reply)await run(`UPDATE inbox_messages SET bot_category=$2,bot_suggestion=$3
            WHERE id=$1 AND status='sending' AND reply_claim_until=$4`,id,currentDecision.category,currentDecision.reply,claimUntil);
          return finish('review');
        }
      }
    }
    if(orderLookup){
      if(!customMessage||!c.orders_enabled||c.page_purpose!=='sales')return finish('review');
      if((await messengerBotDecision(withoutFaqs(c.message_bot_policy,entitled),item)).action==='blocked')return finish('review');
    }
    let product;
    if(catalogLookup){
      if(!customMessage||c.catalog_mode==='off'||c.page_purpose!=='sales')return finish('review');
      const decision=await messengerBotDecision(withoutFaqs(c.message_bot_policy,entitled),item);
      if(decision.action==='blocked'){
        await run(`UPDATE inbox_messages SET bot_category=$1,bot_blocked=TRUE,bot_suggestion=NULL
          WHERE id=$2 AND status='sending' AND reply_claim_until=$3`,decision.category,id,claimUntil);
        return finish('review');
      }
      try{
        const match=await matchCatalogImage(c.id,item.catalog_image_url);
        if(match)product=await get(`SELECT sku,name,price,in_stock,image_url FROM catalog_products
          WHERE channel_id=$1 AND sku=$2 AND image_url=$3`,c.id,match.sku,match.image_url);
      }catch{
        return finish('review','Chưa đọc được một trong các ảnh để đối chiếu. Kiểm tra ảnh khách và URL ảnh công khai của sản phẩm.');
      }
      item.reply=product
        ? quoteFor(product,checkoutTemplates(c.message_bot_policy,c.order_templates),c.message_bot_policy.unifiedAgent?[]:c.order_cases,item.text)
        : salesReply(c.order_templates,'unknownImage',{},c.order_cases,item.text);
      if(!item.reply)return finish('review');
      const latest=await get(`SELECT c.catalog_mode,c.page_purpose,c.message_bot_mode,c.message_bot_policy,u.active,
          EXISTS(SELECT 1 FROM inbox_messages newer WHERE newer.channel_id=$1 AND newer.sender_id=$2 AND newer.created>$3) AS newer
        FROM channels c JOIN entitled_shop_channels entitlement ON entitlement.id=c.id JOIN shops tenant ON tenant.id=c.shop_id AND tenant.status='ACTIVE'
        AND (tenant.expired_at IS NULL OR tenant.expired_at>extract(epoch FROM clock_timestamp())*1000)
      JOIN users u ON u.id=tenant.owner_id WHERE c.id=$1`,c.id,item.sender_id,item.created);
      if(!latest?.active||latest.catalog_mode==='off'||latest.page_purpose!=='sales'||latest.message_bot_mode!=='rules'||latest.message_bot_policy?.version!==2)return finish('review');
      const latestDecision=await messengerBotDecision(withoutFaqs(latest.message_bot_policy,entitled),item);
      if(latestDecision.action==='blocked'){
        await run(`UPDATE inbox_messages SET bot_category=$1,bot_blocked=TRUE,bot_suggestion=NULL
          WHERE id=$2 AND status='sending' AND reply_claim_until=$3`,latestDecision.category,id,claimUntil);
        return finish('review');
      }
      await run(`UPDATE inbox_messages SET bot_category=$1,bot_suggestion=$2,sales_sku=$5
        WHERE id=$3 AND status='sending' AND reply_claim_until=$4`,
        product?'Sản phẩm · '+product.sku:'Chưa xác định được sản phẩm',item.reply,id,claimUntil,product?.sku??null);
      if(!product||c.catalog_mode!=='auto'||latest.catalog_mode!=='auto'||latest.newer||
        (latest.message_bot_policy.unifiedAgent&&latest.message_bot_policy.agentMode!=='auto'))return finish('review');
    }
    const publicAgentReply=!messaging&&item.automatic&&item.agent_public_policy;
    if(publicAgentReply){
      const current=await get(`SELECT 1 FROM channels WHERE id=$1 AND token=$2 AND message_bot_policy=$3::jsonb
        AND message_bot_policy->>'agentMode'='auto'`,c.id,c.token,JSON.stringify(item.agent_public_policy));
      if(!current)return finish('review');
    }
    if(!messaging&&item.automatic&&c.message_bot_policy?.unifiedAgent&&!publicAgentReply)return finish('review');
    if(item.automatic&&!catalogLookup&&!orderLookup&&!conversationReply&&!publicAgentReply){
      if(messaging&&!customMessage&&containsBlockedPhrase(item.text,c.message_bot_policy?.blocked)){
        await run(`UPDATE ${table} SET bot_blocked=TRUE,bot_category='Nội dung bị chặn',bot_suggestion=NULL
          WHERE id=$1 AND status='sending' AND reply_claim_until=$2`,id,claimUntil);
        return finish('review');
      }
      const rule=messaging?null:await postBot(c,item.media_id,'',item.post_id);
      const mode=rule?.bot_mode&&rule.bot_mode!=='inherit'?rule.bot_mode:c.bot_mode;
      const policy=rule?.bot_mode==='inherit'||!rule ? c.comment_policy : rule.comment_policy;
      const customComment=!messaging&&policy?.version===2;
      const decision=customMessage?await messengerBotDecision(withoutFaqs(c.message_bot_policy,entitled),item)
        :customComment?decideBotReply(withoutFaqs(policy,entitled),item.text,{manualOnly:mode!=='auto'||!!item.parent_key}):null;
      const expected=decision?(decision.action==='auto'&&decision.reply):messaging
        ?(c.message_bot_mode==='greeting'&&acknowledgementTemplates[c.message_greeting])
        :(mode==='auto'&&commentDecision(policy,item.text).reply);
      if(!item.automatic_ack||!expected||expected!==item.reply){
        if(decision)await run(`UPDATE ${table} SET bot_blocked=$1,bot_category=$2,bot_suggestion=$3
          WHERE id=$4 AND status='sending' AND reply_claim_until=$5`,
          decision.action==='blocked',decision.category,decision.reply||null,id,claimUntil);
        return finish('review');
      }
      if(customMessage||customComment){
        const customerName=messaging
          ?(item.reply.includes('{{customer_name}}')?await messengerName(c,item.sender_id):'')
          :item.author==='Người xem'?'':item.author;
        item.reply=renderBotReply(item.reply,{customerName,pageName:c.name});
      }else if(messaging&&c.message_personalize){
        item.reply=messengerGreeting(c.message_greeting,{
          customerName:await messengerName(c,item.sender_id),pageName:singleLine(c.name),
        });
      }
    }
    if(item.automatic&&messaging&&await manuallyAnswered(item))return finish('review');
    if(messaging&&item.created<=Date.now()-messageWindow)return finish('expired');
    if(messaging&&item.automatic){
      const updated=await run(`UPDATE inbox_messages m SET reply=$3 FROM channels c
        WHERE m.id=$1 AND m.status='sending' AND m.reply_claim_until=$2 AND c.id=m.channel_id
          AND c.messenger=1 AND c.token=$4 AND c.message_bot_mode=$5
          AND c.message_bot_policy IS NOT DISTINCT FROM $6::jsonb AND c.message_greeting=$7 AND c.message_personalize=$8
          AND ($19::text IS NULL OR EXISTS (SELECT 1 FROM catalog_products p
            WHERE p.channel_id=c.id AND p.sku=$19 AND p.detail_images=$20::jsonb))
          AND (NOT $18::boolean OR EXISTS(SELECT 1 FROM messenger_contacts contact
            WHERE contact.channel_id=m.channel_id AND contact.sender_id=m.sender_id AND contact.last_inbound<=m.created))
          AND (NOT $14::boolean OR (c.orders_enabled AND c.page_purpose='sales'))
          AND (NOT $15::boolean OR (c.order_ai_mode='auto' AND c.order_cases IS NOT DISTINCT FROM $16::jsonb
            AND c.order_templates IS NOT DISTINCT FROM $17::jsonb AND EXISTS(SELECT 1 FROM messenger_contacts contact
              WHERE contact.channel_id=m.channel_id AND contact.sender_id=m.sender_id AND contact.last_inbound<=m.created)))
          AND ($9::text IS NULL OR (c.catalog_mode='auto' AND c.page_purpose='sales'
            AND EXISTS(SELECT 1 FROM catalog_products p WHERE p.channel_id=c.id AND p.sku=$9
              AND p.name=$10 AND p.price=$11 AND p.in_stock=$12 AND p.image_url=$13)))`,
        id,claimUntil,item.reply,c.token,c.message_bot_mode,c.message_bot_policy,c.message_greeting,c.message_personalize,
        product?.sku??null,product?.name??null,product?.price??null,product?.in_stock??null,product?.image_url??null,!!orderLookup,aiReply,JSON.stringify(c.order_cases),JSON.stringify(c.order_templates),conversationReply,
        item.catalogPhotoBundle?.sku??null,JSON.stringify(item.catalogPhotoBundle?.images??[]));
      if(!updated.changes){
        if(catalogLookup)await run(`UPDATE inbox_messages SET bot_suggestion=NULL
          WHERE id=$1 AND status='sending' AND reply_claim_until=$2`,id,claimUntil);
        return finish('review');
      }
    }
    let status, receipt, replyError=null;
    try{
      ensure(await activePage(item.channel_id),403,'Page đang tạm ngừng xử lý.');
      ensure(!item.queued_by||await canSendQueuedReply(item.channel_id,item.queued_by),
        403,'Người gửi không còn quyền trả lời trên Page.');
      if(productReviewNotice)ensure(await get(`SELECT 1 FROM channels WHERE id=$1 AND page_purpose='sales'`,c.id),
        403,'Page này đã ngừng bán hàng.');
      if(item.automatic||verificationNotice){
        if(orderLookup||requiresOrders||verificationNotice){
          ensure(await get(`SELECT 1 FROM channels WHERE id=$1 AND page_purpose='sales' AND orders_enabled`,c.id),
            403,'Page này đã tắt chốt đơn.');
        }
        const plan=await shopFeatures(c.shop_id);
        ensure(!item.automatic||automationAllowed(plan,item.created),403,automationPauseNote(plan));
        ensure(!(orderLookup||requiresOrders||verificationNotice)||plan?.order_management,403,
          'Gói hiện tại không có Quản lý đơn hàng.');
      }
      ensure((await shopFeatures(c.shop_id))?.feature_flags[messaging?'messages':'comments'],403,'Gói hiện tại không bao gồm tính năng này.');
      if(messaging&&item.automatic){
        // Serialize dispatch with a staff takeover. A successful takeover cannot leave a new Agent send in flight.
        receipt=await transaction(async()=>{
          await run(`INSERT INTO messenger_contacts(channel_id,sender_id,last_inbound)
            VALUES($1,$2,$3) ON CONFLICT (channel_id,sender_id) DO NOTHING`,c.id,item.sender_id,item.created);
          const contact=await get(`SELECT agent_resume_at FROM messenger_contacts
            WHERE channel_id=$1 AND sender_id=$2 FOR UPDATE`,c.id,item.sender_id);
          if(!agentCanAnswer(item.created,contact?.agent_resume_at))return null;
          return sendReply(c,item,true);
        });
        if(!receipt)return finish('review');
      }else receipt=await sendReply(c,item,messaging);
      status=receipt.id?'replied':'uncertain';
      if(status==='uncertain')replyError='Meta chưa xác nhận đã gửi phản hồi.';
    }catch(error){
      status=error.ambiguous?'uncertain':'review';
      replyError=error instanceof MetaError||error instanceof AppError
        ?error.message:'SnailChat chưa gửi được phản hồi.';
      if(messaging&&error instanceof MetaError&&error.httpStatus){
        console.warn('Messenger Send API rejected',JSON.stringify({
          mode:item.automatic?'automatic':'manual',
          httpStatus:error.httpStatus,code:error.code,
          error_subcode:error.subcode||null,fbtrace_id:error.traceId||null,
        }));
        if(error.subcode)replyError+=' Mã phụ Meta '+error.subcode+'.';
        if(error.code===10||error.code===200){
          replyError+=' Kiểm tra quyền pages_messaging và quyền nhắn tin của Page.';
        }
      }
    }
    if(status==='replied'&&messaging&&item.automatic_ack&&!customMessage){
      return run(`UPDATE inbox_messages SET status='review',greeting=reply,greeting_remote_id=$3,reply=NULL,automatic=0,automatic_ack=0,
        reply_error=NULL WHERE id=$1 AND status='sending' AND reply_claim_until=$2`,id,claimUntil,receipt.id);
    }
    if(status==='replied'&&messaging){
      return transaction(async()=>{
        const now=receipt.sentAt??Date.now();
        const updated=await run(`UPDATE inbox_messages SET status='replied',sent_at=$3,reply_remote_id=$4,reply_error=NULL
          WHERE id=$1 AND status='sending' AND reply_claim_until=$2`,id,claimUntil,now,receipt.id);
        if(!updated.changes||!item.reply_request_id?.startsWith('verification-'))return;
        const code=item.reply_request_id.slice('verification-'.length);
        const verified=await get(`SELECT * FROM order_verifications WHERE channel_id=$1 AND code=$2
          AND notice_message_id=$3 AND status='verified' FOR UPDATE`,item.channel_id,code,id);
        if(!verified)return;
        const placed=await createShopOrder(verified.channel_id,verified.sender_id,verified,{
          sku:verified.sku,name:verified.approved_product_name,price:verified.unit_price,
        },now,false);
        if(!placed)return;
        await run("UPDATE order_verifications SET status='approved' WHERE channel_id=$1 AND code=$2",item.channel_id,code);
      });
    }
    if(status==='replied'){
      return transaction(async()=>{
        let parent=receipt.observedParent;
        if(receipt.checkParent){
          // A signed webhook can arrive before the newly created comment is readable.
          const seen=!parent&&await get(`SELECT parent_remote_id FROM facebook_comment_links
            WHERE channel_id=$1 AND media_key=$2 AND comment_key=$3`,c.id,item.facebook_media_key,facebookCommentKey(receipt.id));
          parent||=seen?.parent_remote_id||'';
          if(!parent)replyError='Facebook đã đăng phản hồi. Chưa xác minh được bình luận cha.';
          else if(facebookCommentKey(parent)!==item.facebook_key)
            replyError='Facebook đã đăng phản hồi dưới một bình luận khác với bình luận đã chọn.';
        }
        const updated=await run(`UPDATE comments SET status='replied',reply_sent_at=$3,reply_error=$4,reply=$5
          WHERE id=$1 AND status='sending' AND reply_claim_until=$2`,id,claimUntil,receipt.sentAt,replyError,item.reply);
        if(updated.changes&&receipt.parent)
          await rememberFacebookCommentLink(c.id,item.media_id,receipt.id,parent||receipt.parent,!!parent);
      });
    }
    return finish(status,replyError);
  }));
  for(const result of results){
    if(result.status==='rejected')console.error('Reply queue item error:',result.reason?.code??result.reason?.name);
  }
}
const numberOrNull=(value)=>Number.isSafeInteger(value)&&value>=0?value:null;

export async function publishedPosts(channel,after) {
  const facebook=channel.platform==='fb';
  const token=validToken(channel);
  const fields=facebook
    ?'id,message,created_time,permalink_url,full_picture,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares'
    :'id,caption,timestamp,permalink,media_type,media_product_type,like_count,comments_count,thumbnail_url,media_url';
  const edge=pathId(channel.meta_id)+(facebook?'/published_posts':'/media');
  const read=(cursor,limit,selection)=>graph(channel.platform,edge,{
    token,fields:selection,params:{limit,...(cursor?{after:cursor}:{})},
  });
  const posts=[];
  let next=after||null;
  const visited=new Set();
  try{
    // Meta can return a short page with a cursor when it filters individual records.
    for(let hop=0;hop<8;hop++){
      if(visited.has(next)){next=null;break;}
      visited.add(next);
      const full=posts.length===pageSize;
      let result;
      try{result=await read(next,full?1:pageSize-posts.length,full?'id':fields);}
      catch(error){if(full)break;throw error;}
      const batch=(result.data??[]).filter(item=>item.id);
      if(full&&batch.length)break;
      if(!full)posts.push(...batch);
      next=result.paging?.next?s(result.paging?.cursors?.after)||null:null;
      if(!next)break;
    }
  }catch(error){
    throw new AppError(502,error instanceof MetaError?error.message:'Chưa tải được bài đăng từ Meta.');
  }
  const plan=posts.length?await shopFeatures(channel.shop_id):null;
  const ai=agentIncluded(plan);
  const syncRows=facebook&&plan?.feature_flags.comments?await all(`SELECT media_id,synced_at,last_error FROM facebook_comment_sync
    WHERE channel_id=$1 AND media_id=ANY($2::text[])`,channel.id,posts.map((item)=>postKey(channel,String(item.id)))):[];
  const syncByPost=new Map(syncRows.map((row)=>[row.media_id,row]));
  const items=await Promise.all(posts.map(async(item)=>{
    const rule=ai?await postBot(channel,String(item.id)):null;
    const sync=syncByPost.get(postKey(channel,String(item.id)));
    return {
      id:String(item.id), text:(s(facebook?item.message:item.caption)).slice(0,4000),
      publishedAt:s(facebook?item.created_time:item.timestamp), permalink:s(facebook?(item.permalink_url||item.link):item.permalink),
      type:facebook?'':s(item.media_product_type==='REELS'?'Reel':item.media_type),
      thumbnail:metaImage(facebook?item.full_picture:item.thumbnail_url||(item.media_type!=='VIDEO'?item.media_url:'')),
      reactions:numberOrNull(facebook?item.reactions?.summary?.total_count:item.like_count),
      comments:numberOrNull(facebook?item.comments?.summary?.total_count:item.comments_count),
      shares:facebook?numberOrNull(item.shares?.count):null,
      ...(ai?{botMode:rule?.bot_mode==='auto'&&!rule.comment_policy?'review':rule?.bot_mode??'inherit',policy:withoutFaqs(rule?.comment_policy,plan)??null}:{}),
      commentSync:sync?{lastSync:sync.synced_at,error:sync.last_error}:null,
    };
  }));
  return {items,next};
}

function metaImage(value) {
  try {
    const url=new URL(value);
    const allowed=['fbcdn.net','cdninstagram.com','fbsbx.com'].some((host)=>url.hostname===host||url.hostname.endsWith('.'+host));
    if(!allowed||url.protocol!=='https:'||url.username||url.password||url.port)return '';
    if(url.searchParams.has('access_token'))url.searchParams.delete('access_token');
    return url.href;
  } catch { return ''; }
}

const visualCache=new Map();
function cachedVisual(key,read) {
  const current=visualCache.get(key);
  if(current?.expires>Date.now())return current.value;
  if(visualCache.size>=1000)visualCache.delete(visualCache.keys().next().value);
  const entry={expires:Date.now()+10*60_000,value:read().catch(()=>{
    entry.expires=Date.now()+45_000;
    return null;
  })};
  visualCache.set(key,entry);
  return entry.value;
}

export function channelAvatar(channel) {
  return cachedVisual('avatar:'+channel.id+':'+channel.meta_id,async()=>{
    const token=validToken(channel);
    const id=pathId(channel.meta_id);
    if(channel.platform==='fb'){
      const result=await graph('fb',id+'/picture',{token,params:{redirect:false,type:'normal'}});
      return result.data?.is_silhouette?'':metaImage(result.data?.url);
    }
    const result=await graph('ig',id,{token,fields:'profile_picture_url'});
    return metaImage(result.profile_picture_url);
  });
}

export function postContext(channel,media) {
  return cachedVisual('post:'+channel.id+':'+media,async()=>{
    const facebook=channel.platform==='fb';
    const id=facebook&&/^\d+$/.test(media)?channel.meta_id+'_'+media:media;
    const fields=facebook?'message,full_picture,permalink_url':'caption,media_type,thumbnail_url,media_url,permalink';
    const token=validToken(channel);
    const item=await graph(channel.platform,pathId(id),{token,fields,timeout:8_000}).catch((error)=>{
      if(!facebook||id===media)throw error;
      return graph('fb',pathId(media),{token,fields:'name,images,link',timeout:8_000});
    });
    const thumbnail=facebook?(item.full_picture||item.images?.[0]?.source):item.thumbnail_url||(item.media_type!=='VIDEO'?item.media_url:'');
    return {
      text:s(facebook?(item.message||item.name):item.caption).slice(0,900),
      thumbnail:metaImage(thumbnail),
      permalink:s(facebook?(item.permalink_url||item.link):item.permalink),
    };
  });
}

export async function channelInsights(c) {
  if(!c.token||c.expires&&c.expires<=Date.now())return {messageKey:'metaReconnect',message:'Kết nối lại kênh để xem dữ liệu Meta.'};
  if(!insightsEnabled)return {messageKey:'metaDisabled',message:'Máy chủ chưa bật quyền Insights. Bật META_INSIGHTS_ENABLED rồi kết nối lại kênh.'};
  const configs=c.platform==='fb'?
    [['page_media_view','Lượt hiển thị nội dung'],['page_post_engagements','Tương tác bài viết']]:
    [['views','Lượt xem'],['reach','Tài khoản tiếp cận'],['total_interactions','Tương tác']];
  const end=Math.floor(Date.now()/86400000)*86400, start=end-7*86400;
  const token=validToken(c), edge=pathId(c.meta_id)+'/insights';
  const results=await Promise.allSettled(configs.map(async([metric,label])=>{
    const params={metric,period:'day',since:start,until:end,...(c.platform==='ig'?{metric_type:'total_value'}:{})};
    const result=await graph(c.platform,edge,{token,params});
    const item=result?.data?.find((row)=>row.name===metric);
    const values=item?.values?.filter((row)=>Number.isFinite(row.value));
    const total=item?.total_value?.value;
    return {key:metric,label,value:Number.isFinite(total)?total:values?.length?values.reduce((sum,row)=>sum+row.value,0):null};
  }));
  if(results.every((result)=>result.status==='rejected'))return {messageKey:'metaUnavailable',message:'Meta chưa trả số liệu. Kiểm tra quyền Insights rồi kết nối lại kênh.'};
  return {metrics:results.map((result,i)=>result.status==='fulfilled'?result.value:{key:configs[i][0],label:configs[i][1],value:null})};
}
export async function refreshInstagram(){
  const now=Date.now();
  for(const c of await all(`SELECT c.id,c.token,c.expires FROM channels c JOIN shops s ON s.id=c.shop_id
    WHERE c.platform='ig' AND c.expires>$1 AND c.expires<$2 AND c.token IS NOT NULL
      AND s.status='ACTIVE' AND (s.expired_at IS NULL OR s.expired_at>$1)`,now,now+7*86400000)){
    try{
      const response=await request('https://graph.instagram.com/refresh_access_token',{params:{grant_type:'ig_refresh_token',access_token:unseal(c.token)}});
      if(response.access_token&&Number(response.expires_in)>0)await run('UPDATE channels SET token=$1,expires=$2 WHERE id=$3 AND expires=$4',seal(response.access_token),now+Number(response.expires_in)*1000,c.id,c.expires);
    }catch{}
  }
}
