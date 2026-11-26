'use client';

import { useEffect, useState } from 'react';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { api } from '../lib/workspace.js';
import { Button, CardHead, Chip, Field, MetricGrid, Title } from './ui.jsx';
import { chartDate, TimeChart } from './stat-charts.jsx';

const endpoint = 'admin/openrouter';
const emptyBackup = {enabled:false,provider:null,model:null,configured:false};
function providerLabel(providers, id) {
  return providers.find(item=>item.id===id)?.label ?? id;
}

function useAiError() {
  const {copy}=useDisplayLocale();
  return (message)=>{
    const upstream=message.match(/^(.* \(\d{3}\)\. )(.+)$/);
    return upstream ? upstream[1]+copy(upstream[2]) : copy(message);
  };
}

function UsageChart({providers}) {
  const {copy,t,intl} = useDisplayLocale();
  const displayError=useAiError();
  const [provider,setProvider] = useState('');
  const [refresh,setRefresh] = useState(0), [result,setResult] = useState(null);
  const query = new URLSearchParams({days:'7',...(provider ? {provider} : {})}).toString();
  const requestId = query + ':' + refresh;
  useEffect(()=>{
    const controller = new AbortController();
    api('admin/ai/usage?' + query,'GET',undefined,controller.signal)
      .then(data=>{if(!controller.signal.aborted)setResult({requestId,data});})
      .catch(error=>{if(!controller.signal.aborted)setResult({requestId,error:error.message});});
    return ()=>controller.abort();
  },[query,requestId]);

  const current = result?.requestId === requestId ? result : null;
  const {data,error} = current ?? {};
  const items = data?.items ?? [];
  const total = items.reduce((sum,row)=>sum+row.reportedTokens,0);
  const number = new Intl.NumberFormat(intl);
  const axis = new Intl.NumberFormat(intl,{notation:'compact',maximumFractionDigits:1});
  const series = [{key:'reportedTokens',name:copy('Token do nhà cung cấp báo'),color:'primary'}];
  return <section className="ai-usage-overview" aria-labelledby="ai-usage-heading">
    <div className="section-head ai-usage-heading"><h2 id="ai-usage-heading">{copy('Mức sử dụng AI')}</h2>
      <Button disabled={!current} onClick={()=>setRefresh(n=>n+1)}>{t('refresh')}</Button></div>
    <div className="ai-usage-controls">
      <Field label={copy('Nhà cung cấp AI')}><select value={provider} onChange={e=>setProvider(e.target.value)}>
        <option value="">{copy('Tất cả nhà cung cấp')}</option>
        {providers.map(({id,label})=><option key={id} value={id}>{label}</option>)}
      </select></Field>
    </div>
    {!current&&<p className="dim" role="status">{t('activityLoading')}</p>}
    {error&&<p className="formerror" role="alert">{displayError(error)}</p>}
    {data&&<>
      <MetricGrid metrics={[[copy('Token do nhà cung cấp báo'),number.format(total),
        t('lastDays',{count:number.format(7)}),'chart']]}/>
      <TimeChart key={requestId} type="line" title={copy('Sử dụng AI theo ngày')} subtitle={t('vietnamTime')} series={series}
        rows={items.map(({date,reportedTokens})=>({label:chartDate(date,intl),values:{reportedTokens}}))}
        axisFormat={value=>axis.format(value)}/>
    </>}
  </section>;
}

const normal = value => value.trim().toLowerCase().replace(/\s+/g,'');
function providerInput(providers, draft, saved) {
  const input=draft.provider??'';
  const match=providers.find(({id,label})=>id===input||normal(label)===normal(input));
  const provider=match?.id??input.trim();
  const changed=provider!==(saved.provider??'');
  const apiKey=draft.apiKey.trim();
  const hasKey=!!apiKey || !!saved.configured&&!changed;
  const model=draft.model?.trim()??'';
  return {match,changed,hasKey,ready:!!provider&&!!model&&hasKey,payload:{provider,model,apiKey}};
}

function ProviderFields({target,providers,draft,saved,edit}) {
  const {copy}=useDisplayLocale();
  const {match,changed}=providerInput(providers,draft,saved);
  const custom=!match||match.custom;
  return <>
    <div className="ai-provider-grid">
      <Field label={copy('Nhà cung cấp AI')}><select value={draft.provider==null?'':custom?'custom':match.id} onChange={event=>{
        const provider=event.target.value==='custom'?'':event.target.value;
        edit({provider,model:provider===saved.provider?saved.model??'':'',apiKey:''});
      }}>
        <option value="" disabled>{copy('Chọn nhà cung cấp')}</option>
        {providers.filter(item=>!item.custom).map(({id,label})=><option key={id} value={id}>{label}</option>)}
        <option value="custom">{copy('Nhập nhà cung cấp')}</option>
      </select></Field>
      {custom&&<Field label={copy('Tên nhà cung cấp')}>
        <input list={target+'-custom-providers'} value={match?.label??draft.provider??''} maxLength={48}
          autoComplete="off" spellCheck={false} aria-describedby={target+'-provider-help'}
          onChange={event=>edit({provider:event.target.value,apiKey:''})}/>
        <datalist id={target+'-custom-providers'}>
          {providers.filter(item=>item.custom).map(({id,label})=><option key={id} value={label}/>)}
        </datalist>
      </Field>}
      <Field label={copy('Mã model')}><input value={draft.model??''} maxLength={160}
        placeholder={match?.example} spellCheck={false} onChange={event=>edit({model:event.target.value})}/></Field>
    </div>
    {custom&&<p className="bot-hint ai-custom-help" id={target+'-provider-help'}>{copy('Nhà cung cấp riêng cần được đăng ký trên máy chủ.')}</p>}
    <Field label="API key"><input type="password" value={draft.apiKey} maxLength={512} autoComplete="new-password"
      aria-describedby={target+'-key-help'} onChange={event=>edit({apiKey:event.target.value})}/></Field>
    <p id={target+'-key-help'} className="bot-hint">{changed&&saved.configured ? copy('Nhập API key mới khi đổi nhà cung cấp.')
      : saved.configured ? copy('Để trống để giữ API key đã lưu.') : copy('Nhập API key của nhà cung cấp đã chọn.')}</p>
  </>;
}

function draftFrom(saved) {
  return {enabled:saved.enabled,primary:{provider:saved.provider,model:saved.model,apiKey:''},
    backup:{...emptyBackup,...saved.backup,apiKey:''}};
}

export function AdminAiSettings() {
  const {copy,t,intl} = useDisplayLocale();
  const displayError=useAiError();
  const [saved,setSaved] = useState(null), [draft,setDraft] = useState(null);
  const [busy,setBusy] = useState(''), [error,setError] = useState(null), [conflict,setConflict] = useState(false);
  const [tests,setTests] = useState({}), [notice,setNotice] = useState(false);
  const [reload,setReload] = useState(0);
  useEffect(()=>{
    const controller = new AbortController();
    api(endpoint,'GET',undefined,controller.signal)
      .then(data=>{if(!controller.signal.aborted){setSaved(data);setDraft(draftFrom(data));setConflict(false);}})
      .catch(problem=>{if(!controller.signal.aborted)setError({message:problem.message});});
    return ()=>controller.abort();
  },[reload]);

  function edit(target, changes) {
    setDraft(current=>({...current,[target]:{...current[target],...changes}}));
    setTests(current=>({...current,[target]:null}));setNotice(false);
    if(error?.target===target)setError(null);
  }
  const providers = saved?.providers ?? [];
  const savedBackup=saved?.backup??emptyBackup;
  const primary=draft&&providerInput(providers,draft.primary,saved);
  const backup=draft&&providerInput(providers,draft.backup,savedBackup);
  const backupEnabled=!!draft?.backup.enabled;
  const sameProvider=backupEnabled&&!!backup.payload.provider&&backup.payload.provider===primary.payload.provider;
  const missingPrimary=draft&&(draft.enabled&&!primary.ready || !primary.payload.provider || primary.changed&&!primary.hasKey);
  const saveBlocked=!!busy||conflict||missingPrimary||backupEnabled&&(!backup.ready||sameProvider);
  const payload=draft&&{enabled:draft.enabled,...primary.payload,
    backup:backupEnabled?{enabled:true,...backup.payload}:{enabled:false}};

  async function act(mode) {
    setBusy(mode);setError(null);setNotice(false);
    try {
      if(mode==='save') {
        await api(endpoint,'POST',payload,undefined,saved.version);
        const data=await api(endpoint);
        setSaved(data);setDraft(draftFrom(data));setNotice(true);
      } else {
        setTests(current=>({...current,[mode]:null}));
        const response=await api(endpoint+'/test','POST',
          {target:mode,...(mode==='primary'?primary:backup).payload},AbortSignal.timeout(50_000),saved.version);
        setTests(current=>({...current,[mode]:response}));
      }
    } catch(problem) {
      setError({target:mode,message:problem.message});setConflict(problem.status===412);
    } finally {setBusy('');}
  }

  function testControl(target, ready) {
    const test=tests[target];
    return <>
      <Button icon="check" onClick={()=>act(target)} disabled={!!busy||conflict||!ready}>
        {busy===target?copy('Đang kiểm tra kết nối…'):copy('Kiểm tra kết nối')}</Button>
      {test&&<p className="notice" role="status"><strong>{copy('Kết nối và JSON hợp lệ.')}</strong>{' '}
        {providerLabel(providers,test.provider)} · {test.model} · {test.tokens==null
          ? copy('Chưa nhận được số token từ nhà cung cấp.')
          : copy('Token thử nghiệm')+' '+new Intl.NumberFormat(intl).format(test.tokens)}</p>}
      {error?.target===target&&<p className="formerror" role="alert">{displayError(error.message)}</p>}
    </>;
  }

  return <>
    <Title title={copy('Cấu hình AI')} subtitle={copy('Chọn nhà cung cấp và model AI dùng chung cho SnailChat.')}/>
    <section className="card ai-provider-card">
      <CardHead title={copy('Kết nối nhà cung cấp')}
        action={saved&&<Chip status={saved.enabled?'active':'off'}>{saved.enabled?copy('AI đang bật'):copy('AI đang tắt')}</Chip>}/>
      <div className="ai-provider-body">
        {draft&&<form onSubmit={event=>{event.preventDefault();if(!saveBlocked)act('save');}}>
          <fieldset disabled={!!busy} className="ai-provider-fields">
            <h3>{copy('Nhà cung cấp chính')}</h3>
            <ProviderFields target="primary" providers={providers} draft={draft.primary} saved={saved}
              edit={changes=>edit('primary',changes)}/>
            <label className="check ai-enabled"><input type="checkbox" checked={draft.enabled}
              onChange={event=>{setDraft({...draft,enabled:event.target.checked});setNotice(false);}}/>{copy('Bật AI cho hệ thống')}</label>
            {testControl('primary',primary.ready)}
          </fieldset>
          <details className="ai-backup">
            <summary><span>{copy('Nhà cung cấp dự phòng')}</span>
              <Chip status={savedBackup.enabled?'active':'off'}>{savedBackup.enabled
                ? providerLabel(providers,savedBackup.provider) : copy('Đã tắt dự phòng')}</Chip>
            </summary>
            <fieldset disabled={!!busy} className="ai-provider-fields ai-backup-fields">
              <p className="bot-hint">{copy('Agent tự chuyển sang nhà cung cấp dự phòng nếu nhà cung cấp chính gián đoạn hoặc API key hết số dư.')}</p>
              <label className="check ai-enabled"><input type="checkbox" checked={backupEnabled}
                onChange={event=>edit('backup',{enabled:event.target.checked})}/>{copy('Bật chuyển dự phòng tự động')}</label>
              {backupEnabled&&<>
                <ProviderFields target="backup" providers={providers} draft={draft.backup} saved={savedBackup}
                  edit={changes=>edit('backup',changes)}/>
                {sameProvider&&<p className="formerror" role="alert">{copy('Hãy chọn nhà cung cấp dự phòng khác nhà cung cấp chính.')}</p>}
                {testControl('backup',backup.ready&&!sameProvider)}
              </>}
            </fieldset>
          </details>
          <div className="ai-provider-actions"><Button type="submit" variant="primary" disabled={saveBlocked}>
            {busy==='save'?t('loading'):copy('Lưu cấu hình AI')}</Button></div>
        </form>}
        {!draft&&!error&&<p className="dim" role="status">{t('loading')}</p>}
        {notice&&<p className="notice" role="status">{copy('Đã lưu cấu hình AI.')}</p>}
        {error&&!['primary','backup'].includes(error.target)&&<p className="formerror" role="alert">{displayError(error.message)}</p>}
        {(conflict||!draft&&error)&&<Button onClick={()=>{setError(null);setReload(n=>n+1);}}>{copy('Tải lại cấu hình đã lưu')}</Button>}
      </div>
    </section>
    <UsageChart providers={providers}/>
  </>;
}
