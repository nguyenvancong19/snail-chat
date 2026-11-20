import { all, run, transaction } from '../db/store.mjs';
import { ensure, string } from '../http/validation.mjs';
import { shopLimits } from './limits.mjs';

import { ownedShop } from './subscriptions.mjs';

export async function billingResources(actor,shopId) {
  const shop=await ownedShop(actor,shopId);
  const now=Date.now();
  const [limits,pages,staff,invitations]=await Promise.all([
    shopLimits(shop),
    all(`SELECT id,name,platform,quota_paused AS paused,
      (token IS NOT NULL AND meta_id IS NOT NULL AND (expires IS NULL OR expires>$2)) AS connected
      FROM channels WHERE shop_id=$1 ORDER BY name,id`,shop.id,now),
    all(`SELECT m.id,u.name,u.email FROM shop_members m JOIN users u ON u.id=m.user_id
      WHERE m.shop_id=$1 AND m.role='STAFF' AND m.status='ACTIVE' ORDER BY u.name,m.id`,shop.id),
    all(`SELECT id,email FROM shop_invitations WHERE shop_id=$1 AND expires_at>$2 ORDER BY email,id`,shop.id,now),
  ]);
  return {limits,pages,staff,invitations};
}

function selectedIds(value,available) {
  ensure(Array.isArray(value)&&value.length<=available.length,400,'Danh sách lựa chọn không hợp lệ.');
  const ids=value.map((id)=>string(id,100,{required:true}));
  const allowed=new Set(available.map(({id})=>id));
  ensure(new Set(ids).size===ids.length&&ids.every((id)=>allowed.has(id)),409,
    'Danh sách đã thay đổi. Vui lòng tải lại và chọn lại.');
  return ids;
}

export async function setBillingResources(actor,shopId,body) {
  return transaction(async()=>{
    const shop=await ownedShop(actor,shopId,{lock:true});
    const items=await billingResources(actor,shopId);
    const snapshot=[items.pages.map(({id})=>id),items.staff.map(({id})=>id),items.invitations.map(({id})=>id)];
    ensure(body.snapshot===JSON.stringify(snapshot),409,'Danh sách đã thay đổi. Vui lòng tải lại và chọn lại.');
    const pages=selectedIds(body.pages,items.pages);
    const staff=selectedIds(body.staff,items.staff);
    const invites=selectedIds(body.invitations,items.invitations);
    ensure(pages.length<=items.limits.pages&&staff.length+invites.length<=items.limits.staff,409,
      'Số Page hoặc chỗ nhân viên được chọn vượt hạn mức gói.');
    await run('UPDATE channels SET quota_paused=NOT(id=ANY($2::text[])) WHERE shop_id=$1',shop.id,pages);
    await run(`UPDATE shop_members SET status='SUSPENDED' WHERE shop_id=$1 AND role='STAFF'
      AND status='ACTIVE' AND NOT(id=ANY($2::text[]))`,shop.id,staff);
    const revoke=items.invitations.filter(({id})=>!invites.includes(id)).map(({id})=>id);
    await run(`WITH revoked AS (DELETE FROM shop_invitations WHERE shop_id=$1 AND id=ANY($2::text[]) RETURNING email)
      DELETE FROM shop_members m USING users u,revoked r WHERE m.shop_id=$1 AND m.status='INVITED'
        AND m.role='STAFF' AND m.user_id=u.id AND u.email=r.email`,shop.id,revoke);
    return {ok:true};
  });
}
