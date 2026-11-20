'use client';

import { useEffect, useState } from 'react';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { api, formatDate } from '../lib/workspace.js';
import { CardHead } from './ui.jsx';

export const allowanceLabels={'5h':'AI · 5 giờ',week:'AI · 7 ngày'};

export function AgentUsage({usage}) {
  const {copy,intl}=useDisplayLocale();
  if(!usage?.available)return null;
  const percent=new Intl.NumberFormat(intl,{style:'percent'});
  const exhausted=usage.windows.filter(item=>item.percentUsed===100);
  return <section className="card ai-usage">
    <CardHead title={copy('Mức sử dụng AI của Shop')} subtitle={copy('Dùng chung cho tất cả Page trong Shop.')}/>
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
    {(usage.blocked||exhausted.length>0)&&<p className="notice" role="status">{copy(usage.canReset
      ?'Đã chạm hạn mức. Chủ Shop có thể dùng lượt đặt lại trong Gói dịch vụ.'
      :usage.walletTokens>0?'Đã chạm hạn mức gói. AI có thể sử dụng token trong ví.'
        :'Đã hết hạn mức AI. Bạn vẫn có thể trả lời thủ công.')}
      {exhausted.length>0&&!usage.canReset&&!usage.walletTokens&&<> {copy('AI có thể dùng lại từ')} {formatDate(Math.max(...exhausted.map(item=>item.resetAt)),intl)}.</>}</p>}
  </section>;
}

export function useShopAgentUsage(reloadKey) {
  const [usage,setUsage]=useState(null);
  useEffect(()=>{
    const controller=new AbortController();
    let pending=false;
    async function load(){
      if(pending||document.hidden)return;
      pending=true;
      try{
        const next=await api('ai/usage','GET',undefined,controller.signal);
        if(!controller.signal.aborted)setUsage(next);
      }catch{}
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
  },[reloadKey]);
  return usage;
}

export function ShopAgentUsage() {
  return <AgentUsage usage={useShopAgentUsage()}/>;
}
