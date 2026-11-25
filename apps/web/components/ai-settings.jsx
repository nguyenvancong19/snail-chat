'use client';

import { useEffect, useState } from 'react';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { api } from '../lib/workspace.js';
import { Button, CardHead, Chip, Field, MetricGrid, Title } from './ui.jsx';
import { chartDate, TimeChart } from './stat-charts.jsx';

const endpoint = 'admin/openrouter';
const emptyCounts = {calls:0, failedCalls:0, reportedTokens:0, estimatedTokens:0};

function UsageChart({providers}) {
  const {copy,t,intl} = useDisplayLocale();
  const [days,setDays] = useState('7'), [provider,setProvider] = useState('');
  const [metric,setMetric] = useState('tokens'), [refresh,setRefresh] = useState(0), [result,setResult] = useState(null);
  const query = new URLSearchParams({days,...(provider ? {provider} : {})}).toString();
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
  const items = data?.firstRecordedDay ? data.items.filter(row=>row.date>=data.firstRecordedDay) : [];
  const totals = items.reduce((summary,row)=>({
    calls:summary.calls+row.calls,
    failedCalls:summary.failedCalls+row.failedCalls,
    reportedTokens:summary.reportedTokens+row.reportedTokens,
    estimatedTokens:summary.estimatedTokens+row.estimatedTokens,
  }),emptyCounts);
  const number = new Intl.NumberFormat(intl);
  const axis = new Intl.NumberFormat(intl,{notation:'compact',maximumFractionDigits:1});
  const series = metric === 'tokens' ? [
    {key:'reportedTokens',name:copy('Token do nhà cung cấp báo'),color:'primary'},
    {key:'estimatedTokens',name:copy('Token ước tính'),color:'secondary'},
  ] : [
    {key:'calls',name:copy('Lượt gọi AI'),color:'primary'},
    {key:'failedCalls',name:copy('Lượt xử lý lỗi'),color:'secondary'},
  ];
  return <section className="ai-usage" aria-labelledby="ai-usage-heading">
    <div className="section-head ai-usage-heading"><div>
      <h2 id="ai-usage-heading">{copy('Mức sử dụng AI')}</h2>
      <p>{copy('Thống kê toàn hệ thống theo giờ Việt Nam, bắt đầu từ khi cập nhật.')}</p>
    </div><Button disabled={!current} onClick={()=>setRefresh(n=>n+1)}>{t('refresh')}</Button></div>
    <div className="ai-usage-controls">
      <Field label={copy('Nhà cung cấp AI')}><select value={provider} onChange={e=>setProvider(e.target.value)}>
        <option value="">{copy('Tất cả nhà cung cấp')}</option>
        {providers.map(({id,label})=><option key={id} value={id}>{label}</option>)}
      </select></Field>
      <Field label={t('range')}><select value={days} onChange={e=>setDays(e.target.value)}>
        {[7,30].map(n=><option key={n} value={n}>{t('lastDays',{count:number.format(n)})}</option>)}
      </select></Field>
      <Field label={copy('Chỉ số biểu đồ')}><select value={metric} onChange={e=>setMetric(e.target.value)}>
        <option value="tokens">Token</option><option value="calls">{copy('Lượt gọi AI')}</option>
      </select></Field>
    </div>
    {!current&&<p className="dim" role="status">{t('activityLoading')}</p>}
    {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    {data&&<>
      <MetricGrid metrics={[
        [copy('Lượt gọi AI'),number.format(totals.calls),null,'chart'],
        [copy('Lượt xử lý lỗi'),number.format(totals.failedCalls),null,'alert','rose'],
        [copy('Token do nhà cung cấp báo'),number.format(totals.reportedTokens),null,'check','mint'],
        [copy('Token ước tính'),number.format(totals.estimatedTokens),null,'bot','amber'],
      ]}/>
      <TimeChart key={requestId+metric} title={copy('Sử dụng AI theo ngày')} subtitle={t('vietnamTime')} series={series}
        rows={items.map(({date,...values})=>({label:chartDate(date,intl),values}))}
        axisFormat={value=>axis.format(value)}/>
    </>}
  </section>;
}

export function AdminAiSettings() {
  const {copy,t,intl} = useDisplayLocale();
  const [saved,setSaved] = useState(null), [draft,setDraft] = useState(null), [key,setKey] = useState('');
  const [busy,setBusy] = useState(''), [error,setError] = useState(''), [conflict,setConflict] = useState(false);
  const [test,setTest] = useState(null), [notice,setNotice] = useState(false);
  const [reload,setReload] = useState(0);
  useEffect(()=>{
    const controller = new AbortController();
    api(endpoint,'GET',undefined,controller.signal)
      .then(data=>{if(!controller.signal.aborted){setSaved(data);setDraft(data);setKey('');setConflict(false);}})
      .catch(problem=>{if(!controller.signal.aborted)setError(problem.message);});
    return ()=>controller.abort();
  },[reload]);

  function edit(changes) {
    setDraft(current=>({...current,...changes}));
    setTest(null);setNotice(false);
  }
  const providers = saved?.providers ?? [];
  const normal = value => value.trim().toLowerCase().replace(/\s+/g,'');
  const selected = draft && providers.find(({id,label})=>id===draft.provider||normal(label)===normal(draft.provider));
  const custom = !!draft && (!selected || selected.custom);
  const providerChanged = !!draft && (selected?.id??draft.provider)!==saved.provider;
  const hasKey = !!key.trim() || !!saved?.configured && !providerChanged;
  const payload = draft && {enabled:draft.enabled,provider:selected?.id??draft.provider.trim(),model:draft.model.trim(),apiKey:key.trim()};

  async function act(mode) {
    setBusy(mode);setError('');setTest(null);setNotice(false);
    try {
      if(mode==='test') {
        setTest(await api(endpoint+'/test','POST',payload,AbortSignal.timeout(50_000),saved.version));
      } else {
        await api(endpoint,'POST',payload,undefined,saved.version);
        const data = await api(endpoint);
        setSaved(data);setDraft(data);setKey('');setNotice(true);
      }
    } catch(problem) {
      setError(problem.message);setConflict(problem.status===412);
    } finally {setBusy('');}
  }
  return <>
    <Title title={copy('Cấu hình AI')} subtitle={copy('Chọn nhà cung cấp và model AI dùng chung cho SnailChat.')}/>
    <section className="card ai-provider-card">
      <CardHead title={copy('Kết nối nhà cung cấp')}
        action={saved&&<Chip status={saved.enabled?'active':'off'}>{saved.enabled ? copy('AI đang bật') : copy('AI đang tắt')}</Chip>}/>
      <div className="ai-provider-body">
        {draft&&<form onSubmit={event=>{event.preventDefault();act('save');}}>
          <fieldset disabled={!!busy} className="ai-provider-fields">
            <div className="ai-provider-grid">
              <Field label={copy('Nhà cung cấp AI')}><select value={custom?'custom':selected.id} onChange={event=>{
                const provider=event.target.value==='custom'?'':event.target.value;
                edit({provider,model:provider===saved.provider?saved.model:''});setKey('');
              }}>
                {providers.filter(item=>!item.custom).map(({id,label})=><option key={id} value={id}>{label}</option>)}
                <option value="custom">{copy('Nhập nhà cung cấp')}</option>
              </select></Field>
              {custom&&<Field label={copy('Tên nhà cung cấp')}>
                <input list="ai-custom-providers" value={selected?.label??draft.provider} maxLength={48} required
                  autoComplete="off" spellCheck={false} aria-describedby="ai-provider-help" onChange={event=>{
                    edit({provider:event.target.value});setKey('');
                  }}/>
                <datalist id="ai-custom-providers">
                  {providers.filter(item=>item.custom).map(({id,label})=><option key={id} value={label}/>)}
                </datalist>
              </Field>}
              <Field label={copy('Mã model')}><input value={draft.model} maxLength={160} required={draft.enabled}
                placeholder={selected?.example} spellCheck={false} onChange={event=>edit({model:event.target.value})}/></Field>
            </div>
            {custom&&<p className="bot-hint ai-custom-help" id="ai-provider-help">{copy('Nhà cung cấp riêng cần được đăng ký trên máy chủ.')}</p>}
            <Field label="API key"><input type="password" value={key} maxLength={512} autoComplete="new-password"
              required={providerChanged||draft.enabled&&!hasKey} aria-describedby="ai-key-help"
              onChange={event=>{setKey(event.target.value);setTest(null);setNotice(false);}}/></Field>
            <p id="ai-key-help" className="bot-hint">{providerChanged ? copy('Nhập API key mới khi đổi nhà cung cấp.')
              : saved.configured ? copy('Để trống để giữ API key đã lưu.') : copy('Nhập API key của nhà cung cấp đã chọn.')}</p>
            <label className="check ai-enabled"><input type="checkbox" checked={draft.enabled}
              onChange={event=>edit({enabled:event.target.checked})}/> {copy('Bật AI cho hệ thống')}</label>
          </fieldset>
          <div className="ai-provider-actions">
            <Button icon="check" onClick={()=>act('test')} disabled={!!busy||conflict||!payload.provider||!hasKey||!payload.model}>
              {busy==='test' ? copy('Đang kiểm tra kết nối…') : copy('Kiểm tra kết nối')}</Button>
            <Button type="submit" variant="primary" disabled={!!busy||conflict||!payload.provider||(providerChanged&&!hasKey)||(draft.enabled&&(!hasKey||!payload.model))}>
              {busy==='save' ? t('loading') : copy('Lưu cấu hình AI')}</Button>
          </div>
        </form>}
        {!draft&&!error&&<p className="dim" role="status">{t('loading')}</p>}
        {test&&<p className="notice" role="status"><strong>{copy('Kết nối và JSON hợp lệ.')}</strong>{' '}
          {providers.find(item=>item.id===test.provider)?.label??test.provider} · {test.model} · {test.tokens==null
            ? copy('Chưa nhận được số token từ nhà cung cấp.')
            : copy('Token thử nghiệm')+' '+new Intl.NumberFormat(intl).format(test.tokens)}</p>}
        {notice&&<p className="notice" role="status">{copy('Đã lưu cấu hình AI.')}</p>}
        {error&&<p className="formerror" role="alert">{copy(error)}</p>}
        {(conflict||!draft&&error)&&<Button onClick={()=>{setError('');setReload(n=>n+1);}}>{copy('Tải lại cấu hình đã lưu')}</Button>}
      </div>
    </section>
    <UsageChart providers={providers}/>
  </>;
}
