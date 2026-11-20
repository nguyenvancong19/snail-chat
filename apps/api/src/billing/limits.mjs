import { get } from '../db/store.mjs';
import { ensure } from '../http/validation.mjs';

export async function lockBillingShop(shopId) {
  return ensure(await get('SELECT * FROM shops WHERE id=$1 FOR NO KEY UPDATE',shopId),404,'Không tìm thấy Shop.');
}

export async function shopUsage(shopId) {
  return get(`SELECT
    (SELECT COUNT(*) FROM channels WHERE shop_id=$1 AND NOT quota_paused) AS pages,
    (SELECT COUNT(*) FROM channels WHERE shop_id=$1 AND NOT quota_paused AND meta_id IS NOT NULL
      AND token IS NOT NULL) AS "linkedPages",
    (SELECT COUNT(*) FROM shop_members WHERE shop_id=$1 AND role='STAFF' AND status='ACTIVE') AS staff,
    (SELECT COUNT(*) FROM shop_invitations WHERE shop_id=$1 AND expires_at>$2) AS invitations`,shopId,Date.now());
}

export async function shopLimits(shop) {
  return get(`SELECT COALESCE($2::int, p.page_limit, f.page_limit) AS pages,
    COALESCE($3::int, p.staff_limit, f.staff_limit) AS staff
    FROM subscription_plans f LEFT JOIN subscription_plans p ON p.code=$1 WHERE f.code='FREE'`,
    shop.subscription_plan,shop.subscription_page_limit,shop.subscription_staff_limit);
}

export async function requirePageSlot(shop) {
  const limits=await shopLimits(shop);
  const usage=await shopUsage(shop.id);
  ensure(usage.pages<limits.pages,409,'Shop đã dùng hết '+limits.pages+' chỗ cho Page/kênh. Nâng cấp trong Gói dịch vụ.');
}

export async function requireStaffSlot(shop,{reserved=false}={}) {
  const limits=await shopLimits(shop);
  const usage=await shopUsage(shop.id);
  const occupied=reserved?usage.staff:usage.staff+usage.invitations;
  ensure(occupied<limits.staff,409,'Shop đã dùng hết '+limits.staff+' chỗ cho nhân viên. Nâng cấp trong Gói dịch vụ.');
}
