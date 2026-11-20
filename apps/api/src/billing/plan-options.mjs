import { ensure } from '../http/validation.mjs';
import { quotePlan } from './plan-changes.mjs';

export const billingMonths = [1, 3, 6, 12];
const baseFeatureKeys = ['messages','comments','agent','quickReplies','faq','orders'];
export const featureKeys = [...baseFeatureKeys,'alertSounds'];

export function effectiveFlags(plan) {
  if (!plan) return Object.fromEntries(featureKeys.map(key => [key,false]));
  const flags=plan.feature_flags ?? {
    messages:true, comments:true, agent:plan.agent_mode!=='OFF',
    quickReplies:true, faq:plan.agent_mode!=='OFF', orders:plan.order_management===true,
  };
  return {...flags,alertSounds:flags.alertSounds===true};
}

export function offeredTerms(plan) {
  return plan.term_prices ?? (plan.duration_days===30 && plan.price_vnd ? {1:plan.price_vnd} : {});
}

function promotionDiscount(basePrice,rule) {
  return rule.kind==='percent'?Math.round(basePrice*rule.value/100):rule.value;
}

export function termPromotion(plan,months) {
  const basePrice=offeredTerms(plan)[months];
  const rule=plan.term_promotions?.[months];
  if(!basePrice||!rule?.enabled)return null;
  const discount=promotionDiscount(basePrice,rule);
  if(!Number.isSafeInteger(discount)||discount<1||basePrice-discount<1000)return null;
  return {months,kind:rule.kind,value:rule.value,basePrice,discount,finalPrice:basePrice-discount};
}

export function configurePromotions(body,plan,previous={}) {
  const prices=offeredTerms(plan);
  const supplied=body.term_promotions;
  const rules=supplied===undefined?Object.fromEntries(Object.entries(previous).filter(([month])=>prices[month])):supplied;
  ensure(rules&&typeof rules==='object'&&!Array.isArray(rules),400,'Cấu hình ưu đãi không hợp lệ.');
  const entries=Object.entries(rules);
  ensure(plan.code!=='FREE'||!entries.length,400,'Ưu đãi chỉ áp dụng cho gói có giá.');
  return Object.fromEntries(entries.map(([month,rule])=>{
    ensure(billingMonths.map(String).includes(month)&&prices[month],400,'Chọn chu kỳ có giá để đặt ưu đãi.');
    ensure(rule&&typeof rule==='object'&&!Array.isArray(rule)&&['percent','fixed'].includes(rule.kind)&&
      typeof rule.enabled==='boolean'&&Number.isSafeInteger(rule.value)&&rule.value>=1&&
      rule.value<=(rule.kind==='percent'?99:999999998),400,'Mức giảm không hợp lệ.');
    if(rule.enabled)ensure(prices[month]-promotionDiscount(prices[month],rule)>=1000,400,
      'Giá sau ưu đãi phải từ 1.000 đ cho mỗi chu kỳ.');
    return [month,{kind:rule.kind,value:rule.value,enabled:rule.enabled}];
  }));
}

export function configureOptions(body, free) {
  const flags=body.feature_flags;
  ensure(flags===undefined || flags && typeof flags==='object' && !Array.isArray(flags) &&
    baseFeatureKeys.every(key=>typeof flags[key]==='boolean') &&
    Object.entries(flags).every(([key,value])=>featureKeys.includes(key)&&typeof value==='boolean'),400,'Quyền tính năng không hợp lệ.');
  const prices=body.term_prices;
  ensure(prices===undefined || !free && prices && typeof prices==='object' && !Array.isArray(prices) &&
    Object.entries(prices).every(([key,value])=>billingMonths.map(String).includes(key) &&
      Number.isSafeInteger(value) && value>=1000 && value<=999999999),
    400,'Giá hoặc chu kỳ thanh toán không hợp lệ.');
  ensure(!prices || !Object.keys(prices).length || prices[1],400,'Cần đặt giá 1 tháng để mở các chu kỳ khác.');
  ensure(!prices || billingMonths.every(months=>!prices[months] || prices[months]<=prices[1]*months),
    400,'Giá chu kỳ không được vượt quá tổng giá trả từng tháng.');
  for(const field of ['page_addon_vnd','staff_addon_vnd']){
    const value=body[field];
    ensure(value==null || !free && Number.isSafeInteger(value) && value>=1 && value<=999999999,400,'Đơn giá bổ sung không hợp lệ.');
  }
  return [prices===undefined?null:JSON.stringify(prices),body.page_addon_vnd??null,
    body.staff_addon_vnd??null,flags===undefined?null:JSON.stringify(flags),
    Object.hasOwn(body,'page_addon_vnd'),Object.hasOwn(body,'staff_addon_vnd')];
}

export function describeQuote(shop, plan, policy, terms, limits, now, selection, usage) {
  ensure(selection===undefined || selection && typeof selection==='object' && !Array.isArray(selection) &&
    billingMonths.includes(selection.months) && Number.isSafeInteger(selection.pages) && Number.isSafeInteger(selection.staff),
    400,'Chu kỳ hoặc hạn mức tùy chọn không hợp lệ.');
  const months=selection?.months??null;
  const prices=offeredTerms(plan);
  const pages=selection?.pages??plan.page_limit;
  const staff=selection?.staff??plan.staff_limit;
  ensure(months===null || billingMonths.includes(months) && prices[months],409,'Gói chưa mở bán chu kỳ này.');
  ensure(Number.isSafeInteger(pages)&&pages>=plan.page_limit&&pages<=100&&
    Number.isSafeInteger(staff)&&staff>=plan.staff_limit&&staff<=200,400,'Hạn mức tùy chọn không hợp lệ.');
  const extraPages=pages-plan.page_limit, extraStaff=staff-plan.staff_limit;
  ensure(!extraPages||plan.page_addon_vnd,409,'Gói này chưa có giá bổ sung Page.');
  ensure(!extraStaff||plan.staff_addon_vnd,409,'Gói này chưa có giá bổ sung nhân viên.');
  ensure(months!==null||!extraPages&&!extraStaff,400,'Hãy chọn chu kỳ cho gói tùy chọn.');
  const addonMonthly=extraPages*(plan.page_addon_vnd??0)+extraStaff*(plan.staff_addon_vnd??0);
  const duration=months===null?plan.duration_days:months*30;
  const price=months===null?plan.price_vnd:prices[months]+addonMonthly*months;
  ensure(Number.isSafeInteger(price)&&price>=1000&&price<=999999999,400,'Tổng giá gói ngoài phạm vi cho phép.');
  const result={...plan,price_vnd:price,duration_days:duration,page_limit:pages,staff_limit:staff};
  let quote=quotePlan(shop,result,policy,terms,limits,now);
  if(quote.kind==='UPGRADE'&&months!==null){
    const monthly={...result,price_vnd:prices[1]+addonMonthly,duration_days:30};
    quote=quotePlan(shop,monthly,policy,terms,limits,now);
    // Store the monthly tariff used for proration as the next upgrade baseline.
    result.duration_days=monthly.duration_days;
    result.price_vnd=monthly.price_vnd;
  }
  if(quote.kind!=='BLOCKED'&&usage&&(usage.pages>pages||usage.staff+usage.invitations>staff)){
    quote={kind:'BLOCKED',reason:'Hạn mức của gói thấp hơn số Page hoặc số chỗ nhân viên Shop đang dùng.'};
  }
  // Prorated upgrades cover the remaining days rather than a new billing term.
  const promotion=quote.kind==='NEW'||quote.kind==='RENEW'
    ?termPromotion(plan,months??(plan.duration_days===30?1:null)):null;
  if(promotion){
    result.price_vnd=price-promotion.discount;
    quote={...quote,amount:result.price_vnd,listPrice:result.price_vnd,promotion:{...promotion,originalTotal:price}};
  }
  const monthlyTotal=(prices[1]??0)+addonMonthly;
  const savings=months>1?Math.max(0,monthlyTotal*months-price):0;
  return { plan:result, quote:{
    ...quote,months,pages,staff,extraPages,extraStaff,addonMonthly,basePrice:months===null?price:prices[months],
    savings, savingsPercent:savings?Math.round(1000*savings/(monthlyTotal*months))/10:0,
  }};
}
