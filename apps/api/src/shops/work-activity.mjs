import { all, get, run, transaction } from '../db/store.mjs';
import { readPage } from '../db/pagination.mjs';
import { ensure } from '../http/validation.mjs';
import { ownerOnly } from './tenant.mjs';

export async function assignStaffCode(shopId,userId) {
  return transaction(async()=>{
    const existing=await get('SELECT number FROM shop_staff_codes WHERE shop_id=$1 AND user_id=$2',shopId,userId);
    if(existing)return existing.number;
    await run('SELECT pg_advisory_xact_lock(hashtextextended($1,521021))',shopId);
    await run(`INSERT INTO shop_staff_codes(shop_id,user_id,number)
      SELECT $1,$2,COALESCE(MAX(number),0)+1 FROM shop_staff_codes WHERE shop_id=$1
      ON CONFLICT(shop_id,user_id) DO NOTHING`,shopId,userId);
    return (await get('SELECT number FROM shop_staff_codes WHERE shop_id=$1 AND user_id=$2',shopId,userId)).number;
  });
}

export const staffCode=number=>number==null?null:'NV-'+String(number).padStart(3,'0');

export async function workActor(shopId,userId) {
  if(!userId)return null;
  const member=ensure(await get(`SELECT m.role,u.name FROM shop_members m JOIN users u ON u.id=m.user_id
    WHERE m.shop_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND u.active=1`,shopId,userId),
    403,'Bạn không còn quyền thao tác trong Shop.');
  const code=member.role==='STAFF'?staffCode(await assignStaffCode(shopId,userId)):null;
  return {id:userId,role:member.role,name:member.name,code};
}

// Internal account IDs are only used for matching actors and aggregating events.
export function displayWorkActor(actor) {
  return actor?{role:actor.role,name:actor.name,code:actor.code}:null;
}

export async function recordWorkEvent(channel,{id,kind,subject,at,actor}) {
  if(!actor)return;
  await run(`INSERT INTO shop_work_events(id,shop_id,channel_id,channel_name,kind,subject,at,actor)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,
    id,channel.shop_id,channel.id,channel.name,kind,subject,at,JSON.stringify(actor));
}

export async function takeoverHistory(shopId,channelId,sender) {
  const rows=await all(`SELECT kind,at,actor FROM shop_work_events WHERE shop_id=$1 AND channel_id=$2 AND subject=$3
    AND kind IN ('takeover','extend','release') ORDER BY at DESC,id DESC LIMIT 30`,shopId,channelId,sender);
  return rows.map(({kind,at,actor})=>({kind,at,actor:displayWorkActor(actor)}));
}

const vietnamOffset=7*3_600_000;
const dayMs=86_400_000;
function workRange(days,now=Date.now()) {
  const today=Math.floor((now+vietnamOffset)/dayMs)*dayMs-vietnamOffset;
  return {from:today-(days-1)*dayMs,to:today+dayMs};
}

export async function workOverview(user,{channel,days}) {
  ownerOnly(user);
  const shopId=user.currentShop.id;
  const {from,to}=workRange(days);
  const [channels,rows,totals]=await Promise.all([
    all('SELECT id,name FROM channels WHERE shop_id=$1 ORDER BY name,id',shopId),
    all(`WITH scoped AS (
      SELECT * FROM shop_work_events WHERE shop_id=$1 AND at>=$2 AND at<$3 AND ($4='' OR channel_id=$4)
    ), metrics AS (
      SELECT actor->>'id' AS actor_id,actor->>'role' AS actor_role,COUNT(*) FILTER(WHERE kind='takeover') AS takeovers,
        COUNT(DISTINCT (channel_id,subject)) FILTER(WHERE kind='reply') AS conversations,
        COUNT(*) FILTER(WHERE kind='reply') AS messages,COUNT(*) FILTER(WHERE kind='order') AS orders
      FROM scoped GROUP BY actor_id,actor_role
    ), latest AS (
      SELECT DISTINCT ON (actor->>'id',actor->>'role') actor->>'id' AS actor_id,actor
      FROM scoped ORDER BY actor->>'id',actor->>'role',at DESC,id DESC
    ), people AS (
      SELECT m.user_id AS actor_id,jsonb_build_object('role',m.role,'name',u.name,
        'code',CASE WHEN n.number IS NOT NULL THEN 'NV-'||lpad(n.number::text,GREATEST(3,length(n.number::text)),'0') END) AS actor
      FROM shop_members m JOIN users u ON u.id=m.user_id
      LEFT JOIN shop_staff_codes n ON n.shop_id=m.shop_id AND n.user_id=m.user_id
      WHERE m.shop_id=$1 AND m.status<>'INVITED'
      UNION ALL SELECT actor_id,actor FROM latest l
        WHERE NOT EXISTS(SELECT 1 FROM shop_members m WHERE m.shop_id=$1 AND m.user_id=l.actor_id AND m.role=l.actor->>'role' AND m.status<>'INVITED')
    )
    SELECT p.actor_id AS id,p.actor,COALESCE(m.takeovers,0) AS takeovers,COALESCE(m.conversations,0) AS conversations,
      COALESCE(m.messages,0) AS messages,COALESCE(m.orders,0) AS orders
    FROM people p LEFT JOIN metrics m ON m.actor_id=p.actor_id AND m.actor_role=p.actor->>'role' ORDER BY p.actor->>'name',p.actor_id`,shopId,from,to,channel),
    get(`SELECT COUNT(*) FILTER(WHERE kind='takeover') AS takeovers,
      COUNT(DISTINCT (channel_id,subject)) FILTER(WHERE kind='reply') AS conversations,
      COUNT(*) FILTER(WHERE kind='order') AS orders
      FROM shop_work_events WHERE shop_id=$1 AND at>=$2 AND at<$3 AND actor->>'role'='STAFF'
      AND ($4='' OR channel_id=$4)`,shopId,from,to,channel),
  ]);
  if(channel)ensure(channels.some(item=>item.id===channel),404,'Không tìm thấy Page.');
  const people=rows.map(row=>({...row,actor:displayWorkActor(row.actor)}));
  return {channels,staff:people.filter(row=>row.actor.role==='STAFF'),owners:people.filter(row=>row.actor.role==='OWNER'),totals};
}

export async function workDetails(user,{channel,days,person,role,page}) {
  ownerOnly(user);
  const shop=user.currentShop.id;
  const {from,to}=workRange(days);
  if(channel)ensure(await get('SELECT 1 FROM channels WHERE id=$1 AND shop_id=$2',channel,shop),404,'Không tìm thấy Page.');
  const result=await readPage(`SELECT e.id,e.channel_id AS "channelId",COALESCE(c.name,e.channel_name) AS "channelName",
    e.kind,e.subject,e.at,e.actor,
    CASE WHEN e.kind='order' THEN o.customer ELSE mc.display_name END AS customer,
    o.archived_at IS NOT NULL AS archived,
    CASE WHEN e.kind='order' THEN o.code IS NOT NULL ELSE mc.sender_id IS NOT NULL END AS "targetExists"
    FROM shop_work_events e
    LEFT JOIN channels c ON c.id=e.channel_id AND c.shop_id=e.shop_id
    LEFT JOIN messenger_contacts mc ON mc.channel_id=c.id AND e.kind<>'order' AND mc.sender_id=e.subject
    LEFT JOIN shop_orders o ON o.channel_id=c.id AND e.kind='order' AND o.code=e.subject
    WHERE e.shop_id=$1 AND e.at>=$2 AND e.at<$3 AND ($4='' OR e.channel_id=$4) AND e.actor->>'id'=$5 AND e.actor->>'role'=$6`,
    'at DESC,id DESC',[shop,from,to,channel,person,role],page);
  return {...result,items:result.items.map(item=>({...item,actor:displayWorkActor(item.actor)}))};
}
