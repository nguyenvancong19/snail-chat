'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/workspace.js';
import { Brand } from '../../components/ui.jsx';

export default function VerifyEmail() {
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
        <h1>{!result?'Đang xác minh email…':result.ok?'Email đã được xác nhận':'Chưa xác minh được email'}</h1>
        {result&&<p className="auth-intro">{result.ok?'Vui lòng đăng nhập để trải nghiệm SnailChat.':result.error}</p>}
      </div>
      {result&&<a href="/login" className="button primary">Về màn đăng nhập</a>}
    </section>
  </main>;
}
