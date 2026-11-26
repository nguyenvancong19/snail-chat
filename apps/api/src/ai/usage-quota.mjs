import { all, get, run, transaction, uid } from '../db/store.mjs';
import { AppError, ensure } from '../http/validation.mjs';
import { dayBucket, dayLength } from './provider-usage.mjs';
import { agentIncluded } from '../billing/plan-features.mjs';
import { effectiveFlags } from '../billing/plan-options.mjs';

const windows=[['5h',5*3_600_000,'ai_5h_tokens'],['week',7*86_400_000,'ai_week_tokens']];

function periods(shop,now){
  return windows.map(([kind,duration,field])=>{
    const starts=shop.ai_cycle_anchor+Math.max(0,Math.floor((now-shop.ai_cycle_anchor)/duration))*duration;
    return {kind,starts,resetAt:starts+duration,limit:shop[field]};
  });
}

const planQuery=`SELECT s.ai_cycle_anchor,s.status,s.expired_at,s.ai_wallet_tokens,s.ai_wallet_reserved,
  p.ai_5h_tokens,p.ai_week_tokens,p.ai_reset_limit,p.agent_mode,p.feature_flags
  FROM shops s JOIN subscription_plans p ON p.code=s.subscription_plan WHERE s.id=$1`;

function active(shop,now){
  return shop?.status==='ACTIVE'&&(shop.expired_at===null||shop.expired_at>now);
}

async function usageWindows(shopId,shop,now){
  const current=periods(shop,now);
  const tallies=await all(`SELECT kind,tokens,reserved,blocked_need FROM ai_token_windows WHERE shop_id=$1 AND
    ((kind='5h' AND starts_at=$2) OR (kind='week' AND starts_at=$3))`,shopId,...current.map(p=>p.starts));
  const used=await get('SELECT used FROM ai_reset_periods WHERE shop_id=$1 AND starts_at=$2',shopId,current[1].starts);
  return {
    current:current.map(period=>({...period,...tallies.find(item=>item.kind===period.kind)})),
    resetsLeft:Math.max(0,shop.ai_reset_limit-(used?.used??0)),
  };
}

function exhaustedWindow(period){
  const spent=period.tokens??0;
  return spent>=period.limit||(spent>0&&(period.blocked_need??0)>period.limit-spent);
}

export async function publicUsage(shopId,now=Date.now()){
  const shop=await get(planQuery,shopId);
  if(!shop)return null;
  const available=active(shop,now)&&shop.ai_5h_tokens>0;
  const walletTokens=shop.ai_wallet_tokens;
  if(!available)return {available:false,windows:[],walletTokens,limitDepleted:false,canReset:false,canTopup:false};
  const {current,resetsLeft}=await usageWindows(shopId,shop,now);
  const exhausted=current.some(exhaustedWindow);
  const limitDepleted=current.some(period=>(period.tokens??0)>=period.limit);
  const agent=agentIncluded(shop)&&effectiveFlags(shop).agent;
  return {available:true,walletTokens,resetsLeft,resetLimit:shop.ai_reset_limit,resetsAt:current[1].resetAt,
    blocked:exhausted,limitDepleted,canReset:exhausted&&resetsLeft>0,canTopup:agent&&limitDepleted&&resetsLeft===0,
    windows:current.map(({kind,resetAt,limit,tokens=0})=>({
      kind,resetAt,percentUsed:tokens>=limit?100:Math.min(99,Math.round(100*tokens/limit)),
    }))};
}

export async function dailyPlanUsage(shopId,now=Date.now()){
  const last=dayBucket(now);
  const first=last-6;
  const totals=await all(`SELECT day_bucket,plan_tokens FROM ai_shop_daily_usage
    WHERE shop_id=$1 AND day_bucket BETWEEN $2 AND $3`,shopId,first,last);
  const usage=new Map(totals.map(({day_bucket,plan_tokens})=>[day_bucket,plan_tokens]));
  return Array.from({length:7},(_,index)=>{
    const day=first+index;
    return {date:new Date(day*dayLength).toISOString().slice(0,10),planTokens:usage.get(day)??0};
  });
}

export async function resetAllowance(shopId){
  return transaction(async()=>{
    const shop=await get(planQuery+' FOR NO KEY UPDATE OF s FOR SHARE OF p',shopId);
    const now=Date.now();
    ensure(active(shop,now)&&shop.ai_5h_tokens>0,403,'Shop hiện chưa có hạn mức AI.');
    await settleExpired(shopId,now);
    const {current,resetsLeft}=await usageWindows(shopId,shop,now);
    const exhausted=current.filter(exhaustedWindow);
    ensure(exhausted.length&&resetsLeft>0,409,'Shop chưa hết hạn mức hoặc đã hết lượt đặt lại tuần này.');
    ensure(exhausted.every(p=>!p.reserved),409,'AI đang xử lý. Hãy thử đặt lại sau khi lượt gọi hoàn tất.');
    for(const {kind,starts} of exhausted){
      // A reset grants a fresh window even if the previous provider response exceeded the estimate.
      await run('UPDATE ai_token_windows SET tokens=0,blocked_need=0 WHERE shop_id=$1 AND kind=$2 AND starts_at=$3',
        shopId,kind,starts);
    }
    await run(`INSERT INTO ai_reset_periods(shop_id,starts_at,used) VALUES($1,$2,1)
      ON CONFLICT(shop_id,starts_at) DO UPDATE SET used=ai_reset_periods.used+1`,shopId,current[1].starts);
    return publicUsage(shopId,now);
  });
}

export function tokenAllowance(body,previous){
  const five=body.ai_5h_tokens??previous?.ai_5h_tokens??100000;
  const week=body.ai_week_tokens??previous?.ai_week_tokens??500000;
  ensure(Number.isSafeInteger(five)&&Number.isSafeInteger(week)&&five>=0&&week>=five&&week<=1_000_000_000&&
    (five===0)===(week===0),400,'Nhập hai hạn mức hợp lệ. Hạn mức tuần phải ít nhất bằng hạn mức 5 giờ. Nhập cả hai bằng 0 để tắt.');
  const resets=body.ai_reset_limit??previous?.ai_reset_limit??0;
  ensure(Number.isInteger(resets)&&resets>=0&&resets<=100,400,'Chọn số lượt đặt lại từ 0 đến 100 mỗi tuần.');
  return [five,week,resets];
}

async function applyReservation(record,actual,now){
  const {shop_id,five_start,week_start,included,wallet}=record;
  const walletUsed=Math.min(wallet,Math.max(0,actual-included));
  const planUsed=actual-walletUsed;
  await run(`UPDATE ai_token_windows SET tokens=tokens+$4,reserved=reserved-$5 WHERE shop_id=$1 AND
    ((kind='5h' AND starts_at=$2) OR (kind='week' AND starts_at=$3))`,shop_id,five_start,week_start,planUsed,included);
  // Both quota windows receive the charge, but the daily history counts it once.
  if(planUsed)await run(`INSERT INTO ai_shop_daily_usage(shop_id,day_bucket,plan_tokens)
    VALUES($1,$2,$3) ON CONFLICT(shop_id,day_bucket) DO UPDATE
    SET plan_tokens=ai_shop_daily_usage.plan_tokens+excluded.plan_tokens`,shop_id,dayBucket(now),planUsed);
  if(wallet)await run(`UPDATE shops SET ai_wallet_tokens=ai_wallet_tokens-$2,ai_wallet_reserved=ai_wallet_reserved-$3
    WHERE id=$1`,shop_id,walletUsed,wallet);
}

async function settleExpired(shopId,now){
  const expired=await all('DELETE FROM ai_token_reservations WHERE shop_id=$1 AND expires<=$2 RETURNING *',shopId,now);
  for(const record of expired)await applyReservation(record,record.included+record.wallet,now);
  return expired.some(record=>record.wallet);
}

export async function reserveTokens(shopId,amount){
  return transaction(async()=>{
    const shop=await get(planQuery+' FOR NO KEY UPDATE OF s FOR SHARE OF p',shopId);
    const now=Date.now();
    ensure(active(shop,now),403,'Shop chưa hoạt động hoặc đã hết hạn.');
    ensure(shop.ai_5h_tokens>0,403,'Gói hiện tại chưa có hạn mức AI.');
    const recovered=await settleExpired(shopId,now);
    const {current,resetsLeft}=await usageWindows(shopId,shop,now);
    const included=Math.max(0,Math.min(amount,...current.map(p=>p.limit-(p.tokens??0)-(p.reserved??0))));
    const settledRoom=Math.max(0,Math.min(amount,...current.map(p=>p.limit-(p.tokens??0))));
    if(included<settledRoom&&included<amount&&resetsLeft===0){
      const error=new AppError(429,'AI đang xử lý các lượt khác. Hãy thử lại khi lượt gọi hoàn tất.');
      error.retryAfter=2;
      return {error};
    }
    const wallet=amount-included;
    const funds=recovered?await get('SELECT ai_wallet_tokens,ai_wallet_reserved FROM shops WHERE id=$1',shopId):shop;
    if(wallet>0&&(resetsLeft>0||wallet>funds.ai_wallet_tokens-funds.ai_wallet_reserved)){
      if(amount<=shop.ai_5h_tokens){
        for(const period of current.filter(p=>p.tokens>0&&p.tokens+amount>p.limit)){
          await run('UPDATE ai_token_windows SET blocked_need=GREATEST(blocked_need,$4) WHERE shop_id=$1 AND kind=$2 AND starts_at=$3',
            shopId,period.kind,period.starts,amount);
        }
      }
      const error=new AppError(429,amount>shop.ai_5h_tokens&&resetsLeft>0
        ?'Yêu cầu AI lớn hơn hạn mức của một khung 5 giờ. Hãy rút ngắn nội dung hoặc giảm ngữ cảnh.'
        :'Hạn mức AI hiện không đủ cho yêu cầu này. Kiểm tra hạn mức trong Cấu hình agent.');
      if(amount<=shop.ai_5h_tokens)error.retryAfter=Math.max(1,Math.ceil((Math.max(...current
        .filter(p=>(p.tokens??0)+(p.reserved??0)+amount>p.limit).map(p=>p.resetAt))-now)/1000));
      return {error};
    }
    await run(`INSERT INTO ai_token_windows(shop_id,kind,starts_at,tokens,reserved)
      VALUES($1,'5h',$2,0,$4),($1,'week',$3,0,$4)
      ON CONFLICT(shop_id,kind,starts_at) DO UPDATE SET reserved=ai_token_windows.reserved+excluded.reserved`,
      shopId,...current.map(p=>p.starts),included);
    if(wallet)await run('UPDATE shops SET ai_wallet_reserved=ai_wallet_reserved+$2 WHERE id=$1',shopId,wallet);
    const id=uid();
    await run(`INSERT INTO ai_token_reservations(id,shop_id,five_start,week_start,included,wallet,expires)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,id,shopId,...current.map(p=>p.starts),included,wallet,now+120_000);
    return {id,shopId,amount};
  }).then(result=>{if(result.error)throw result.error;return result;});
}

export async function settleTokens(reservation,actual){
  if(!reservation||!Number.isSafeInteger(actual)||actual<0)return;
  await transaction(async()=>{
    await get('SELECT id FROM shops WHERE id=$1 FOR NO KEY UPDATE',reservation.shopId);
    const record=await get('DELETE FROM ai_token_reservations WHERE id=$1 AND shop_id=$2 RETURNING *',
      reservation.id,reservation.shopId);
    if(record)await applyReservation(record,actual,Date.now());
  });
}

export function compareAllowances(plans){
  const ranks=windows.map(([, ,field])=>[...new Set(plans.filter(plan=>plan.available&&plan[field]>0)
    .map(plan=>plan[field]))].sort((a,b)=>a-b));
  return plan=>Object.fromEntries(windows.map(([kind,,field],index)=>[kind,ranks[index].indexOf(plan[field])+1]));
}
