import { all, get, run, transaction } from '../db/store.mjs';
import { ensure } from '../http/validation.mjs';

export async function userShops(userId) {
  return all(`SELECT s.id,s.name,s.subscription_plan AS "subscriptionPlan",s.expired_at AS "expiredAt",
    s.status,m.role,p.name AS "planName" FROM shop_members m JOIN shops s ON s.id=m.shop_id
    LEFT JOIN subscription_plans p ON p.code=s.subscription_plan
    WHERE m.user_id=$1 AND m.status='ACTIVE' ORDER BY s.created_at,s.id`,userId);
}

export async function ensureDefaultShop(user) {
  if(user.is_super_admin||await get("SELECT 1 FROM shop_members WHERE user_id=$1 AND status<>'INVITED'",user.id))return;
  await transaction(async()=>{
    await get('SELECT id FROM users WHERE id=$1 FOR UPDATE',user.id);
    if(await get("SELECT 1 FROM shop_members WHERE user_id=$1 AND status<>'INVITED'",user.id))return;
    if(await get('SELECT 1 FROM shop_invitations WHERE email=$1 AND expires_at>$2',user.email,Date.now()))return;
    await insertPersonalShop(user,user.name+' · Shop');
  });
}

async function insertPersonalShop(user,name) {
  const shopId='default:'+user.id;
  await run('INSERT INTO shops(id,name,owner_id) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',shopId,name,user.id);
  await run(`INSERT INTO shop_members(id,shop_id,user_id,role,status,joined_at)
    VALUES($1,$2,$3,'OWNER','ACTIVE',$4) ON CONFLICT(shop_id,user_id) DO NOTHING`,
    'owner:'+user.id,shopId,user.id,Date.now());
  return shopId;
}

export async function createPersonalShop(user,name) {
  ensure(!user.is_super_admin,403,'Khu vực quản trị hệ thống không tạo Shop cá nhân.');
  return transaction(async()=>{
    await get('SELECT id FROM users WHERE id=$1 FOR UPDATE',user.id);
    ensure(!await get('SELECT id FROM shops WHERE owner_id=$1',user.id),409,'Tài khoản đã có Shop riêng.');
    const shopId=await insertPersonalShop(user,name);
    await run('UPDATE users SET preferred_shop_id=$2 WHERE id=$1',user.id,shopId);
    return {shopId};
  });
}

export async function rememberShop(user,shopId) {
  const currentShop=ensure(workspaceShop(await userShops(user.id),user.preferred_shop_id,shopId),403,'Shop không khả dụng hoặc bạn không còn quyền truy cập.');
  await run('UPDATE users SET preferred_shop_id=$2 WHERE id=$1',user.id,currentShop.id);
  return {ok:true};
}

export const usableShop = (shop,now=Date.now()) =>
  shop?.status==='ACTIVE' && (shop.expiredAt===null||shop.expiredAt>now);

export function workspaceShop(shops, preferred, requested, now=Date.now()) {
  const selectable=shops.filter((shop)=>shop.role==='OWNER'||usableShop(shop,now));
  if(requested!==undefined)return selectable.find((shop)=>shop.id===requested);
  const active=selectable.filter((shop)=>usableShop(shop,now));
  return selectable.find((shop)=>shop.id===preferred)
    ?? active.find((shop)=>shop.role==='OWNER')
    ?? (active.length===1?active[0]:undefined)
    ?? (active.length===0?selectable.find((shop)=>shop.role==='OWNER'):undefined);
}

export async function requireShop(user,shopId) {
  ensure(typeof shopId==='string'&&shopId.length>0&&shopId.length<=100,403,'Hãy chọn một Shop.');
  const currentShop=(await userShops(user.id)).find((shop)=>shop.id===shopId);
  ensure(currentShop,403,'Bạn không phải thành viên đang hoạt động của Shop.');
  ensure(usableShop(currentShop),403,'Shop đang bị khóa hoặc đã hết hạn.');
  return {...user,currentShop,memberRole:currentShop.role};
}

export function ownerOnly(user) {
  ensure(user?.memberRole==='OWNER',403,'Chỉ chủ Shop có quyền thực hiện thao tác này.');
}

export async function pageGrants(user) {
  if(!user?.currentShop)return [];
  return all(`SELECT c.id, CASE WHEN m.role='OWNER'
    THEN ARRAY['chat:read','chat:reply','order:manage']::text[] ELSE a.permissions END AS permissions
    FROM channels c JOIN entitled_shop_channels entitlement ON entitlement.id=c.id JOIN shops s ON s.id=c.shop_id
    JOIN shop_members m ON m.shop_id=s.id AND m.user_id=$2 AND m.status='ACTIVE'
    LEFT JOIN page_assignments a ON a.shop_member_id=m.id AND a.page_id=c.id
    WHERE s.id=$1 AND s.status='ACTIVE' AND (s.expired_at IS NULL OR s.expired_at>$3)
      AND (m.role='OWNER' OR a.id IS NOT NULL)`,user.currentShop.id,user.id,Date.now());
}

export async function visiblePageIds(user,permission) {
  return (await pageGrants(user)).filter((page)=>!permission||page.permissions.includes(permission)).map(({id})=>id);
}

export async function activePage(channelId) {
  return get(`SELECT c.id FROM channels c JOIN entitled_shop_channels entitlement ON entitlement.id=c.id JOIN shops s ON s.id=c.shop_id
    WHERE c.id=$1 AND s.status='ACTIVE' AND (s.expired_at IS NULL OR s.expired_at>$2)`,channelId,Date.now());
}

export async function canSendQueuedReply(channelId,userId) {
  return get(`SELECT c.id FROM channels c JOIN entitled_shop_channels entitlement ON entitlement.id=c.id JOIN shops s ON s.id=c.shop_id
    JOIN shop_members m ON m.shop_id=s.id AND m.user_id=$2 AND m.status='ACTIVE'
    JOIN users u ON u.id=m.user_id AND u.active=1 AND u.email_verified_at IS NOT NULL
    WHERE c.id=$1 AND s.status='ACTIVE' AND (s.expired_at IS NULL OR s.expired_at>$3)
      AND (m.role='OWNER' OR EXISTS(SELECT 1 FROM page_assignments a
        WHERE a.shop_member_id=m.id AND a.page_id=c.id AND 'chat:reply'=ANY(a.permissions)))`,
    channelId,userId,Date.now());
}
