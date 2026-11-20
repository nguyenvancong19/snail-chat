'use client';

import { useEffect, useState } from 'react';
import { accountHome, api, ensureBrowserSession } from '../../lib/workspace.js';

const publicSections=['', '#main', '#features', '#workflow', '#platforms'];
const authBookmarks=['#login', '#register', '#forgot-password'];

// Preserve old bookmarks and Meta callbacks before the landing content becomes visible.
const legacyRedirect = `(() => {
  const content = document.currentScript.parentElement;
  function redirect() {
    const { hash, search } = window.location;
    const auth = ${JSON.stringify(authBookmarks)}.includes(hash);
    if (${JSON.stringify(publicSections)}.includes(hash) && !new URLSearchParams(search).has('meta')) return;
    content.hidden = true;
    content.previousElementSibling.hidden = false;
    window.location.replace((auth ? '/login' : '/dashboard') + search + hash);
  }
  redirect();
  window.addEventListener('hashchange', redirect);
})();`;

export default function HomeEntry({checkSession,children}) {
  const [checking,setChecking]=useState(checkSession);

  useEffect(()=>{
    if(!checkSession)return;
    const {hash,search}=window.location;
    if(!publicSections.includes(hash)||new URLSearchParams(search).has('meta'))return;
    const controller=new AbortController();
    async function enter(){
      try {
        const {user}=await api('session','GET',undefined,controller.signal);
        if(user){
          if(!controller.signal.aborted)window.location.replace(accountHome(user));
          return;
        }
        if(await ensureBrowserSession()){
          const {user:restored}=await api('session','GET',undefined,controller.signal);
          if(restored){
            if(!controller.signal.aborted)window.location.replace(accountHome(restored));
            return;
          }
        }
      }catch{
        // A guest can still use the public site if the session API is unavailable.
      }
      if(!controller.signal.aborted)setChecking(false);
    }
    void enter();
    return ()=>controller.abort();
  },[checkSession]);

  return <>
    <div className="loading" role="status" hidden={!checking}>Đang mở SnailChat…</div>
    <div hidden={checking}>
      <script dangerouslySetInnerHTML={{__html:legacyRedirect}}/>
      {children}
    </div>
  </>;
}
