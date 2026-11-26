import { randomBytes } from 'node:crypto';
import { get, run, throttle, transaction } from '../db/store.mjs';
import { checkVersion } from '../http/versions.mjs';
import { ensure } from '../http/validation.mjs';
import { publicUsage } from '../ai/usage-quota.mjs';
import { paymentQr, sepayAccount } from './sepay.mjs';
import { readPage } from '../db/pagination.mjs';
import { hasPurchasedPlan } from './plan-changes.mjs';

function checkoutInfo(order){
  if(!order)return null;
  const {id,tokens,price_vnd,created_at,expires_at,paid_at,review_reason}=order;
  const status=order.status==='PENDING'&&expires_at<=Date.now()?'EXPIRED':order.status;
  return {id,tokens,price_vnd,created_at,expires_at,paid_at,status,review_reason,kind:'TOKEN_TOPUP',
    ...(status==='PENDING'?{checkout:{bank:order.bank_code,account:order.account_number,name:order.account_name,qr:paymentQr(order)}}:{})};
}

async function owner(user,shopId,lock=false){
  return ensure(await get(`SELECT s.id,s.status FROM shops s JOIN shop_members m ON m.shop_id=s.id AND m.user_id=s.owner_id
    WHERE s.id=$1 AND s.owner_id=$2 AND m.role='OWNER' AND m.status='ACTIVE' ${lock?'FOR NO KEY UPDATE OF s':''}`,
    shopId,user.id),404,'Không tìm thấy Shop bạn sở hữu.');
}

export function topupSettings(){
  return get('SELECT enabled,tokens,price_vnd,version FROM ai_topup_settings WHERE id=1');
}

export async function saveTopupSettings(body,expected){
  const {enabled,tokens,price_vnd}=body;
  ensure(typeof enabled==='boolean'&&Number.isSafeInteger(tokens)&&tokens>=1&&tokens<=1_000_000_000&&
    Number.isSafeInteger(price_vnd)&&price_vnd>=1000&&price_vnd<=999999999,400,'Số token hoặc giá nạp không hợp lệ.');
  await transaction(async()=>{
    const current=await get('SELECT version FROM ai_topup_settings WHERE id=1 FOR UPDATE');
    checkVersion(current.version,expected);
    await run('UPDATE ai_topup_settings SET enabled=$1,tokens=$2,price_vnd=$3 WHERE id=1',enabled,tokens,price_vnd);
  });
}

export async function walletOverview(user,shopId,page=1){
  const shop=await owner(user,shopId);
  const [usage,settings,history,pending]=await Promise.all([
    publicUsage(shop.id),topupSettings(),
    readPage('SELECT * FROM ai_topup_orders WHERE shop_id=$1','created_at DESC,id DESC',[shop.id],page),
    get("SELECT * FROM ai_topup_orders WHERE shop_id=$1 AND status='PENDING' AND expires_at>$2 ORDER BY created_at DESC LIMIT 1",shop.id,Date.now()),
  ]);
  return {usage,offer:settings.enabled?{tokens:settings.tokens,price_vnd:settings.price_vnd,version:settings.version}:null,
    sepayReady:!!sepayAccount(),pending:checkoutInfo(pending),
    orders:history.items.map(checkoutInfo),orderPage:{page:history.page,total:history.total}};
}

export async function startTopup(user,shopId,expected){
  await throttle('ai-topup:'+user.id,15,60_000);
  return transaction(async()=>{
    const shop=await owner(user,shopId,true);
    const now=Date.now();
    const usage=await publicUsage(shop.id,now);
    ensure(usage?.canTopup&&await hasPurchasedPlan(shop.id),409,
      'Chỉ nạp thêm token khi đã hết hạn mức và hết lượt đặt lại.');
    const pending=await get("SELECT * FROM ai_topup_orders WHERE shop_id=$1 AND status='PENDING' AND expires_at>$2 ORDER BY created_at DESC LIMIT 1",shop.id,now);
    if(pending)return checkoutInfo(pending);
    const settings=await topupSettings();
    ensure(settings.enabled,409,'Nạp token hiện chưa mở bán.');
    checkVersion(settings.version,expected);
    const account=ensure(sepayAccount(),503,'Thanh toán SePay chưa được cấu hình.');
    const id='ST'+randomBytes(6).toString('hex').toUpperCase();
    const order=await get(`INSERT INTO ai_topup_orders(id,shop_id,tokens,price_vnd,bank_code,account_number,account_name,created_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,id,shop.id,settings.tokens,settings.price_vnd,
      account.bank,account.number,account.name,now,now+30*60_000);
    return checkoutInfo(order);
  });
}

export async function topupOrder(user,shopId,id){
  await owner(user,shopId);
  const order=ensure(await get('SELECT * FROM ai_topup_orders WHERE id=$1 AND shop_id=$2',id,shopId),
    404,'Không tìm thấy đơn nạp token.');
  return checkoutInfo(order);
}

// Both kinds of purchase share a lock namespace keyed by the signed SePay transfer ID.
export async function lockPaymentReceipt(transferId,otherTable){
  await run('SELECT pg_advisory_xact_lock(hashtextextended($1,541606))',transferId);
  const existing=otherTable==='topup'
    ?await get('SELECT 1 FROM ai_topup_receipts WHERE transaction_id=$1',transferId)
    :await get('SELECT 1 FROM sepay_receipts WHERE transaction_id=$1',transferId);
  return !existing;
}

export async function processTopupTransfer(transfer){
  const target=await get('SELECT shop_id,account_number FROM ai_topup_orders WHERE id=$1',transfer.orderId);
  if(!target||target.account_number!==transfer.account)return;
  await transaction(async()=>{
    if(!await lockPaymentReceipt(transfer.id,'subscription'))return;
    await get('SELECT id FROM shops WHERE id=$1 FOR NO KEY UPDATE',target.shop_id);
    const order=await get('SELECT * FROM ai_topup_orders WHERE id=$1 FOR UPDATE',transfer.orderId);
    const now=Date.now();
    let reason=null;
    if(order.status!=='PENDING')reason='Đơn đã được xử lý hoặc đang chờ đối soát.';
    else if(transfer.amount!==order.price_vnd)reason='Số tiền nhận không khớp với giá đơn.';
    else if(!Number.isFinite(transfer.date)||transfer.date<Math.floor(order.created_at/60_000)*60_000||
      transfer.date>order.expires_at||transfer.date>now+5*60_000)reason='Thời điểm chuyển khoản nằm ngoài hiệu lực của mã thanh toán.';
    const receipt=await run(`INSERT INTO ai_topup_receipts(transaction_id,order_id,amount_vnd,received_at,outcome,reference_code)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(transaction_id) DO NOTHING`,transfer.id,order.id,transfer.amount,now,reason?'REVIEW':'PAID',transfer.reference);
    if(!receipt.changes)return;
    if(reason){
      if(order.status==='PENDING')await run("UPDATE ai_topup_orders SET status='REVIEW',review_reason=$2 WHERE id=$1",order.id,reason);
      return;
    }
    await run('UPDATE shops SET ai_wallet_tokens=ai_wallet_tokens+$2 WHERE id=$1',order.shop_id,order.tokens);
    await run("UPDATE ai_topup_orders SET status='PAID',paid_at=$2 WHERE id=$1",order.id,now);
  });
}

export async function adminTopups(page=1){
  return readPage(`SELECT o.id,o.tokens,o.price_vnd,o.status,o.created_at,o.expires_at,o.paid_at,o.review_reason,s.name AS shop_name,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.transaction_id,'amount',r.amount_vnd,'outcome',r.outcome,
      'reference',r.reference_code) ORDER BY r.received_at DESC) FROM ai_topup_receipts r WHERE r.order_id=o.id),'[]') AS receipts
    FROM ai_topup_orders o JOIN shops s ON s.id=o.shop_id`,'created_at DESC,id DESC',[],page);
}
