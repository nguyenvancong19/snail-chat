'use client';

import { useEffect, useRef, useState } from 'react';
import { displayCopy } from '../../lib/display-catalog.jsx';
import { useDeviceDisplayLocale } from '../../lib/display-locale.jsx';
import { api } from '../../lib/workspace.js';
import { Brand } from '../../components/ui.jsx';

export default function VerifyEmail() {
  const locale=useDeviceDisplayLocale();
  const copy=(source)=>displayCopy(locale,null,source);
  useEffect(()=>{document.documentElement.lang=locale;},[locale]);
  const requested=useRef(false);
  const [result,setResult]=useState(null);
  useEffect(()=>{
    if(requested.current)return;
    requested.current=true;
    const token=window.location.hash.slice(1);
    async function confirm() {
      try {
        if(!token)throw new Error('Hãy mở liên kết xác minh trong email của bạn.');
        await api('verify-email','POST',{token});
        setResult({ok:true});
      } catch(error){
        setResult({ok:false,error:error.message});
      } finally {
        window.history.replaceState(null,'',window.location.pathname);
      }
    }
    confirm();
  },[]);
  return <main className="auth-main verification-page">
    <section className="auth-inner">
      <Brand/>
      <div role="status">
        <h1>{copy(!result?'Đang xác minh email…':result.ok?'Email đã được xác nhận':'Chưa xác minh được email')}</h1>
        {result&&<p className="auth-intro">{copy(result.ok?'Vui lòng đăng nhập để trải nghiệm SnailChat.':result.error)}</p>}
      </div>
      {result&&<a href="/login" className="button primary">{copy("Về màn đăng nhập")}</a>}
    </section>
  </main>;
}
