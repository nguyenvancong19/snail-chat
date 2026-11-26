'use client';

import { useEffect, useState } from 'react';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { api } from '../lib/workspace.js';
import { Dialog } from './forms.jsx';
import { Button, Chip } from './ui.jsx';
import { useShopAgentUsage } from './agent-usage.jsx';

const durations=[[15,'15 phút'],[30,'30 phút'],[60,'1 giờ'],[120,'2 giờ']];

export function ConversationTakeover({item,resumeAt,canReply,openPlans,lastReplyError}) {
  const {copy,intl}=useDisplayLocale();
  const usage=useShopAgentUsage(lastReplyError);
  const [until,setUntil]=useState(resumeAt);
  const [now,setNow]=useState(Date.now);
  const [dialog,setDialog]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    setUntil(resumeAt);
    setNow(Date.now());
  },[resumeAt]);
  const paused=until>now;
  useEffect(()=>{
    if(!paused)return;
    const timer=setInterval(()=>setNow(Date.now()),500);
    return ()=>clearInterval(timer);
  },[paused]);

  async function update(minutes) {
    const result=await api('messenger/takeover','PATCH',{channel:item.channelId,sender:item.senderId,minutes});
    setUntil(result.agentResumeAt);
    setNow(Date.now());
    setError('');
  }

  async function resume() {
    setBusy(true);
    try{await update(0);}
    catch(error){setError(error.message);}
    finally{setBusy(false);}
  }

  const seconds=Math.max(0,Math.ceil((until-now)/1000));
  const countdown=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60]
    .map(value=>String(value).padStart(2,'0')).join(':');
  const limited=usage?.blocked||usage?.available===false;
  const label=paused?'Nhân viên đang tiếp quản':usage?.available===false?'Agent chưa có hạn mức':
    limited?'Đã chạm hạn mức gói':'Agent đang bật';
  return <>
    <section className={'takeover-panel'+(paused||limited?' paused':'')} aria-label={copy('Chế độ trả lời')}>
      <div>
        <Chip status={paused||limited?'review':'replied'}>{copy(label)}</Chip>
        <p className="dim">{paused
          ?<>{copy('Agent tự bật lại sau')} <time>{countdown}</time>{' · '}{new Intl.DateTimeFormat(intl,{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Ho_Chi_Minh'}).format(until)}</>
          :copy(limited?(usage?.canReset?'Chủ Shop có thể đặt lại hạn mức trong Cấu hình agent.':
            usage?.walletTokens>0?'Agent có thể dùng token trong ví nếu số dư đủ cho lượt gọi.':
            'Kiểm tra hạn mức trong Cấu hình agent hoặc trả lời thủ công.')
            :'Agent có thể phản hồi tin nhắn mới theo cấu hình của kênh.')}</p>
      </div>
      {canReply&&<div className="rowactions">
        {limited&&!paused&&openPlans&&<Button onClick={openPlans}>{copy('Xem hạn mức AI')}</Button>}
        {paused&&<Button onClick={()=>setDialog(true)} disabled={busy}>{copy('Đổi thời gian')}</Button>}
        <Button variant="primary" disabled={busy} onClick={paused?resume:()=>setDialog(true)}>
          {copy(paused?'Bật lại Agent':'Tiếp quản')}
        </Button>
      </div>}
      {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    </section>
    {dialog&&<Dialog title={copy(paused?'Đổi thời gian tiếp quản':'Nhân viên tiếp quản')}
      label={copy(paused?'Lưu thời gian':'Tiếp quản')} close={()=>setDialog(false)} submit={(form)=>update(Number(form.get('minutes')))}>
      <p>{copy('Agent sẽ tạm dừng trả lời trong hội thoại với')} <strong>{item.author}</strong>.</p>
      <label className="field">{copy('Agent tự bật lại sau')}
        <select name="minutes" defaultValue="30">{durations.map(([minutes,label])=><option value={minutes} key={minutes}>{copy(label)}</option>)}</select>
      </label>
      <p className="dim">{copy('Thời gian được tính từ lúc lưu. Tin nhắn đến trong thời gian tiếp quản dành cho nhân viên xử lý.')}</p>
    </Dialog>}
  </>;
}
