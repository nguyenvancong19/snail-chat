'use client';

import { ListPagination, useListPage } from './list-pagination.jsx';

import { useDisplayLocale } from '../lib/display-locale.jsx';

import { useState } from 'react';
import { api } from '../lib/workspace.js';
import { Dialog } from './forms.jsx';
import { Button, Field } from './ui.jsx';

export function ChannelResources({ state, refreshWorkspace }) {
  const {copy}=useDisplayLocale();
  const owned=(state.shops??[]).filter((shop)=>shop.role==='OWNER'&&(!state.activeShopId||state.activeShopId===shop.id));
  const [selected,setSelected]=useState('');
  const [resources,setResources]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!owned.length)return null;
  const shop=owned.find(({id})=>id===selected)??owned.find(({id})=>id===state.activeShopId)??owned[0];
  async function open() {
    setBusy(true);setError('');
    try {setResources(await api('billing/resources?'+new URLSearchParams({shop:shop.id})));}
    catch(error){setError(error.message);}
    finally{setBusy(false);}
  }
  async function save(values) {
    await api('billing/resources','PATCH',{shop:shop.id,...values});
    await refreshWorkspace();
  }
  return <>
    <div className="toolbar channel-resource-toolbar">
      {owned.length>1&&<Field label={copy("Shop quản lý")}><select value={shop.id} disabled={busy||!!resources}
        onChange={(event)=>setSelected(event.target.value)}>
        {owned.map(({id,name})=><option key={id} value={id}>{name}</option>)}
      </select></Field>}
      <Button icon="settings" disabled={busy} onClick={open}>{copy("Chọn Page và nhân viên")}</Button>
    </div>
    {error&&<p className="notice" role="alert">{copy(error)}</p>}
    {resources&&<ResourceSelection resources={resources} close={()=>setResources(null)} save={save}/>}
  </>;
}

function ResourceGroup({title,items,selected,toggle,label}) {
  const {copy}=useDisplayLocale();
  const list=useListPage(items);
  return <fieldset className="billing-resource-choice">
    <legend>{copy(title)}</legend>
    {items.length?list.items.map(item=><label key={item.id} className="billing-checkbox">
      <input type="checkbox" checked={selected.has(item.id)} onChange={event=>toggle(item.id,event.target.checked)}/> {label(item)}
    </label>):<p className="dim">{copy("Chưa có mục nào.")}</p>}
    <ListPagination {...list.pagination}/>
  </fieldset>;
}

function ResourceSelection({ resources, close, save }) {
  const {copy}=useDisplayLocale();
  const {limits,pages,staff,invitations}=resources;
  const groups={pages,staff,invitations};
  const [selected,setSelected]=useState(()=>Object.fromEntries(Object.entries(groups).map(([key,items])=>
    [key,new Set(items.filter(item=>!item.paused).map(item=>item.id))])));
  function toggle(group,id,checked){
    setSelected(current=>{
      const next=new Set(current[group]);
      if(checked)next.add(id);else next.delete(id);
      return {...current,[group]:next};
    });
  }
  return <Dialog title={copy("Chọn Page và nhân viên")} close={close} submit={async()=>save({
    pages:[...selected.pages],staff:[...selected.staff],invitations:[...selected.invitations],
    snapshot:JSON.stringify([pages,staff,invitations].map((group)=>group.map(({id})=>id))),
  })}>
    <p>{copy("Chọn tối đa")} {limits.pages} {copy("Page/kênh và")} {limits.staff} {copy("chỗ nhân viên, gồm cả lời mời đang chờ.")}</p>
    <ResourceGroup title="Page/kênh" items={pages} selected={selected.pages} toggle={(...args)=>toggle('pages',...args)}
      label={page=>page.name+' · '+(page.platform==='fb'?'Facebook':'Instagram')+
        (page.connected?'':' · Chưa kết nối')+(page.paused?' · Tạm dừng':'')}/>
    <ResourceGroup title="Nhân viên" items={staff} selected={selected.staff} toggle={(...args)=>toggle('staff',...args)}
      label={member=>member.name+' · '+member.email}/>
    <ResourceGroup title="Lời mời đang chờ" items={invitations} selected={selected.invitations}
      toggle={(...args)=>toggle('invitations',...args)} label={invite=>invite.email}/>
    <p className="notice">{copy("Page bỏ chọn sẽ tạm dừng và giữ lịch sử. Nhân viên bỏ chọn sẽ bị tạm khóa trong Shop này. Bạn có thể mở lại tại Cài đặt nhân viên khi có chỗ. Lời mời bỏ chọn sẽ bị thu hồi.")}</p>
  </Dialog>;
}

