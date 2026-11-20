import { effectiveFlags } from './plan-options.mjs';
import { get } from '../db/store.mjs';
import { ensure } from '../http/validation.mjs';

const localTime=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Ho_Chi_Minh',hourCycle:'h23',hour:'2-digit',minute:'2-digit',
});
const minuteMs=60_000;
const dayMinutes=1440;

export async function shopFeatures(shopId) {
  const plan=await get(`SELECT p.agent_mode,p.agent_start,p.agent_end,p.order_management,p.feature_flags FROM shops s
    JOIN subscription_plans p ON p.code=s.subscription_plan
    WHERE s.id=$1 AND s.status='ACTIVE' AND (s.expired_at IS NULL OR s.expired_at>$2)`,shopId,Date.now());
  if (!plan) return null;
  const feature_flags=effectiveFlags(plan);
  return {...plan,feature_flags,order_management:feature_flags.orders,
    agent_mode:feature_flags.agent?plan.agent_mode:'OFF'};
}

export async function requirePlanFeature(shopId,key) {
  const plan=await shopFeatures(shopId);
  ensure(plan?.feature_flags[key],403,'Gói hiện tại không bao gồm tính năng này.');
  return plan;
}

export function withoutFaqs(policy,plan) {
  if(!Array.isArray(policy?.rules)||plan?.feature_flags.faq)return policy;
  return {...policy,rules:policy.rules.filter(rule=>rule.type!=='faq')};
}

export function agentIncluded(plan) {
  return plan?.agent_mode==='SCHEDULED'||plan?.agent_mode==='ALWAYS';
}

export function catalogIncluded(plan) {
  return agentIncluded(plan)||plan?.order_management===true;
}

export async function requireCatalogFeature(shopId) {
  const plan=await shopFeatures(shopId);
  ensure(catalogIncluded(plan),403,'Danh mục Page cần gói có AI agent hoặc Quản lý đơn hàng.');
  return plan;
}

function shiftStart(plan,instant) {
  const [hours,minutes]=localTime.format(instant).split(':').map(Number);
  const elapsed=(hours*60+minutes-plan.agent_start+dayMinutes)%dayMinutes;
  const duration=(plan.agent_end-plan.agent_start+dayMinutes)%dayMinutes;
  return elapsed<duration?Math.floor(instant/minuteMs)-elapsed:null;
}

export function automationAllowed(plan,created,now=Date.now()) {
  if(plan?.agent_mode==='ALWAYS')return true;
  if(plan?.agent_mode!=='SCHEDULED')return false;
  const shift=shiftStart(plan,now);
  return shift!==null&&shift===shiftStart(plan,created);
}

export function automationPauseNote(plan) {
  return !plan||plan.agent_mode==='OFF'?'Gói hiện tại không có AI agent.':
    'Tin đến ngoài ca hoặc đã qua ca của AI agent. Hãy xử lý thủ công.';
}

export async function requireOrderFeature(shopId) {
  const plan=await shopFeatures(shopId);
  ensure(plan?.order_management,403,'Gói hiện tại không có Quản lý đơn hàng.');
  return plan;
}

export async function requireAgentFeature(shopId) {
  const plan=await shopFeatures(shopId);
  ensure(agentIncluded(plan),403,'Gói hiện tại không có AI agent.');
}
