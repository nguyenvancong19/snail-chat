'use client';

import { useCallback,useEffect,useMemo,useState } from 'react';
import interfaceCatalog from '../../../packages/localization/interface-catalog.json';
import builtInCopy from './display-builtin.json';
import { staticMessage } from './locale.js';
import { api } from './workspace.js';

const languages=['en','ko','ja','zh','th','lo'];
const identifiers=new Map(Object.entries(interfaceCatalog).map(([id,source])=>[source,id]));

function builtIn(locale,source){
  const local=Object.hasOwn(builtInCopy,source)&&builtInCopy[source][languages.indexOf(locale)];
  return local||staticMessage(locale,source);
}

export function displayCopy(locale,catalog,source,key){
  if(typeof source!=='string'||!source.trim()||locale==='vi')return source;
  const label=builtIn(locale,source);
  if(label!==source)return label;
  // Dynamic plan descriptions use exact values so edited content invalidates old translations.
  const text=source.trim();
  const infix=(label)=>source.slice(0,source.indexOf(text))+label+source.slice(source.indexOf(text)+text.length);
  const normalized=key?text:builtIn(locale,text);
  if(normalized!==text)return infix(normalized);
  const exact=key??identifiers.get(source);
  const id=exact??identifiers.get(text);
  if(!id)return source;
  const expected=exact?source:text;
  const translated=catalog?.entries[id];
  if(translated?.source===expected)return exact?translated.value:infix(translated.value);
  catalog?.queue(id,expected);
  return source;
}

export function useDisplayCatalog(locale,enabled){
  const [snapshot,setSnapshot]=useState({});
  const work=useMemo(()=>({pending:new Map(),seen:new Map(),timer:null,schedule:null}),[locale,enabled]);
  const saved=snapshot[locale];
  const queue=useCallback((key,source)=>{
    if(!enabled||locale==='vi'||work.seen.get(key)===source)return;
    work.pending.set(key,source);
    work.schedule?.();
  },[enabled,locale,work]);

  useEffect(()=>{
    if(!enabled||locale==='vi')return;
    const abort=new AbortController();
    let running=false,retries=0,cachedOnly=false;
    let unavailableStatus=null;
    function schedule(delay=40){
      if(work.timer||running||abort.signal.aborted||!work.pending.size)return;
      work.timer=setTimeout(()=>{work.timer=null;void load();},delay);
    }
    async function load(){
      running=true;
      const page=[...work.pending].slice(0,32);
      if(!page.length){running=false;return;}
      for(const [key,source] of page){
        work.pending.delete(key);
        work.seen.set(key,source);
      }
      let delay=40;
      try{
        const data=await api('localization/display','POST',{locale,keys:page.map(([key])=>key),cachedOnly},abort.signal);
        if(abort.signal.aborted)return;
        if(data.state==='busy'&&retries<4){
          for(const [key,source] of page){work.seen.delete(key);work.pending.set(key,source);}
          retries++;
          delay=300*2**retries;
        }else{
          retries=0;
          if(['disabled','unavailable'].includes(data.state)){
            cachedOnly=true;
            unavailableStatus=data.state;
          }
          setSnapshot((old)=>({...old,[locale]:{
            entries:{...old[locale]?.entries,...data.entries},
            status:unavailableStatus??(data.state==='ready'&&work.pending.size?'loading':data.state)}}));
        }
      }catch{
        if(!abort.signal.aborted){
          if(retries<2){
            for(const [key,source] of page){work.seen.delete(key);work.pending.set(key,source);}
            delay=500*2**retries++;
          }else{
            retries=0;
            setSnapshot((old)=>({...old,[locale]:{entries:old[locale]?.entries??{},status:'unavailable'}}));
          }
        }
      }finally{
        running=false;
        schedule(delay);
      }
    }
    work.schedule=schedule;
    schedule();
    return ()=>{
      abort.abort();
      work.schedule=null;
      clearTimeout(work.timer);work.timer=null;
      work.pending.clear();work.seen.clear();
    };
  },[locale,enabled,work]);

  return {entries:saved?.entries??{},status:saved?.status??'ready',queue};
}
