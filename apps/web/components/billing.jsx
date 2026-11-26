'use client';

import { allowanceLabels } from './agent-usage.jsx';
import { ListPagination, useListPage } from './list-pagination.jsx';

import { useDisplayLocale } from '../lib/display-locale.jsx';
import { planDisplayName } from '../lib/locale.js';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, formatDate } from '../lib/workspace.js';
import { Dialog } from './forms.jsx';
import { Icon } from './icons.jsx';
import { chartCurrency, chartDate, TimeChart } from './stat-charts.jsx';
import { Button, CardHead, Chip, Empty, Field, MetricGrid, Title } from './ui.jsx';

const vnd=(intl)=>new Intl.NumberFormat(intl,{style:'currency',currency:'VND'}).format;
const newPlan={code:'',name:'',description:'',page_limit:1,staff_limit:1,duration_days:30,available:false};
const billingMonths=[1,3,6,12];
const planFeatures=[
  ['messages','Tin nhắn'],['comments','Bình luận'],['agent','Cấu hình agent'],
  ['quickReplies','Chat nhanh'],['faq','FAQ'],['orders','Quản lý đơn hàng'],['alertSounds','Âm thanh thông báo'],
];
const termLabel=(months,copy)=>months===1?copy('1 tháng'):months+' '+copy('tháng');
const discount=(plan,months)=>Math.max(0,1-plan.term_prices[months]/(plan.term_prices[1]*months));

function PromotionPrice({promotion,period,money,copy,intl}) {
  const percentage=new Intl.NumberFormat(intl,{style:'percent'}).format(promotion.value/100);
  return <div className="billing-promotion-price">
    <div><span>{copy('Giá cũ')} </span><del>{money(promotion.basePrice)}</del></div>
    <div className="billing-price"><strong>{money(promotion.finalPrice)}</strong><small>/ {period}</small></div>
    <span className="billing-saving">{promotion.kind==='percent'?copy('Giảm')+' '+percentage:copy('Ưu đãi')}
      {' · '}{copy('Tiết kiệm')} {money(promotion.discount)}</span>
  </div>;
}

function previewPromotion(basePrice,rule) {
  if(!rule?.enabled)return null;
  const value=Number(rule.value);
  if(!Number.isSafeInteger(value)||value<1||rule.kind==='percent'&&value>99)return null;
  const discount=rule.kind==='percent'?Math.round(basePrice*value/100):value;
  const finalPrice=basePrice-discount;
  return discount>0&&finalPrice>=1000?{...rule,basePrice,discount,finalPrice}:null;
}

function TermPromotionEditor({prices,rules,setRules}) {
  const {copy,intl}=useDisplayLocale();
  const money=vnd(intl);
  const terms=billingMonths.filter(month=>prices[month]);
  const [active,setActive]=useState(()=>terms.find(month=>rules[month]?.enabled)??terms[0]);
  const id=useId();
  const month=terms.includes(active)?active:terms[0];
  const rule=rules[month]??{kind:'percent',value:20,enabled:false};
  const basePrice=prices[month];
  const update=patch=>setRules({...rules,[month]:{...rule,...patch}});
  const promotion=previewPromotion(basePrice,rule);
  const badTerms=terms.filter(term=>term!==month&&rules[term]?.enabled&&!previewPromotion(prices[term],rules[term]));
  return <fieldset className="billing-resource-choice billing-promotions">
    <legend>{copy('Ưu đãi')}</legend>
    <p className="dim">{copy('Áp dụng cho kỳ mua mới hoặc gia hạn. Page và nhân viên bổ sung tính theo đơn giá riêng.')}</p>
    {!month?<p className="dim">{copy('Đặt giá cho ít nhất một chu kỳ để cấu hình ưu đãi.')}</p>:<div className="billing-promotion-editor">
      <div className="billing-promotion-fields">
        <Field label={copy('Chu kỳ áp dụng')}><select value={month} onChange={event=>setActive(Number(event.target.value))}>
          {terms.map(term=><option key={term} value={term}>{termLabel(term,copy)}{rules[term]?.enabled?' · '+copy('Có ưu đãi'):''}</option>)}
        </select></Field>
        <label className="billing-checkbox"><input type="checkbox" checked={rule.enabled}
          onChange={event=>{
            const enabled=event.target.checked;
            update(!enabled&&!promotion?{enabled,kind:'percent',value:20}:{enabled});
          }}/>{copy('Áp dụng ưu đãi')}</label>
        {rule.enabled&&<>
          <Field label={copy('Hình thức giảm')}><select value={rule.kind} onChange={event=>update({kind:event.target.value,value:''})}>
            <option value="percent">{copy('Theo phần trăm')}</option>
            <option value="fixed">{copy('Theo số tiền')}</option>
          </select></Field>
          <Field label={copy(rule.kind==='percent'?'Mức giảm (%)':'Số tiền giảm (VND)')}>
            <input type="number" inputMode="numeric" min={1} max={rule.kind==='percent'?99:Math.max(1,basePrice-1000)}
              step={1} required value={rule.value} aria-describedby={id} aria-invalid={!promotion}
              onChange={event=>update({value:event.target.value})}/>
          </Field>
          <p id={id} className={promotion?'dim':'formerror'}>{copy('Giá sau ưu đãi phải từ 1.000 đ cho mỗi chu kỳ.')}</p>
        </>}
        {badTerms.length>0&&<p className="formerror" role="alert">
          {copy('Kiểm tra mức giảm của các chu kỳ')} {badTerms.map(term=>termLabel(term,copy)).join(', ')}.
        </p>}
      </div>
      <section className="billing-promotion-preview" aria-live="polite">
        <h3>{copy('Xem trước giá gói')}</h3>
        {promotion?<PromotionPrice {...{promotion,money,copy,intl}} period={termLabel(month,copy)}/>:
          <div className="billing-price"><strong>{money(basePrice)}</strong><small>/ {termLabel(month,copy)}</small></div>}
      </section>
    </div>}
  </fieldset>;
}

function normalizeBilling(result) {
  if(!Array.isArray(result?.plans))throw new Error('Chưa tải được gói dịch vụ.');
  return {...result,plans:result.plans.map(plan=>{
    const agent=plan.agent_mode==='ALWAYS'||plan.agent_mode==='SCHEDULED';
    return {...plan,
      term_prices:plan.term_prices??{},
      feature_flags:{alertSounds:false,...(plan.feature_flags??{
        messages:true,comments:true,agent,quickReplies:true,faq:agent,orders:plan.order_management===true,
      })},
      benefits:plan.benefits??[],
    };
  })};
}

function PlanConfigurator({ plans, shop, months, choose, purchaseBlock, busy }) {
  const {copy,intl}=useDisplayLocale();
  const money=vnd(intl);
  const number=new Intl.NumberFormat(intl,{style:'percent',maximumFractionDigits:1});
  const [code,setCode]=useState('');
  const plan=plans.find(item=>item.code===code)??plans[0];
  const [selection,setSelection]=useState(null);
  const selected=selection?.code===plan?.code?selection:null;
  const pages=selected?.pages??plan?.page_limit;
  const staff=selected?.staff??plan?.staff_limit;
  const period=selected?.months??(plan?.term_prices[months]?months:1);
  const [preview,setPreview]=useState(null);
  const planCode=plan?.code;
  const valid=!!planCode&&Number.isInteger(pages)&&pages>=plan.page_limit&&pages<=100&&
    Number.isInteger(staff)&&staff>=plan.staff_limit&&staff<=200&&!!plan.term_prices[period];
  const key=JSON.stringify([shop,planCode,pages,staff,period]);
  const current=preview?.key===key?preview:null;
  useEffect(()=>{
    if(!valid)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      api('billing/quote','POST',{shop,plan:planCode,selection:{pages,staff,months:period}},controller.signal)
        .then(quote=>{if(!controller.signal.aborted)setPreview({key,quote});})
        .catch(error=>{if(!controller.signal.aborted)setPreview({key,error:error.message});});
    },220);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[key,shop,planCode,pages,staff,period,valid]);
  if(!plan)return null;
  const quote=current?.quote;
  const reviewed={...plan,quote,selection:{pages,staff,months:period},page_limit:pages,staff_limit:staff,duration_days:period*30};
  const reason=quote?.kind==='BLOCKED'?{key:'custom',message:quote.reason}:quote?purchaseBlock(reviewed,true):null;
  const update=(values)=>setSelection({code:plan.code,pages,staff,months:period,...values});
  return <section className="card billing-custom">
    <div>
      <h2>{copy('Tự cấu hình gói')}</h2>
      <p className="dim">{copy('Chọn gói tính năng, hạn mức và chu kỳ phù hợp với Shop.')}</p>
      <div className="form-grid">
        <Field label={copy('Gói tính năng')}><select value={plan.code} onChange={event=>{setCode(event.target.value);setSelection(null);}}>
          {plans.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}
        </select></Field>
        <Field label={copy('Chu kỳ thanh toán')}><select value={period} onChange={event=>update({months:Number(event.target.value)})}>
          {billingMonths.filter(value=>plan.term_prices[value]).map(value=><option key={value} value={value}>{termLabel(value,copy)}</option>)}
        </select></Field>
        <Field label={copy('Tổng số Page/kênh')}><input type="number" min={plan.page_limit} max={100} step={1}
          disabled={!plan.page_addon_vnd} value={Number.isNaN(pages)?'':pages} onChange={event=>update({pages:event.target.valueAsNumber})}/></Field>
        <Field label={copy('Tổng số nhân viên')}><input type="number" min={plan.staff_limit} max={200} step={1}
          disabled={!plan.staff_addon_vnd} value={Number.isNaN(staff)?'':staff} onChange={event=>update({staff:event.target.valueAsNumber})}/></Field>
      </div>
      <p className="dim">{copy('Page và nhân viên ngoài hạn mức tính theo đơn giá tháng nhân số tháng.')}</p>
    </div>
    <div className="billing-custom-summary" aria-live="polite">
      <h3>{copy('Tóm tắt thanh toán')}</h3>
      {!valid?<p>{copy('Hãy chọn số Page và nhân viên trong phạm vi cho phép.')}</p>:current?.error?<p role="alert">{copy(current.error)}</p>:
        !quote?<p>{copy('Đang tính báo giá…')}</p>:quote.kind==='BLOCKED'?<p>{copy(quote.reason)}</p>:<>
        <div><span>{copy('Giá gói')}</span><strong>{money(quote.promotion?.basePrice??(quote.listPrice-(quote.upgrade?quote.addonMonthly:quote.addonMonthly*period)))}</strong></div>
        {quote.promotion&&<div><span>{copy('Ưu đãi')}</span><strong>−{money(quote.promotion.discount)}</strong></div>}
        <div><span>{copy('Phần bổ sung')}</span><strong>{money(quote.upgrade?quote.addonMonthly:quote.addonMonthly*period)}</strong></div>
        {quote.upgrade?<p className="dim">{copy('Nâng gói áp dụng cho số ngày còn lại của kỳ hiện tại.')}</p>:
          quote.savings>0&&<div><span>{copy('Tiết kiệm so với trả từng tháng')}</span><strong>{money(quote.savings)} ({number.format(quote.savingsPercent/100)})</strong></div>}
        <div className="billing-custom-total"><span>{copy('Số tiền cần trả')}</span><strong>{money(quote.amount)}</strong></div>
      </>}
      <Button variant="primary" disabled={busy||!quote||quote.kind==='BLOCKED'} onClick={()=>choose(reviewed,reason)}>
        {copy('Xem và xác nhận')}
      </Button>
    </div>
  </section>;
}

const orderStatuses={PENDING:'Chờ thanh toán',PAID:'Đã thanh toán',REVIEW:'Cần đối soát',EXPIRED:'Hết hạn mã QR',CANCELLED:'Đã hủy mã QR',SCHEDULED:'Đã trả tiền · Chờ đổi gói'};
const statusClass={PAID:'replied',REVIEW:'review',PENDING:'active',EXPIRED:'off',CANCELLED:'off',SCHEDULED:'active'};
const clock=(minutes)=>Number.isInteger(minutes)?
  String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0'):'';
function agentHours(plan,copy) {
  if(plan.agent_mode==='ALWAYS')return copy("Cả ngày (24/24)");
  if(plan.agent_mode==='SCHEDULED'){
    const end=clock(plan.agent_end)+(plan.agent_end<plan.agent_start?copy(" hôm sau"):'');
    return clock(plan.agent_start)+'–'+end+copy(" mỗi ngày");
  }
  return copy("Không bao gồm");
}


function Checkout({ order, close }) {
  const {intl,copy}=useDisplayLocale();
  const money=vnd(intl);
  const {checkout}=order;
  const topup=order.kind==='TOKEN_TOPUP';
  const number=new Intl.NumberFormat(intl);
  const [copied,setCopied]=useState('');
  async function copyToClipboard(value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied('Đã sao chép.');
    }catch{setCopied('Hãy chọn và sao chép trực tiếp trong thông tin bên dưới.');}
  }
  return <Dialog title={topup?copy("Thanh toán nạp token"):copy("Thanh toán gói ")+order.plan_name} close={close}>
    <p role="status"><Chip status={statusClass[order.status]}>{copy(orderStatuses[order.status])}</Chip></p>
    {topup&&<p><strong>{number.format(order.tokens)} token</strong></p>}
    {checkout&&<div className="billing-checkout">
      <div className="billing-qr"><img src={checkout.qr} width={208} height={208} alt={copy("Mã VietQR thanh toán ")+order.id}
        referrerPolicy="no-referrer"/><small>{copy("Dùng ứng dụng ngân hàng để quét mã")}</small></div>
      <dl>
        <dt>{copy("Ngân hàng")}</dt><dd>{checkout.bank}</dd>
        <dt>{copy("Tài khoản nhận")}</dt><dd>{checkout.account} <Button onClick={()=>copyToClipboard(checkout.account)}>{copy("Sao chép")}</Button></dd>
        <dt>{copy("Chủ tài khoản")}</dt><dd>{checkout.name}</dd>
        <dt>{copy("Số tiền")}</dt><dd><strong>{money(order.price_vnd)}</strong></dd>
        <dt>{copy("Nội dung chuyển khoản")}</dt><dd><strong>{order.id}</strong> <Button onClick={()=>copyToClipboard(order.id)}>{copy("Sao chép")}</Button></dd>
      </dl>
      <p className="dim">{copy("Mã hết hạn lúc")} {formatDate(order.expires_at,intl)}{topup?copy(". Token sẽ vào ví khi SePay xác nhận đã nhận tiền."):copy(". Gói sẽ tự kích hoạt khi SePay báo đã nhận tiền.")}</p>
    </div>}
    {order.promotion&&<p className="dim">{copy('Giá cũ')} <del>{money(order.promotion.originalTotal)}</del>
      {' · '}{copy('Tiết kiệm')} {money(order.promotion.discount)}</p>}
    {copied&&<p role="status" className="dim">{copy(copied)}</p>}
    {order.status==='PENDING'&&order.upgrade&&<p>{copy("Sau khi nâng gói, hạn sử dụng là")} <strong>{formatDate(order.upgrade.endsAt,intl)}</strong>.</p>}
    {order.status==='PAID'&&topup&&<p role="status">{copy('Đã cộng token vào ví của Shop.')}</p>}
    {order.status==='PAID'&&!topup&&<p>{copy("Gói đã kích hoạt đến")} <strong>{formatDate(order.subscription_until,intl)}</strong>.</p>}
    {order.status==='SCHEDULED'&&<p>{copy("Gói mới dự kiến bắt đầu vào")} <strong>{formatDate(order.starts_at,intl)}</strong>.</p>}
    {order.status==='CANCELLED'&&<p className="notice">{copy(order.review_reason)}</p>}
    {order.status==='REVIEW'&&<p className="notice">{copy(order.review_reason)} {copy("Liên hệ quản trị viên và cung cấp mã")} {order.id}.</p>}
    {order.status==='EXPIRED'&&<p>{copy("Mã thanh toán đã hết hạn. Nếu đã chuyển khoản, hãy đợi đối soát trước khi tạo đơn mới.")}</p>}
    <div className="action-row"><Button onClick={close}>{copy("Đóng")}</Button></div>
  </Dialog>;
}

function WalletOrders({orders,orderPage,onPage,view,admin=false}) {
  const {copy,intl}=useDisplayLocale();
  const money=vnd(intl);
  const number=new Intl.NumberFormat(intl);
  return <div className="shop-table">
    {!orders.length?<Empty>{copy('Chưa có đơn nạp token.')}</Empty>:<table>
      <thead><tr><th>{copy('Mã thanh toán')}</th>{admin&&<th>Shop</th>}<th>Token</th>
        <th>{copy('Số tiền')}</th><th>{copy('Trạng thái')}</th><th>{admin?copy('Giao dịch SePay'):copy('Chi tiết')}</th></tr></thead>
      <tbody>{orders.map(order=>{
        const status=order.status==='PENDING'&&order.expires_at<=Date.now()?'EXPIRED':order.status;
        return <tr key={order.id}>
          <td>{order.id}<small>{formatDate(order.created_at,intl)}</small></td>
          {admin&&<td>{order.shop_name}</td>}<td>{number.format(order.tokens)}</td><td>{money(order.price_vnd)}</td>
          <td><Chip status={statusClass[status]}>{copy(orderStatuses[status])}</Chip>
            {order.review_reason&&<small>{copy(order.review_reason)}</small>}</td>
          <td>{admin?(order.receipts.length?order.receipts.map(receipt=><small key={receipt.id}>
            #{receipt.id} · {money(receipt.amount)} · {copy(receipt.outcome==='REVIEW'?'Cần đối soát':'Đã nhận')}
            {receipt.reference?' · '+receipt.reference:''}</small>):'—'):
            <Button onClick={()=>view(order)}>{copy('Xem đơn')}</Button>}</td>
        </tr>;
      })}</tbody>
    </table>}
    {orderPage&&<ListPagination {...orderPage} onChange={onPage}/>}
  </div>;
}

export function TokenWallet({shop,usage,refreshUsage,applyReset,readOnly=false}) {
  const {copy,intl}=useDisplayLocale();
  const number=new Intl.NumberFormat(intl);
  const money=vnd(intl);
  const [summary,setSummary]=useState(null);
  const [page,setPage]=useState(1);
  const [dialog,setDialog]=useState('');
  const [order,setOrder]=useState(null);
  const [error,setError]=useState('');
  const [resetConfirmed,setResetConfirmed]=useState(false);
  const load=useCallback(async(signal)=>{
    const next=await api('billing/token-wallet?'+new URLSearchParams({shop,page}),'GET',undefined,signal);
    if(!signal?.aborted)setSummary(next);
  },[shop,page]);
  useEffect(()=>{
    const controller=new AbortController();
    load(controller.signal).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[load]);
  const id=order?.id;
  const pending=order?.status==='PENDING';
  useEffect(()=>{
    if(!id||!pending)return;
    const controller=new AbortController();
    let checking=false;
    const timer=setInterval(async()=>{
      if(checking||document.hidden)return;
      checking=true;
      try{
        const next=await api('billing/token-wallet/orders/'+id+'?'+new URLSearchParams({shop}),'GET',undefined,controller.signal);
        if(controller.signal.aborted)return;
        if(next.status!=='PENDING')await Promise.all([load(controller.signal),refreshUsage?.(controller.signal)]);
        if(!controller.signal.aborted)setOrder(current=>current?.id===id?next:current);
      }catch(error){if(!controller.signal.aborted)setError(error.message);}
      finally{checking=false;}
    },3000);
    return ()=>{clearInterval(timer);controller.abort();};
  },[shop,id,pending,load,refreshUsage]);
  const snapshot=usage??summary?.usage;
  const offer=summary?.offer;
  const depleted=!readOnly&&snapshot?.limitDepleted;
  const visible=snapshot?.walletTokens>0||depleted;
  const canReset=depleted&&snapshot.canReset;
  const canBuy=depleted&&snapshot.canTopup;
  const pendingCheckout=canBuy&&summary?.pending?.expires_at>Date.now();
  useEffect(()=>{
    if((dialog==='buy'&&!canBuy)||(dialog==='reset'&&!canReset))setDialog('');
  },[dialog,canBuy,canReset]);
  return <>
    {visible&&<section className="card ai-usage">
      <CardHead title={copy('Ví token AI')}/>
      <div className="ai-usage-layout">
        <div className="ai-usage-window">
          <div className="ai-usage-label"><strong>{copy('Token đang sở hữu')}</strong>
            <b>{number.format(snapshot.walletTokens??0)}</b></div>
          <small className="dim">{copy(readOnly
            ?'Số dư được giữ lại và có thể dùng tiếp khi Shop có gói Agent đang hoạt động.'
            :'Token trong ví không hết hạn. Dùng khi hạn mức gói không còn đủ và Shop đã hết lượt đặt lại.')}</small>
        </div>
        {!readOnly&&snapshot.available&&<div className="ai-usage-window">
          <div className="ai-usage-label"><strong>{copy('Lượt đặt lại còn lại')}</strong>
            <b>{number.format(snapshot.resetsLeft??0)}</b></div>
          {snapshot.resetsAt&&<small className="dim">{copy('Cấp lại lượt vào')} {formatDate(snapshot.resetsAt,intl)}</small>}
        </div>}
      </div>
      {(canReset||canBuy)&&<div className="action-row ai-wallet-actions">
        {canReset&&<Button onClick={()=>setDialog('reset')}>{copy('Đặt lại hạn mức')}</Button>}
        {canBuy&&(pendingCheckout?<Button variant="primary" onClick={()=>setOrder(summary.pending)}>{copy('Mở đơn đang chờ')}</Button>:
          <Button variant="primary" disabled={!offer||!summary?.sepayReady}
            onClick={()=>setDialog('buy')}>{copy('Nạp token qua SePay')}</Button>)}
      </div>}
      {canBuy&&summary&&!pendingCheckout&&(!offer||!summary.sepayReady)&&<p className="dim ai-wallet-help">
        {copy(!offer?'Nạp token hiện chưa mở bán.':'Thanh toán SePay chưa được cấu hình.')}</p>}
      {error&&<p role="alert" className="notice">{copy(error)}</p>}
      {summary&&<details className="ai-wallet-history"><summary>{copy('Lịch sử nạp token')}</summary>
        <WalletOrders {...summary} onPage={setPage} view={setOrder}/></details>}
    </section>}
    {resetConfirmed&&!snapshot?.blocked&&<p role="status" className="notice agent-reset-confirmation">
      {copy('Đã đặt lại hạn mức. Agent có thể xử lý tin nhắn mới theo cấu hình của kênh.')}</p>}
    {dialog==='reset'&&canReset&&<Dialog title={copy('Đặt lại hạn mức')} label={copy('Dùng một lượt đặt lại')}
      close={()=>setDialog('')} submit={async()=>{
        const updated=await api('billing/token-wallet/reset','POST',{shop});
        applyReset(updated);
        setResetConfirmed(true);
        void refreshUsage().catch(()=>{});
      }}><p>{copy('Khôi phục hạn mức dự trữ tương đương cho khung đã hết. Thời điểm làm mới tự động không thay đổi.')}</p></Dialog>}
    {dialog==='buy'&&canBuy&&offer&&<Dialog title={copy('Nạp token qua SePay')} label={copy('Tạo mã thanh toán')}
      close={()=>setDialog('')} submit={async()=>{
        const next=await api('billing/token-wallet/orders','POST',{shop},undefined,offer.version);
        setOrder(next);
        void load().catch(()=>{});
      }}>
      <p><strong>{number.format(offer.tokens)} token</strong> · {money(offer.price_vnd)}</p>
      <p className="dim">{copy('SePay xác nhận chuyển khoản rồi hệ thống cộng token vào ví của Shop.')}</p>
      <p className="dim">{copy('Số dư được giữ lại và có thể dùng tiếp khi Shop có gói Agent đang hoạt động.')}</p>
    </Dialog>}
    {order&&<Checkout key={order.id} order={canBuy?order:{...order,checkout:undefined}}
      close={()=>{setOrder(null);void load().catch(()=>{});}}/>}
  </>;
}

function AdminTokenWallet(){
  const {copy,intl}=useDisplayLocale();
  const money=vnd(intl);
  const [data,setData]=useState(null);
  const [editing,setEditing]=useState(null);
  const [error,setError]=useState('');
  const [page,setPage]=useState(1);
  const load=useCallback(async(signal)=>{
    const next=await api('admin/billing/token-wallet?'+new URLSearchParams({page}),'GET',undefined,signal);
    if(!signal?.aborted)setData(next);
  },[page]);
  useEffect(()=>{
    const controller=new AbortController();
    load(controller.signal).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[load]);
  return <section className="card ai-usage">
    <CardHead title={copy('Cấu hình nạp token')} action={<Button disabled={!data} onClick={()=>setEditing(data.settings)}>{copy('Chỉnh sửa giá nạp')}</Button>}/>
    {data&&<p className="dim">{copy(data.settings.enabled?'Đang mở bán':'Chưa mở bán')} · {new Intl.NumberFormat(intl).format(data.settings.tokens)} token · {money(data.settings.price_vnd)}</p>}
    {error&&<p role="alert" className="notice">{copy(error)}</p>}
    {data&&<details className="ai-wallet-history"><summary>{copy('Đơn nạp token')}</summary>
      <WalletOrders {...data} onPage={setPage} admin/></details>}
    {editing&&<Dialog title={copy('Cấu hình nạp token')} close={()=>setEditing(null)}
      submit={async(form)=>{
        await api('admin/billing/token-wallet','PATCH',{enabled:form.has('enabled'),tokens:Number(form.get('tokens')),
          price_vnd:Number(form.get('price_vnd'))},undefined,editing.version);
        await load();
      }}>
      <label className="check"><input type="checkbox" name="enabled" defaultChecked={editing.enabled}/>{copy('Mở bán token nạp thêm')}</label>
      <div className="form-grid">
        <Field label={copy('Số token mỗi lần nạp')}><input name="tokens" type="number" min="1" max="1000000000" required defaultValue={editing.tokens}/></Field>
        <Field label={copy('Giá mỗi lần nạp (VNĐ)')}><input name="price_vnd" type="number" min="1000" max="999999999" required defaultValue={editing.price_vnd}/></Field>
      </div>
    </Dialog>}
  </section>;
}

export function ServicePlans({ state, refreshWorkspace, notify, go, accessRevision }) {
  const {copy,t,locale,intl,translatedContent}=useDisplayLocale();
  const money=vnd(intl);
  const number=new Intl.NumberFormat(intl);
  const owned=(state.shops??[]).filter((shop)=>shop.role==='OWNER'&&(!state.activeShopId||state.activeShopId===shop.id));
  const [selected,setSelected]=useState(()=>owned.find((shop)=>shop.id===state.activeShopId)?.id??owned[0]?.id);
  const shop=owned.find(({id})=>id===selected)?.id??owned[0]?.id;
  const [data,setData]=useState(null), [order,setOrder]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const [offer,setOffer]=useState(null);
  const [historyPage,setHistoryPage]=useState(1);
  const [planIndex,setPlanIndex]=useState(0);
  const [months,setMonths]=useState(1);
  const carouselId=useId();
  const details=shop&&data?.shop?.id===shop?data:null;
  const plans=[...(details?.plans??[])].sort((a,b)=>a.tier-b.tier);
  const lastPlanIndex=Math.max(0,plans.length-3);
  const hasMorePlans=lastPlanIndex>0;
  const currentPlanIndex=Math.min(planIndex,lastPlanIndex);
  useEffect(()=>{setPlanIndex(0);setMonths(1);setHistoryPage(1);setOrder(null);setOffer(null);},[shop]);
  useEffect(()=>{setPlanIndex((index)=>Math.min(index,lastPlanIndex));},[lastPlanIndex]);
  const path='billing?'+new URLSearchParams({shop,page:historyPage});
  const load=useCallback(async(signal)=>{
    const result=await api(path,'GET',undefined,signal);
    if(!signal?.aborted)setData(normalizeBilling(result));
  },[path]);
  useEffect(()=>{
    if(!shop)return;
    const controller=new AbortController();
    setError('');
    load(controller.signal).catch((error)=>{if(!controller.signal.aborted)setError(error.message);});
    const refresh=()=>{if(!document.hidden)load(controller.signal).catch(()=>{});};
    const timer=setInterval(refresh,15_000);
    window.addEventListener('focus',refresh);
    return ()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[shop,load,accessRevision]);

  const scheduledAt=data?.scheduled?.starts_at;
  useEffect(()=>{
    if(!scheduledAt)return;
    const controller=new AbortController();
    const timer=setInterval(()=>{
      if(Date.now()>=scheduledAt)load(controller.signal).catch(()=>{});
    },5000);
    return ()=>{clearInterval(timer);controller.abort();};
  },[scheduledAt,load]);

  const orderId=order?.id;
  const payable=['PENDING','EXPIRED','SCHEDULED'].includes(order?.status);
  useEffect(()=>{
    if(!payable||!orderId)return;
    const controller=new AbortController();
    let checking=false;
    async function check() {
      if(checking)return;
      checking=true;
      try {
        const next=await api('billing/orders/'+orderId+'?'+new URLSearchParams({shop}),'GET',undefined,controller.signal);
        if(controller.signal.aborted)return;
        setOrder(next);
        if(next.status==='REVIEW')notify({id:'payment-review:'+next.id,title:'Thanh toán cần đối soát',
          message:(next.review_reason??'Cần kiểm tra giao dịch.')+' Mã thanh toán '+next.id+'.',
          action:{view:'billing',label:'Xem gói dịch vụ'}},{repeat:false});
        if(['PAID','REVIEW','SCHEDULED','CANCELLED'].includes(next.status)){
          await load(controller.signal);
          if(next.status==='PAID'&&!controller.signal.aborted)await refreshWorkspace();
        }
      }catch(error){if(!controller.signal.aborted)setError(error.message);}
      finally{checking=false;}
    }
    const timer=setInterval(check,3000);
    return ()=>{clearInterval(timer);controller.abort();};
  },[shop,orderId,payable,load,refreshWorkspace,notify]);

  async function buy(plan) {
    setBusy(true);setError('');
    try {
      const next=await api('billing/orders','POST',{shop,plan:plan.code,expectedPrice:plan.quote.amount,expectedEndsAt:plan.quote.upgrade?.endsAt??null,selection:plan.selection});
      setOffer(null);
      setOrder(next);
      void load().catch(()=>{});
      if(next.status==='PAID')void refreshWorkspace().catch(()=>{});
    }catch(error){
      notify({id:'checkout:'+shop+':'+plan.code,title:'Chưa thể thanh toán gói '+plan.name,message:error.message});
      if(error.status===409)void load().catch(()=>{});
    }finally{setBusy(false);}
  }

  async function openOrder(id) {
    setBusy(true);setError('');
    try{setOrder(await api('billing/orders/'+id+'?'+new URLSearchParams({shop})));}
    catch(error){setError(error.message);}
    finally{setBusy(false);}
  }

  const expires=details?.shop.expiresAt;
  const elapsed=expires!==null&&expires!==undefined&&expires<=Date.now();
  const needsPage=details&&details.usage.linkedPages===0;
  const over=details&&(details.usage.pages>details.limits.pages||
    details.usage.staff+details.usage.invitations>details.limits.staff);
  async function choosePlan(plan,reason) {
    if(!reason){
      setBusy(true);
      try {
        const quote=await api('billing/quote','POST',{shop,plan:plan.code,selection:plan.selection});
        const reviewed={...plan,quote};
        const block=quote.kind==='BLOCKED'?{key:'quote',message:quote.reason}:purchaseBlock(reviewed,true);
        if(block){await choosePlan(plan,block);return;}
        setOffer(reviewed);
      }catch(error){notify({id:'billing-quote:'+shop+':'+plan.code,title:copy('Chưa thể lấy báo giá'),message:error.message});}
      finally{setBusy(false);}
      return;
    }
    notify({id:'billing:'+shop+':'+plan.code+':'+reason.key,
      title:'Chưa thể đăng ký gói '+plan.name,titleSource:'Chưa thể đăng ký gói ',titleSuffix:plan.name,message:reason.message,action:reason.action});
  }
  function purchaseBlock(plan,fits) {
    if(details.shop.status!=='ACTIVE')return {key:'locked',message:'Shop đang bị khóa. Liên hệ quản trị viên để mở khóa.'};
    if(!plan.available||!plan.quote)return {key:'unavailable',message:'Gói này hiện chưa mở bán.'};
    if(needsPage)return {key:'link',message:'Hãy liên kết ít nhất một Page hoặc kênh trước khi đăng ký gói.',
      action:elapsed?null:{view:'channels',shopId:shop,label:'Quản lý kênh'}};
    if(details.scheduled)return {key:'scheduled',message:'Shop đã có gói chờ chuyển vào '+formatDate(details.scheduled.starts_at,intl)+'.'};
    if(!fits)return {key:'limit',
      message:'Gói này không đủ chỗ cho số Page hoặc nhân viên đang dùng. Hãy chọn gói cao hơn hoặc giảm số tài nguyên đang hoạt động.'};
    if(!details.sepayReady&&plan.quote.amount>0)return {key:'sepay',message:'Thanh toán SePay chưa được cấu hình. Liên hệ quản trị viên để được hỗ trợ.'};
    return null;
  }
  return <>
    <Title title={copy("Gói dịch vụ")} subtitle={t('planHelp')}/>
    {owned.length>1&&<div className="toolbar"><label htmlFor="billing-shop">{t('billingShop')}</label>
      <select id="billing-shop" disabled={busy} value={shop} onChange={(event)=>setSelected(event.target.value)}>
        {owned.map(({id,name})=><option key={id} value={id}>{name}</option>)}</select></div>}
    {error&&<p className="notice" role="alert">{copy(error)}</p>}
    {!details&&<Empty>{shop?(error?copy("Chưa tải được gói dịch vụ."):copy("Đang tải gói dịch vụ…")):copy("Bạn chưa sở hữu Shop.")}</Empty>}
    {details&&<>
      <section className="billing-summary" aria-label={t('shopLimits')}>
        <div><strong>{owned.find(({id})=>id===shop)?.name}</strong>
          <span>{planDisplayName(locale,details.shop.plan,details.shop.planName)}{details.shop.planArchived?copy(" · Ngừng bán"):''}</span>
          <span>{details.shop.status==='SUSPENDED'?copy("Shop đang bị khóa"):elapsed?copy("Gói đã hết hạn"):expires?(copy("Có hiệu lực đến ")+formatDate(expires,intl)):copy("Gói không thời hạn")}</span></div>
        <div><strong>{details.usage.pages}/{details.limits.pages}</strong><span>{t('usedChannels')}</span></div>
        <div><strong>{details.usage.staff+details.usage.invitations}/{details.limits.staff}</strong><span>{t('staffSlots')}{details.usage.invitations>0?copy(" · gồm lời mời chờ"):''}</span></div>
      </section>
      {over&&<div className="notice workspace-quota" role="alert">
        {copy("Shop vượt hạn mức hiện tại. Hãy chọn Page và nhân viên cần giữ hoặc mua gói đủ chỗ để tiếp tục.")}
        <Button onClick={()=>go('channels')}>{copy("Mở Quản lý kênh")}</Button>

      </div>}
      {details.scheduled&&<p className="notice">{copy("Gói")} {details.scheduled.plan_name} {copy("đã thanh toán và dự kiến bắt đầu vào")} {formatDate(details.scheduled.starts_at,intl)}.</p>}
      <div className="billing-options-heading billing-period-heading"><h2>{t('planOptions')}</h2>
        <div className="billing-periods" role="group" aria-label={copy('Chu kỳ thanh toán')}>
          {billingMonths.map(period=><Button key={period} aria-pressed={months===period} disabled={busy}
            variant={months===period?'primary':''} onClick={()=>setMonths(period)}>{termLabel(period,copy)}</Button>)}
        </div>
      </div>
      {plans.some(plan=>plan.aiAllowance?.['5h']>0)&&<p className="dim">{copy('Bậc AI càng cao thì hạn mức càng lớn.')}</p>}
      {plans.length===0?<Empty>{copy('Chưa có gói dịch vụ.')}</Empty>:<section className={hasMorePlans?'billing-carousel with-arrows':'billing-carousel'}
        aria-label={t('comparePlans')} aria-roledescription={hasMorePlans?'carousel':undefined}>
      {hasMorePlans&&<Button icon="left" className="button billing-carousel-arrow" aria-label={t('lowerPlans')}
        aria-controls={carouselId} disabled={currentPlanIndex===0}
        onClick={()=>setPlanIndex((index)=>Math.max(0,index-1))}/>}
      <div className="billing-grid" id={carouselId}>{plans.slice(currentPlanIndex,currentPlanIndex+3).map((plan,index)=>{
        const free=plan.code==='FREE';
        const current=details.shop.plan===plan.code&&!elapsed;
        const previous=plans[currentPlanIndex+index-1];
        const termPrice=plan.term_prices[months];
        const legacy=months===1&&plan.price_vnd&&!Object.keys(plan.term_prices).length;
        const shownPrice=termPrice??(legacy?plan.price_vnd:null);
        const savings=termPrice?discount(plan,months):0;
        const promotion=plan.termOffers?.[months];
        const purchase={...plan,quote:shownPrice?plan.quote:null,
          duration_days:termPrice?months*30:plan.duration_days,
          selection:termPrice?{months,pages:plan.page_limit,staff:plan.staff_limit}:undefined};
        const fits=details.usage.pages<=plan.page_limit&&details.usage.staff+details.usage.invitations<=plan.staff_limit;
        const blocked=purchase.quote?.kind==='BLOCKED';
        const reason=free||blocked?null:purchaseBlock(purchase,fits);
        const action=t({RENEW:'renewPlan',UPGRADE:'upgradePlan'}[plan.quote?.kind]??'buyPlan');
        const period=free?t('noExpiration'):legacy?t('days',{count:number.format(plan.duration_days)}):termLabel(months,copy);
        const capacity=[['channels',plan.page_limit,'Page/kênh',previous?.page_limit],
          ['user',plan.staff_limit,'chỗ nhân viên',previous?.staff_limit]];
        return <article className={'billing-plan billing-plan-'+plan.code.toLowerCase()} key={plan.code}>
          <div className="billing-plan-top"><h3>{planDisplayName(locale,plan.code,plan.name)}</h3>
            {current&&<span className="billing-current"><Icon name="check"/> {t('inUse')}</span>}
          </div>
          {promotion?<PromotionPrice {...{promotion,period,money,copy,intl}}/>:
          <div className="billing-price"><strong>{free?money(0):shownPrice?money(shownPrice):copy("Chưa công bố")}</strong>
            <small>{free?period:'/ '+period}</small>
            {termPrice&&months>1&&<span className="billing-saving">{copy('Tiết kiệm')} {number.format(Math.round(savings*1000)/10)}%</span>}</div>}
          <p className="billing-description">{translatedContent('p:'+plan.code+':description',plan.description)}</p>
          <div className="billing-plan-action">{free?<span className="billing-included">{t(current?'currentPlan':'defaultPlan')}</span>:
            blocked?<span className="billing-included">{copy(plan.quote.reason)}</span>:<Button variant={reason?'':'primary'} data-restricted={reason?'true':undefined}
              aria-label={action+' '+planDisplayName(locale,plan.code,plan.name)} disabled={busy} onClick={()=>choosePlan(purchase,reason)}>
              {action}<Icon name={reason?'lock':'arrow'}/>
            </Button>}
          </div>
          <div className="billing-plan-includes">
            <h4>{previous?t('planLimits',{plan:planDisplayName(locale,plan.code,plan.name)}):t('baseLimits')}</h4>
            <ul>
              {capacity.map(([icon,value,label,before])=><li key={icon}><Icon name={icon}/>
                <span><strong>{value}</strong> {copy(label)}</span>
                {before!==undefined&&value!==before&&<small>{value>before?'+':''}{value-before} {copy("so với")} {planDisplayName(locale,previous.code,previous.name)}</small>}
              </li>)}
              {planFeatures.filter(([key])=>key!=='alertSounds'||plan.feature_flags.alertSounds===true).map(([key,label])=><li key={key} className={plan.feature_flags[key]?'':'billing-feature-off'}>
                <Icon name={plan.feature_flags[key]?'check':'x'}/>
                <span>{copy(label)}{key==='agent'&&plan.feature_flags.agent?' · '+agentHours(plan,copy):''}</span>
                {!plan.feature_flags[key]?<small>{copy('Không bao gồm')}</small>:
                  previous&&!previous.feature_flags[key]?<small>{copy("Thêm so với")} {planDisplayName(locale,previous.code,previous.name)}</small>:null}
              </li>)}
              {plan.aiAllowance&&Object.entries(allowanceLabels).map(([kind,label])=><li key={kind}>
                <Icon name="bot"/><span>{copy(label)}</span>
                <small>{plan.aiAllowance[kind]?copy('Bậc')+' '+number.format(plan.aiAllowance[kind]):copy('Không có')}</small>
              </li>)}
              {plan.ai_reset_limit>0&&<li><Icon name="bot"/><span>{copy('Lượt đặt lại hạn mức mỗi tuần')}</span>
                <small>{number.format(plan.ai_reset_limit)}</small></li>}
              {plan.benefits.map((benefit,index)=><li key={index}><Icon name="check"/>
                <span><strong>{translatedContent('p:'+plan.code+':name:'+index,benefit.name)}</strong>{benefit.description&&' · '+translatedContent('p:'+plan.code+':detail:'+index,benefit.description)}</span>
                {previous&&!previous.benefits.some((item)=>item.name.toLowerCase()===benefit.name.toLowerCase())&&
                  <small>{copy("Thêm so với")} {planDisplayName(locale,previous.code,previous.name)}</small>}
              </li>)}
            </ul>
          </div>
        </article>;
      })}</div>
      {hasMorePlans&&<>
        <Button icon="right" className="button billing-carousel-arrow" aria-label={t('higherPlans')}
          aria-controls={carouselId} disabled={currentPlanIndex===lastPlanIndex}
          onClick={()=>setPlanIndex((index)=>Math.min(lastPlanIndex,index+1))}/>
        <span className="billing-carousel-status" role="status">
          {copy("Gói")} {currentPlanIndex+1}–{currentPlanIndex+3} / {plans.length}
        </span>
      </>}
      </section>}
      <PlanConfigurator key={shop+':'+months} plans={plans.filter(plan=>plan.available&&plan.term_prices[1]&&(plan.page_addon_vnd||plan.staff_addon_vnd))}
        {...{shop,months,busy,purchaseBlock}} choose={choosePlan}/>
      {details.plans.some((plan)=>plan.agent_mode==='SCHEDULED')&&<p className="dim billing-agent-note">
        {copy("Lịch agent tính theo giờ Việt Nam. Tin nhắn và bình luận đến ngoài ca vẫn được lưu để shop xử lý thủ công. Khi mở ca, agent xử lý tương tác mới và không tự trả lời hàng loạt tin cũ.")}
      </p>}
      <section className="card shop-table"><h2 className="billing-table-heading">{t('paymentHistory')}</h2>
        {!details.orders.length?<Empty>{copy("Chưa có đơn thanh toán.")}</Empty>:<table>
          <thead><tr><th>{copy("Mã thanh toán")}</th><th>{copy("Gói")}</th><th>{copy("Số tiền")}</th><th>{t('status')}</th><th>{copy("Ngày tạo")}</th><th></th></tr></thead>
          <tbody>{details.orders.map((entry)=><tr key={entry.id}><td>{entry.id}</td><td>{planDisplayName(locale,entry.plan_code,entry.plan_name)}</td>
            <td>{money(entry.price_vnd)}</td><td><Chip status={statusClass[entry.status]}>{copy(orderStatuses[entry.status])}</Chip></td>
            <td>{formatDate(entry.created_at,intl)}</td><td><Button disabled={busy} onClick={()=>openOrder(entry.id)}>{entry.status==='PENDING'?copy("Mở mã QR"):copy("Xem chi tiết")}</Button></td></tr>)}</tbody>
        </table>}
        {details.ordersPage&&<ListPagination {...details.ordersPage} onChange={setHistoryPage}/>}
      </section>
    </>}
    {offer&&<Dialog title={offer.name+copy(" · Xác nhận đổi gói")} close={()=>setOffer(null)} submit={()=>buy(offer)}
      label={offer.quote.amount?copy("Tiếp tục thanh toán"):copy("Xác nhận kích hoạt")}>
      <section className="billing-change-details">
        <p>{copy("Giá niêm yết")} <strong>{money(offer.quote.promotion?.originalTotal??offer.quote.listPrice)}</strong></p>
        {offer.quote.promotion&&<p>{copy('Ưu đãi')} <strong>−{money(offer.quote.promotion.discount)}</strong></p>}
        {offer.quote.upgrade&&<>
          <p>{copy("Chênh lệch cho")} {offer.quote.upgrade.remainingDays} {copy("ngày còn lại")} <strong>{money(offer.quote.upgrade.differenceVnd)}</strong></p>
          <p>{copy("Phí nâng gói (")}{offer.quote.upgrade.feeBps/100}%) <strong>+{money(offer.quote.upgrade.feeVnd)}</strong></p>
        </>}
        <p>{copy("Số tiền cần trả")} <strong>{money(offer.quote.amount)}</strong></p>
        {offer.quote.upgrade?<>
          <p>{copy("Gói mới có hiệu lực sau khi xác nhận và dùng đến")} <strong>{formatDate(offer.quote.upgrade.endsAt,intl)}</strong>.</p>
          <p>{copy("Shop giữ các Page và nhân viên đang có. Hạn mức gói mới là")} {offer.page_limit} {copy("Page và")} {offer.staff_limit} {copy("chỗ nhân viên.")}</p>
        </>:<p>{offer.quote.kind==='RENEW'?copy("Cộng thêm ")+offer.duration_days+copy(" ngày vào kỳ đang dùng."):
          copy("Kỳ mới ")+offer.duration_days+copy(" ngày bắt đầu khi kích hoạt.")}</p>}
      </section>
    </Dialog>}
    {order&&<Checkout key={order.id} order={order} close={()=>setOrder(null)}/>}
  </>;
}

const hours=Array.from({length:24},(_,hour)=>hour);
const minutes=Array.from({length:60},(_,minute)=>minute);
const schedulePresets=[['Ban ngày',360,1140],['Giờ hành chính',480,1020],['Qua đêm',1140,360]];

function AgentTimeSelect({label,value,onChange,errorId,hourLabel,minuteLabel,minuteRef}) {
  const hour=Math.floor(value/60);
  const minute=value%60;
  return <fieldset className="billing-agent-time">
    <legend>{label}</legend>
    <div className="billing-agent-time-parts">
      <Field label={hourLabel}><select value={hour} onChange={(event)=>onChange(Number(event.target.value)*60+minute)}>
        {hours.map((option)=><option value={option} key={option}>{String(option).padStart(2,'0')}</option>)}
      </select></Field>
      <Field label={minuteLabel}><select ref={minuteRef} value={minute} aria-invalid={errorId?true:undefined}
        aria-describedby={errorId} onChange={(event)=>onChange(hour*60+Number(event.target.value))}>
        {minutes.map((option)=><option value={option} key={option}>{String(option).padStart(2,'0')}</option>)}
      </select></Field>
    </div>
  </fieldset>;
}

function AgentScheduleEditor({plan,enabled}) {
  const {copy}=useDisplayLocale();
  const id=useId();
  const [mode,setMode]=useState(plan.agent_mode==='SCHEDULED'?'SCHEDULED':'ALWAYS');
  const [start,setStart]=useState(plan.agent_start??360);
  const [end,setEnd]=useState(plan.agent_end??1140);
  const endMinute=useRef(null);
  const scheduled=enabled&&mode==='SCHEDULED';
  const error=scheduled&&start===end?copy('Giờ kết thúc phải khác giờ bắt đầu. Chọn Cả ngày để Agent chạy 24/24.'):'';
  useEffect(()=>{endMinute.current?.setCustomValidity(error);},[error,scheduled]);

  if(!enabled)return null;
  const preview=agentHours({agent_mode:mode,agent_start:start,agent_end:end},copy);
  return <fieldset className="billing-resource-choice billing-agent-schedule">
    <legend>{copy('Lịch AI agent')}</legend>
    <p className="billing-agent-zone dim">{copy('Giờ Việt Nam (UTC+7)')}</p>
    <div className="billing-agent-modes">
      {[['ALWAYS','Cả ngày (24/24)'],['SCHEDULED','Theo khung giờ mỗi ngày']].map(([value,label])=>
        <label className="billing-checkbox billing-agent-mode" key={value}>
          <input type="radio" name="agent_mode" value={value} checked={mode===value} onChange={()=>setMode(value)}/>
          {copy(label)}
        </label>)}
    </div>
    {scheduled&&<>
      <div className="billing-agent-presets" role="group" aria-label={copy('Khung giờ gợi ý')}>
        {schedulePresets.map(([label,from,to])=>{
          const selected=from===start&&to===end;
          return <Button key={label} variant={selected?'primary':'subtle'} aria-pressed={selected} onClick={()=>{
            setStart(from);
            setEnd(to);
          }}><span>{copy(label)}</span><span className="billing-agent-clock">{clock(from)}–{clock(to)}</span></Button>;
        })}
      </div>
      <div className="billing-agent-times">
        <AgentTimeSelect label={copy('Giờ bắt đầu')} value={start} onChange={setStart}
          hourLabel={copy('Giờ')} minuteLabel={copy('Phút')}/>
        <AgentTimeSelect label={copy('Giờ kết thúc')} value={end} onChange={setEnd}
          hourLabel={copy('Giờ')} minuteLabel={copy('Phút')} minuteRef={endMinute} errorId={error?id+'-error':undefined}/>
      </div>
      <input type="hidden" name="agent_start" value={start}/>
      <input type="hidden" name="agent_end" value={end}/>
    </>}
    <div className="billing-agent-preview" role="status" aria-atomic="true">
      <Icon name="clock"/>
      {error?<span className="formerror" id={id+'-error'}>{error}</span>:<span><strong>{preview}</strong></span>}
    </div>
    {scheduled&&<p className="dim">{copy('Tin đến ngoài ca vẫn có trong hộp thư để shop xử lý thủ công.')}</p>}
  </fieldset>;
}

function PlanEditor({ plan, close, save }) {
  const {copy,locale,intl,translatedContent}=useDisplayLocale();
  const number=new Intl.NumberFormat(intl);
  const adding=!plan.code, free=plan.code==='FREE';
  const [features,setFeatures]=useState(()=>Object.fromEntries(planFeatures.map(([key])=>[key,plan.feature_flags?.[key]??(!plan.feature_flags&&(key==='messages'||key==='comments'))])));
  const [prices,setPrices]=useState(plan.term_prices??{});
  const [periods,setPeriods]=useState(()=>new Set(plan.term_prices&&Object.keys(plan.term_prices).length?
    Object.keys(plan.term_prices).map(Number):[1]));
  const [preset,setPreset]=useState(adding||!plan.price_vnd||plan.duration_days===30||!!plan.term_prices?.[1]);
  const [promotions,setPromotions]=useState(plan.term_promotions??{});
  const termPrices=preset?Object.fromEntries([...periods].filter(period=>prices[period]).map(period=>[period,Number(prices[period])])):undefined;
  const nextPromotions=()=>Object.fromEntries(Object.entries(promotions)
    .filter(([month,rule])=>(termPrices??plan.term_prices)?.[month]&&(rule.enabled||Number(rule.value)>0))
    .map(([month,rule])=>[month,{...rule,value:Number(rule.value)}]));
  const [benefits,setBenefits]=useState(()=> (plan.benefits??[]).map((benefit,id)=>({...benefit,id})));
  const nextBenefitId=useRef(benefits.length);
  return <Dialog title={adding?copy("Thêm gói dịch vụ"):copy("Cấu hình gói ")+plan.name} close={close}
    inline extra={<Button onClick={close}>{copy('Hủy')}</Button>}
    label={adding?copy("Thêm gói"):copy("Lưu")} submit={(form)=>save(form,benefits.map(({name,description})=>({name,description})),
      features,free?undefined:termPrices,free?undefined:nextPromotions())}>
    {adding&&<div className="form-grid">
      <Field label={copy("Mã gói")}><input name="code" required minLength={2} maxLength={24} pattern="[A-Za-z][A-Za-z0-9_]{1,23}" placeholder={copy("Ví dụ TEAM")}/></Field>
      <Field label={copy("Bậc gói")}><input type="number" name="tier" min={1} max={10000} step={1} required defaultValue={plan.tier}/></Field>
    </div>}
    {adding&&<p className="dim">{copy("Bậc số lớn hơn là gói cao hơn.")}</p>}
    <Field label={copy("Tên gói")}><input name="name" required maxLength={60} defaultValue={plan.name}/></Field>
    <Field label={copy("Mô tả")}><textarea name="description" maxLength={250} defaultValue={plan.description}/></Field>
    {!adding&&locale!=='vi'&&plan.description&&
      <p className="dim">{copy('Mô tả')}: {translatedContent('p:'+plan.code+':description',plan.description)}</p>}
    <div className="billing-fields">
      <Field label={copy("Page/kênh")}><input type="number" name="page_limit" min={1} max={100} required defaultValue={plan.page_limit}/></Field>
      <Field label={copy("Nhân viên")}><input type="number" name="staff_limit" min={1} max={200} required defaultValue={plan.staff_limit}/></Field>
    </div>
    <fieldset className="billing-resource-choice ai-quota-fields">
      <legend>{copy('Hạn mức token AI')}</legend>
      <div className="form-grid">
        <Field label={copy('Token trong 5 giờ')}><input type="number" name="ai_5h_tokens" min="0" max="1000000000"
          step="1" required defaultValue={plan.ai_5h_tokens??(free?0:100000)}/></Field>
        <Field label={copy('Token trong 7 ngày')}><input type="number" name="ai_week_tokens" min="0" max="1000000000"
          step="1" required defaultValue={plan.ai_week_tokens??(free?0:500000)}/></Field>
        <Field label={copy('Lượt đặt lại hạn mức mỗi tuần')}><input type="number" name="ai_reset_limit" min="0" max="100"
          step="1" required defaultValue={plan.ai_reset_limit??0}/></Field>
      </div>
      <p className="dim">{copy('Hạn mức 7 ngày phải bằng hoặc lớn hơn hạn mức 5 giờ. Nhập 0 cho cả hai để tắt AI. Shop chỉ thấy phần trăm đã dùng.')}</p>
    </fieldset>
    <fieldset className="billing-resource-choice">
      <legend>{copy("Chức năng của gói")}</legend>
      <div className="billing-feature-grid">
        {planFeatures.map(([key,label])=><label className="billing-checkbox" key={key}>
          <input type="checkbox" checked={features[key]} onChange={event=>setFeatures({...features,[key]:event.target.checked})}/>
          {copy(label)}
        </label>)}
      </div>
    </fieldset>
    <AgentScheduleEditor plan={plan} enabled={features.agent}/>
    {!free&&<fieldset className="billing-resource-choice">
      <legend>{copy('Chu kỳ và giá')}</legend>
      {!preset?<>
        <p className="dim">{copy('Giá của chu kỳ hiện tại')} · {plan.duration_days} {copy('ngày')}</p>
        <Field label={copy('Giá (VND)')}><input type="number" name="price_vnd" min={1000} max={999999999} defaultValue={plan.price_vnd}/></Field>
        <input type="hidden" name="duration_days" value={plan.duration_days}/>
        <Button onClick={()=>setPreset(true)}>{copy('Chuyển sang chu kỳ theo tháng')}</Button>
      </>:<>
        <div className="billing-term-fields">
          {billingMonths.map(period=>{
            const savings=prices[1]&&prices[period]?Math.max(0,1-Number(prices[period])/(period*Number(prices[1]))):0;
            return <div className="billing-admin-term" key={period}>
              <label className="billing-checkbox"><input type="checkbox" checked={periods.has(period)}
                disabled={period===1} onChange={event=>setPeriods(current=>{
                  const next=new Set(current);
                  if(event.target.checked)next.add(period);else next.delete(period);
                  return next;
                })}/>{termLabel(period,copy)}</label>
              <Field label={copy('Giá (VND)')}><input type="number" min={1000} max={999999999} step={1}
                disabled={!periods.has(period)} required={periods.has(period)&&period!==1}
                value={prices[period]??''} onChange={event=>setPrices({...prices,[period]:event.target.value})}/></Field>
              {period!==1&&periods.has(period)&&savings>0&&<small className="billing-saving">{copy('Tiết kiệm')} {number.format(Math.round(savings*1000)/10)}%</small>}
            </div>;
          })}
        </div>
        <div className="form-grid">
          <Field label={copy('Thêm một Page/kênh (VND/tháng)')}><input type="number" name="page_addon_vnd" min={1} max={999999999} step={1} defaultValue={plan.page_addon_vnd??''}/></Field>
          <Field label={copy('Thêm một nhân viên (VND/tháng)')}><input type="number" name="staff_addon_vnd" min={1} max={999999999} step={1} defaultValue={plan.staff_addon_vnd??''}/></Field>
        </div>
        <p className="dim">{copy('Để trống đơn giá bổ sung nếu Shop chỉ được mua hạn mức có sẵn.')}</p>
      </>}
    </fieldset>}
    {!free&&preset&&<TermPromotionEditor prices={termPrices} rules={promotions} setRules={setPromotions}/>}
    <fieldset className="billing-resource-choice">
      <legend>{copy("Quyền lợi bổ sung")}</legend>
      <p className="dim">{copy("Tên và mô tả hiển thị trên thẻ gói để khách so sánh. Bật quyền sử dụng trong mục Chức năng của gói.")}</p>
      {benefits.map((benefit,index)=><div className="billing-benefit-editor" key={benefit.id}>
        <div className="form-grid">
          <Field label={copy("Tên quyền lợi ")+(index+1)}><input required maxLength={60} value={benefit.name} onChange={(event)=>{
            const name=event.target.value;
            setBenefits((items)=>items.map((item)=>item.id===benefit.id?{...item,name}:item));
          }}/></Field>
          <Field label={copy("Mô tả quyền lợi ")+(index+1)}><input maxLength={160} value={benefit.description} onChange={(event)=>{
            const description=event.target.value;
            setBenefits((items)=>items.map((item)=>item.id===benefit.id?{...item,description}:item));
          }}/></Field>
        </div>
        <Button variant="danger" onClick={()=>setBenefits((items)=>items.filter((item)=>item.id!==benefit.id))}>{copy("Bỏ quyền lợi")} {index+1}</Button>
      </div>)}
      <Button icon="plus" disabled={benefits.length>=20} onClick={()=>{
        const id=nextBenefitId.current++;
        setBenefits((items)=>[...items,{id,name:'',description:''}]);
      }}>{copy("Thêm quyền lợi")}</Button>
    </fieldset>
    {!free&&<label className="billing-checkbox"><input type="checkbox" name="available" defaultChecked={plan.available}/> {copy("Mở bán khi đã đặt giá")}</label>}
  </Dialog>;
}

export function AdminBilling({ accessRevision }) {
  const {intl,copy}=useDisplayLocale();
  const money=vnd(intl);
  const [group,setGroup]=useState('daily');
  const [paymentPage,setPaymentPage]=useState(1);
  const [data,setData]=useState(null),[editing,setEditing]=useState(null),[deleting,setDeleting]=useState(null),[policyOpen,setPolicyOpen]=useState(false),[error,setError]=useState('');
  const load=useCallback(async(signal)=>{
    const result=await api('admin/billing?'+new URLSearchParams({page:paymentPage}),'GET',undefined,signal);
    if(!signal?.aborted)setData(normalizeBilling(result));
  },[paymentPage]);
  useEffect(()=>{
    const controller=new AbortController();
    load(controller.signal).catch((error)=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[load,accessRevision]);
  async function save(form,benefits,feature_flags,term_prices,term_promotions) {
    const price=form.get('price_vnd');
    const adding=!editing.code;
    await api('admin/billing/plans'+(adding?'':'/'+editing.code),adding?'POST':'PATCH',{
      ...(adding?{code:form.get('code'),tier:Number(form.get('tier'))}:{}),
      name:form.get('name'),description:form.get('description'),page_limit:Number(form.get('page_limit')),
      staff_limit:Number(form.get('staff_limit')),duration_days:Number(form.get('duration_days')),
      price_vnd:price===''||price===null?null:Number(price),available:form.has('available'),
      agent_mode:feature_flags.agent?form.get('agent_mode'):'OFF',
      agent_start:form.has('agent_start')?Number(form.get('agent_start')):null,
      agent_end:form.has('agent_end')?Number(form.get('agent_end')):null,
      order_management:feature_flags.orders,feature_flags,benefits,term_promotions,
      ai_5h_tokens:Number(form.get('ai_5h_tokens')),ai_week_tokens:Number(form.get('ai_week_tokens')),
      ai_reset_limit:Number(form.get('ai_reset_limit')),
      ...(term_prices===undefined?{}:{term_prices,
        page_addon_vnd:form.get('page_addon_vnd')?Number(form.get('page_addon_vnd')):null,
        staff_addon_vnd:form.get('staff_addon_vnd')?Number(form.get('staff_addon_vnd')):null,
      }),
    },undefined,editing.version);
    await load();
    setEditing(null);
  }
  const revenue=data?.revenue?.[group]??[];
  const total=revenue.reduce((sum,{amount})=>sum+amount,0);
  const plansPage=useListPage(data?.plans??[]);
  const editorRef=useRef(null);
  useEffect(()=>{if(editing)editorRef.current?.scrollIntoView({block:'start'});},[editing]);
  const peak=revenue.reduce((best,row)=>row.amount>(best?.amount??0)?row:best,null);
  return <>
    <Title title={copy("Quản lý gói dịch vụ")} subtitle={copy("Cấu hình chức năng, giá, thời hạn, hạn mức và theo dõi thanh toán SePay.")}
      action={<div className="rowactions">
        <Button variant="primary" icon="plus" disabled={!data} onClick={()=>{
          const nextTier=Math.max(0,...data.plans.map((plan)=>plan.tier))+10;
          setEditing({...newPlan,tier:nextTier<=10000?nextTier:''});
        }}>{copy("Thêm gói")}</Button>
        <Button disabled={!data} onClick={()=>setPolicyOpen(data.policy)}>{copy("Phí nâng gói")}</Button>
        <Button onClick={()=>load().then(()=>setError('')).catch((error)=>setError(error.message))}>{copy("Tải lại")}</Button>
      </div>}/>
    {error&&<p className="notice" role="alert">{copy(error)}</p>}
    {data&&<>
      {data.revenue&&<>
      <MetricGrid metrics={[
        [copy("Tổng đã thu"),money(total),group==='monthly'?copy("6 tháng gần nhất"):copy("15 ngày gần nhất"),'document','mint'],
        [copy("Kỳ cao nhất"),peak?money(peak.amount):'—',peak?chartDate(peak.date,intl):copy("Chưa có giao dịch"),'chart'],
      ]}/>
      <TimeChart key={group} title={copy("Tiền thanh toán gói dịch vụ và nạp token")}
        subtitle={(group==='monthly'?copy("6 tháng gần nhất · Tháng hiện tại đang diễn ra"):copy("15 ngày gần nhất"))+copy(" · Giao dịch SePay đã đối soát · Giờ Việt Nam")}
        label={group==='monthly'?copy("Tháng"):copy("Ngày")} format={money} axisFormat={chartCurrency}
        rows={revenue.map(({date,amount})=>({label:chartDate(date,intl),values:{amount}}))}
        series={[{key:'amount',name:copy("Đã thu"),color:'primary'}]}
        action={<select aria-label={copy("Nhóm theo")} value={group} onChange={(event)=>setGroup(event.target.value)}>
          <option value="daily">{copy("Theo ngày")}</option><option value="monthly">{copy("Theo tháng")}</option>
        </select>}/>
      </>}
      <section className="card shop-table"><table>
        <thead><tr><th>{copy("Gói")}</th><th>{copy("Page/kênh")}</th><th>{copy("Nhân viên")}</th><th>AI agent</th><th>{copy("Đơn hàng")}</th><th>{copy("Thời hạn")}</th><th>{copy("Giá")}</th><th>{copy("Trạng thái")}</th><th></th></tr></thead>
        <tbody>{plansPage.items.map((plan)=><tr key={plan.code}><td><strong>{plan.name}</strong><small className="dim">{plan.code} {copy("· Bậc")} {plan.tier}</small></td>
          <td>{plan.page_limit}</td><td>{plan.staff_limit}</td><td>{agentHours(plan,copy)}</td><td>{plan.order_management?copy("Có"):copy("Không")}</td><td>{Object.keys(plan.term_prices).length?billingMonths.filter(period=>plan.term_prices[period]).map(period=>termLabel(period,copy)).join(' · '):
            plan.duration_days?plan.duration_days+copy(" ngày"):copy("Không thời hạn")}</td>
          <td>{plan.code==='FREE'?copy("Miễn phí"):plan.price_vnd?money(plan.price_vnd):copy("Chưa đặt giá")}
            {!plan.archived_at&&Object.values(plan.term_promotions??{}).some(rule=>rule.enabled)&&<small className="dim">{copy('Có ưu đãi')}</small>}</td>
          <td>{plan.archived_at?copy("Đã xóa"):plan.code==='FREE'?copy("Tự cấp"):plan.available&&plan.price_vnd?copy("Mở bán"):copy("Chưa mở bán")}</td>
          <td>{!plan.archived_at&&<div className="rowactions">
            <Button onClick={()=>setEditing(plan)}>{copy("Chỉnh sửa")}</Button>
            {plan.code!=='FREE'&&<Button variant="danger" onClick={()=>setDeleting(plan)}>{copy("Xóa")}</Button>}
          </div>}</td></tr>)}</tbody>
      </table><ListPagination {...plansPage.pagination}/></section>
      <AdminTokenWallet/>
      {editing&&<div className="billing-plan-editor" ref={editorRef}><PlanEditor key={editing.code} plan={editing} close={()=>setEditing(null)} save={save}/></div>}
      <section className="card shop-table"><h2 className="billing-table-heading">{copy("Đơn thanh toán gần đây")}</h2>
        {!data.orders.length?<Empty>{copy("Chưa có đơn thanh toán.")}</Empty>:<table>
          <thead><tr><th>{copy("Mã")}</th><th>Shop</th><th>{copy("Gói")}</th><th>{copy("Giá đơn")}</th><th>{copy("Trạng thái")}</th><th>{copy("Giao dịch SePay")}</th></tr></thead>
          <tbody>{data.orders.map((order)=><tr key={order.id}><td>{order.id}<small>{formatDate(order.created_at,intl)}</small></td>
            <td>{order.shop_name}</td><td>{order.plan_name}</td><td>{money(order.price_vnd)}</td>
            <td><Chip status={statusClass[order.status]}>{copy(orderStatuses[order.status])}</Chip>
              {order.review_reason&&<small>{copy(order.review_reason)}</small>}</td>
            <td>{order.receipts.length?order.receipts.map((receipt)=><small key={receipt.id}>
              #{receipt.id} · {money(receipt.amount)} · {receipt.outcome==='REVIEW'?copy("Cần đối soát"):copy("Đã nhận")}
              {receipt.reference?' · '+receipt.reference:''}
            </small>):'—'}</td></tr>)}</tbody>
        </table>}
        {data.ordersPage&&<ListPagination {...data.ordersPage} onChange={setPaymentPage}/>}
      </section>
    </>}
    {policyOpen&&<Dialog title={copy("Phí nâng gói")} close={()=>setPolicyOpen(false)} submit={async(form)=>{
      await api('admin/billing/policy','PATCH',{upgrade_fee_bps:Math.round(Number(form.get('upgrade_fee_percent'))*100)},undefined,policyOpen.version);
      await load();
    }}>
      <Field label={copy("Phí nâng gói (% chênh lệch còn lại)")}>
        <input type="number" name="upgrade_fee_percent" min="0" max="100" step=".01" required
          defaultValue={policyOpen.upgrade_fee_bps/100}/>
      </Field>
      <p className="dim">{copy("Phí tính trên phần chênh lệch giữa hai gói trong thời gian còn lại. Gói nâng cấp giữ ngày hết hạn hiện tại.")}</p>
    </Dialog>}
    {deleting&&<Dialog title={copy("Xóa gói ")+deleting.name} close={()=>setDeleting(null)} label={copy("Xóa gói")} submit={async()=>{
      await api('admin/billing/plans/'+deleting.code,'DELETE',undefined,undefined,deleting.version);
      await load();
    }}>
      <p>{copy("Gói sẽ biến mất khỏi danh sách đăng ký. Shop đang sử dụng giữ quyền lợi đến hết kỳ. Mã QR đã cấp còn hạn vẫn có thể thanh toán và lịch chuyển gói đã thanh toán vẫn có hiệu lực.")}</p>
    </Dialog>}
  </>;
}
