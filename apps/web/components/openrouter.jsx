'use client';

import { useDisplayLocale } from '../lib/display-locale.jsx';

import { useEffect, useState } from 'react';
import { api } from '../lib/workspace.js';
import { Button, Field, Title } from './ui.jsx';

export function AiDraft({ channel, kind, onDraft }) {
  const {copy}=useDisplayLocale();
  const [prompt,setPrompt]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const [draft,setDraft]=useState(null);
  async function generate() {
    setBusy(true);setError('');setDraft(null);
    try{
      setDraft(await api('ai/draft','POST',{channel:channel.id,kind,prompt:prompt.trim()},AbortSignal.timeout(95_000)));
    }catch(problem){setError(problem.message);}
    finally{setBusy(false);}
  }
  if(channel.aiToolsEnabled===false)return null;
  return <details className="bot-collapsible">
    <summary>{kind==='faq'?copy("Gợi ý FAQ bằng AI"):copy("Gợi ý câu trả lời bằng AI")}</summary>
    <div className="bot-section">
      <Field label={copy("Chủ đề và thông tin để soạn bản nháp")}><textarea rows={3} maxLength={2000}
        value={prompt} onChange={(event)=>{setPrompt(event.target.value);setDraft(null);}} disabled={busy}/></Field>
      <p className="bot-hint">{copy("Nội dung bạn nhập và tên Page được gửi đến nhà cung cấp AI đã cấu hình khi tạo bản nháp.")}</p>
      <Button disabled={busy||!prompt.trim()} onClick={generate}>{busy?copy("Đang tạo…"):copy("Tạo bản nháp")}</Button>
      {error&&<p className="formerror" role="alert">{copy(error)}</p>}
      {draft&&<div className="notice bot-preview">
        {draft.question&&<strong>{draft.question}</strong>}<p>{draft.reply}</p>
        <Button onClick={()=>{onDraft(draft);setDraft(null);}}>{copy("Dùng bản nháp")}</Button>
      </div>}
    </div>
  </details>;
}
