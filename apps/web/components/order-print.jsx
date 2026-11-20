'use client';

import { useDisplayLocale } from '../lib/display-locale.jsx';

import { useRef, useState } from 'react';
import { api } from '../lib/workspace.js';
import { Dialog } from './forms.jsx';
import { Button, Field } from './ui.jsx';

export function OrderPrint({channel,orders,close}){
  const {copy}=useDisplayLocale();
  const [format,setFormat]=useState('a5'),[preview,setPreview]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef(null);
  async function load(event){
    event.preventDefault();
    if(request.current)return;
    const controller=new AbortController();
    request.current=controller;
    setBusy(true);setError('');setPreview('');
    try{
      const result=await api('orders/ghn/print','POST',{channel,format,codes:orders.map((order)=>order.code)},
        AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)]));
      if(!controller.signal.aborted)setPreview(result.url);
    }catch(problem){
      if(!controller.signal.aborted)setError(problem.message);
    }finally{
      request.current=null;
      if(!controller.signal.aborted)setBusy(false);
    }
  }
  return <Dialog title={copy("Xem trước nhãn GHN · ")+orders.length+copy(" đơn")} close={()=>{request.current?.abort();close();}}>
    <form className="toolbar" onSubmit={load}>
      <Field label={copy("Khổ giấy")}><select value={format} disabled={busy} onChange={(event)=>{setFormat(event.target.value);setPreview('');}}>
        <option value="a5">A5</option><option value="square">80 × 80 mm</option><option value="small">52 × 70 mm</option>
      </select></Field>
      <Button variant="primary" type="submit" disabled={busy}>{busy?copy("Đang tải…"):copy("Xem trước")}</Button>
      {preview&&<a className="button" href={preview} target="_blank" rel="noreferrer">{copy("Mở trang in GHN")}</a>}
    </form>
    <details><summary>{copy("Vận đơn đã chọn")}</summary><ul>{orders.map((order)=><li key={order.code}>{order.tracking} · {order.customer}</li>)}</ul></details>
    {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    {preview&&<>
      <p className="dim">{copy("Dùng nút In trên trang GHN. Nếu khung xem trước trống, mở trang in GHN ở tab mới.")}</p>
      <iframe className="order-print-frame" title={copy("Xem trước nhãn vận đơn GHN")} src={preview} referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-modals"/>
    </>}
  </Dialog>;
}
