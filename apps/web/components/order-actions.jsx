'use client';

import { useDisplayLocale } from '../lib/display-locale.jsx';

import { useState } from 'react';
import { api } from '../lib/workspace.js';
import { Dialog } from './forms.jsx';
import { Button, Field } from './ui.jsx';

const labels={edit:'Sửa thông tin giao hàng',cod:'Đổi COD',print:'In vận đơn GHN',cancel:'Hủy vận đơn GHN',
  redeliver:'Yêu cầu giao lại',return:'Yêu cầu trả hàng',sync:'Đồng bộ GHN',archive:'Ẩn khỏi danh sách',restore:'Khôi phục đơn'};

function RecipientFields({order}){
  const {copy}=useDisplayLocale();
  return <>
    <Field label={copy("Người nhận")}><input name="customer" defaultValue={order?.customer} required minLength={2} maxLength={100}/></Field>
    <Field label={copy("Số điện thoại")}><input name="phone" type="tel" defaultValue={order?.phone} required maxLength={30}/></Field>
    <Field label={copy("Địa chỉ")}><textarea name="address" defaultValue={order?.address} required minLength={8} maxLength={350}/></Field>
  </>;
}

export function CreateOrder({channel,ghn,close,complete}){
  const {copy}=useDisplayLocale();
  const [code]=useState(()=>crypto.randomUUID().replaceAll('-','').slice(0,16).toUpperCase());
  return <Dialog title={copy("Tạo đơn hàng")} label={copy("Tạo đơn")} close={close} submit={async(form)=>{
    const data=Object.fromEntries(form);
    await api('orders/create','POST',{...data,channel,code,quantity:Number(data.quantity),sendToGhn:form.has('sendToGhn')});
    complete('Đã tạo đơn '+code+'.');
  }}>
    <div className="form-grid">
      <Field label={copy("Mã sản phẩm trong danh mục")}><input name="sku" required maxLength={50}/></Field>
      <Field label={copy("Số lượng")}><input name="quantity" type="number" min={1} max={99} defaultValue={1} required/></Field>
    </div>
    <RecipientFields/>
    {ghn&&<label className="check"><input name="sendToGhn" type="checkbox"/> {copy("Gửi sang GHN sau khi tạo đơn")}</label>}
  </Dialog>;
}

export function OrderAction({order,action,channel,close,complete}){
  const {copy}=useDisplayLocale();
  const ghn=order.carrier==='ghn'&&!!order.tracking;
  const archive=['archive','restore'].includes(action);
  return <Dialog title={labels[action]} close={close} label={action==='print'?copy("Lấy nhãn in"):labels[action]}
    submit={async(form)=>{
      const data=Object.fromEntries(form);
      const base={channel,code:order.code,updated:order.updated};
      if(archive){
        await api('orders/archive','POST',{...base,restore:action==='restore'});
        complete(action==='restore'?'Đã khôi phục đơn.':'Đã ẩn đơn khỏi danh sách.');
        return;
      }
      if(!ghn){
        await api('orders/recipient','POST',{...base,...data});
        complete('Đã lưu thông tin người nhận.');
        return;
      }
      if(action==='cod')data.amount=Number(data.amount);
      for(const key of ['payment','weight','length','width','height']){
        if(data[key])data[key]=Number(data[key]);else delete data[key];
      }
      if(data.note==='')delete data.note;
      const result=await api('orders/ghn/action','POST',{...base,...data,action});
      if(result.url){complete('Nhãn in đã sẵn sàng.',result.url);return;}
      complete(result.pending
        ? action==='sync'?'Đã tải thông tin vận đơn. Một số dữ liệu từ GHN chưa cập nhật xong.'
          :'GHN đã nhận yêu cầu. SnailChat đang chờ dữ liệu mới.'
        : 'Đã cập nhật vận đơn GHN.');
    }}>
    <p className="dim">{copy("Đơn")} {order.code}{order.tracking?copy(" · Vận đơn ")+order.tracking:''}</p>
    {action==='print'&&<Field label={copy("Khổ giấy")}><select name="format">
      <option value="a5">A5</option><option value="square">80 × 80 mm</option><option value="small">52 × 70 mm</option>
    </select></Field>}
    {action==='edit'&&<>
      <RecipientFields order={order}/>
      {ghn&&<>
        <p className="dim">{copy("Nếu đổi địa chỉ, nhập số nhà/đường, phường/xã mới, tỉnh/thành. GHN quyết định trường nào được sửa theo trạng thái vận đơn.")}</p>
        <Field label={copy("Ghi chú mới cho tài xế")}><input name="note" maxLength={500}/></Field>
        <Field label={copy("Quyền kiểm hàng")}><select name="inspection"><option value="">{copy("Giữ nguyên")}</option>
          <option value="KHONGCHOXEMHANG">{copy("Không xem hàng")}</option><option value="CHOXEMHANGKHONGTHU">{copy("Xem hàng, không thử")}</option>
          <option value="CHOTHUHANG">{copy("Xem và thử hàng")}</option></select></Field>
        <Field label={copy("Bên trả phí vận chuyển")}><select name="payment"><option value="">{copy("Giữ nguyên")}</option>
          <option value="1">{copy("Shop trả")}</option><option value="2">{copy("Khách trả")}</option></select></Field>
        <div className="form-grid">
          {[['weight','Khối lượng (g)',19999],['length','Dài (cm)',200],['width','Rộng (cm)',200],['height','Cao (cm)',200]]
            .map(([key,label,max])=><Field key={key} label={label}><input name={key} type="number" min={1} max={max} placeholder={copy("Giữ nguyên")}/></Field>)}
        </div>
      </>}
    </>}
    {action==='cod'&&<>
      <Field label={copy("COD mới (đồng)")}><input name="amount" type="number" min={0} max={50_000_000} defaultValue={order.shipment?.cod??''} required/></Field>
      <p className="dim">{copy("Đổi số tiền GHN thu từ khách khi giao. Nếu giao một phần, hãy chờ tài xế GHN xác nhận rồi nhập số tiền thực thu. Dùng 0 nếu không cần thu hộ.")}</p>
    </>}
    {action==='cancel'&&<>
      <Field label={copy("Lý do hủy")}><select name="reasonCode" required><option value="">{copy("Chọn lý do")}</option>
        <option value="GHN-CO001">{copy("Shop chưa gửi hàng")}</option><option value="GHN-CO002">{copy("Hết hàng")}</option>
        <option value="GHN-CO003">{copy("Người nhận không còn nhu cầu")}</option><option value="GHN-CANCEL-OTHER">{copy("Lý do khác")}</option></select></Field>
      <Field label={copy("Ghi chú lý do")}><input name="reason" maxLength={250}/></Field>
    </>}
    {action==='archive'&&<p>{copy("Đơn sẽ chuyển vào mục Đã ẩn. Bạn có thể khôi phục từ đó.")}</p>}
  </Dialog>;
}

export function OrderMenu({code,children}){
  const {copy}=useDisplayLocale();
  return <details className="order-menu" onToggle={(event)=>{
    const menu=event.currentTarget;
    if(!menu.open||!menu.closest('.order-table'))return;
    const trigger=menu.querySelector('summary').getBoundingClientRect();
    const panel=menu.querySelector('.order-menu-panel');
    const gap=6;
    const bottom=trigger.bottom+gap;
    const top=bottom+panel.offsetHeight<=window.innerHeight-gap?bottom:Math.max(gap,trigger.top-panel.offsetHeight-gap);
    panel.style.top=top+'px';
    panel.style.right=Math.max(gap,window.innerWidth-trigger.right)+'px';
  }} onKeyDown={(event)=>{
    if(event.key!=='Escape'||!event.currentTarget.open)return;
    event.preventDefault();
    event.currentTarget.open=false;
    event.currentTarget.querySelector('summary').focus();
  }} onBlur={(event)=>{
    if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;
  }}>
    <summary className="button order-menu-trigger" aria-label={copy("Thao tác đơn ")+code}>
      <span aria-hidden="true">⋯</span>
    </summary>
    <div className="order-menu-panel" role="group" aria-label={copy("Thao tác đơn hàng")} onClick={(event)=>{
      if(event.target.closest('button')){
        const menu=event.currentTarget.closest('details');
        menu.open=false;
        menu.querySelector('summary').focus();
      }
    }}>{children}</div>
  </details>;
}

export function GhnOrderActions({order,open,includePrint=true}){
  const {copy}=useDisplayLocale();
  const state=order.shipment?.status;
  const closed=['delivered','returned','cancel','lost','damage'].includes(state);
  return <>
    {includePrint&&<Button onClick={()=>open('print')}>{copy("In vận đơn")}</Button>}
    <Button onClick={()=>open('sync')}>{copy("Đồng bộ GHN")}</Button>
    {!closed&&<>
      <Button onClick={()=>open('edit')}>{copy("Sửa thông tin giao hàng")}</Button>
      <Button onClick={()=>open('cod')}>{copy("Đổi COD")}</Button>
    </>}
    {['ready_to_pick','picking'].includes(state)&&<Button variant="danger" onClick={()=>open('cancel')}>{copy("Hủy vận đơn")}</Button>}
    {['storing','waiting_to_return'].includes(state)&&<Button onClick={()=>open('redeliver')}>{copy("Giao lại")}</Button>}
    {['delivery_fail','storing','waiting_to_return','return'].includes(state)&&<Button onClick={()=>open('return')}>{copy("Trả hàng")}</Button>}
  </>;
}
