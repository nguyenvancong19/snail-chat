'use client';

import { useDisplayLocale } from '../lib/display-locale.jsx';

import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui.jsx';
import { Icon } from './icons.jsx';

function read(scope) {
  if(!scope)return [];
  try {
    const items=JSON.parse(localStorage.getItem(scope)??'[]');
    return Array.isArray(items)?items:[];
  } catch { return []; }
}

export function useWorkspaceAlerts(userId,shopId) {
  const scope=userId?'snailchat.alerts:'+JSON.stringify([userId,shopId??null]):null;
  const [alerts,setAlerts]=useState({scope:null,items:[],visible:null});
  useEffect(()=>{
    setAlerts((state)=>state.scope===scope?state:{scope,items:read(scope),visible:null});
  },[scope]);
  useEffect(()=>{
    if(!scope||alerts.scope!==scope)return;
    try{localStorage.setItem(scope,JSON.stringify(alerts.items));}catch{}
  },[scope,alerts.scope,alerts.items]);
  const notify=useCallback((alert,{repeat=true}={})=>{
    if(!scope)return;
    const item={...alert,created:Date.now(),unread:true};
    setAlerts((state)=>{
      const items=state.scope===scope?state.items:read(scope);
      if(!repeat&&items.some(({id})=>id===item.id))return state;
      return {scope,items:[item,...items.filter(({id})=>id!==item.id)].slice(0,30),visible:item.id};
    });
  },[scope]);
  const dismiss=()=>setAlerts((state)=>state.visible?{...state,visible:null}:state);
  const markRead=(id)=>setAlerts((state)=>state.scope!==scope?state:{
    ...state,visible:!id||state.visible===id?null:state.visible,
    items:state.items.map((item)=>!id||item.id===id?{...item,unread:false}:item),
  });
  const items=alerts.scope===scope?alerts.items:[];
  const visible=items.find(({id})=>id===alerts.visible);
  useEffect(()=>{
    if(!visible)return;
    const timer=setTimeout(dismiss,9000);
    return ()=>clearTimeout(timer);
  },[visible]);
  return {items,visible,notify,dismiss,markRead};
}

export function AlertToast({ item, onDismiss, onOpen }) {
  const {copy}=useDisplayLocale();
  return <aside className="urgent-toast" aria-label={copy("Cảnh báo mới")}>
    <span className="alert-icon"><Icon name="alert"/></span>
    <div>
      <div role="alert"><strong>{item.titleSource?copy(item.titleSource)+item.titleSuffix:copy(item.title)}</strong><p>{copy(item.message)}</p></div>
      {item.action&&<Button variant="subtle" icon="arrow" onClick={()=>onOpen(item)}>{copy(item.action.label)}</Button>}
    </div>
    <button type="button" className="iconbtn" aria-label={copy("Ẩn cảnh báo")} onClick={onDismiss}><Icon name="x"/></button>
  </aside>;
}
