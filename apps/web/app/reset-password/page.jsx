'use client';

import { useEffect, useState } from 'react';
import { Brand, Button, Field } from '../../components/ui.jsx';
import { displayCopy } from '../../lib/display-catalog.jsx';
import { useDeviceDisplayLocale } from '../../lib/display-locale.jsx';
import { api } from '../../lib/workspace.js';

export default function ResetPassword() {
  const locale=useDeviceDisplayLocale();
  const copy=(source)=>displayCopy(locale,null,source);
  useEffect(()=>{document.documentElement.lang=locale;},[locale]);
  const [token,setToken]=useState(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [complete,setComplete]=useState(false);
  useEffect(()=>{
    setToken(window.location.hash.slice(1));
  },[]);
  const valid=token!==null&&/^[A-Za-z0-9_-]{43}$/.test(token);

  async function submit(event) {
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const password=form.get('password'),confirmPassword=form.get('confirmPassword');
    setError('');
    if(password!==confirmPassword){setError('Hai mật khẩu cần trùng nhau.');return;}
    setBusy(true);
    try{
      await api('reset-password','POST',{token,password,confirmPassword});
      window.history.replaceState(null,'',window.location.pathname);
      setComplete(true);
    }catch(problem){setError(problem.message);}
    finally{setBusy(false);}
  }

  return <main className="auth-main verification-page">
    <section className="auth-inner">
      <Brand/>
      <h1>{copy(complete?'Đã đặt lại mật khẩu':'Đặt lại mật khẩu')}</h1>
      {complete?<p className="auth-intro" role="status">{copy("Các phiên cũ đã được đăng xuất. Hãy đăng nhập bằng mật khẩu mới.")}</p>:
        token===null?<p role="status">{copy("Đang đọc liên kết…")}</p>:valid?<form onSubmit={submit}>
          <p className="auth-intro">{copy("Mật khẩu mới cần từ 12 đến 128 ký tự.")}</p>
          <Field label={copy("Mật khẩu mới")}><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></Field>
          <Field label={copy("Nhập lại mật khẩu mới")}><input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></Field>
          {error&&<p className="formerror" role="alert">{copy(error)}</p>}
          <Button type="submit" variant="primary auth-submit" disabled={busy}>{copy(busy?'Đang lưu…':'Lưu mật khẩu mới')}</Button>
        </form>:<p role="alert">{copy("Hãy mở liên kết đặt lại mật khẩu trong email SnailChat.")}</p>}
      <div className="action-row">
        {!complete&&<a href="/login#forgot-password" className="button">{copy("Yêu cầu liên kết mới")}</a>}
        <a href="/login" className={'button'+(complete?' primary':'')}>{copy("Về màn đăng nhập")}</a>
      </div>
    </section>
  </main>;
}
