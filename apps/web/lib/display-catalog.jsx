'use client';

import { useCallback,useEffect,useMemo,useState } from 'react';
import interfaceCatalog from '../../../packages/localization/interface-catalog.json';
import builtInCopy from './display-builtin.json';
import { staticMessage } from './locale.js';
import { api } from './workspace.js';

const identifiers=new Map(Object.entries(interfaceCatalog).map(([id,source])=>[source,id]));

export function displayCopy(locale,catalog,source,key){
  if(typeof source!=='string'||!source.trim()||locale==='vi')return source;
  const local=builtInCopy[source]?.[['en','ko','ja','zh','th','lo'].indexOf(locale)];
  if(local)return local;
  const builtIn=staticMessage(locale,source);
  if(builtIn!==source)return builtIn;
  const id=key??identifiers.get(source);
  if(!id)return source;
  const translated=catalog?.entries[id];
  if(translated?.source===source)return translated.value;
  catalog?.queue(id,source);
  return source;
}

export function useDisplayCatalog(locale,enabled){
  const [snapshot,setSnapshot]=useState({locale:null,entries:{},status:'ready'});
  const work=useMemo(()=>({pending:new Map(),seen:new Map(),timer:null,schedule:null}),[locale,enabled]);
  const queue=useCallback((key,source)=>{
    if(!enabled||locale==='vi'||work.seen.get(key)===source)return;
    work.pending.set(key,source);
    work.schedule?.();
  },[enabled,locale,work]);

  useEffect(()=>{
    if(!enabled||locale==='vi')return;
    const abort=new AbortController();
    let running=false,retries=0,failed=false,cachedOnly=false;
    let unavailableStatus=null;
    function schedule(delay=40){
      if(work.timer||running||abort.signal.aborted||failed||!work.pending.size)return;
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
          setSnapshot((old)=>({locale,entries:{...(old.locale===locale?old.entries:{}),...data.entries},
            status:unavailableStatus??(data.state==='ready'&&work.pending.size?'loading':data.state)}));
        }
      }catch{
        if(!abort.signal.aborted){
          failed=true;
          setSnapshot((old)=>({locale,entries:old.locale===locale?old.entries:{},status:'unavailable'}));
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

  return {entries:snapshot.locale===locale?snapshot.entries:{},status:snapshot.locale===locale?snapshot.status:'ready',queue};
}
