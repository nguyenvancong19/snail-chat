'use client';

import { ShopAgentUsage } from './agent-usage.jsx';
import { ListPagination, useListPage } from './list-pagination.jsx';

import { useDisplayLocale } from '../lib/display-locale.jsx';

import { useEffect, useState } from 'react';
import { acknowledgementTemplates, commentDecision, decideBotReply, renderBotReply } from '@reeldesk/bot-rules';
import { api } from '../lib/workspace.js';
import { AiDraft } from './openrouter.jsx';
import { AgentDocuments } from './page-documents.jsx';
import { TemplatesEditor } from './messenger.jsx';
import { BotForm, Dialog } from './forms.jsx';
import { Button, Empty, Field, PageAvatar, Title } from './ui.jsx';

function BotScope({ channels, channel, kind, setSelectedChannel, setBotKind, showSurface=true }) {
  const {copy}=useDisplayLocale();
  return <div className="toolbar">
    <label htmlFor="bot-page">Page</label>
    <select id="bot-page" value={channel.id} onChange={(event)=>setSelectedChannel(event.target.value)}>
      {channels.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    {showSurface&&!channel.messageBotPolicy?.unifiedAgent&&<><div className="bot-kind" role="group" aria-label={copy("Áp dụng cho")}>
      <Button aria-pressed={kind==='message'} disabled={channel.platform!=='fb'}
        variant={kind==='message'?'primary':''} onClick={()=>setBotKind('message')}>Messenger</Button>
      <Button aria-pressed={kind==='comment'}
        variant={kind==='comment'?'primary':''} onClick={()=>setBotKind('comment')}>{copy("Bình luận")}</Button>
    </div>
    {channel.platform!=='fb'&&<small className="dim">{copy("Messenger chỉ dành cho Facebook Page.")}</small>}</>}
  </div>;
}

function scope(props) {
  const channel=props.state.channels.find((item)=>item.id===props.selectedChannel)??props.state.channels[0];
  const kind=channel?.platform==='fb'?(channel.messageBotPolicy?.unifiedAgent?'message':props.botKind):'comment';
  const policy=kind==='message'?channel?.messageBotPolicy:channel?.policy;
  const mode=kind==='message'?channel?.messageBotMode:channel?.botMode;
  const faqs=(policy?.rules??[]).filter((rule)=>rule.type==='faq');
  return {channel,kind,policy,mode,faqs};
}

function FaqForm({ item, channel, onSave, close }) {
  const {copy}=useDisplayLocale();
  const [question,setQuestion]=useState(item?.name??''), [answer,setAnswer]=useState(item?.reply??'');
  const phrases=(form,name)=>String(form.get(name)??'').split(/[,\n]+/).map((part)=>part.trim()).filter(Boolean);
  return <Dialog title={item?copy("Sửa FAQ"):copy("Thêm FAQ")} close={close} submit={async(form)=>{
    const name=String(form.get('question')).trim();
    await onSave({
      type:'faq',faqId:item?.faqId||item?.name||crypto.randomUUID(),name,group:String(form.get('group')).trim(),
      include:[...new Set([name,...phrases(form,'alternatives')])],
      context:phrases(form,'context'),exclude:phrases(form,'exclude'),
      reply:String(form.get('answer')).trim(),action:form.get('action'),enabled:form.has('enabled'),
    });
  }}>
    <Field label={copy("Nhóm chủ đề")}><input name="group" maxLength={60} defaultValue={item?.group} placeholder={copy("Giao hàng, Hợp tác…")}/></Field>
    <Field label={copy("Câu hỏi")}><input name="question" maxLength={80} required value={question} onChange={(event)=>setQuestion(event.target.value)}/></Field>
    <Field label={copy("Câu trả lời")}><textarea name="answer" maxLength={1000} rows={4} required value={answer} onChange={(event)=>setAnswer(event.target.value)}/></Field>
    <AiDraft channel={channel} kind="faq" onDraft={(draft)=>{setQuestion(draft.question);setAnswer(draft.reply);}}/>
    <Field label={copy("Các cách hỏi khác")}><textarea name="alternatives" rows={2} defaultValue={item?.include.filter((part)=>part!==item.name).join(', ')} placeholder={copy("Tách từng cụm bằng dấu phẩy hoặc xuống dòng")}/></Field>
    <details className="bot-collapsible"><summary>{copy("Điều kiện ngữ cảnh")}</summary>
      <div className="bot-section">
        <Field label={copy("Cụm từ cần có")}><input name="context" defaultValue={item?.context.join(', ')}/></Field>
        <Field label={copy("Cụm từ cần bỏ qua")}><input name="exclude" defaultValue={item?.exclude.join(', ')}/></Field>
      </div>
    </details>
    <Field label={copy("Khi khớp FAQ")}><select name="action" defaultValue={item?.action??'review'}>
      <option value="review">{copy("Chờ duyệt")}</option><option value="auto">{copy("Tự gửi khi bot cho phép")}</option>
    </select></Field>
    <label className="check"><input name="enabled" type="checkbox" defaultChecked={item?.enabled!==false}/> {copy("Bật FAQ")}</label>
  </Dialog>;
}

function BatchFaq({channel,kind,close,onSave}) {
  const {copy}=useDisplayLocale();
  const [items,setItems]=useState([]),[selected,setSelected]=useState([]);
  const [count,setCount]=useState(5),[prompt,setPrompt]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function generate(){
    setBusy(true);setError('');setItems([]);setSelected([]);
    try{
      const result=await api('ai/faqs','POST',{channel:channel.id,surface:kind,count,prompt},AbortSignal.timeout(25_000));
      setItems(result.items);setSelected(result.items.map((_,index)=>index));
    }catch(problem){setError(problem.message);}
    finally{setBusy(false);}
  }
  return <Dialog title={copy("Tạo nhiều FAQ bằng AI")} close={close} label={copy("Lưu mục đã chọn")} submit={async()=>{
    if(!selected.length||busy)throw new Error('Chọn ít nhất một FAQ đã tạo.');
    await onSave(items.filter((_,index)=>selected.includes(index)).map((item)=>({
      type:'faq',faqId:crypto.randomUUID(),name:item.question,reply:item.reply,group:item.group,
      include:[...new Set([item.question,...item.alternatives])],context:[],exclude:[],enabled:true,action:'review',
    })));
  }}>
    <p className="bot-hint">{copy("OpenRouter nhận mục đích, thông tin Page và danh mục sản phẩm của Page bán hàng. FAQ lưu ở chế độ Chờ duyệt.")}</p>
    <Field label={copy("Số lượng tối đa")}><select value={count} onChange={(event)=>setCount(Number(event.target.value))}>
      {[1,2,3,4,5,6,7,8].map((number)=><option key={number}>{number}</option>)}</select></Field>
    <Field label={copy("Yêu cầu bổ sung (tùy chọn)")}><textarea value={prompt} maxLength={2000} onChange={(event)=>setPrompt(event.target.value)}/></Field>
    <Button onClick={generate} disabled={busy}>{busy?copy("Đang tạo…"):copy("Tạo danh sách FAQ")}</Button>
    {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    {items.map((item,index)=><div className="bot-group" key={index}>
      <label className="check"><input type="checkbox" checked={selected.includes(index)} onChange={(event)=>
        setSelected((current)=>event.target.checked?[...current,index]:current.filter((value)=>value!==index))}/>{item.question}</label>
      <p>{item.reply}</p>
    </div>)}
  </Dialog>;
}

function FaqList({ faqs, channel, kind, save }) {
  const {copy}=useDisplayLocale();
  const [batch,setBatch]=useState(null);
  const [search,setSearch]=useState('');
  const [edit,setEdit]=useState(null);
  const [remove,setRemove]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const filtered=faqs.map((faq,index)=>({faq,index})).filter(({faq})=>
    [faq.name,faq.reply,faq.group].some((value)=>value?.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')))).reverse();
  const list=useListPage(filtered);
  const groups=Map.groupBy(list.items,({faq})=>faq.group||'Chưa phân nhóm');
  const write=(items,previous=faqs)=>save('bots/faqs',{id:channel.id,kind,items,previous});
  async function toggle(index) {
    setBusy(true);setError('');
    try {await write(faqs.map((faq,i)=>i===index?{...faq,enabled:faq.enabled===false}:faq));}
    catch(error){setError(error.message);}
    finally{setBusy(false);}
  }
  return <>
    <div className="toolbar faq-toolbar">
      <label htmlFor="faq-search">{copy("Tìm FAQ")}</label><input id="faq-search" value={search} onChange={(e)=>{setSearch(e.target.value);list.pagination.onChange(1);}}/>
      <span>{faqs.filter((faq)=>faq.enabled!==false).length} {copy("đang bật ·")} {faqs.length} FAQ</span>
      {channel.aiToolsEnabled===true&&<Button disabled={busy} onClick={()=>setBatch(faqs)}>{copy("Tạo nhiều FAQ bằng AI")}</Button>}
      <Button variant="primary" disabled={busy} onClick={()=>setEdit({index:-1,previous:faqs})}>{copy("Thêm FAQ")}</Button>
    </div>
    {error&&<p role="alert" className="formerror">{copy(error)}</p>}
    {!groups.size&&<div className="card"><Empty>{faqs.length?copy("Không tìm thấy FAQ phù hợp."):copy("Page này chưa có FAQ cho mục đã chọn.")}</Empty></div>}
    {[...groups].map(([group,items])=><section key={group} className="faq-group">
      <header><h2>{group}</h2><small>{items.length} {copy("câu hỏi")}</small></header>
      {items.map(({faq,index})=><article className="card faq-row" key={index}>
        <div><h3>{faq.name}</h3><p>{faq.reply}</p>
          <small className="dim">{faq.enabled===false?copy("Đang tắt"):copy("Đang bật")} · {faq.action==='auto'?copy("Tự gửi khi bot cho phép"):copy("Chờ duyệt")}</small>
        </div>
        <div className="faq-actions">
          <Button disabled={busy} onClick={()=>toggle(index)}>{faq.enabled===false?copy("Bật"):copy("Tắt")}</Button>
          <Button disabled={busy} onClick={()=>setEdit({index,item:faq,previous:faqs})}>{copy("Sửa")}</Button>
          <Button disabled={busy} variant="danger" onClick={()=>setRemove({index,item:faq,previous:faqs})}>{copy("Xóa")}</Button>
        </div>
      </article>)}
    </section>)}
    <ListPagination {...list.pagination}/>
    {batch&&<BatchFaq {...{channel,kind}} close={()=>setBatch(null)} onSave={(items)=>{
      const names=new Set(batch.map((faq)=>faq.name.toLocaleLowerCase('vi')));
      const unique=items.filter((item)=>{
        const name=item.name.toLocaleLowerCase('vi');
        if(names.has(name))return false;
        names.add(name);return true;
      });
      if(!unique.length)throw new Error('Các câu hỏi đã có trong Kho FAQ.');
      return write([...batch,...unique],batch);
    }}/>}
    {edit&&<FaqForm channel={channel} item={edit.item} close={()=>setEdit(null)} onSave={(item)=>write(
      edit.index<0?[...edit.previous,item]:edit.previous.map((faq,index)=>index===edit.index?item:faq),edit.previous)}/>}
    {remove&&<Dialog title={copy("Xóa FAQ")} label={copy("Xóa FAQ")} close={()=>setRemove(null)} submit={()=>write(
      remove.previous.filter((_,index)=>index!==remove.index),remove.previous)}>
      <p>{remove.item.name}</p>
    </Dialog>}
  </>;
}

export function BotKnowledge(props) {
  const {copy}=useDisplayLocale();
  const {channel,kind,faqs}=scope(props);
  const {faq,quickReplies}=props.state.planFeatures?.feature_flags??{};
  const quick=quickReplies&&(!faq||props.workspaceTab==='quick-replies');
  const [notice,setNotice]=useState(null);
  return <>
    <Title title={copy(faq&&quickReplies?'FAQ & Chat nhanh':faq?'FAQ':'Chat nhanh')} subtitle={copy("Quản lý nội dung phản hồi theo từng kênh.")}/>
    {faq&&quickReplies&&<div className="toolbar" role="group" aria-label={copy("Loại nội dung")}>
      <Button variant={quick?'':'primary'} aria-pressed={!quick} onClick={()=>props.go('bot-knowledge')}>{copy("FAQ cho bot")}</Button>
      <Button variant={quick?'primary':''} aria-pressed={quick} onClick={()=>props.go('quick-replies')}>{copy("Chat nhanh")}</Button>
    </div>}
    {channel?<><BotScope {...props} channels={props.state.channels} channel={channel} kind={kind} showSurface={!quick}/>
      {quick?<section className="card bot-workspace-card">
        <h2>{copy("Mẫu Chat nhanh")}</h2>
        {channel.platform==='fb'&&channel.messenger?<><p className="dim">{copy("Gõ lệnh như /qr trong Messenger để chèn mẫu, rồi bấm Gửi.")}</p>
          {notice===channel.id&&<p className="notice" role="status">{copy("Đã lưu thay đổi mẫu Chat nhanh.")}</p>}
          <TemplatesEditor key={channel.id} channel={channel.id} onChange={()=>setNotice(channel.id)}/>
        </>:<p className="dim">{copy("Chọn Facebook Page đã cấp quyền Messenger để quản lý mẫu.")}</p>}
      </section>:<FaqList key={channel.id+kind} {...{faqs,channel,kind,save:props.save}}/>}
    </>:<Empty>{copy("Kết nối một kênh để quản lý nội dung phản hồi.")}</Empty>}
  </>;
}

function BotTester({ channel, kind, policy, mode, faqs }) {
  const {copy}=useDisplayLocale();
  const [question,setQuestion]=useState('');
  const [context,setContext]=useState('');
  const [result,setResult]=useState(null);
  function test(event) {
    event.preventDefault();
    if(!question.trim())return;
    if(mode==='off'){setResult({category:'Bot đang tắt',action:'review'});return;}
    if(kind==='message'&&mode==='greeting'){
      setResult({category:'Lời chào trong lượt chờ mới',action:'auto',reply:acknowledgementTemplates[channel.messageGreeting]});
      return;
    }
    if(policy?.version===2){
      setResult(decideBotReply(policy,question,{context,manualOnly:mode==='review'}));
      return;
    }
    const decision=commentDecision(mode==='auto'?policy:null,question);
    setResult({...decision,action:decision.reply?'auto':'review'});
  }
  return <section className="card bot-workspace-card">
    <h2>{copy("Kiểm tra bot")}</h2>
    <p className="dim">{copy("Thử bằng cấu hình đã lưu của")} {channel.name}.</p>
    <div className="faq-actions">{faqs.filter((faq)=>faq.enabled!==false).slice(0,3).map((faq,index)=>
      <button type="button" className="button bot-sample" key={index} onClick={()=>{setQuestion(faq.name);setResult(null);}}>{faq.name}</button>)}</div>
    <form onSubmit={test}>
      {kind==='message'&&<Field label={copy("Tin nhắn trước đó (tùy chọn)")}><input value={context} maxLength={4000}
        onChange={(event)=>{setContext(event.target.value);setResult(null);}}/></Field>}
      <Field label={kind==='message'?copy("Tin nhắn của khách"):copy("Bình luận của khách")}><textarea value={question} maxLength={4000} rows={3}
        onChange={(event)=>{setQuestion(event.target.value);setResult(null);}}/></Field>
      <Button type="submit" variant="primary" disabled={!question.trim()}>{copy("Thử phản hồi")}</Button>
    </form>
    {result&&<div className="notice bot-preview" role="status">
      <strong>{{auto:'Tự gửi',review:'Chờ duyệt',blocked:'Bot bỏ qua'}[result.action]}{result.category?' · '+result.category:''}</strong>
      {result.reply&&<p>{renderBotReply(result.reply,{customerName:'Khách thử',pageName:channel.name})}</p>}
    </div>}
  </section>;
}

function legacyAgentGuide(channel){
  const policy=channel.messageBotPolicy;
  return policy?.unifiedAgent?policy.agentMarkdown??'':policy?.agentMarkdown||channel.policy?.agentMarkdown||'';
}

function UnifiedAgentForm({channel,save,orderManagement,hasGeneralFile}){
  const {copy}=useDisplayLocale();
  const policy=channel.messageBotPolicy;
  const [mode,setMode]=useState(policy?.unifiedAgent?policy.agentMode??'off':'off');
  const [markdown,setMarkdown]=useState(()=>legacyAgentGuide(channel));
  const [checkout,setCheckout]=useState(!!channel.ordersEnabled);
  useEffect(()=>setCheckout(!!channel.ordersEnabled),[channel.ordersEnabled]);
  const guide=hasGeneralFile?legacyAgentGuide(channel):markdown;
  return <Dialog inline title={copy("AI agent của Page")} label={copy("Lưu AI agent")}
    submit={()=>save('bots/agent',{id:channel.id,mode,markdown:guide,checkout:orderManagement?channel.platform==='fb'&&channel.purpose==='sales'&&checkout:undefined})}>
    <Field label={copy("Chế độ hoạt động")}><select value={mode} onChange={(event)=>setMode(event.target.value)}>
      <option value="off">{copy("Tắt")}</option>
      <option value="review" disabled={!channel.messenger}>{copy("Soạn để shop duyệt")}</option>
      <option value="auto" disabled={!channel.messenger}>{copy("Tự động xử lý")}</option>
    </select></Field>
    {!channel.messenger&&<p className="notice">{copy("Kết nối lại Facebook Page để cấp quyền Messenger.")}</p>}
    {hasGeneralFile!==null&&<p className="bot-hint" role="status">{copy(hasGeneralFile
      ?"Agent lấy hướng dẫn chung từ các tệp đã lưu ở mục Hướng dẫn chung."
      :legacyAgentGuide(channel).trim()
        ?"Agent dùng hướng dẫn cũ cho đến khi Page có tệp thuộc mục Hướng dẫn chung."
        :"Page chưa có hướng dẫn chung. Bạn có thể thêm một tệp thuộc mục Hướng dẫn chung.")}</p>}
    {hasGeneralFile!==null&&(!hasGeneralFile||guide.trim())&&<details className="bot-collapsible">
      <summary>{copy(hasGeneralFile?"Xem hướng dẫn cũ đang lưu dự phòng":"Hướng dẫn cũ của Page (dự phòng)")}</summary>
      <div className="bot-section">
        <Field label={copy("Nội dung hướng dẫn cũ")}><textarea rows={9} maxLength={8000}
          value={guide} readOnly={hasGeneralFile} onChange={(event)=>setMarkdown(event.target.value)}/></Field>
        {!hasGeneralFile&&<p className="bot-hint">{copy("Dùng một mục trên mỗi dòng, giữ nguyên tên mục bên dưới, thêm dấu hai chấm rồi nhập thông tin của shop.")} <code>Giờ mở cửa · Địa chỉ cửa hàng · Liên hệ công khai · Ưu đãi</code></p>}
      </div>
    </details>}
    {channel.platform==='fb'&&channel.purpose==='sales'&&orderManagement&&<label className="check"><input type="checkbox" checked={checkout}
      onChange={(event)=>setCheckout(event.target.checked)}/> {copy("Cho phép agent chốt và tạo đơn trong Messenger")}</label>}
    {channel.platform==='fb'&&channel.purpose==='sales'&&orderManagement&&<p className="bot-hint">{copy("Tạo đơn cần chế độ Tự động xử lý và xác nhận của khách.")}</p>}
  </Dialog>;
}

function FacebookAgentSettings({channel,save,orderManagement}){
  const [files,setFiles]=useState(null);
  const hasGeneralFile=files?.some(({purpose})=>purpose==='general')??null;
  return <>
    <AgentDocuments channel={channel} onFilesChange={setFiles} hasLegacyGuide={!!legacyAgentGuide(channel).trim()}/>
    <UnifiedAgentForm channel={channel} save={save} orderManagement={orderManagement} hasGeneralFile={hasGeneralFile}/>
  </>;
}

export function BotConfiguration(props) {
  const {copy}=useDisplayLocale();
  const {channel,kind,mode,policy,faqs}=scope(props);
  if(channel?.platform==='fb')return <>
    <Title title={copy("Cấu hình bot")} subtitle={copy("Một AI agent cho bình luận, Messenger và chốt đơn.")}/>
    <ShopAgentUsage/>
    <BotScope {...props} channels={props.state.channels} channel={channel} kind={kind} showSurface={false}/>
    {props.state.planFeatures?.agent_mode==='SCHEDULED'&&<p className="notice">
      {props.state.planFeatures.agent_active?copy("Agent đang trong ca."):copy("Agent hiện ngoài ca.")} {copy("Tin đến ngoài ca vẫn có trong hộp thư để shop xử lý thủ công.")}
    </p>}
    <FacebookAgentSettings key={channel.id} channel={channel} save={props.save} orderManagement={props.state.planFeatures?.order_management===true}/>
  </>;
  const modeLabel={auto:'Kết hợp tự gửi và duyệt tay',review:'Chỉ duyệt thủ công',rules:'Theo từng quy tắc',greeting:'Lời chào theo lượt chờ',off:'Đang tắt'};
  return <>
    <Title title={copy("Cấu hình bot")} subtitle={copy("Chọn cách bot xử lý tin nhắn và bình luận của từng Page.")}/>
    <ShopAgentUsage/>
    {channel?<><BotScope {...props} channels={props.state.channels} channel={channel} kind={kind}/>
      <div className="bot-workspace-grid">
        <div>
          <section className="card bot-workspace-card">
            <div className="bot-workspace-heading"><PageAvatar channel={channel}/><div><h2>{channel.name}</h2>
              <small className="dim">{kind==='message'?'Messenger':copy("Bình luận")}</small></div></div>
            <p className="notice">{modeLabel[mode]??copy("Đang tắt")}</p>
          </section>
          <BotForm key={channel.id+kind} inline channel={channel} messaging={kind==='message'} save={props.save}/>
        </div>
        <div>
          <section className="card bot-workspace-card">
            <h2>{copy("Kiến thức của bot")}</h2>
            <p>{faqs.filter((faq)=>faq.enabled!==false).length} {copy("FAQ đang bật")}</p>
            <Button icon="document" onClick={()=>{props.setSelectedChannel(channel.id);props.go('bot-knowledge');}}>{copy("Mở kho FAQ")}</Button>
          </section>
          <BotTester key={channel.id+kind} {...{channel,kind,policy,mode,faqs}}/>
        </div>
      </div>
    </>:<Empty>{copy("Kết nối một Page để cấu hình bot.")}</Empty>}
  </>;
}
