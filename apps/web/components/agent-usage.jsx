'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { api, formatDate } from '../lib/workspace.js';
import { CardHead, Chip } from './ui.jsx';
import { chartDate, TimeChart } from './stat-charts.jsx';

export const allowanceLabels={'5h':'AI · 5 giờ',week:'AI · 7 ngày'};

export function AgentUsage({usage,planName}) {
  const {copy,intl}=useDisplayLocale();
  if(!usage?.available)return null;
  const percent=new Intl.NumberFormat(intl,{style:'percent'});
  const exhausted=usage.windows.filter(item=>item.percentUsed===100);
  const canReset=usage.canReset&&usage.limitDepleted;
  return <section className="card ai-usage">
    <CardHead title={copy('Hạn mức gói')} subtitle={copy('Dùng chung cho tất cả Page trong Shop.')}
      action={planName&&<Chip status="active">{planName}</Chip>}/>
    <div className="ai-usage-layout">
      {usage.windows.map(({kind,percentUsed,resetAt})=>{
        const label=copy(allowanceLabels[kind]);
        const value=percent.format(percentUsed/100);
        return <div className="ai-usage-window" key={kind}>
          <div className="ai-usage-label"><strong>{label}</strong><span>{copy('Đã dùng')} <b>{value}</b></span></div>
          <progress max={100} value={percentUsed} aria-label={label} aria-valuetext={copy('Đã dùng')+' '+value}/>
          <small className="dim">{copy('Đặt lại lúc')} {formatDate(resetAt,intl)}</small>
        </div>;
      })}
    </div>
    {(usage.blocked||exhausted.length>0)&&<p className="notice" role="status">{copy(canReset
      ?'Đã chạm hạn mức. Chủ Shop có thể dùng lượt đặt lại trong Cấu hình agent.'
      :usage.walletTokens>0?'Đã chạm hạn mức gói. AI có thể sử dụng token trong ví.'
        :exhausted.length?'Đã hết hạn mức AI. Bạn vẫn có thể trả lời thủ công.'
          :'Hạn mức còn lại chưa đủ cho lượt này. Hãy thử yêu cầu ngắn hơn hoặc đợi hạn mức tự đặt lại.')}
      {exhausted.length>0&&!canReset&&!usage.walletTokens&&<> {copy('AI có thể dùng lại từ')} {formatDate(Math.max(...exhausted.map(item=>item.resetAt)),intl)}.</>}</p>}
  </section>;
}

export function useAgentUsage(reloadKey,{history=false,enabled=true}={}) {
  const [usage,setUsage]=useState(null),[error,setError]=useState('');
  const latest=useRef(0);
  const refresh=useCallback(async(signal)=>{
    if(!enabled)return;
    const request=++latest.current;
    const current=()=>request===latest.current&&!signal?.aborted;
    try{
      const next=await api(history?'ai/usage?history=1':'ai/usage','GET',undefined,signal);
      if(current()){setUsage(next);setError('');}
    }catch(problem){
      if(current())setError(problem.message);
    }
  },[history,enabled]);
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();
    let pending=false;
    async function load(){
      if(pending||document.hidden)return;
      pending=true;
      try{await refresh(controller.signal);}
      finally{pending=false;}
    }
    void load();
    const timer=setInterval(load,20_000);
    document.addEventListener('visibilitychange',load);
    return ()=>{
      clearInterval(timer);
      controller.abort();
      document.removeEventListener('visibilitychange',load);
    };
  },[enabled,refresh,reloadKey]);

  function applyReset(next){
    latest.current++;
    setUsage(previous=>({...next,daily:previous?.daily}));
  }
  return {usage:enabled?usage:null,error:enabled?error:'',refresh,applyReset};
}

export function useShopAgentUsage(reloadKey) {
  return useAgentUsage(reloadKey).usage;
}

export function DailyAgentUsage({daily}) {
  const {copy,intl,t}=useDisplayLocale();
  if(!daily)return null;
  const number=new Intl.NumberFormat(intl);
  const compact=new Intl.NumberFormat(intl,{notation:'compact',maximumFractionDigits:1});
  const total=daily.reduce((sum,{planTokens})=>sum+planTokens,0);
  return <>
    <TimeChart title={copy('Mức sử dụng Agent theo ngày')}
      subtitle={t('lastDays',{count:number.format(7)})+' · '+t('vietnamTime')}
      rows={daily.map(({date,planTokens})=>({label:chartDate(date,intl),values:{planTokens}}))}
      series={[{key:'planTokens',name:copy('Token từ gói'),color:'primary'}]}
      axisFormat={value=>compact.format(value)}
      action={<strong className="agent-usage-total">{copy('Tổng token từ gói')} · {number.format(total)}</strong>}/>
    <p className="dim agent-usage-note">{copy('Biểu đồ ghi nhận từ khi cập nhật. Số liệu tính theo thời điểm trừ hạn mức gói.')}</p>
  </>;
}
