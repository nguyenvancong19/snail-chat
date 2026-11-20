'use client';

import { useDisplayLocale } from '../lib/display-locale.jsx';

import { useEffect, useState } from 'react';
import { api } from '../lib/workspace.js';
import { Button, Field, Title } from './ui.jsx';

export function AdminOpenRouter() {
  const {copy}=useDisplayLocale();
  const [test,setTest]=useState(null);
  const [settings,setSettings]=useState(null), [key,setKey]=useState('');
  const [busy,setBusy]=useState(false), [error,setError]=useState(''),[conflict,setConflict]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    api('admin/openrouter','GET',undefined,controller.signal).then(setSettings)
      .catch((problem)=>{if(!controller.signal.aborted)setError(problem.message);});
    return ()=>controller.abort();
  },[]);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);setError('');setTest(null);
    try{
      await api('admin/openrouter','POST',{enabled:settings.enabled,model:settings.model,apiKey:key.trim()},undefined,settings.version);
      setSettings(await api('admin/openrouter'));
      setKey('');
    }catch(problem){setError(problem.message);setConflict(problem.status===412);}
    finally{setBusy(false);}
  }
  async function testConnection() {
    setBusy(true);setError('');setTest(null);
    try { setTest(await api('admin/openrouter/test','POST',{},AbortSignal.timeout(45_000))); }
    catch(problem){setError(problem.message);}
    finally{setBusy(false);}
  }
  return <>
    <Title title="OpenRouter" subtitle={copy("Cấu hình AI dùng chung cho FAQ, bản nháp phản hồi và nhận diện câu hỏi chốt đơn.")}/>
    <section className="card bot-workspace-card">
      {settings&&<form onSubmit={submit}>
        <label className="check"><input type="checkbox" checked={settings.enabled} disabled={busy}
          onChange={(event)=>setSettings({...settings,enabled:event.target.checked})}/> {copy("Bật gợi ý AI cho hệ thống")}</label>
        <Field label={copy("Mã model OpenRouter")}><input value={settings.model} maxLength={160} disabled={busy}
          placeholder={copy("nhà-cung-cấp/tên-model")} onChange={(event)=>setSettings({...settings,model:event.target.value})}/></Field>
        <Field label={settings.configured?copy("API key mới (để trống để giữ khóa hiện tại)"):'API key OpenRouter'}>
          <input type="password" autoComplete="new-password" value={key} maxLength={512} disabled={busy}
            onChange={(event)=>setKey(event.target.value)}/>
        </Field>
        <div className="faq-actions">
          <Button type="submit" variant="primary" disabled={busy||conflict}>{copy("Lưu OpenRouter")}</Button>
          <Button onClick={testConnection} disabled={busy||!settings.configured}>{copy("Thử cấu hình đã lưu")}</Button>
          {conflict&&<Button disabled={busy} onClick={async()=>{
            setBusy(true);
            try{setSettings(await api('admin/openrouter'));setKey('');setError('');setConflict(false);}
            catch(problem){setError(problem.message);}
            finally{setBusy(false);}
          }}>{copy('Tải lại cấu hình đã lưu')}</Button>}
        </div>
      </form>}
      {test&&<p className="notice" role="status">{copy("Kết nối thành công với")} {test.model}{copy(". FAQ mẫu:")} {test.sample.question} — {test.sample.reply}</p>}
      {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    </section>
  </>;
}

export function AiDraft({ channel, kind, onDraft }) {
  const {copy}=useDisplayLocale();
  const [prompt,setPrompt]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const [draft,setDraft]=useState(null);
  async function generate() {
    setBusy(true);setError('');setDraft(null);
    try{
      setDraft(await api('ai/draft','POST',{channel:channel.id,kind,prompt:prompt.trim()},AbortSignal.timeout(45_000)));
    }catch(problem){setError(problem.message);}
    finally{setBusy(false);}
  }
  if(channel.aiToolsEnabled===false)return null;
  return <details className="bot-collapsible">
    <summary>{kind==='faq'?copy("Gợi ý FAQ bằng AI"):copy("Gợi ý câu trả lời bằng AI")}</summary>
    <div className="bot-section">
      <Field label={copy("Chủ đề và thông tin để soạn bản nháp")}><textarea rows={3} maxLength={2000}
        value={prompt} onChange={(event)=>{setPrompt(event.target.value);setDraft(null);}} disabled={busy}/></Field>
      <p className="bot-hint">{copy("Nội dung bạn nhập và tên Page được gửi đến OpenRouter khi tạo bản nháp.")}</p>
      <Button disabled={busy||!prompt.trim()} onClick={generate}>{busy?copy("Đang tạo…"):copy("Tạo bản nháp")}</Button>
      {error&&<p className="formerror" role="alert">{copy(error)}</p>}
      {draft&&<div className="notice bot-preview">
        {draft.question&&<strong>{draft.question}</strong>}<p>{draft.reply}</p>
        <Button onClick={()=>{onDraft(draft);setDraft(null);}}>{copy("Dùng bản nháp")}</Button>
      </div>}
    </div>
  </details>;
}
