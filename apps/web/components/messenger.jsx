'use client';

import { ListPagination, useListPage } from './list-pagination.jsx';

import { AgentProductReview } from './agent-product-review.jsx';
import { useDisplayLocale } from '../lib/display-locale.jsx';

import { Fragment, useEffect, useRef, useState } from 'react';
import { activityLabels, api, formatDate } from '../lib/workspace.js';
import { BotReplyPicker, Dialog } from './forms.jsx';
import { Button, Field } from './ui.jsx';

const templatesPath=(channel)=>'messenger/templates?'+new URLSearchParams({channel});
const fileExtensions='.jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx';

function useTemplates(channel, revision) {
  const [items,setItems]=useState([]);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!channel)return;
    const controller=new AbortController();
    setError('');
    api(templatesPath(channel),'GET',undefined,AbortSignal.any([controller.signal,AbortSignal.timeout(8_000)]))
      .then((result)=>{if(!controller.signal.aborted)setItems(result.items);})
      .catch((error)=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[channel,revision]);
  return channel?{items,error}:{items:[],error:''};
}

export function TemplatesEditor({ channel, onChange=()=>{} }) {
  const {copy}=useDisplayLocale();
  const [revision,setRevision]=useState(0);
  const {items,error}=useTemplates(channel,revision);
  const list=useListPage(items);
  const [command,setCommand]=useState(''), [text,setText]=useState('');
  const [busy,setBusy]=useState(false), [problem,setProblem]=useState('');
  const [image,setImage]=useState(null), [imageName,setImageName]=useState('');
  async function save(remove=false) {
    setBusy(true);setProblem('');
    try{
      let body={channel,command,text,remove};
      if(image&&!remove){
        body=new FormData();body.set('channel',channel);body.set('command',command);body.set('attachment',image);
      }
      await api('messenger/templates','POST',body,AbortSignal.timeout(image?90_000:8_000));
      setCommand('');setText('');setImage(null);setImageName('');
      if(!remove)list.pagination.onChange(1);
      setRevision((value)=>value+1);
      onChange();
    }catch(error){setProblem(error.message);}
    finally{setBusy(false);}
  }
  const saved=items.some((item)=>item.command===command.trim().toLowerCase().replace(/^\//,''));
  return <>
    {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    {items.length>0&&<div className="messenger-template-list">
      {list.items.map((item)=><Button key={item.command} aria-pressed={command===item.command}
        disabled={busy} onClick={()=>{setCommand(item.command);setText(item.text);setImage(null);setImageName(item.imageName||'');setProblem('');}}>/{item.command}</Button>)}
    </div>}
    <ListPagination {...list.pagination}/>
    <form onSubmit={(event)=>{event.preventDefault();save();}}>
      <Field label={copy("Lệnh")}><input value={command} maxLength={33} required placeholder="/gia"
        onChange={(event)=>setCommand(event.target.value)}/></Field>
      <Field label={copy("Nội dung mẫu")}><textarea value={text} maxLength={1000} rows={4} disabled={!!image}
        onChange={(event)=>setText(event.target.value)}/></Field>
      <Field label={copy("Hoặc chọn ảnh mẫu (ví dụ mã QR)")}><input type="file" accept=".png,.jpg,.jpeg,.webp,.gif" onChange={(event)=>{
        const file=event.target.files?.[0];event.target.value='';
        if(file){setImage(file);setImageName(file.name);setText('');}
      }}/></Field>
      {imageName&&<p className="dim">{copy("Ảnh mẫu:")} {imageName}</p>}
      {problem&&<p className="formerror" role="alert">{copy(problem)}</p>}
      <div className="action-row">
        {saved&&<Button variant="danger" disabled={busy} onClick={()=>save(true)}>{copy("Xóa mẫu")}</Button>}
        <Button disabled={busy||(!command&&!text)} onClick={()=>{setCommand('');setText('');setImage(null);setImageName('');setProblem('');}}>{copy("Mẫu mới")}</Button>
        <Button type="submit" variant="primary" disabled={busy||!command.trim()||(!text.trim()&&!image)}>{copy("Lưu mẫu")}</Button>
      </div>
    </form>
  </>;
}

export function MessengerTemplates({ channels, selectedChannel, close, onChange }) {
  const {copy}=useDisplayLocale();
  const [channel,setChannel]=useState(channels.some((item)=>item.id===selectedChannel)?selectedChannel:channels[0].id);
  return <Dialog title={copy("Mẫu tin nhanh Messenger")} close={close}>
    <Field label="Facebook Page"><select value={channel} onChange={(event)=>setChannel(event.target.value)}>
      {channels.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}
    </select></Field>
    <TemplatesEditor key={channel} channel={channel} onChange={onChange}/>
  </Dialog>;
}

function MessageAttachments({ attachments }) {
  return attachments?.map(({type,name,url},index)=>{
    if(url&&type==='image')return <a key={index} href={url} target="_blank" rel="noreferrer">
      <img className="messenger-media" src={url} loading="lazy" alt={name} referrerPolicy="no-referrer"/>
    </a>;
    if(url&&type==='video')return <video key={index} className="messenger-media" src={url} controls preload="none" aria-label={name}/>;
    return url?<a className="messenger-attachment" key={index} href={url} target="_blank" rel="noreferrer">{name}</a>
      :<span className="messenger-attachment" key={index}>{name}</span>;
  });
}

function messagePreview(message) {
  return message.text||message.attachments?.[0]?.name||'Tin nhắn';
}

export function MessengerTimeline({ items, outbound=[], onQuote, selectedMid, focusMid, aiToolsEnabled, canRespond, latestId }) {
  const {intl,copy,t}=useDisplayLocale();
  const entries=(items??[]).toReversed().flatMap((message)=>{
    const reply=message.reply||message.replyAttachment;
    return [
      {key:message.id,mid:message.mid,by:'customer',text:message.text,created:message.created,
        attachments:message.attachments,quoteMid:message.quoteMid,botCategory:message.botCategory,
        review:message.orderReview,status:message.status,paused:message.agentResumeAt>Date.now(),
        replyError:message.status!=='replied'?message.replyError:null},
      ...(message.greeting?[{key:message.id+'-greeting',mid:message.greetingMid,by:'page',label:'Lời chào tự động',
        text:message.greeting,created:message.created}]:[]),
      ...(message.previousReplies??[]).map((entry,index)=>({
        key:message.id+'-previous-'+index,by:'page',label:'Page',mid:entry.mid,text:entry.text,created:entry.sentAt,
        quote:entry.quote,attachments:entry.attachment?[entry.attachment]:[],
      })),
      ...(reply?[{key:message.id+'-reply',mid:message.replyMid,by:'page',
        label:(message.reviewReply?copy('Agent · Shop chuyển tiếp'):message.automatic?'Bot':'Page')+(message.status==='replied'?'':' · '+activityLabels[message.status]),
        text:message.reply,created:message.sentAt??message.created,quote:message.replyQuote,
        attachments:message.replyAttachment?[message.replyAttachment]:[]}]:[]),
    ];
  });
  const known=new Set(entries.map((entry)=>entry.mid));
  for(const message of outbound){
    if(!known.has(message.mid))entries.push({...message,key:'page:'+message.mid,by:'page',
      label:message.fromApp?'Ứng dụng khác · App ID '+message.appId:'Page · Facebook'});
  }
  entries.sort((first,second)=>first.created-second.created);
  const byMid=new Map(entries.filter((entry)=>entry.mid).map((entry)=>[entry.mid,entry]));
  return entries.map((entry)=>{
    const quoted=entry.quote??byMid.get(entry.quoteMid);
    return <Fragment key={entry.key}>
      <div className={'bubble'+(entry.by==='page'?' sent':'')+(focusMid&&focusMid===entry.mid?' focused-comment':'')}>
        <div className="messenger-bubble-head">
          <small>{entry.label??copy("Khách")} · {formatDate(entry.created,intl)}</small>
          {entry.mid&&onQuote&&<Button variant="subtle" aria-pressed={selectedMid===entry.mid}
            onClick={()=>onQuote({mid:entry.mid,by:entry.by,text:messagePreview(entry).slice(0,240)})}>{t('reply')}</Button>}
        </div>
        {(quoted||entry.quoteMid)&&<blockquote className="messenger-quote">
          <small>{quoted?.by==='page'?'Page':quoted?.by==='customer'?copy("Khách"):copy("Tin được trích dẫn")}</small>
          {quoted&&<p>{messagePreview(quoted)}</p>}
        </blockquote>}
        {aiToolsEnabled===true&&entry.botCategory&&<small className="bot-category">{entry.botCategory}</small>}
        {entry.text&&<p>{entry.text}</p>}
        <MessageAttachments attachments={entry.attachments}/>
        {entry.replyError&&(!entry.review||entry.review.decision)&&<p className="notice">{entry.replyError}</p>}
      </div>
      {entry.review&&<AgentProductReview id={entry.key} review={entry.review}
        {...{canRespond}} status={entry.status} paused={entry.paused} latest={entry.key===latestId}/>}
    </Fragment>;
  });
}

export function MessengerComposer({ item, channel, save, quote, setQuote, templateRevision, reviewItem=item }) {
  const {copy,t}=useDisplayLocale();
  const [text,setText]=useState(''), [file,setFile]=useState(null);
  const [imageTemplate,setImageTemplate]=useState(null);
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const request=useRef(null), input=useRef(null);
  const {items,error:templateError}=useTemplates(channel.quickRepliesEnabled?channel.id:null,templateRevision);
  const expired=item.status==='expired'||item.created<=Date.now()-86_400_000;
  const canSend=channel.messenger&&!expired&&['review','replied'].includes(item.status);
  const command=/^\/([a-z\d_-]*)$/i.exec(text.trim())?.[1].toLowerCase();
  const suggestions=command===undefined?[]:items.filter((item)=>item.command.startsWith(command)).slice(0,8);
  const exact=suggestions.find((item)=>item.command===command);

  function insertTemplate(template) {
    setText(template.text);
    if(template.imageName)setFile(null);
    setImageTemplate(template.imageName?template:null);
    setError('');
    input.current?.focus();
  }
  function changeText(value) {
    const completed=/^\/([a-z\d_-]+) $/i.exec(value)?.[1].toLowerCase();
    const template=completed&&items.find((item)=>item.command===completed);
    if(template)insertTemplate(template);
    else setText(value);
  }
  function chooseFile(event) {
    const selected=event.target.files?.[0];
    event.target.value='';
    if(!selected)return;
    const extension=selected.name.split('.').at(-1).toLowerCase();
    const accepted=fileExtensions.split(',').includes('.'+extension);
    const image=['jpg','jpeg','png','gif','webp'].includes(extension);
    if(!accepted){setError('Định dạng tệp này chưa được hỗ trợ.');return;}
    if(!selected.size||selected.size>(image?8:20)*1024*1024){
      setError('Ảnh tối đa 8 MB. Video và tệp tối đa 20 MB.');
      return;
    }
    setImageTemplate(null);setFile(selected);setError('');
  }
  async function submit(event) {
    event.preventDefault();
    if(!canSend||busy||imageTemplate&&!channel.quickRepliesEnabled)return;
    if(!file&&!imageTemplate&&command!==undefined){
      if(exact)insertTemplate(exact);
      else setError('Chưa có mẫu cho lệnh này. Tạo mẫu trong Chat nhanh.');
      return;
    }
    const templateCommand=imageTemplate?.command;
    const reply=file||templateCommand?'':text.trim();
    if(!file&&!reply&&!templateCommand)return;
    if(!request.current||request.current.file!==file||request.current.templateCommand!==templateCommand||request.current.reply!==reply||request.current.quoteMid!==quote?.mid){
      request.current={file,reply,templateCommand,quoteMid:quote?.mid,itemId:item.id,id:crypto.randomUUID()};
    }
    const current=request.current;
    const payload={id:current.itemId,kind:'message',reply,requestId:current.id,...(templateCommand?{templateCommand}:{}),...(current.quoteMid?{quoteMid:current.quoteMid}:{})};
    let body=payload;
    if(file){
      body=new FormData();
      for(const [key,value] of Object.entries(payload))body.set(key,value);
      body.set('attachment',file);
    }
    setBusy(true);setError('');
    try{
      await save('replies',body);
      if(imageTemplate)setImageTemplate(null);
      if(file)setFile(null);
      else setText('');
      setQuote(null);
      request.current=null;
    }catch(error){
      if(error.status>=400&&error.status<500)request.current=null;
      setError(error.message);
    }
    finally{setBusy(false);}
  }
  return <form className="inbox-reply messenger-composer" onSubmit={submit}>
    {quote&&<div className="messenger-composer-quote">
      <blockquote className="messenger-quote"><small>{t('reply')} {quote.by==='page'?'Page':copy("khách")}</small><p>{quote.text}</p></blockquote>
      <Button icon="x" variant="subtle" aria-label={t('removeQuote')} disabled={busy} onClick={()=>setQuote(null)}/>
    </div>}
    {canSend&&<BotReplyPicker item={reviewItem} channel={channel}
      rules={channel.messageBotMode==='rules'?channel.messageBotPolicy?.rules.filter((rule)=>rule.enabled!==false&&rule.action!=='ignore'):[]}
      onInsert={(text)=>insertTemplate({text})} disabled={busy||!!file}/>}
    <label><span>{t('messageAs')} <strong>{channel.name}</strong></span>
      <textarea ref={input} value={text} onChange={(event)=>changeText(event.target.value)} maxLength={1000} rows={3}
        disabled={!canSend||busy||!!imageTemplate} placeholder={t(channel.quickRepliesEnabled?'writeMessage':'writeReply')}
        onKeyDown={(event)=>{
          if(!event.nativeEvent.isComposing&&!event.shiftKey&&exact&&(event.key==='Enter'||event.key==='Tab')){
            event.preventDefault();insertTemplate(exact);
          }
        }}/>
    </label>
    {suggestions.length>0&&<div className="messenger-suggestions" aria-label={t('templateSuggestions')}>
      {suggestions.map((item)=><button type="button" key={item.command} disabled={!canSend||busy}
        onClick={()=>insertTemplate(item)}><strong>/{item.command}</strong><span>{item.imageName||item.text}</span></button>)}
    </div>}
    {command!==undefined&&templateError&&<small className="formerror">{copy(templateError)}</small>}
    {imageTemplate&&<div className="messenger-composer-quote">
      <span className="messenger-attachment">{imageTemplate.imageName}</span>
      <Button icon="x" variant="subtle" aria-label={t('removeTemplateImage')} disabled={busy} onClick={()=>setImageTemplate(null)}/>
    </div>}
    {file&&<div className="messenger-composer-quote">
      <span className="messenger-attachment">{file.name} · {t('sendPrivately')}</span>
      <Button icon="x" variant="subtle" aria-label={t('removeFile')} disabled={busy} onClick={()=>setFile(null)}/>
    </div>}
    {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    {expired&&<small className="dim">{t('expiredConversation')}</small>}
    <div className="messenger-compose-actions">
      <label className="button messenger-file-picker">
        {t('attach')}
        <input type="file" aria-label={t('attachFiles')} accept={fileExtensions}
          disabled={!canSend||busy} onChange={chooseFile}/>
      </label>
      <Button type="submit" variant="primary" icon="send" disabled={!canSend||busy||(!file&&!imageTemplate&&!text.trim())}>
        {t(busy?'processing':file?'sendFile':'sendMessage')}
      </Button>
    </div>
  </form>;
}
