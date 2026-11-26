'use client';

import { useEffect, useRef, useState } from 'react';
import { api, formatDate, workActorLabel } from '../lib/workspace.js';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { Button, CardHead, Empty, Field, MetricGrid } from './ui.jsx';
import { Dialog } from './forms.jsx';
import { ListPagination, useListPage } from './list-pagination.jsx';

const metrics=[
  ['takeovers','Lượt tiếp quản','switch'],
  ['conversations','Hội thoại đã trả lời','chat'],
  ['orders','Đơn nhập tay','package'],
];
const eventNames={takeover:'Tiếp quản',extend:'Gia hạn tiếp quản',release:'Kết thúc tiếp quản',
  reply:'Gửi tin nhắn',order:'Tạo đơn nhập tay'};

function WorkDetails({person,query,close,openWorkItem}) {
  const {copy,intl,t}=useDisplayLocale();
  const [page,setPage]=useState(1),[result,setResult]=useState(null),[error,setError]=useState('');
  const navigation=useRef(null);
  const [opening,setOpening]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams(query);
    params.set('person',person.id);params.set('role',person.actor.role);params.set('page',page);
    api('shop/work-activity/details?'+params,'GET',undefined,controller.signal)
      .then(value=>{if(!controller.signal.aborted){setResult(value);setError('');}})
      .catch(problem=>{if(!controller.signal.aborted)setError(problem.message);});
    return ()=>controller.abort();
  },[person.id,person.actor.role,query,page]);
  useEffect(()=>()=>navigation.current?.abort(),[]);
  async function openItem(item) {
    const controller=new AbortController();
    navigation.current=controller;
    setOpening(true);
    try {
      await openWorkItem(item,controller.signal);
    } catch(problem) {
      if(!controller.signal.aborted)setError(problem.message);
    } finally {
      if(!controller.signal.aborted)setOpening(false);
    }
  }
  return <Dialog title={workActorLabel(person.actor,copy)} close={close}>
    {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    {!result&&!error&&<Empty>{t('loadingData')}</Empty>}
    {result&&!result.items.length&&<Empty>{copy('Chưa có hoạt động trong khoảng thời gian đã chọn.')}</Empty>}
    {result?.items.length>0&&<>
      <div className="table-wrap staff-work-table" tabIndex={0} role="region" aria-label={copy('Nhật ký hoạt động')}>
        <table><thead><tr><th scope="col">{t('date')}</th><th scope="col">{copy('Thao tác')}</th><th scope="col">{t('page')}</th>
          <th scope="col">{copy('Chi tiết')}</th></tr></thead>
          <tbody>{result.items.map(item=><tr key={item.id}>
            <td>{formatDate(item.at,intl)}</td><td>{copy(eventNames[item.kind])}<small>{workActorLabel(item.actor,copy)}</small></td>
            <td>{item.channelName}</td>
            <td>{item.targetExists?<Button disabled={opening} onClick={()=>openItem(item)}>
              {item.kind==='order'?item.subject:item.customer||copy('Xem hội thoại')}</Button>:'—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <ListPagination page={result.page} total={result.total} onChange={setPage}/>
    </>}
  </Dialog>;
}

function WorkTable({items,owner=false,view}) {
  const {copy,intl,t}=useDisplayLocale();
  const number=new Intl.NumberFormat(intl);
  const list=useListPage(items);
  const title=copy(owner?'Hoạt động của chủ Shop':'Hoạt động theo nhân viên');
  return <section className="card">
    <CardHead title={title} subtitle={owner?undefined:copy('Một hội thoại được tính một lần cho mỗi nhân viên trong kỳ đã chọn.')}/>
    {items.length?<div className="table-wrap staff-work-table" tabIndex={0} role="region" aria-label={title}>
      <table><thead><tr><th scope="col">{t(owner?'owner':'staff')}</th>
        {metrics.map(([key,name])=><th className="staff-work-number" key={key} scope="col">{copy(name)}</th>)}
        <th scope="col">{copy('Chi tiết')}</th></tr></thead>
        <tbody>{list.items.map(row=><tr key={row.id}>
          <th scope="row">{row.actor.name}{row.actor.code&&<small>{row.actor.code}</small>}</th>
          {metrics.map(([key])=><td className="staff-work-number" key={key}>{number.format(row[key])}</td>)}
          <td><Button onClick={()=>view(row)} aria-label={copy('Xem chi tiết')+' · '+workActorLabel(row.actor,copy)}>
            {copy('Xem chi tiết')}</Button></td>
        </tr>)}</tbody>
      </table>
    </div>:<Empty>{copy('Chưa có nhân viên.')}</Empty>}
    <ListPagination {...list.pagination}/>
  </section>;
}

export function StaffActivity({accessRevision,activityVersion,openWorkItem}) {
  const {copy,intl,t}=useDisplayLocale();
  const [channel,setChannel]=useState(''),[days,setDays]=useState('7');
  const [channels,setChannels]=useState([]),[load,setLoad]=useState(null),[selected,setSelected]=useState(null);
  const query=new URLSearchParams({channel,days}).toString();
  useEffect(()=>{
    const controller=new AbortController();
    api('shop/work-activity?'+query,'GET',undefined,controller.signal)
      .then(data=>{if(!controller.signal.aborted){setChannels(data.channels);setLoad({query,data});}})
      .catch(error=>{if(!controller.signal.aborted)setLoad({query,error:error.message});});
    return ()=>controller.abort();
  },[query,accessRevision,activityVersion]);
  const current=load?.query===query?load:null;
  const result=current?.data;
  const number=new Intl.NumberFormat(intl);
  return <section className="staff-work" aria-label={copy('Thống kê nhân viên')}>
    <div className="card staff-work-filters">
      <Field label={t('page')}><select value={channel} onChange={event=>setChannel(event.target.value)}>
        <option value="">{copy('Tất cả Page')}</option>
        {channels.map(page=><option key={page.id} value={page.id}>{page.name}</option>)}
      </select></Field>
      <Field label={copy('Thời gian')}><select value={days} onChange={event=>setDays(event.target.value)}>
        {['7','30'].map(value=><option value={value} key={value}>{t('lastDays',{count:number.format(Number(value))})}</option>)}
      </select></Field>
      <small className="dim">{t('vietnamTime')} · {copy('Ghi nhận từ khi cập nhật.')}</small>
    </div>
    {!current&&<p role="status" className="dim">{t('loadingData')}</p>}
    {current?.error&&<p role="alert" className="notice">{copy(current.error)}</p>}
    {result&&<>
      <MetricGrid metrics={metrics.map(([key,name,icon])=>[copy(name),number.format(result.totals[key]),
        key==='conversations'?copy('Mỗi hội thoại nhân viên đã trả lời tính một lần trên toàn Shop.'):null,icon])}/>
      <WorkTable items={result.staff} view={setSelected}/>
      {result.owners.length>0&&<WorkTable owner items={result.owners} view={setSelected}/>}
    </>}
    {selected&&<WorkDetails person={selected} query={query} openWorkItem={openWorkItem} close={()=>setSelected(null)}/>}
  </section>;
}
