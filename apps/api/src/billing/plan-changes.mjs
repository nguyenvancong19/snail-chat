import { checkVersion } from '../http/versions.mjs';
import { all, get, run, transaction } from '../db/store.mjs';
import { ensure } from '../http/validation.mjs';
import { lockBillingShop } from './limits.mjs';

export const day=86_400_000;

export async function hasPurchasedPlan(shopId) {
  const result=await get(`SELECT EXISTS (
    SELECT 1 FROM subscription_orders WHERE shop_id=$1 AND plan_code<>'FREE'
      AND paid_at IS NOT NULL AND status IN ('PAID','SCHEDULED')
  ) AS purchased`,shopId);
  return result.purchased;
}

export async function planTier(code) {
  return (await get('SELECT tier FROM subscription_plans WHERE code=$1',code))?.tier??0;
}

export function billingPolicy() {
  return get('SELECT upgrade_fee_bps,version FROM subscription_policy WHERE id=1');
}

export async function updateBillingPolicy(body,expected) {
  const fee=body.upgrade_fee_bps;
  ensure(Number.isInteger(fee)&&fee>=0&&fee<=10000,400,'Nhập phí nâng gói từ 0 đến 100%.');
  const saved=await run('UPDATE subscription_policy SET upgrade_fee_bps=$1 WHERE id=1 AND ($2::integer IS NULL OR version=$2)',fee,expected??null);
  checkVersion(saved.changes?expected:null,expected);
}

export async function remainingValue(shop,now) {
  if(shop.expired_at<=now)return 0;
  let value=shop.subscription_value_vnd, since=shop.subscription_value_since;
  if(value==null){
    const last=await get(`SELECT price_vnd,subscription_until,duration_days,paid_at FROM subscription_orders
      WHERE shop_id=$1 AND plan_code=$2 AND status='PAID' AND subscription_until=$3 ORDER BY paid_at DESC LIMIT 1`,
      shop.id,shop.subscription_plan,shop.expired_at);
    if(!last)return 0;
    value=last.price_vnd;
    since=Math.max(last.paid_at,last.subscription_until-last.duration_days*day);
  }
  const time=Math.max(since,now);
  const duration=shop.expired_at-since;
  return duration>0?Math.floor(value*(shop.expired_at-time)/duration):0;
}

export async function currentPlanTerms(shop,now) {
  const current=await get('SELECT * FROM subscription_plans WHERE code=$1',shop.subscription_plan);
  const active=shop.subscription_plan!=='FREE'&&shop.expired_at>now;
  if(!active)return {current,active};
  const order=await get(`SELECT list_price_vnd,price_vnd,duration_days FROM subscription_orders
    WHERE shop_id=$1 AND plan_code=$2 AND status='PAID' AND subscription_until=$3
    ORDER BY paid_at DESC,id DESC LIMIT 1`,shop.id,shop.subscription_plan,shop.expired_at);
  const days=order?.duration_days??current?.duration_days??30;
  const price=order?.list_price_vnd??order?.price_vnd??current?.price_vnd??0;
  return {current,active,days,price};
}

export function quotePlan(shop,plan,policy,terms,limits,now) {
  const lowerTier=plan.tier<(terms.current?.tier??0);
  const samePlan=plan.code===shop.subscription_plan;
  const reducesLimits=terms.active&&(plan.page_limit<limits.pages||plan.staff_limit<limits.staff);
  if(lowerTier||reducesLimits)return {kind:'BLOCKED',reason:lowerTier?
    'Shop chỉ có thể gia hạn gói đang dùng hoặc chuyển lên gói cao hơn.':
    'Gói này có hạn mức thấp hơn hạn mức hiện tại của Shop.'};
  const kind=!terms.active?'NEW':samePlan&&plan.page_limit===limits.pages&&plan.staff_limit===limits.staff?'RENEW':'UPGRADE';
  if(kind!=='UPGRADE')return {kind,amount:plan.price_vnd,listPrice:plan.price_vnd};
  // Quote in whole remaining days so the amount is stable throughout each day of the term.
  const remainingDays=Math.ceil((shop.expired_at-now)/day);
  const differencePerDay=plan.price_vnd/plan.duration_days-terms.price/terms.days;
  const differenceVnd=Math.max(0,Math.round(differencePerDay*remainingDays));
  const feeVnd=Math.round(differenceVnd*policy.upgrade_fee_bps/10000);
  const upgrade={remainingDays,differenceVnd,feeVnd,feeBps:policy.upgrade_fee_bps,endsAt:shop.expired_at};
  return {kind,amount:differenceVnd+feeVnd,listPrice:plan.price_vnd,upgrade};
}

export async function applyOrderPlan(shop,order,now) {
  const samePlan=shop.subscription_plan===order.plan_code;
  const extend=order.change_kind==='RENEW'||(!order.change_kind&&(samePlan||shop.expired_at>now));
  const until=order.upgrade_quote?.endsAt??(Math.max(now,extend?(shop.expired_at??0):0)+order.duration_days*day);
  const carry=extend&&samePlan?await remainingValue(shop,now):0;
  await run(`UPDATE shops SET subscription_plan=$2,expired_at=$3,subscription_page_limit=$4,subscription_staff_limit=$5,
    subscription_value_vnd=$6,subscription_value_since=$7,subscription_revision=subscription_revision+1 WHERE id=$1`,
    shop.id,order.plan_code,until,order.page_limit,order.staff_limit,
    carry+(order.list_price_vnd??order.price_vnd),now);
  await run("UPDATE subscription_orders SET status='PAID',paid_at=COALESCE(paid_at,$2),subscription_until=$3,review_reason=NULL WHERE id=$1",
    order.id,now,until);
}

export async function activateScheduledPlans() {
  const due=await all("SELECT shop_id FROM subscription_orders WHERE status='SCHEDULED' AND starts_at<=$1 ORDER BY starts_at LIMIT 100",Date.now());
  for(const {shop_id} of due)await transaction(async()=>{
    const shop=await lockBillingShop(shop_id);
    const now=Date.now();
    const order=await get("SELECT * FROM subscription_orders WHERE shop_id=$1 AND status='SCHEDULED' AND starts_at<=$2 FOR UPDATE",shop_id,now);
    if(order)await applyOrderPlan(shop,order,now);
  });
}
