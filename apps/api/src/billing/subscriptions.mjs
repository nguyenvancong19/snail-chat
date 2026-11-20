import { lockPaymentReceipt, processTopupTransfer } from './token-topups.mjs';
import { compareAllowances, publicUsage, tokenAllowance } from '../ai/usage-quota.mjs';
import { checkVersion } from '../http/versions.mjs';
import { readPage } from '../db/pagination.mjs';
import { configureOptions, configurePromotions, describeQuote, effectiveFlags, offeredTerms, termPromotion } from './plan-options.mjs';
import { randomBytes } from 'node:crypto';
import { all, get, run, throttle, transaction } from '../db/store.mjs';
import { choicesOf, ensure, string } from '../http/validation.mjs';
import { lockBillingShop, shopLimits, shopUsage } from './limits.mjs';
import { applyOrderPlan, billingPolicy, currentPlanTerms, day, planTier, quotePlan, remainingValue } from './plan-changes.mjs';
import { paymentQr, sepayAccount, transferDetails } from './sepay.mjs';

const orderLifetime=30*60_000;
const minute=60_000;
const timeReview='Thời điểm chuyển khoản nằm ngoài hiệu lực của mã thanh toán.';

export async function ownedShop(user,id,{lock=false}={}) {
  const shop=lock?await lockBillingShop(id):await get('SELECT * FROM shops WHERE id=$1',id);
  ensure(shop?.owner_id===user.id&&await get(`SELECT 1 FROM shop_members WHERE shop_id=$1 AND user_id=$2
    AND role='OWNER' AND status='ACTIVE'`,id,user.id),404,'Không tìm thấy Shop bạn sở hữu.');
  return shop;
}

export async function subscriptionPlans({includeArchived=false}={}) {
  const rows=await all(`SELECT code,name,description,page_limit,staff_limit,duration_days,price_vnd,available,
      agent_mode,agent_start,agent_end,order_management,tier,archived_at,benefits,term_prices,page_addon_vnd,staff_addon_vnd,feature_flags,term_promotions,version,ai_5h_tokens,ai_week_tokens,ai_reset_limit
    FROM subscription_plans WHERE $1 OR archived_at IS NULL ORDER BY tier`,includeArchived);
  return rows.map(plan=>({...plan,term_prices:offeredTerms(plan),feature_flags:effectiveFlags(plan)}));
}

function planCode(value) {
  const code=string(value,24,{required:true}).toUpperCase();
  return ensure(/^[A-Z][A-Z0-9_]{1,23}$/.test(code)&&code,400,'Mã gói cần từ 2 đến 24 ký tự, bắt đầu bằng chữ cái và chỉ chứa chữ cái, chữ số hoặc dấu gạch dưới.');
}

function orderInfo(order,{withQr=false}={}) {
  const {id,plan_code,plan_name,price_vnd,created_at,expires_at,paid_at,subscription_until,review_reason,starts_at,upgrade_quote,pricing_selection,promotion_quote}=order;
  const status=order.status==='PENDING'&&expires_at<=Date.now()?'EXPIRED':order.status;
  return {id,plan_code,plan_name,price_vnd,created_at,expires_at,paid_at,subscription_until,review_reason,starts_at,status,upgrade:upgrade_quote,selection:pricing_selection,promotion:promotion_quote,
    ...(withQr&&status==='PENDING'?{
      checkout:{bank:order.bank_code,account:order.account_number,name:order.account_name,qr:paymentQr(order)},
    }:{})};
}

export async function billingOverview(user,shopId,page=1) {
  const shop=await ownedShop(user,shopId);
  const now=Date.now();
  const [plans,limits,usage,orders,policy,terms,scheduled,aiUsage]=await Promise.all([
    subscriptionPlans(),shopLimits(shop),shopUsage(shop.id),
    readPage('SELECT * FROM subscription_orders WHERE shop_id=$1','created_at DESC,id DESC',[shop.id],page),
    billingPolicy(),currentPlanTerms(shop,now),
    get("SELECT * FROM subscription_orders WHERE shop_id=$1 AND status='SCHEDULED' ORDER BY created_at DESC,id DESC LIMIT 1",shop.id),
    publicUsage(shop.id,now),
  ]);
  const allowance=compareAllowances(plans);
  const offers=plans.map(config=>{
    const {term_promotions,ai_5h_tokens:_five,ai_week_tokens:_week,...plan}=config;
    const quote=plan.price_vnd?quotePlan(shop,plan,policy,terms,limits,now):null;
    const termOffers={};
    if(plan.available&&(quote?.kind==='NEW'||quote?.kind==='RENEW')){
      for(const month of Object.keys(plan.term_prices)){
        const promotion=termPromotion({...plan,term_promotions},Number(month));
        if(promotion)termOffers[month]=promotion;
      }
    }
    return {...plan,quote,termOffers,aiAllowance:allowance(config)};
  });
  const currentPlan=terms.current;
  return {plans:offers,limits,usage,aiUsage,orders:orders.items.map((order)=>orderInfo(order)),ordersPage:{page:orders.page,total:orders.total},
    scheduled:scheduled?orderInfo(scheduled):null,
    shop:{id:shop.id,status:shop.status,plan:shop.subscription_plan,planName:currentPlan?.name,planArchived:currentPlan?.archived_at!=null,expiresAt:shop.expired_at},
    sepayReady:!!sepayAccount()};
}

async function salePlan(code,lock=false) {
  return ensure(await get(`SELECT * FROM subscription_plans WHERE code=$1 AND archived_at IS NULL
    AND available AND price_vnd IS NOT NULL ${lock?'FOR SHARE':''}`,code),409,'Gói này chưa mở bán.');
}

export async function checkoutQuote(user,shopId,requestedCode,selection) {
  const code=planCode(requestedCode);
  ensure(code!=='FREE',400,'Gói miễn phí được cấp tự động.');
  const shop=await ownedShop(user,shopId);
  const now=Date.now();
  const [plan,terms,policy,limits,usage]=await Promise.all([
    salePlan(code),currentPlanTerms(shop,now),billingPolicy(),shopLimits(shop),shopUsage(shopId),
  ]);
  return describeQuote(shop,plan,policy,terms,limits,now,selection,usage).quote;
}

export async function startCheckout(user,shopId,requestedCode,expectedPrice,expectedEndsAt,selection) {
  const code=planCode(requestedCode);
  ensure(code!=='FREE',400,'Gói miễn phí được cấp tự động.');
  ensure(Number.isSafeInteger(expectedPrice)&&expectedPrice>=0,400,'Giá gói không hợp lệ.');
  ensure(expectedEndsAt===undefined||expectedEndsAt===null||Number.isSafeInteger(expectedEndsAt),400,'Hạn sử dụng gói không hợp lệ.');
  await throttle('subscription-checkout:'+user.id,25,60_000);
  return transaction(async()=>{
    const shop=await ownedShop(user,shopId,{lock:true});
    ensure(shop.status==='ACTIVE',403,'Shop đang bị khóa. Liên hệ quản trị viên để mở khóa.');
    const now=Date.now();
    const usage=await shopUsage(shop.id);
    ensure(usage.linkedPages>0,409,'Vui lòng liên kết ít nhất một Page/kênh đang quản lý trước khi đăng ký gói.');
    ensure(!await get("SELECT id FROM subscription_orders WHERE shop_id=$1 AND status='SCHEDULED'",shop.id),409,
      'Shop đã có gói chờ chuyển sang kỳ sau.');
    const pending=await get(`SELECT * FROM subscription_orders
      WHERE shop_id=$1 AND status='PENDING' AND expires_at>$2 ORDER BY created_at DESC LIMIT 1`,shop.id,now);
    if(pending){
      ensure(pending.plan_code===code&&pending.price_vnd===expectedPrice&&
        (expectedEndsAt===undefined||(pending.upgrade_quote?.endsAt??null)===expectedEndsAt)&&
        (selection===undefined?pending.pricing_selection==null:
          pending.pricing_selection?.months===selection?.months&&pending.page_limit===selection?.pages&&pending.staff_limit===selection?.staff),409,
        'Shop đang có đơn chờ thanh toán. Mở lại đơn đó trong lịch sử hoặc đợi mã hết hạn.');
      return orderInfo(pending,{withQr:true});
    }
    const configured=await salePlan(code,true);
    const terms=await currentPlanTerms(shop,now);
    const {plan,quote}=describeQuote(shop,configured,await billingPolicy(),terms,await shopLimits(shop),now,selection,usage);
    ensure(quote.kind!=='BLOCKED',409,quote.reason);
    ensure(quote.amount===expectedPrice&&(expectedEndsAt===undefined||(quote.upgrade?.endsAt??null)===expectedEndsAt),409,
      'Báo giá vừa thay đổi. Hãy tải lại để xem số tiền và thời hạn.');
    ensure(usage.pages<=plan.page_limit&&usage.staff+usage.invitations<=plan.staff_limit,409,
      'Hạn mức của gói thấp hơn số Page hoặc số chỗ nhân viên Shop đang dùng.');
    const account=quote.amount?ensure(sepayAccount(),503,'Thanh toán SePay chưa được cấu hình.'):null;
    const id='SC'+randomBytes(6).toString('hex').toUpperCase();
    const order=await get(`INSERT INTO subscription_orders(id,shop_id,plan_code,plan_name,price_vnd,page_limit,staff_limit,duration_days,
      bank_code,account_number,account_name,created_at,expires_at,change_kind,list_price_vnd,upgrade_quote,subscription_revision,pricing_selection,promotion_quote)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      id,shop.id,code,plan.name,quote.amount,plan.page_limit,plan.staff_limit,plan.duration_days,
      account?.bank??'',account?.number??'',account?.name??'',now,Math.min(now+orderLifetime,quote.upgrade?.endsAt??Infinity),
      quote.kind,quote.listPrice,quote.upgrade??null,shop.subscription_revision,selection===undefined?null:
        {months:quote.months,pages:quote.pages,staff:quote.staff},quote.promotion??null);
    if(quote.amount===0){
      await applyOrderPlan(shop,order,now);
      return orderInfo(await get('SELECT * FROM subscription_orders WHERE id=$1',id));
    }
    return orderInfo(order,{withQr:true});
  });
}

export async function billingOrder(user,shopId,orderId) {
  const shop=await ownedShop(user,shopId);
  const order=ensure(await get('SELECT * FROM subscription_orders WHERE shop_id=$1 AND id=$2',shop.id,orderId),
    404,'Không tìm thấy đơn thanh toán.');
  return orderInfo(order,{withQr:true});
}

export async function processTransfer(body) {
  const transfer=transferDetails(body);
  if(!transfer)return;
  if(transfer.orderId.startsWith('ST'))return processTopupTransfer(transfer);
  const target=await get('SELECT shop_id,account_number FROM subscription_orders WHERE id=$1',transfer.orderId);
  if(!target||target.account_number!==transfer.account)return;
  await transaction(async()=>{
    if(!await lockPaymentReceipt(transfer.id,'topup'))return;
    const shop=await lockBillingShop(target.shop_id);
    const order=await get('SELECT * FROM subscription_orders WHERE id=$1 FOR UPDATE',transfer.orderId);
    const now=Date.now();
    const usage=await shopUsage(shop.id);
    // A bank can report the first second of the creation minute for a transfer within that minute.
    const atCreationMinute=transfer.date===Math.floor(order.created_at/minute)*minute;
    const earlierThanOrder=transfer.date<Math.floor(order.created_at/1000)*1000;
    const retryTimeReview=order.status==='REVIEW'&&order.review_reason===timeReview&&atCreationMinute&&earlierThanOrder;
    let reason=null;
    if(!retryTimeReview&&order.status!=='PENDING')reason='Đơn đã được xử lý hoặc đã chờ đối soát.';
    else if(transfer.amount!==order.price_vnd)reason='Số tiền nhận không khớp với giá đơn.';
    else if(!Number.isFinite(transfer.date)||(earlierThanOrder&&!atCreationMinute)||
      transfer.date>order.expires_at||transfer.date>now+5*minute)reason=timeReview;
    else if(order.upgrade_quote&&(shop.expired_at!==order.upgrade_quote.endsAt||now>=order.upgrade_quote.endsAt))
      reason='Kỳ cũ đã kết thúc hoặc đã thay đổi trước khi kích hoạt gói nâng cấp. Cần đối soát.';
    else if(shop.subscription_revision!==order.subscription_revision||shop.status!=='ACTIVE'||!usage.linkedPages||
      await get("SELECT id FROM subscription_orders WHERE shop_id=$1 AND status='SCHEDULED'",shop.id)||
      order.change_kind==='DOWNGRADE'||(order.plan_code!==shop.subscription_plan&&await planTier(order.plan_code)<await planTier(shop.subscription_plan))||
      usage.pages>order.page_limit||usage.staff+usage.invitations>order.staff_limit)
      reason='Gói đã mua không phù hợp với trạng thái hiện tại của Shop.';
    if(retryTimeReview&&reason)return;
    const receipt=retryTimeReview
      ?await run(`UPDATE sepay_receipts SET outcome='PAID'
          WHERE transaction_id=$1 AND order_id=$2 AND amount_vnd=$3 AND reference_code=$4
            AND outcome='REVIEW' AND received_at>=$5 AND received_at<$6
            AND NOT EXISTS (SELECT 1 FROM sepay_receipts WHERE order_id=$2 AND outcome='PAID')`,
        transfer.id,order.id,transfer.amount,transfer.reference,order.created_at,order.expires_at)
      :await run(`INSERT INTO sepay_receipts(transaction_id,order_id,amount_vnd,received_at,outcome,reference_code)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (transaction_id) DO NOTHING`,
        transfer.id,order.id,transfer.amount,now,reason?'REVIEW':'PAID',transfer.reference);
    if(!receipt.changes)return;
    if(reason){
      if(['PENDING','CANCELLED'].includes(order.status))await run("UPDATE subscription_orders SET status='REVIEW',review_reason=$2 WHERE id=$1",order.id,reason);
      return;
    }
    await applyOrderPlan(shop,order,now);
  });
}

function integer(value,min,max,label) {
  return ensure(Number.isSafeInteger(value)&&value>=min&&value<=max&&value,400,label+' không hợp lệ.');
}

function planValues(code,body) {
  const free=code==='FREE';
  ensure(free||typeof body.available==='boolean',400,'Trạng thái mở bán không hợp lệ.');
  const chosen=body.term_prices;
  const inputPrice=chosen===undefined?body.price_vnd:chosen?.[1]??null;
  const price=free||inputPrice===null?null:integer(inputPrice,1000,999999999,'Giá gói');
  const mode=body.agent_mode===undefined?null:choicesOf(body.agent_mode,['OFF','SCHEDULED','ALWAYS']);
  const minuteOfDay=(value)=>{
    ensure(Number.isInteger(value)&&value>=0&&value<1440,400,'Giờ hoạt động không hợp lệ.');
    return value;
  };
  ensure(body.feature_flags?.agent===undefined || body.feature_flags.agent===(mode==='SCHEDULED'||mode==='ALWAYS'),
    400,'Hãy chọn lịch hoạt động khi bật quyền AI agent.');
  const start=mode==='SCHEDULED'?minuteOfDay(body.agent_start):null;
  const end=mode==='SCHEDULED'?minuteOfDay(body.agent_end):null;
  ensure(mode!=='SCHEDULED'||start!==end,400,'Giờ bắt đầu và kết thúc phải khác nhau. Chọn Cả ngày nếu muốn chạy 24/24.');
  ensure(body.order_management===undefined||typeof body.order_management==='boolean',400,'Quyền quản lý đơn hàng không hợp lệ.');
  ensure(body.benefits===undefined||Array.isArray(body.benefits)&&body.benefits.length<=20,
    400,'Có thể thêm tối đa 20 quyền lợi cho mỗi gói.');
  const benefits=body.benefits?.map((benefit)=>{
    ensure(benefit&&typeof benefit==='object'&&!Array.isArray(benefit),400,'Quyền lợi không hợp lệ.');
    return {name:string(benefit.name,60,{required:true}),description:string(benefit.description,160)};
  });
  return [code,string(body.name,60,{required:true}),string(body.description,250),price,
    integer(body.page_limit,1,100,'Hạn mức Page'),integer(body.staff_limit,1,200,'Hạn mức nhân viên'),
    free?null:chosen===undefined?integer(body.duration_days,1,365,'Thời hạn'):30,free||body.available,mode,start,end,
    body.order_management??null,benefits===undefined?null:JSON.stringify(benefits)];
}

export async function createPlan(body) {
  const code=planCode(body.code);
  ensure(code!=='FREE',409,'Mã FREE dành cho gói miễn phí mặc định.');
  const tier=integer(body.tier,1,10000,'Bậc gói');
  const values=planValues(code,body);
  const options=configureOptions(body,false);
  const promotions=configurePromotions(body,{code,term_prices:body.term_prices,price_vnd:values[3],duration_days:values[6]});
  const created=await run(`INSERT INTO subscription_plans(code,name,description,price_vnd,page_limit,staff_limit,
    duration_days,available,agent_mode,agent_start,agent_end,order_management,benefits,tier,term_prices,page_addon_vnd,staff_addon_vnd,feature_flags,term_promotions,ai_5h_tokens,ai_week_tokens,ai_reset_limit)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'OFF'),$10,$11,COALESCE($12,FALSE),COALESCE($13,'[]'::jsonb),$14,$15,$16,$17,$18,$19,$20,$21,$22)
    ON CONFLICT DO NOTHING`,...values,tier,...options.slice(0,4),JSON.stringify(promotions),...tokenAllowance(body));
  ensure(created.changes,409,'Mã hoặc bậc gói đã được dùng, kể cả bởi gói đã xóa.');
  return {code};
}

export async function updatePlan(requestedCode,body,expected) {
  const code=planCode(requestedCode);
  const values=planValues(code,body);
  const options=configureOptions(body,code==='FREE');
  await transaction(async()=>{
    const previous=ensure(await get('SELECT term_prices,term_promotions,version,ai_5h_tokens,ai_week_tokens,ai_reset_limit FROM subscription_plans WHERE code=$1 AND archived_at IS NULL FOR UPDATE',code),
      404,'Không tìm thấy gói đang quản lý.');
    checkVersion(previous.version,expected);
    const promotions=configurePromotions(body,{code,term_prices:body.term_prices??previous.term_prices,
      price_vnd:values[3],duration_days:values[6]},previous.term_promotions);
    const updated=await run(`UPDATE subscription_plans SET name=$2,description=$3,price_vnd=$4,page_limit=$5,staff_limit=$6,
      duration_days=$7,available=$8,agent_mode=COALESCE($9,agent_mode),
      agent_start=CASE WHEN $9 IS NULL THEN agent_start ELSE $10 END,
      agent_end=CASE WHEN $9 IS NULL THEN agent_end ELSE $11 END,
      order_management=COALESCE($12,order_management),benefits=COALESCE($13,benefits),
      term_prices=COALESCE($14,term_prices),
      page_addon_vnd=CASE WHEN $18::boolean THEN $15 ELSE page_addon_vnd END,
      staff_addon_vnd=CASE WHEN $19::boolean THEN $16 ELSE staff_addon_vnd END,
      feature_flags=CASE WHEN $17::jsonb IS NULL THEN feature_flags
        ELSE COALESCE(feature_flags,'{}'::jsonb)||$17::jsonb END,term_promotions=$20,ai_5h_tokens=$21,ai_week_tokens=$22,ai_reset_limit=$23
      WHERE code=$1 AND archived_at IS NULL`,...values,...options,JSON.stringify(promotions),...tokenAllowance(body,previous));
    ensure(updated.changes,404,'Không tìm thấy gói đang quản lý.');
  });
}

export async function archivePlan(requestedCode,expected) {
  const code=planCode(requestedCode);
  ensure(code!=='FREE',409,'Gói miễn phí mặc định luôn được giữ để cấp cho Shop mới.');
  await transaction(async()=>{
    const old=ensure(await get('SELECT version FROM subscription_plans WHERE code=$1 FOR UPDATE',code),404,'Không tìm thấy gói.');
    checkVersion(old.version,expected);
    await run(`UPDATE subscription_plans SET archived_at=COALESCE(archived_at,$2),available=FALSE WHERE code=$1`,code,Date.now());
  });
}

export async function adminRevenueChart(now=Date.now()) {
  const offset=7*3_600_000, dayMs=86_400_000;
  const today=new Date(now+offset);
  const monthStart=(index)=>Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+index,1);
  const firstDay=Math.floor((now+offset)/dayMs)-14;
  const rows=await all(`SELECT to_char(to_timestamp((received_at+$1::bigint)/1000.0)
    AT TIME ZONE 'UTC','YYYY-MM-DD') AS date, SUM(amount_vnd)::bigint AS amount
    FROM (SELECT received_at,amount_vnd,outcome FROM sepay_receipts UNION ALL
      SELECT received_at,amount_vnd,outcome FROM ai_topup_receipts) receipts
    WHERE outcome='PAID' AND received_at >= $2 AND received_at <= $3
    GROUP BY date ORDER BY date`,offset,monthStart(-5)-offset,now);
  const byDay=new Map(rows.map(({date,amount})=>[date,amount]));
  const byMonth=new Map();
  for(const {date,amount} of rows) {
    const month=date.slice(0,7);
    byMonth.set(month,(byMonth.get(month)??0)+amount);
  }
  const daily=Array.from({length:15},(_,index)=>{
    const date=new Date((firstDay+index)*dayMs).toISOString().slice(0,10);
    return {date,amount:byDay.get(date)??0};
  });
  const monthly=Array.from({length:6},(_,index)=>{
    const date=new Date(monthStart(index-5)).toISOString().slice(0,7);
    return {date,amount:byMonth.get(date)??0};
  });
  return {daily,monthly};
}

export async function adminPaymentHistory(page=1) {
  return readPage(`SELECT o.id,o.plan_name,s.name AS shop_name,o.price_vnd,o.created_at,o.expires_at,o.paid_at,o.review_reason,
    CASE WHEN o.status='PENDING' AND o.expires_at<=$1 THEN 'EXPIRED' ELSE o.status END AS status,
    COALESCE(r.receipts,'[]'::jsonb) AS receipts
    FROM subscription_orders o JOIN shops s ON s.id=o.shop_id
    LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',t.transaction_id,'amount',t.amount_vnd,
      'outcome',t.outcome,'at',t.received_at,'reference',t.reference_code) ORDER BY t.received_at DESC) AS receipts
      FROM sepay_receipts t WHERE t.order_id=o.id) r ON TRUE
    `, 'created_at DESC,id DESC',[Date.now()],page);
}

export async function setShopSubscription(user,shopId,{plan:requestedCode,days},expected) {
  ensure(user.is_super_admin===true,403,'Chỉ quản trị viên hệ thống có quyền thay đổi gói.');
  const code=planCode(requestedCode);
  return transaction(async()=>{
    const shop=await lockBillingShop(shopId);
    checkVersion(shop.version,expected);
    const plan=ensure(await get('SELECT * FROM subscription_plans WHERE code=$1 AND archived_at IS NULL FOR SHARE',code),404,'Không tìm thấy gói đang quản lý.');
    const now=Date.now();
    const duration=code==='FREE'?null:integer(days,1,365,'Thời hạn');
    const renewed=code!=='FREE'&&shop.subscription_plan===code;
    const expiresAt=duration===null?null:Math.max(now,renewed?(shop.expired_at??0):0)+duration*day;
    const carry=renewed?await remainingValue(shop,now):0;
    await run(`UPDATE shops SET subscription_plan=$2,expired_at=$3,subscription_page_limit=$4,subscription_staff_limit=$5,
      subscription_value_vnd=$7,subscription_value_since=$6,subscription_revision=subscription_revision+1 WHERE id=$1`,
      shop.id,code,expiresAt,code==='FREE'?null:plan.page_limit,code==='FREE'?null:plan.staff_limit,now,carry);
    await run(`UPDATE subscription_orders SET status='CANCELLED',review_reason='Quản trị viên đã thay đổi gói của Shop.'
      WHERE shop_id=$1 AND status='PENDING'`,shop.id);
    await run(`UPDATE subscription_orders SET status='REVIEW',review_reason='Đơn đã thanh toán nhưng lịch đổi gói bị quản trị viên thay đổi. Cần đối soát.'
      WHERE shop_id=$1 AND status='SCHEDULED'`,shop.id);
    await run(`INSERT INTO subscription_changes(shop_id,admin_id,previous_plan,new_plan,expires_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6)`,shop.id,user.id,shop.subscription_plan,code,expiresAt,now);
    return {subscriptionPlan:code,expiresAt,version:shop.version+1};
  });
}
