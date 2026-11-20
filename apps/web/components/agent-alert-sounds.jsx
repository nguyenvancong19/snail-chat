'use client';

import { useEffect, useRef, useState } from 'react';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { agentSounds, deviceSoundOn, playAgentSound, setDeviceSound, soundRequest, unlockAgentAudio } from '../lib/agent-alert-sounds.js';
import { Icon } from './icons.jsx';
import { Button } from './ui.jsx';

export function AgentAlertSounds({shop,owner}){
  const {copy}=useDisplayLocale();
  const [enabled,setEnabled]=useState(()=>deviceSoundOn(shop));
  const [settings,setSettings]=useState(null);
  const [feedback,setFeedback]=useState(null);
  const [busy,setBusy]=useState('');
  const [revision,setRevision]=useState(0);
  const scope=useRef(null);
  useEffect(()=>{
    const controller=new AbortController();
    scope.current=controller;
    soundRequest(shop,'',{signal:controller.signal}).then(response=>response.json()).then(({sounds})=>{
      if(!controller.signal.aborted)setSettings(sounds);
    }).catch(error=>{
      if(!controller.signal.aborted)setFeedback({error:true,text:error.message});
    });
    function updateDevice(){setEnabled(deviceSoundOn(shop));}
    window.addEventListener('storage',updateDevice);
    return ()=>{controller.abort();window.removeEventListener('storage',updateDevice);};
  },[shop,revision]);
  async function change(kind,path,options,success){
    const signal=scope.current.signal;
    setBusy(kind);
    setFeedback(null);
    try{
      const response=await soundRequest(shop,path,{...options,signal});
      const {sounds}=await response.json();
      if(signal.aborted)return;
      setSettings(sounds);
      setFeedback({kind,text:success});
    }catch(error){
      if(!signal.aborted)setFeedback({kind,error:true,text:error.message});
    }finally{
      if(!signal.aborted)setBusy('');
    }
  }
  function upload(kind,event){
    const file=event.target.files[0];
    event.target.value='';
    if(!file)return;
    if(!/\.(mp3|wav)$/i.test(file.name)||!file.size||file.size>5*1024*1024){
      setFeedback({kind,error:true,text:'Chọn file MP3 hoặc WAV có dung lượng tối đa 5 MB.'});
      return;
    }
    void change(kind,'/'+kind+'/file?'+new URLSearchParams({name:file.name}),
      {method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file},'Đã lưu file âm báo.');
  }
  function toggleDevice(){
    if(!enabled)unlockAgentAudio();
    try{setDeviceSound(shop,!enabled);setEnabled(!enabled);setFeedback(null);}
    catch{setFeedback({error:true,text:'Trình duyệt chưa cho phép lưu cài đặt âm thanh.'});}
  }
  async function preview(kind){
    unlockAgentAudio();
    const signal=scope.current.signal;
    setBusy(kind);
    setFeedback(null);
    try{await playAgentSound(shop,kind,{filename:settings[kind].filename,signal});}
    catch{if(!signal.aborted)setFeedback({kind,error:true,text:'Không phát được âm báo. Hãy kiểm tra âm lượng hoặc đổi file.'});}
    finally{if(!signal.aborted)setBusy('');}
  }
  const feedbackLine=kind=>feedback&&feedback.kind===kind&&
    <p className={feedback.error?'formerror':'dim'} role={feedback.error?'alert':'status'}>{copy(feedback.text)}</p>;
  return <div className="agent-sound-settings">
    <section className="card settings-card agent-sound-device">
      <div className="agent-sound-heading"><span className="agent-sound-icon"><Icon name="bell"/></span><div>
        <h2>{copy('Âm thanh trên thiết bị này')}</h2>
        <p className="dim">{copy(enabled?'Đang bật âm thanh cho Shop này.':'Bật để nghe âm báo khi Agent có sự kiện mới.')}</p>
      </div></div>
      <Button variant={enabled?'':'primary'} aria-pressed={enabled} onClick={toggleDevice}>
        {copy(enabled?'Tắt âm thanh':'Bật âm thanh thông báo')}
      </Button>
      {feedbackLine(undefined)}
    </section>
    <section className="card settings-card agent-sound-events">
      <header><h2>{copy('Âm báo theo sự kiện')}</h2>
        <p className="dim">{copy(owner?'Chọn file MP3 hoặc WAV, tối đa 5 MB mỗi file. Cài đặt áp dụng cho cả Shop.':'Âm báo do chủ Shop thiết lập. Bạn có thể nghe thử và bật hoặc tắt âm thanh trên thiết bị của mình.')}</p>
      </header>
      {!settings&&!feedback&&<p role="status">{copy('Đang tải âm báo…')}</p>}
      {!settings&&feedback&&<Button onClick={()=>{setFeedback(null);setRevision(value=>value+1);}}>{copy('Tải lại')}</Button>}
      {settings&&Object.entries(agentSounds).map(([kind,{label,phrase}])=>{
        const {enabled:on,filename}=settings[kind];
        const icon={order:'check',product:'document',customer:'user'}[kind];
        return <article className="agent-sound-event" key={kind}>
          <div className="agent-sound-heading"><span className="agent-sound-icon"><Icon name={icon}/></span><div>
            <h3>{copy(label)}</h3><p className="dim">“{copy(phrase)}”</p>
          </div></div>
          {owner?<label className="agent-sound-switch"><input type="checkbox" role="switch" aria-label={copy(label)}
            checked={on} disabled={!!busy} onChange={event=>void change(kind,'/'+kind,{method:'PATCH',
              headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:event.target.checked})},'Đã lưu trạng thái âm báo.')}/>
            <span>{copy(on?'Đang bật':'Đang tắt')}</span></label>:<span className="dim">{copy(on?'Đang bật':'Đang tắt')}</span>}
          <div className="agent-sound-file">
            <p className="dim">{filename||copy('Âm báo mặc định')}</p>
            <div className="agent-sound-actions">
              {owner&&<label className="button agent-sound-upload"><Icon name="upload"/>{copy(filename?'Đổi file':'Chọn file')}
                <input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={!!busy} aria-label={copy('Chọn file âm báo')+' · '+copy(label)} onChange={event=>upload(kind,event)}/>
              </label>}
              <Button icon="play" disabled={!!busy} onClick={()=>void preview(kind)}>{copy('Nghe thử')}</Button>
              {owner&&filename&&<Button disabled={!!busy} onClick={()=>void change(kind,'/'+kind+'/file',{method:'DELETE'},'Đã dùng lại âm báo mặc định.')}>{copy('Dùng mặc định')}</Button>}
            </div>
            {busy===kind&&<p className="dim" role="status">{copy('Đang xử lý…')}</p>}
            {feedbackLine(kind)}
          </div>
        </article>;
      })}
    </section>
  </div>;
}
