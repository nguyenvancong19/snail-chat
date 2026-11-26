import { displayWorkActor, takeoverHistory } from '../shops/work-activity.mjs';
import { pageSize } from '../db/pagination.mjs';
import { agentIncluded, automationAllowed, catalogIncluded, requirePlanFeature, shopFeatures, withoutFaqs } from '../billing/plan-features.mjs';
import { hasPurchasedPlan } from '../billing/plan-changes.mjs';
import { shopLimits, shopUsage } from '../billing/limits.mjs';
import { get, all, run, access } from '../db/store.mjs';
import { ensureDefaultShop, pageGrants, requireShop, usableShop, userShops, workspaceShop, visiblePageIds } from '../shops/tenant.mjs';
import { shopNameDetails } from '../shops/names.mjs';
import { pendingInvitations } from '../shops/members.mjs';
import { choicesOf, ensure, publicUser, string } from '../http/validation.mjs';
import { configured, facebookCommentRoot, messageWindow, messengerEnabled, postBot, privateReplyWindow, queueEnabled } from '../meta/meta.mjs';

function viewActivity(row, messaging, now, ai, owner=false) {
  let status=row.status;
  if(messaging&&status==='review'&&row.created<=now-messageWindow)status='expired';
  if(status==='queued'||status==='sending')status='working';
  const showingReply=['replied','working','uncertain'].includes(status);
  return {
    ...(messaging?{agentResumeAt:row.agent_resume_at??0}:{handled:row.handled_at!=null?'manual':status==='replied'?(row.automatic?'agent':'reply'):null,privateReply:row.private_status==='sending'&&row.private_started<now-60_000
      ?'uncertain':row.private_status??null,privateReplyError:row.private_error??null,
      privateReplyAutomatic:!!row.private_automatic,privateReplyDraft:ai?row.private_ai_draft??null:null,
      privateReplyInWindow:row.created>now-privateReplyWindow}),
    customerName:messaging?row.display_name??null:null,
    id:row.id,channelId:row.channel_id,author:messaging?(row.display_name||'Khách Messenger · '+row.sender_id):row.author,
    source:messaging?null:row.post_title||row.media_id||null,mediaId:messaging?null:row.media_id||row.post_remote_id||null,
    senderId:messaging?row.sender_id:null,greeting:messaging?row.greeting:null,
    ...(messaging?{orderReview:ai?row.order_review??null:null,reviewReply:row.reply_request_id==='product-review-'+row.id,mid:row.remote_id,quoteMid:row.inbound_quote_mid,attachments:row.attachments,
      greetingMid:row.greeting_remote_id,replyMid:row.reply_remote_id,
      replyQuote:showingReply?row.reply_payload?.quote??null:null,
      replyAttachment:showingReply?row.reply_payload?.attachment??null:null}:{}),
    previousReplies:messaging?(row.previous_replies??[]).map(({text,sentAt,mid,quote,attachment,actor,automatic})=>({text,sentAt,mid,quote,attachment,automatic,
      ...(owner&&actor?{actor:displayWorkActor(actor)}:{})})):[],
    ...(messaging&&owner?{
      takeoverActor:row.agent_resume_at>now?displayWorkActor(row.takeover_actor):null,
      replyActor:row.status==='replied'&&!row.automatic?displayWorkActor(row.reply_actor):null,
    }:{}),
    sentAt:messaging?row.sent_at:row.reply_sent_at,nested:!messaging&&!!row.parent_key,text:row.text,botCategory:ai?row.bot_category:null,botSuggestion:ai?row.bot_suggestion:null,botBlocked:ai&&!!row.bot_blocked,
    status,reply:showingReply?row.reply:null,
    replyError:row.reply_error??null,automatic:!!row.automatic,created:row.created,
  };
}

export async function bootstrap(user,selectedShop,pagedAccounts=false) {
  if(!user)return {mode:'live',user:null};
  await ensureDefaultShop(user);
  const now=Date.now();
  const data={mode:'live',user:publicUser(user),channels:[],users:[],stats:{},meta:{}};
  data.theme=(await get('SELECT ui_theme FROM users WHERE id=$1',user.id))?.ui_theme??{};
  if(user.is_super_admin){
    data.accountTotals=await get(`SELECT count(*) AS total,
      count(*) FILTER (WHERE role='user' AND NOT is_super_admin) AS customers,
      count(*) FILTER (WHERE role='user' AND NOT is_super_admin AND active=1) AS active FROM users`);
    if(!pagedAccounts)data.users=(await all(`SELECT u.id,u.name,u.email,u.role,u.active,u.email_verified_at,u.is_super_admin,
      (SELECT COUNT(*) FROM channels c JOIN shops s ON s.id=c.shop_id WHERE s.owner_id=u.id AND c.token IS NOT NULL
        AND (c.expires IS NULL OR c.expires>$1)) AS connected
      FROM users u ORDER BY u.name`,now)).map(u=>({...publicUser(u),connectedChannels:u.connected}));
    const platforms=await get(`SELECT COUNT(*) FILTER (WHERE platform='fb') AS facebook,
      COUNT(*) FILTER (WHERE platform='ig') AS instagram
      FROM channels WHERE token IS NOT NULL AND (expires IS NULL OR expires>$1)`,now);
    const comments=await get("SELECT COUNT(*) AS comments, COUNT(*) FILTER (WHERE status='replied') AS replied FROM comments");
    const messages=await get("SELECT COUNT(*) AS messages, COUNT(*) FILTER (WHERE status='replied' OR jsonb_array_length(previous_replies)>0) AS messages_replied FROM inbox_messages");
    data.system={...platforms,...comments,...messages};
    data.user.shops=await userShops(user.id);
    return data;
  }
  data.shops=await userShops(user.id);
  data.invitations=await pendingInvitations(user);
  data.user.shops=data.shops;
  const eligible=data.shops.filter((shop)=>usableShop(shop,now));
  const selected=workspaceShop(data.shops,user.preferred_shop_id,selectedShop,now);
  const current=selectedShop===undefined?selected:
    ensure(selected,403,'Shop đang bị khóa, hết hạn hoặc bạn không còn quyền truy cập.');
  data.shopSelectionNeeded=!current&&eligible.length>1;
  data.shopPreferenceUnavailable=selectedShop===undefined&&!!user.preferred_shop_id&&current?.id!==user.preferred_shop_id;
  data.activeShopId=current?.id??null;
  data.memberRole=current?.role??null;
  data.shopAccessLimited=!!current&&!usableShop(current,now);
  data.hasPurchasedPlan=current?.role==='OWNER'&&await hasPurchasedPlan(current.id);
  if(!current||data.shopAccessLimited)return data;
  user=await requireShop(user,current.id);
  const plan=await get('SELECT * FROM shops WHERE id=$1',current.id);
  const [limits,usage,features]=await Promise.all([shopLimits(plan),shopUsage(current.id),shopFeatures(current.id)]);
  const ai=agentIncluded(features);
  const orders=features?.order_management===true;
  const flags=features?.feature_flags??{};
  const knowledgePolicy=(policy)=>{
    if(!owner||(!ai&&!flags.faq))return null;
    if(!ai)return {unifiedAgent:policy?.unifiedAgent,rules:(policy?.rules??[]).filter(rule=>rule.type==='faq')};
    return withoutFaqs(policy,features);
  };
  data.planFeatures={...features,agent_enabled:ai,catalog_enabled:catalogIncluded(features),
    order_management:orders,agent_active:automationAllowed(features,now,now)};
  data.shopOverQuota=usage.pages>limits.pages||usage.staff+usage.invitations>limits.staff;
  const grants=new Map((await pageGrants(user)).map(({id,permissions})=>[id,permissions]));
  const chatPages=[...grants].filter(([,permissions])=>permissions.includes('chat:read')).map(([id])=>id);
  const owner=user.memberRole==='OWNER';
  if(owner)data.shopName=await shopNameDetails(plan);
  const orderPages=owner&&orders?[...grants.keys()]:[];
  data.channels=(await all(`SELECT c.*, EXISTS(SELECT 1 FROM shop_orders o WHERE o.channel_id=c.id) AS has_orders
    FROM channels c WHERE c.id=ANY($1::text[]) ORDER BY c.name,c.platform`,[...grants.keys()])).map((c)=>({
    id:c.id,name:c.name,handle:c.handle,platform:c.platform,createdAt:c.created_at,topic:c.topic,purpose:c.page_purpose,permissions:orders&&c.platform==='fb'&&(c.page_purpose==='sales'||c.has_orders)?grants.get(c.id):grants.get(c.id).filter((permission)=>!permission.startsWith('order:')),
    botMode:ai?(c.bot_mode==='auto'&&!c.comment_policy?'review':c.bot_mode):'off',policy:knowledgePolicy(c.comment_policy),
    ordersEnabled:orders&&c.platform==='fb'&&c.page_purpose==='sales'&&c.orders_enabled,aiToolsEnabled:ai,messageBotMode:ai?c.message_bot_mode:'off',
    messageBotPolicy:knowledgePolicy(c.message_bot_policy),messageGreeting:ai?c.message_greeting:null,messagePersonalize:ai&&c.message_personalize,
    commentsEnabled:flags.comments===true,quickRepliesEnabled:flags.quickReplies===true,privateRepliesEnabled:flags.messages===true,messenger:messengerEnabled&&!!c.messenger,connected:!!(c.token&&(!c.expires||c.expires>now)),
  }));
  data.meta={fb:configured('fb'),ig:configured('ig'),messenger:messengerEnabled,commentSync:queueEnabled};
  const engagementCounts=await all(`SELECT c.id,
    COALESCE(cm.total,0) AS comments, COALESCE(cm.replied,0) AS comment_replies, COALESCE(cm.pending,0) AS pending_comments,
    COALESCE(im.total,0) AS messages, COALESCE(im.replied,0) AS message_replies, COALESCE(pending_threads.pending,0) AS pending_messages,
    COALESCE(verifications.pending,0) AS pending_verifications
    FROM channels c
    LEFT JOIN LATERAL (SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='replied') AS replied,
      COUNT(*) FILTER (WHERE status='review' AND handled_at IS NULL) AS pending FROM comments WHERE channel_id=c.id) cm ON true
    LEFT JOIN LATERAL (SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='replied' OR jsonb_array_length(previous_replies)>0) AS replied
      FROM inbox_messages WHERE channel_id=c.id) im ON true
    LEFT JOIN LATERAL (SELECT COUNT(*) AS pending FROM (
      SELECT DISTINCT ON(sender_id) status,created FROM inbox_messages WHERE channel_id=c.id
      ORDER BY sender_id,created DESC,id DESC
    ) newest WHERE status='review' AND created>$2) pending_threads ON true
    LEFT JOIN LATERAL (SELECT COUNT(*) AS pending FROM order_verifications WHERE c.id=ANY($3::text[]) AND c.page_purpose='sales' AND channel_id=c.id AND status='pending') verifications ON true
    WHERE c.id=ANY($1::text[])`,[...grants.keys()],now-messageWindow,orderPages);
  data.stats=Object.fromEntries(engagementCounts.map(({id,...counts})=>[
    id,Object.fromEntries(Object.entries(counts).filter(([key])=>owner||key==='pending_messages'||key==='pending_comments').map(([key,value])=>[
      key,(key==='pending_verifications'?orderPages:flags[key.includes('comment')?'comments':'messages']?chatPages:[]).includes(id)?value:0,
    ])),
  ]));
  if(orderPages.length&&data.channels.some((channel)=>channel.purpose==='sales')){
    const dayMs=86_400_000, offset=7*3_600_000;
    const today=Math.floor((now+offset)/dayMs);
    const days=Array.from({length:7},(_,index)=>today-6+index);
    const start=days[0]*dayMs-offset,end=(today+1)*dayMs-offset;
    const counts=await all(`SELECT o.channel_id,(o.created+$2)/$3 AS day,COUNT(*) AS count,COUNT(*) FILTER(WHERE o.bot_created) AS automatic
      FROM shop_orders o JOIN channels c ON c.id=o.channel_id
      WHERE c.id=ANY($1::text[]) AND c.page_purpose='sales' AND o.created>=$4 AND o.created<$5
      GROUP BY o.channel_id,day`,orderPages,offset,dayMs,start,end);
    const conversion=await all(`WITH inquiries AS (
      SELECT m.channel_id,m.sender_id,MIN(m.created) AS first_at FROM inbox_messages m
      JOIN channels c ON c.id=m.channel_id WHERE c.id=ANY($1::text[]) AND c.page_purpose='sales'
      AND m.sales_inquiry AND m.created>=$2 AND m.created<$3 GROUP BY m.channel_id,m.sender_id
    ) SELECT i.channel_id,COUNT(*) AS asked,COUNT(*) FILTER(WHERE EXISTS(
      SELECT 1 FROM shop_orders o WHERE o.channel_id=i.channel_id AND o.sender_id=i.sender_id
        AND o.created>=i.first_at AND o.created<$3 AND o.status<>'cancelled'
    )) AS bought FROM inquiries i GROUP BY i.channel_id`,orderPages.filter((id)=>chatPages.includes(id)),start,end);
    data.orders={days:days.map((day)=>new Date(day*dayMs).toISOString().slice(0,10)),counts,conversion,today};
  }
  return data;
}

export async function activity(user,{kind,channel,status,before,sender='',threads=false}) {
  const messaging=kind==='message';
  await requirePlanFeature(user.currentShop.id,messaging?'messages':'comments');
  const limit=threads?pageSize:50;
  const table=messaging?'inbox_messages':'comments';
  const pageIds=await visiblePageIds(user,'chat:read');
  if(channel)ensure(pageIds.includes(channel),404,'Không tìm thấy Page được phân quyền.');
  const now=Date.now();
  const source=messaging&&threads
    ? 'SELECT DISTINCT ON (channel_id,sender_id) * FROM visible ORDER BY channel_id,sender_id,created DESC,id DESC'
    : 'SELECT * FROM visible';
  const rows=await all(`WITH visible AS (
    SELECT m.* ${messaging?',contact.display_name,contact.agent_resume_at,contact.takeover_actor':',p.title AS post_title,COALESCE(p.alias_id,p.remote_id) AS post_remote_id,l.parent_key'} FROM ${table} m
    JOIN channels c ON c.id=m.channel_id ${messaging
      ?'LEFT JOIN messenger_contacts contact ON contact.channel_id=m.channel_id AND contact.sender_id=m.sender_id'
      :`LEFT JOIN posts p ON p.id=m.post_id
         LEFT JOIN facebook_comment_links l ON c.platform='fb' AND l.channel_id=m.channel_id
           AND l.media_key=m.facebook_media_key AND l.comment_key=m.facebook_key`}
    WHERE c.id=ANY($1::text[]) AND ($2='' OR m.channel_id=$2) AND ($8='' ${messaging?'OR m.sender_id=$8':''})
  ), candidates AS (${source})
    SELECT * FROM candidates m
    WHERE ($3='' OR $3=CASE
      WHEN m.status IN ('queued','sending') THEN 'working'
      WHEN $4 AND m.status='review' AND m.created<=$5 THEN 'expired'
      ELSE m.status END)
      AND (m.created,m.id)<($6,$7)
    ORDER BY m.created DESC,m.id DESC LIMIT ${limit+1}`,
    pageIds,channel,status,messaging,now-messageWindow,before?.created??Number.MAX_SAFE_INTEGER,before?.id??'',sender);
  const ai=agentIncluded(await shopFeatures(user.currentShop.id));
  const owner=user.memberRole==='OWNER';
  const items=rows.slice(0,limit).map((row)=>viewActivity(row,messaging,now,ai,owner));
  const last=items.at(-1);
  const next=rows.length>limit?last.created+':'+last.id:null;
  if(messaging&&sender&&!threads){
    const outbound=await all(`SELECT m.remote_id AS mid,m.text,m.created,m.attachments,m.quote_mid AS "quoteMid",
      m.app_id AS "appId",m.app_id IS NOT NULL AS "fromApp" FROM messenger_page_messages m JOIN channels c ON c.id=m.channel_id
      WHERE c.id=ANY($1::text[]) AND m.channel_id=$2 AND m.recipient_id=$3 AND m.created>=$4 AND m.created<$5
      AND NOT EXISTS (SELECT 1 FROM inbox_messages i WHERE i.channel_id=m.channel_id AND i.sender_id=m.recipient_id
        AND (i.reply_remote_id=m.remote_id OR i.greeting_remote_id=m.remote_id
          OR i.previous_replies @> jsonb_build_array(jsonb_build_object('mid',m.remote_id))))
      ORDER BY m.created DESC,m.remote_id DESC LIMIT 200`,
      pageIds,channel,sender,next?last.created:0,before?.created??Number.MAX_SAFE_INTEGER);
    return {items,next,outbound,...(owner&&!before?{takeovers:await takeoverHistory(user.currentShop.id,channel,sender)}:{})};
  }
  return {items,next};
}

export async function commentThread(user,id,offset=0) {
  const plan=await requirePlanFeature(user.currentShop.id,'comments');
  const pageIds=await visiblePageIds(user,'chat:read');
  const selected=ensure(await get(`SELECT m.*,c.platform,c.meta_id,c.bot_mode,c.comment_policy,
    pr.status AS private_status,pr.started AS private_started,pr.error AS private_error,pr.automatic AS private_automatic
    FROM comments m JOIN channels c ON c.id=m.channel_id
    LEFT JOIN facebook_private_replies pr ON pr.channel_id=m.channel_id AND pr.comment_key=m.facebook_key
    WHERE m.id=$1 AND c.id=ANY($2::text[])`,id,pageIds),404,'Không tìm thấy bình luận trong kênh của bạn.');
  const ai=agentIncluded(plan);
  const override=ai?await postBot({id:selected.channel_id,platform:selected.platform,meta_id:selected.meta_id},
    selected.media_id,'',selected.post_id):null;
  const inherited=!override||override.bot_mode==='inherit';
  const policy=withoutFaqs(inherited?selected.comment_policy:override.comment_policy,plan);
  const mode=inherited?selected.bot_mode:override.bot_mode;
  const botRules=ai&&mode!=='off'&&policy?.version===2?policy.rules.filter((rule)=>rule.enabled!==false&&rule.action!=='ignore').map(({name,reply})=>({name,reply})):[];
  const root=selected.platform==='fb'&&await facebookCommentRoot(selected.channel_id,selected.media_id,selected.remote_id);
  const now=Date.now();
  if(!root){
    const original=viewActivity(selected,false,now,ai);
    return {botRules,items:[original],original};
  }
  const rows=await all(`WITH RECURSIVE thread(key) AS (
      SELECT $3::text
      UNION
      SELECT l.comment_key FROM thread t JOIN facebook_comment_links l ON l.channel_id=$1 AND l.media_key=$2 AND l.parent_key=t.key
    )
    SELECT m.*,l.parent_key,pr.status AS private_status,pr.started AS private_started,pr.error AS private_error,pr.automatic AS private_automatic FROM thread t JOIN comments m ON m.channel_id=$1 AND m.facebook_media_key=$2 AND m.facebook_key=t.key
    LEFT JOIN facebook_comment_links l ON l.channel_id=$1 AND l.media_key=$2 AND l.comment_key=m.facebook_key
    LEFT JOIN facebook_private_replies pr ON pr.channel_id=m.channel_id AND pr.comment_key=m.facebook_key
    ORDER BY (m.id=$4 OR m.facebook_key=$3) DESC,(m.status='review' AND m.handled_at IS NULL) DESC,m.created DESC,m.id DESC LIMIT ${pageSize+1} OFFSET $5`,
    selected.channel_id,selected.facebook_media_key,root.key,id,offset);
  const items=rows.slice(0,pageSize).sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id))
    .map((row)=>viewActivity(row,false,now,ai));
  const original=offset?await get("SELECT m.*,pr.status AS private_status,pr.started AS private_started,pr.error AS private_error,pr.automatic AS private_automatic FROM comments m LEFT JOIN facebook_private_replies pr ON pr.channel_id=m.channel_id AND pr.comment_key=m.facebook_key WHERE m.channel_id=$1 AND m.facebook_media_key=$2 AND m.facebook_key=$3 ORDER BY m.created,m.id LIMIT 1",selected.channel_id,selected.facebook_media_key,root.key):rows.find((row)=>row.facebook_key===root.key);
  return {items,botRules,original:original?viewActivity(original,false,now,ai):null,next:rows.length>pageSize?String(offset+pageSize):null};
}

export async function saveChannel(user,body) {
  const id=string(body.id,50);
  ensure(id,400,'Hãy kết nối tài khoản Facebook hoặc Instagram để tạo kênh.');
  await access(user,id);
  const purpose=body.purpose==null?null:choicesOf(body.purpose,['sales','news','entertainment']);
  await run(`UPDATE channels SET topic=$1,page_purpose=COALESCE($3,page_purpose),
    orders_enabled=CASE WHEN $3<>'sales' THEN FALSE ELSE orders_enabled END,
    catalog_mode=CASE WHEN $3<>'sales' THEN 'off' ELSE catalog_mode END WHERE id=$2`,string(body.topic,500),id,purpose);
}

export async function commentInbox(user,{channel,status,before}) {
  await requirePlanFeature(user.currentShop.id,'comments');
  const pageIds=await visiblePageIds(user,'chat:read');
  if(channel)ensure(pageIds.includes(channel),404,'Không tìm thấy Page được phân quyền.');
  const rows=await all(`WITH RECURSIVE scoped AS (
    SELECT m.*, c.platform,p.title AS post_title,COALESCE(p.alias_id,p.remote_id) AS post_remote_id
    FROM comments m JOIN channels c ON c.id=m.channel_id LEFT JOIN posts p ON p.id=m.post_id
    WHERE c.id=ANY($1::text[]) AND ($2='' OR c.id=$2)
  ), links AS (
    SELECT l.* FROM facebook_comment_links l JOIN channels c ON c.id=l.channel_id
    WHERE c.id=ANY($1::text[]) AND ($2='' OR c.id=$2)
  ), tree(channel_id,media_key,node,root) AS (
    SELECT DISTINCT l.channel_id,l.media_key,l.parent_key,l.parent_key FROM links l
    WHERE NOT EXISTS (SELECT 1 FROM links p WHERE p.channel_id=l.channel_id AND p.media_key=l.media_key AND p.comment_key=l.parent_key)
    UNION
    SELECT l.channel_id,l.media_key,l.comment_key,t.root FROM tree t JOIN links l
      ON l.channel_id=t.channel_id AND l.media_key=t.media_key AND l.parent_key=t.node
  ), grouped AS (
    SELECT m.*,COALESCE(t.root,m.facebook_key,m.id) AS root, l.parent_key,
      CASE WHEN m.handled_at IS NOT NULL OR m.status='replied' THEN 'handled' WHEN m.status IN ('queued','sending') THEN 'working' ELSE m.status END AS state
    FROM scoped m LEFT JOIN tree t ON m.platform='fb' AND t.channel_id=m.channel_id AND t.media_key=m.facebook_media_key AND t.node=m.facebook_key
    LEFT JOIN links l ON m.platform='fb' AND l.channel_id=m.channel_id AND l.media_key=m.facebook_media_key AND l.comment_key=m.facebook_key
  ), ranked AS (
    SELECT *,COUNT(*) FILTER(WHERE state='review') OVER w AS pending,
      COUNT(*) FILTER(WHERE state='review' AND parent_key IS NOT NULL) OVER w AS pending_children,
      COUNT(*) FILTER(WHERE $3='' OR state=CASE WHEN $3='replied' THEN 'handled' ELSE $3 END) OVER w AS matching,
      MAX(created) OVER w AS latest, MIN(created) FILTER(WHERE state='review') OVER w AS first_pending,
      ROW_NUMBER() OVER(PARTITION BY channel_id,facebook_media_key,root ORDER BY (facebook_key=root) DESC,created,id) AS position
    FROM grouped WINDOW w AS (PARTITION BY channel_id,facebook_media_key,root)
  )
  SELECT *, (pending>0)::int AS priority, COALESCE(-first_pending,latest) AS sort_time FROM ranked WHERE position=1 AND matching>0
    AND ((pending>0)::int,COALESCE(-first_pending,latest),id)<($4,$5,$6)
  ORDER BY priority DESC,sort_time DESC,id DESC LIMIT ${pageSize+1}`,
    pageIds,channel,status,before?.priority??2,before?.created??0,before?.id??'');
  const now=Date.now();
  const ai=agentIncluded(await shopFeatures(user.currentShop.id));
  const items=rows.slice(0,pageSize).map((row)=>({...viewActivity(row,false,now,ai),pending:row.pending,pendingChildren:row.pending_children,latest:row.latest}));
  const last=rows[pageSize-1];
  return {items,next:rows.length>pageSize?`${last.priority}:${last.sort_time}:${last.id}`:null};
}

async function notificationPages(user){
  const [pages,plan]=await Promise.all([visiblePageIds(user,'chat:read'),shopFeatures(user.currentShop.id)]);
  return [plan?.feature_flags.comments?pages:[],plan?.feature_flags.messages?pages:[]];
}

const notificationEvents=`
  SELECT 'comment' AS kind,m.id,m.channel_id,c.name AS page,m.author,m.text,m.created,
    COALESCE(m.media_id,p.alias_id,p.remote_id) AS media_id,p.title AS post_title
  FROM comments m JOIN channels c ON c.id=m.channel_id LEFT JOIN posts p ON p.id=m.post_id WHERE c.id=ANY($4::text[])
  UNION ALL
  SELECT 'message',m.id,m.channel_id,c.name,COALESCE(mc.display_name,'Khách Messenger'),
    COALESCE(NULLIF(m.text,''),m.attachments->0->>'name','Tệp đính kèm'),m.created,NULL,NULL
  FROM inbox_messages m JOIN channels c ON c.id=m.channel_id
  LEFT JOIN messenger_contacts mc ON mc.channel_id=m.channel_id AND mc.sender_id=m.sender_id WHERE c.id=ANY($5::text[])`;

export async function notifications(user,offset=0,unreadOnly=false,size=pageSize) {
  const rows=await all(`WITH events AS (${notificationEvents}), states AS (
    SELECT e.*,r.item_id IS NULL AS unread
    FROM events e LEFT JOIN notification_reads r ON r.user_id=$1 AND r.kind=e.kind AND r.item_id=e.id
  ), page AS (
    SELECT * FROM states WHERE NOT $3::boolean OR unread
    ORDER BY created DESC,id DESC,kind DESC LIMIT $6 OFFSET $2
  )
  SELECT page.*,counts.unread_count,counts.total FROM (
    SELECT count(*) FILTER(WHERE unread) AS unread_count,count(*) FILTER(WHERE NOT $3::boolean OR unread) AS total FROM states
  ) counts LEFT JOIN page ON TRUE ORDER BY page.created DESC,page.id DESC,page.kind DESC`,
    user.id,offset,unreadOnly,...await notificationPages(user),size);
  const items=rows[0]?.id?rows.map(({unread_count,total,...item})=>item):[];
  const total=rows[0]?.total??0;
  return {items,total,unread:rows[0]?.unread_count??0,next:size>0&&offset+size<total?String(offset+size):null};
}

export async function readAllNotifications(user) {
  const result=await run(`INSERT INTO notification_reads(user_id,kind,item_id)
    SELECT $1,e.kind,e.id FROM (${notificationEvents.replace('$4','$2').replace('$5','$3')}) e
    WHERE NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.user_id=$1 AND r.kind=e.kind AND r.item_id=e.id)
    ON CONFLICT DO NOTHING`,user.id,...await notificationPages(user));
  return {marked:result.changes};
}

export async function openNotification(user,kind,id) {
  await requirePlanFeature(user.currentShop.id,kind==='comment'?'comments':'messages');
  const pageIds=await visiblePageIds(user,'chat:read');
  const table=kind==='comment'?'comments':'inbox_messages';
  const selected=ensure(await get(`SELECT m.* FROM ${table} m JOIN channels c ON c.id=m.channel_id
    WHERE m.id=$1 AND c.id=ANY($2::text[])`,id,pageIds),404,'Không tìm thấy tương tác.');
  const now=Date.now();
  const ai=agentIncluded(await shopFeatures(user.currentShop.id));
  const item=kind==='comment'?viewActivity(selected,false,now,ai):
    (await activity(user,{kind,channel:selected.channel_id,sender:selected.sender_id,status:'',threads:true})).items[0];
  await run('INSERT INTO notification_reads(user_id,kind,item_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',user.id,kind,id);
  return {item,focus:kind==='message'?viewActivity(selected,true,now,ai):null};
}
