'use client';

import { useDisplayLocale } from '../lib/display-locale.jsx';

import { useEffect, useId, useRef, useState } from 'react';
import { acknowledgementTemplates, decideBotReply, renderBotReply, validateBotPolicy } from '@reeldesk/bot-rules';
import { channelIdentity } from '../lib/workspace.js';
import { Brand, Button, Field, FilePicker, PlatformIcon } from './ui.jsx';
import { AiDraft } from './openrouter.jsx';
import { Icon } from './icons.jsx';

const fields = (form) => Object.fromEntries(form.entries());
export function Dialog({ title, close, submit, label='Lưu', children, extra, inline=false }) {
  const {copy}=useDisplayLocale();
  const ref = useRef(null);
  const titleId=useId();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  useEffect(() => {
    if(inline)return;
    const element=ref.current;
    element.showModal();
    return () => { if (element.open) element.close(); };
  },[inline]);
  async function save(event) {
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    setBusy(true); setError('');
    try { await submit(data,event.currentTarget); if(!inline)close(); }
    catch(e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const body=submit?<form onSubmit={save}>{children}<div className="formerror" role="alert">{copy(error)}</div>
    <div className="action-row">{extra}{!inline&&<Button disabled={busy} onClick={close}>{copy("Hủy")}</Button>}
      <Button variant="primary" type="submit" disabled={busy}>{busy?copy("Đang xử lý…"):copy(label)}</Button></div>
  </form>:children;
  if(inline)return <section className="card bot-workspace-card">
    <h2>{title}</h2>{body}
  </section>;
  return <dialog ref={ref} onCancel={(e)=>{e.preventDefault(); if(!busy)close();}} aria-labelledby={titleId}>
    <header className="dialog-head"><h2 id={titleId}>{title}</h2><button type="button" className="iconbtn" aria-label={copy("Đóng")} disabled={busy} onClick={close}><Icon name="x"/></button></header>
    {body}
  </dialog>;
}

export function Login({ submit, resend, startRecovery=false,startRegistration=false }) {
  const {copy}=useDisplayLocale();
  const [recovery,setRecovery]=useState(startRecovery);
  const [register, setRegister] = useState(startRegistration);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(null);
  const emailInput = useRef(null);

  function selectMode(mode) {
    setRegister(mode);
    setRecovery(false);
    setPending(null);
    setError('');
    setNotice('');
    setShow(false);
  }

  async function authenticate(event) {
    event.preventDefault();
    const data = fields(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await submit(register ? 'register' : 'login', data);
      if (register) {
        if (result.verificationRequired !== true) {
          throw new Error('Máy chủ chưa trả về trạng thái xác minh email. Hãy kiểm tra phiên bản SnailChat đang chạy.');
        }
        const registeredEmail = data.email.trim().toLowerCase();
        setEmail(registeredEmail);
        setPending({ email: registeredEmail, sent: result.sent, receipt: result.resendReceipt });
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function recover(event) {
    event.preventDefault();
    setBusy(true);setError('');setNotice('');
    try{
      await submit('forgot-password',{email});
      setNotice('Nếu địa chỉ này thuộc tài khoản đã xác minh, SnailChat sẽ gửi liên kết đặt lại mật khẩu. Hãy kiểm tra hộp thư đến và thư rác.');
    }catch(problem){setError(problem.message);}
    finally{setBusy(false);}
  }

  async function resendEmail() {
    if (!pending && !emailInput.current?.reportValidity()) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await resend({ email: pending?.email ?? email, receipt: pending?.receipt });
      if (pending) {
        setPending({ ...pending, sent: result.sent });
      } else {
        setNotice('Yêu cầu đã được tiếp nhận. Nếu email đang chờ xác minh, hãy kiểm tra hộp thư đến và thư rác.');
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-promo"><Brand href="/"/><div className="auth-promo-copy">
      <span className="eyebrow">{copy("QUẢN LÝ TƯƠNG TÁC")}</span><h1>{copy("Trả lời khách hàng")}<br/>{copy("ngay trên SnailChat.")}</h1>
      <p>{copy("Kết nối Facebook và Instagram, cấu hình bot phản hồi và theo dõi tương tác trên từng bài đăng.")}</p>
      <div className="auth-platforms"><PlatformIcon platform="fb"/><PlatformIcon platform="ig"/></div>
    </div><div className="auth-art"><img src="/hero.svg" alt=""/></div><div className="auth-caption">SNAILCHAT · FACEBOOK &amp; INSTAGRAM</div></section>
    <section className="auth-main"><div className="auth-inner"><div className="auth-brand"><Brand href="/"/></div>
      {recovery?<section aria-labelledby="forgot-password-title">
        <h2 id="forgot-password-title">{copy("Quên mật khẩu")}</h2>
        <p className="auth-intro">{copy("Nhập email đã xác minh của tài khoản SnailChat.")}</p>
        {notice&&<p className="notice" role="status">{copy(notice)}</p>}
        <form onSubmit={recover}>
          <Field label="Email"><input name="email" type="email" autoComplete="email" required maxLength={254}
            value={email} onChange={(event)=>{setEmail(event.target.value);setNotice('');}}/></Field>
          {error&&<p className="formerror" role="alert">{copy(error)}</p>}
          <Button type="submit" variant="primary auth-submit" disabled={busy}>{busy?copy("Đang gửi…"):notice?copy("Gửi lại liên kết"):copy("Gửi liên kết đặt lại mật khẩu")}</Button>
          <Button variant="subtle" disabled={busy} onClick={()=>selectMode(false)}>{copy("Quay lại đăng nhập")}</Button>
        </form>
      </section>:pending ? <section className="signup-confirmation" aria-labelledby="signup-confirmation-title">
        <div className="signup-confirmation-icon"><Icon name="check"/></div>
        <h2 id="signup-confirmation-title">{copy("Tạo tài khoản thành công")}</h2>
        <p className="auth-intro">{copy("Xác minh")} <strong>{pending.email}</strong> {copy("để đăng nhập SnailChat.")}</p>
        <div className={'notice' + (pending.sent === false ? ' signup-send-error' : '')} role="status">
          {pending.sent === true
            ? copy("SnailChat đã gửi thư xác minh. Hãy mở thư và bấm Xác minh email.")
            : pending.sent === false
              ? copy("Lần gửi thư vừa rồi chưa thành công. Bạn có thể thử gửi lại.")
              : copy("Yêu cầu gửi lại đã được tiếp nhận. Hãy kiểm tra hộp thư đến và thư rác.")}
        </div>
        {pending.sent === true && <p className="signup-help">{copy("Nếu chưa thấy thư, hãy kiểm tra mục Thư rác hoặc yêu cầu gửi lại.")}</p>}
        {error && <p className="formerror" role="alert">{copy(error)}</p>}
        <div className="signup-confirmation-actions">
          <Button variant="primary" icon="send" disabled={busy} onClick={resendEmail}>
            {busy ? copy("Đang gửi…") : copy("Gửi lại thư xác minh")}
          </Button>
          <Button variant="subtle" disabled={busy} onClick={() => selectMode(false)}>{copy("Quay lại đăng nhập")}</Button>
        </div>
      </section> : <>
        <div className="auth-tabs">
          <Button disabled={busy} variant={!register?'active':''} onClick={()=>selectMode(false)}>{copy("Đăng nhập")}</Button>
          <Button disabled={busy} variant={register?'active':''} onClick={()=>selectMode(true)}>{copy("Tạo tài khoản")}</Button>
        </div>
        <h2>{register?copy("Tạo tài khoản SnailChat"):copy("Chào mừng bạn trở lại")}</h2>
        <p className="auth-intro">{register?copy("Xác minh địa chỉ email để mở không gian làm việc của bạn."):copy("Đăng nhập để quản lý các kênh của bạn.")}</p>
        {notice&&<p className="notice" role="status">{copy(notice)}</p>}
        <form onSubmit={authenticate}>
          {register&&<Field label={copy("Tên hiển thị")}><input name="name" autoComplete="name" required maxLength={100} placeholder={copy("Tên của bạn")}/></Field>}
          <Field label="Email"><input ref={emailInput} type="email" name="email" autoComplete="username" required maxLength={254} placeholder="ban@example.com" value={email} onChange={(event)=>setEmail(event.target.value)}/></Field>
          <div className="password-field"><Field label={copy("Mật khẩu")}><input key={register?'new':'current'} name="password" type={show?'text':'password'}
            minLength={register?12:undefined} maxLength={128} autoComplete={register?'new-password':'current-password'} required
            placeholder={register?copy("Tối thiểu 12 ký tự"):copy("Nhập mật khẩu")}/></Field>
            <button type="button" className="iconbtn" aria-label={show?copy("Ẩn mật khẩu"):copy("Hiện mật khẩu")} onClick={()=>setShow(!show)}><Icon name="eye"/></button>
          </div><div className="formerror" role="alert">{copy(error)}</div>
          <Button type="submit" variant="primary auth-submit" disabled={busy} icon="arrow">
            {busy ? (register ? copy("Đang tạo tài khoản…") : copy("Đang xử lý…")) : (register ? copy("Tạo tài khoản") : copy("Đăng nhập"))}
          </Button>
          {!register&&<div className="faq-actions">
            <Button variant="subtle" disabled={busy} onClick={()=>{selectMode(false);setRecovery(true);}}>{copy("Quên mật khẩu")}</Button>
            <Button variant="subtle" disabled={busy} onClick={resendEmail}>{copy("Gửi lại thư xác minh")}</Button>
          </div>}
        </form>
      </>}
    </div></section>
  </main>;
}

export function ChannelForm({ channel, close, save, connect }) {
  const {copy}=useDisplayLocale();
  return <Dialog title={copy("Cấu hình kênh")} close={close} submit={(form)=>save('channels',{id:channel.id,topic:form.get('topic'),purpose:form.get('purpose')})}>
    <p className="notice"><strong>{channel.name}</strong><br/>{channelIdentity(channel)}</p>
    {channel.platform==='fb'&&<Field label={copy("Mục đích của Page")}>
      <select name="purpose" defaultValue={channel.purpose} aria-describedby="channel-purpose-hint">
        <option value="sales">{copy("Bán hàng")}</option>
        <option value="news">{copy("Tin tức")}</option>
        <option value="entertainment">{copy("Giải trí")}</option>
      </select>
    </Field>}
    {channel.platform==='fb'&&<p className="bot-hint" id="channel-purpose-hint">
      {copy("Chọn Bán hàng để có thể tạo đơn và bật chốt đơn cho Agent. Khi chuyển sang Tin tức hoặc Giải trí, đơn cũ vẫn được lưu.")}
    </p>}
    <Field label={copy("Ghi chú chủ đề của kênh")}><textarea name="topic" defaultValue={channel.topic} maxLength={500}/></Field>
    <Button icon="link" onClick={()=>connect(channel.platform,channel.id)}>{channel.connected?copy("Cấp lại quyền"):copy("Kết nối tài khoản")}</Button>
  </Dialog>;
}

export function PageChoicesForm({ grant, close, connect }) {
  const {copy}=useDisplayLocale();
  const [completed,setCompleted]=useState([]);
  async function save(data) {
    const pages=data.getAll('pages');
    if (!pages.length || pages.length>5) throw new Error('Chọn từ 1 đến 5 Facebook Page mỗi lần.');
    const result=await connect(grant.flow,pages);
    setCompleted((previous)=>[...previous,...result.connected]);
    if (result.failed.length) throw new Error(result.failed.map(({name,message})=>name+' — '+message).join(' '));
  }
  return <Dialog title={copy("Chọn Facebook Page")} close={close} label={copy("Kết nối Page")} submit={save}>
    <p className="notice">{grant.single?copy("Chọn Page để kết nối với kênh hiện có."):copy("Chọn tối đa 5 Page được Facebook cấp quyền để kết nối mỗi lần.")}</p>
    {grant.single
      ? <Field label={copy("Page được cấp quyền")}><select name="pages">{grant.options.map(({id,name})=><option value={id} key={id}>{name}</option>)}</select></Field>
      : <div className="checkset">{grant.options.map(({id,name})=><label key={id} className="check"><input type="checkbox" name="pages" value={id} disabled={completed.includes(id)}/>{name}{completed.includes(id)&&copy(" · Đã kết nối")}</label>)}</div>}
  </Dialog>;
}

const splitPhrases=(value)=>value.split(/[,\n]+/).map((phrase)=>phrase.trim()).filter(Boolean);
const blankBotRule=(id,type='rule')=>({id,type,name:'',include:'',context:'',exclude:'',reply:'',action:'review'});

function initialBotRules(policy, channel, messaging) {
  if(policy?.version===2)return policy.rules.map((rule,id)=>({
    ...rule,id,include:rule.include.filter((phrase)=>rule.type!=='faq'||phrase!==rule.name).join(', '),context:rule.context.join(', '),exclude:rule.exclude.join(', '),
  }));
  if(!messaging&&policy?.include)return [{
    ...blankBotRule(0),name:'Phản hồi đã cấu hình',include:policy.include.join(', '),
    exclude:policy.exclude.join(', '),reply:acknowledgementTemplates[policy.template],action:'auto',
  }];
  if(messaging&&channel.messageBotMode==='greeting')return [{
    ...blankBotRule(0),name:'Lời chào',include:'xin chào, chào shop',
    reply:channel.messagePersonalize?'Xin chào {{customer_name}}! Cảm ơn bạn đã nhắn đến {{page_name}}.':
      acknowledgementTemplates[channel.messageGreeting],action:'auto',
  }];
  return [];
}

function BotRuleEditor({ item, channel, faqs, close, onSave }) {
  const {copy}=useDisplayLocale();
  const faq=item.type==='faq';
  const [action,setAction]=useState(item.action);
  const [faqRef,setFaqRef]=useState(item.faqRef??'');
  const [reply,setReply]=useState(item.reply);
  return <Dialog title={item.name?copy("Sửa quy tắc"):faq?copy("Thêm FAQ"):copy("Thêm quy tắc")} close={close} label={copy("Áp dụng")} submit={(form)=>{
    const draft={...item,...fields(form),type:faq?'faq':'rule',faqRef:action==='ignore'?'':faqRef,reply};
    validateBotPolicy({version:2,blocked:[],rules:[{
      ...draft,include:[...(faq?[draft.name]:[]),...splitPhrases(draft.include)],
      context:splitPhrases(draft.context),exclude:splitPhrases(draft.exclude),
    }]});
    onSave(draft);
  }}>
    <Field label={faq?copy("Câu hỏi"):copy("Tên quy tắc")}><input name="name" required maxLength={80} defaultValue={item.name}/></Field>
    <Field label={faq?copy("Cách khách thường hỏi"):copy("Cụm kích hoạt")}><input name="include" required={!faq} defaultValue={item.include} placeholder={copy("giá, bao nhiêu")}/></Field>
    <Field label={copy("Ngữ cảnh cần có (tùy chọn)")}><input name="context" defaultValue={item.context} placeholder={copy("áo khoác, mẫu A")}/></Field>
    <Field label={copy("Ngữ cảnh cần bỏ qua (tùy chọn)")}><input name="exclude" defaultValue={item.exclude} placeholder={copy("đổi trả, khiếu nại")}/></Field>
    <Field label={copy("Khi khớp quy tắc")}><select name="action" value={action} onChange={(event)=>setAction(event.target.value)}>
      <option value="review">{copy("Đề xuất để duyệt")}</option><option value="auto">{copy("Tự gửi khi chế độ cho phép")}</option>
      {!faq&&<option value="ignore">{copy("Bỏ qua, không phản hồi")}</option>}
    </select></Field>
    {!faq&&action!=='ignore'&&<Field label={copy("Câu trả lời từ Kho FAQ")}><select value={faqRef} onChange={(event)=>setFaqRef(event.target.value)}>
      <option value="">{copy("Dùng câu trả lời tự soạn")}</option>
      {faqRef&&!faqs.some((item)=>(item.faqId||item.name)===faqRef)&&<option value={faqRef}>{copy("FAQ đã tắt hoặc đã xóa")}</option>}
      {faqs.map((item)=><option key={item.faqId||item.name} value={item.faqId||item.name}>{item.name}</option>)}
    </select></Field>}
    {action!=='ignore'&&!faqRef&&<>
      <Field label={copy("Nội dung phản hồi")}><textarea name="reply" required maxLength={1000} value={reply}
        onChange={(event)=>setReply(event.target.value)}/></Field>
      {channel&&<AiDraft channel={channel} kind="reply" onDraft={(draft)=>setReply(draft.reply)}/>}
    </>}
    <p className="bot-hint">{copy("Sau khi áp dụng, chọn Lưu cấu hình để bot dùng quy tắc.")}</p>
  </Dialog>;
}

export function BotForm({ channel, post, messaging=false, close, save, inline=false }) {
  const {copy}=useDisplayLocale();
  const policy=post?post.policy:messaging?channel?.messageBotPolicy:channel?.policy;
  const [mode,setMode]=useState(messaging
    ?(channel?.messageBotMode&&channel.messageBotMode!=='off'?'rules':'off')
    :post?.botMode??channel?.botMode??'review');
  const [rules,setRules]=useState(()=>initialBotRules(policy,channel,messaging));
  const nextRule=useRef(rules.length);
  const [ruleDraft,setRuleDraft]=useState(null);
  const [fallback,setFallback]=useState(policy?.fallback??'');
  const [blocked,setBlocked]=useState((policy?.blocked??[]).join(', '));
  const [agentMode,setAgentMode]=useState(policy?.agentMode??'off');
  const [agentMarkdown,setAgentMarkdown]=useState(policy?.agentMarkdown??'');
  const [agentFileError,setAgentFileError]=useState('');
  const [conversationAi,setConversationAi]=useState(policy?.conversationAi??'off');
  const [sample,setSample]=useState('');
  const facebookPost=!!post&&channel?.platform==='fb';
  const editing=['rules','auto','review'].includes(mode);
  const options=messaging?{off:'Tắt',rules:'Theo cách xử lý của từng quy tắc'}:
    {off:'Tắt',review:'Chỉ duyệt thủ công',auto:'Kết hợp tự động và duyệt thủ công'};
  const configuration=()=>validateBotPolicy({
    version:2,conversationAi,agentMode,agentMarkdown,blocked:splitPhrases(blocked),fallback:fallback.trim(),rules:rules.map((rule)=>({
      ...rule,include:[...(rule.type==='faq'?[rule.name]:[]),...splitPhrases(rule.include)],context:splitPhrases(rule.context),exclude:splitPhrases(rule.exclude),
    })),
  });
  function preview(event) {
    const form=new FormData(event.currentTarget.form);
    try {
      const text=form.get('example')?.trim();
      if(!text){setSample('Nhập nội dung muốn thử.');return;}
      const result=decideBotReply(configuration(),text,{
        context:messaging?form.get('exampleContext'):'',manualOnly:mode==='review',
      });
      const action={auto:'Tự gửi',review:'Chờ duyệt',blocked:'Bot bỏ qua'}[result.action];
      const reply=result.reply&&renderBotReply(result.reply,{customerName:'Nguyễn Minh Anh',pageName:channel?.name??'Page'});
      setSample([action+' · '+result.category,reply].filter(Boolean).join('\n'));
    } catch(error){setSample(error.message);}
  }
  return <><Dialog inline={inline} title={inline?copy("Hướng dẫn cho bot"):post?copy("Bot bình luận của bài đăng"):messaging?'Bot Messenger':channel?copy("Bot bình luận"):copy("Thử quy tắc bình luận")}
    close={close} label={channel?copy("Lưu cấu hình"):'Xong'} submit={async(form)=>{
      if(!channel)return;
      await save(post?'posts/bot':'bots',{
        id:channel.id,media:post?.id,kind:messaging?'message':'comment',botMode:mode,
        policy:editing?configuration():null,
        ...(!post?{keepFaqs:true}:{}),
        ...(facebookPost?{syncComments:form.has('syncComments')}:{}),
      });
    }}>
    {channel&&!inline&&<p className="notice">{channel.name}{post?' · '+(post.text.slice(0,120)||copy("Bài ")+post.id):''}</p>}
    {messaging&&!channel?.messenger&&<p className="notice">{copy("Hãy cấp lại quyền Messenger cho Page trước khi bật bot.")}</p>}
    <Field label={copy("Chế độ phản hồi")}><select value={mode} onChange={(event)=>{setMode(event.target.value);setSample('');}}>
      {post&&<option value="inherit">{copy("Theo cấu hình của kênh")}</option>}
      {Object.entries(options).map(([id,label])=><option value={id} key={id}>{copy(label)}</option>)}
    </select></Field>
    {facebookPost&&<div>
      <label className="check"><input type="checkbox" name="syncComments" defaultChecked={!!post.commentSync}/> {copy("Theo dõi bình luận qua API")}</label>
      <p className="bot-hint">{copy("SnailChat kiểm tra bài này khoảng 8 giây/lần. Bình luận có trước lúc bật được đưa vào Chờ xử lý.")}</p>
    </div>}
    {editing&&<div className="bot-section">
      {channel?.platform==='fb'&&channel.messenger&&<>
        <Field label={messaging?'AI agent Messenger':copy("AI agent nhắn riêng từ bình luận")}>
          <select value={agentMode} onChange={(event)=>setAgentMode(event.target.value)}>
            <option value="off">{copy("Tắt")}</option><option value="review">{copy("Soạn để shop duyệt")}</option>
            <option value="auto">{copy("Tự động tư vấn và phản hồi")}</option>
          </select>
        </Field>
        <Field label={copy("Hướng dẫn của shop (.md)")}><textarea rows={7} maxLength={8000}
          value={agentMarkdown} onChange={(event)=>setAgentMarkdown(event.target.value)}/></Field>
        <FilePicker label={copy("Nhập từ tệp Markdown")} accept=".md,.markdown,text/markdown"
          onChange={async(event)=>{
            const file=event.target.files?.[0];
            if(!file)return;
            try{
              if(file.size>32_000)throw new Error('Tệp Markdown tối đa 8.000 ký tự.');
              const contents=await file.text();
              if(contents.length>8000)throw new Error('Tệp Markdown tối đa 8.000 ký tự.');
              setAgentMarkdown(contents);setAgentFileError('');
            }catch(error){setAgentFileError(error.message);}
          }}/>
        {agentFileError&&<p className="formerror" role="alert">{copy(agentFileError)}</p>}
        <p className="bot-hint">{copy("AI agent dùng hướng dẫn này và danh mục của Page. Bot chốt đơn phải được bật trong Đơn hàng để tạo đơn.")}</p>
        <Field label={messaging?copy("Hiểu tin nhắn bằng AI"):copy("Nhắn riêng từ bình luận bằng AI")}>
          <select value={conversationAi} onChange={(event)=>setConversationAi(event.target.value)}>
            <option value="off">{copy("Tắt")}</option>
            <option value="review">{copy("Tạo bản nháp để shop duyệt")}</option>
            <option value="auto">{copy("Tự gửi khi khớp quy tắc cho phép")}</option>
          </select>
        </Field>
        <p className="bot-hint">{copy("AI đọc nội dung và ngữ cảnh để chọn FAQ hoặc quy tắc. Tự gửi dùng câu trả lời shop đã lưu. Bản nháp AI có thể sửa trước khi gửi.")}</p>
      </>}
      <Field label={copy("Từ hoặc cụm từ bot cần chặn")}><textarea value={blocked} rows={2}
        onChange={(event)=>{setBlocked(event.target.value);setSample('');}}/></Field>
      <p className="bot-hint">{copy("Chỉ chặn khi tin nhắn hoặc bình luận hiện tại chứa cụm từ đã nhập. Tách cụm từ bằng dấu phẩy hoặc xuống dòng.")}</p>
      {messaging&&<p className="bot-hint">{copy("Bot xét tin hiện tại và tin khách được trích dẫn hoặc tin trước đó trong vòng 10 phút.")}</p>}
      <p className="bot-hint">{copy("Dùng")} <code>{'{{customer_name}}'}</code> {copy("và")} <code>{'{{page_name}}'}</code> {copy("trong nội dung trả lời.")}</p>
      <Field label={copy("Gợi ý khi không có câu trả lời")}><textarea rows={2} maxLength={500} value={fallback}
        onChange={(event)=>{setFallback(event.target.value);setSample('');}}/></Field>
      <p className="bot-hint">{copy("Gợi ý này vào Chờ duyệt. Nội dung bị chặn sẽ không nhận gợi ý.")}</p>
      {(post?['faq','rule']:['rule']).map((type)=><section className="bot-section" key={type}>
        <h3>{type==='faq'?copy("Câu hỏi thường gặp (FAQ)"):copy("Quy tắc khác")}</h3>
        {type==='faq'&&<p className="bot-hint">{copy("Lưu các câu hỏi về giá, giao hàng hoặc đổi trả. Thêm những cách khách hay hỏi để bot nhận diện.")}</p>}
        {rules.filter((rule)=>(rule.type??'rule')===type).map((rule)=><div className="bot-rule-summary" key={rule.id}>
          <div><strong>{rule.name}</strong><small className="dim">{{auto:'Tự gửi khi bot cho phép',review:'Chờ duyệt',ignore:'Bỏ qua, không phản hồi'}[rule.action]}</small></div>
          <div className="faq-actions">
            <Button onClick={()=>setRuleDraft(rule)}>{copy("Sửa")}</Button>
            <Button variant="danger" onClick={()=>{setRules((items)=>items.filter((item)=>item.id!==rule.id));setSample('');}}>{copy("Xóa")}</Button>
          </div>
        </div>)}
        <Button disabled={rules.filter((rule)=>(rule.type??'rule')===type).length>=(type==='faq'?50:12)} onClick={()=>setRuleDraft(blankBotRule(nextRule.current++,type))}>
          {type==='faq'?copy("Thêm FAQ"):copy("Thêm quy tắc")}
        </Button>
      </section>)}
      {!inline&&<div className="bot-test">
        <Field label={messaging?copy("Tin nhắn thử"):copy("Bình luận thử")}><input name="example" maxLength={4000} onChange={()=>setSample('')}/></Field>
        {messaging&&<Field label={copy("Tin khách nhắn trước đó (tùy chọn)")}><input name="exampleContext" maxLength={4000} onChange={()=>setSample('')}/></Field>}
        <Button icon="chat" onClick={preview}>{copy("Thử quy tắc")}</Button><output aria-live="polite">{sample}</output>
      </div>}
    </div>}
  </Dialog>
  {ruleDraft&&<BotRuleEditor channel={channel} faqs={(policy?.rules??[]).filter((rule)=>rule.type==='faq'&&rule.enabled!==false)} item={ruleDraft} close={()=>setRuleDraft(null)} onSave={(draft)=>{
    setRules((items)=>items.some((item)=>item.id===draft.id)
      ?items.map((item)=>item.id===draft.id?draft:item):[...items,draft]);
    setSample('');
  }}/>}
  </>;
}

export function BotReplyPicker({ item, channel, rules, onInsert, disabled }) {
  const {copy}=useDisplayLocale();
  if(channel.aiToolsEnabled!==true)return null;
  if(item.botBlocked)return <small className="bot-category">{copy("Bot bỏ qua ·")} {item.botCategory}</small>;
  const insert=(template)=>onInsert(renderBotReply(template,{
    pageName:channel.name,customerName:item.senderId?item.customerName:item.author==='Người xem'?'':item.author,
  }));
  return <>
    {item.botSuggestion&&item.status==='review'&&<div className="bot-review">
      <small className="bot-category">{copy("Chờ duyệt ·")} {item.botCategory}</small>
      <Button disabled={disabled} icon="bot" onClick={()=>insert(item.botSuggestion)}>{copy("Dùng gợi ý bot")}</Button>
    </div>}
    {rules?.some((rule)=>rule.reply)&&<Field label={copy("Chọn mẫu phản hồi của bot")}>
      <select value="" disabled={disabled} onChange={(event)=>insert(rules[Number(event.target.value)].reply)}>
        <option value="" disabled>{copy("Chọn mẫu để soạn phản hồi")}</option>
        {rules.map((rule,index)=>rule.reply&&<option key={index} value={index}>{rule.name}</option>)}
      </select>
    </Field>}
  </>;
}

export function AddAccountForm({ close, add }) {
  const {copy}=useDisplayLocale();
  return <Dialog title={copy("Thêm tài khoản SnailChat")} label={copy("Đăng nhập và thêm")} close={close} submit={(form)=>add(fields(form))}>
    <Field label="Email"><input name="email" type="email" autoComplete="username" maxLength={254} required/></Field>
    <Field label={copy("Mật khẩu")}><input name="password" type="password" autoComplete="current-password" maxLength={128} required/></Field>
  </Dialog>;
}
