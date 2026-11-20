'use client';

import { ListPagination, useListPage } from './list-pagination.jsx';

import { useDisplayLocale } from '../lib/display-locale.jsx';

import { useEffect, useState } from 'react';
import { api, formatDate, orderGoodsTotal, orderLinesText } from '../lib/workspace.js';
import { Dialog } from './forms.jsx';
import { Button, Field } from './ui.jsx';

const events={
  incoming:['Khách nhắn cụm từ',''],
  productDetails:['Thông tin chi tiết sản phẩm','name, sku, description'],
  identifyProduct:['Chưa xác định sản phẩm',''],
  quote:['Báo giá','name, sku, price, stock'],
  buyIdentify:['Khách muốn đặt hàng nhưng chưa rõ sản phẩm',''],
  buyResume:['Khách nhắc lại ý định mua trước khi xác nhận','code, name, sku, quantity, total'],
  buy:['Khách muốn đặt hàng – hỏi thông tin nhận hàng','name, sku, price, stock, quantity'],
  confirm:['Tóm tắt trước khi xác nhận','name, sku, price, stock, quantity, total, code'],
  waiting:['Chờ shop xác minh','code, customer'],
  verified:['Xác minh thành công','code, customer'],
  placed:['Sau khi lên đơn','code'],
  track:['Tra cứu đơn','code, status, tracking'],
  help:['Khách hỏi cách đặt hàng',''],unknownProduct:['Không tìm thấy mã sản phẩm',''],
  quantity:['Số lượng không hợp lệ',''],noOrder:['Không tìm thấy đơn','code'],expired:['Đơn nháp hết hạn hoặc chưa có',''],
  cancelled:['Đã hủy đơn nháp',''],invalidCode:['Mã xác nhận không khớp',''],
  unavailable:['Sản phẩm hết hàng','name, sku, stock, price'],invalidDetails:['Thông tin nhận hàng sai định dạng',''],
  missingDetails:['Chưa có thông tin nhận hàng',''],priceChanged:['Giá thay đổi trước khi chốt','name, sku, price, stock, quantity, total, code'],
  sendingVerification:['Đã duyệt, đang gửi tin xác minh','code, customer'],unknownImage:['Không nhận ra sản phẩm trong ảnh',''],
};

export function CheckoutCases({ channel, saved, close, refresh }) {
  const {copy}=useDisplayLocale();
  const [cases,setCases]=useState(()=>{
    const rules=saved.cases??[];
    const legacy=Object.entries(saved.templates??{}).filter(([event,reply])=>events[event]&&reply&&
      !rules.some((rule)=>rule.event===event&&!rule.match)).map(([event,reply])=>({event,reply,match:''}));
    return [...rules,...legacy].map((rule,id)=>({...rule,id,reply:rule.event==='confirm'&&!rule.reply.includes('{code}')?
      rule.reply+' {code}':rule.reply}));
  });
  const [aiMode,setAiMode]=useState(saved.aiMode??'off');
  const [next,setNext]=useState(cases.length);
  function update(id,fields) {
    setCases((current)=>current.map((rule)=>rule.id===id?{...rule,...fields}:rule));
  }
  return <Dialog title={copy("Cấu hình bot chốt đơn")} close={close} label={copy("Lưu trường hợp")} submit={async()=>{
    await api('orders/cases','POST',{channel,aiMode,cases:cases.map(({event,match,reply})=>({event,match,reply}))});
    refresh();
  }}>
    <Field label={copy("OpenRouter nhận diện câu hỏi tự nhiên")}><select value={aiMode} onChange={(event)=>setAiMode(event.target.value)}>
      <option value="off">{copy("Tắt")}</option><option value="review">{copy("Gợi ý để shop duyệt")}</option><option value="auto">{copy("Tự gửi khi nhận diện rõ")}</option>
    </select></Field>
    <p className="dim">{copy("Cần bật OpenRouter trong Admin. Tin nhắn đang xét được gửi đến model để chọn tình huống. Điền chi tiết sản phẩm trong Danh mục Page và dùng biến")} {'{description}'}.</p>
    <p className="dim">{copy("Bot gửi nội dung shop đã lưu. Để chạy luồng mua lần đầu, thêm Khách muốn đặt hàng – hỏi thông tin nhận hàng, Tóm tắt trước khi xác nhận, Chờ shop xác minh và Xác minh thành công. Trong hướng dẫn, ghi cách gửi Họ tên | Số điện thoại | Địa chỉ. Trong tóm tắt, ghi XÁC NHẬN")} { '{code}' }.</p>
    <p className="dim">{copy("Khi khách nhắn “tôi muốn đặt hàng”, bot dùng sản phẩm vừa báo giá trong cuộc trò chuyện. Nếu chưa rõ sản phẩm, thêm trường hợp hỏi mã. Để trống cụm từ ở mẫu hỏi thông tin nhận hàng để dùng được cả khi khách gửi mã sản phẩm.")}</p>
    <div className="bot-section">
      {cases.map((rule,index)=><fieldset className="bot-group" key={rule.id}>
        <legend>{copy("Trường hợp")} {index+1}</legend>
        <Field label={copy("Khi nào áp dụng")}><select value={rule.event} onChange={(event)=>update(rule.id,{event:event.target.value,match:''})}>
          {Object.entries(events).map(([key,[label]])=><option key={key} value={key}>{copy(label)}</option>)}
        </select></Field>
        {rule.event!=='verified'&&<Field label={rule.event==='incoming'?copy("Cụm từ khách nhắn"):copy("Cụm từ khách nhắn (không bắt buộc)")}>
          <input value={rule.match} required={rule.event==='incoming'} maxLength={120} onChange={(event)=>update(rule.id,{match:event.target.value})}/>
        </Field>}
        <Field label={copy("Câu trả lời")}><textarea required rows={3} maxLength={400} value={rule.reply}
          onChange={(event)=>update(rule.id,{reply:event.target.value})}/></Field>
        {events[rule.event][1]&&<p className="bot-hint">{copy("Biến hỗ trợ")} {events[rule.event][1].split(', ').map((value)=>'{'+value+'}').join(', ')}</p>}
        <Button onClick={()=>setCases((current)=>current.filter(({id})=>id!==rule.id))}>{copy("Xóa trường hợp")}</Button>
      </fieldset>)}
    </div>
    <Button onClick={()=>{
      setCases([...cases,{id:next,event:'incoming',match:'',reply:''}]);
      setNext(next+1);
    }}>{copy("Thêm trường hợp")}</Button>
  </Dialog>;
}

export function BuyerVerification({ channel, refreshOrders }) {
  const {intl,copy}=useDisplayLocale();
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[cursors,setCursors]=useState(['']);
  const before=cursors.at(-1);
  const [result,setResult]=useState(null),[revision,setRevision]=useState(0),[error,setError]=useState('');
  const [review,setReview]=useState(null),[revoke,setRevoke]=useState(null),[notice,setNotice]=useState('');
  const [manual,setManual]=useState(null);
  async function openManual(){
    setManual({contacts:[]});
    try{
      const {items}=await api('orders/verification/contacts?'+new URLSearchParams({channel}));
      setManual((current)=>current&&{...current,contacts:items});
    }catch(problem){setError(problem.message);}
  }
  const path='orders/verification?'+new URLSearchParams({channel,q:search,before});
  useEffect(()=>{
    const controller=new AbortController();
    setError('');setResult(null);
    let loading=false;
    async function load() {
      if(loading)return;
      loading=true;
      try{
        const data=await api(path,'GET',undefined,controller.signal);
        if(!controller.signal.aborted){setResult(data);setError('');}
      }catch(problem){
        if(!controller.signal.aborted)setError(problem.message);
      }finally{loading=false;}
    }
    load();
    const interval=setInterval(load,8000);
    return ()=>{controller.abort();clearInterval(interval);};
  },[path,revision]);
  const customers=useListPage(result?.customers??[]);
  const refresh=()=>setRevision((value)=>value+1);
  return <section className="card bot-workspace-card">
    <div className="bot-rule-summary"><h2>{copy("Khách chờ xác minh")}</h2>
      <Button variant="primary" onClick={openManual}>{copy("Xác minh thủ công")}</Button>
    </div>
    <form className="toolbar" onSubmit={(event)=>{event.preventDefault();setCursors(['']);setSearch(query.trim());customers.pagination.onChange(1);refresh();}}>
      <label htmlFor="buyer-search">{copy("Facebook ID của Page (PSID) hoặc số điện thoại")}</label>
      <input id="buyer-search" value={query} onChange={(event)=>setQuery(event.target.value)} maxLength={40}/>
      <Button type="submit">{copy("Tìm khách")}</Button>
      <Button onClick={()=>{setQuery('');setSearch('');setCursors(['']);refresh();}}>{copy("Làm mới")}</Button>
    </form>
    {notice&&<p role="status" className="notice">{copy(notice)}</p>}
    {error&&<p role="alert" className="formerror">{copy(error)}</p>}
    {!result&&!error&&<p className="dim">{copy("Đang tải yêu cầu…")}</p>}
    {result&&!result.items.length&&<p className="dim">{copy("Chưa có yêu cầu xác minh phù hợp.")}</p>}
    {result?.items.map((item)=><div className="bot-rule-summary" key={item.code}>
      <div><strong>{item.customer} · {item.phone}</strong>
        <small className="dim">{orderLinesText(item)} · {formatDate(item.confirmed_at,intl)}</small></div>
      {item.status==='verified'
        ?<small className="dim">{item.message_status==='uncertain'?copy("Đã xác minh · Cần đối chiếu tin nhắn trên Meta"):
          ['review','expired'].includes(item.message_status)?copy("Đã xác minh · Chờ tin nhắn mới để gửi lại"):
          copy("Đã xác minh · Chờ bot gửi xác nhận để lên đơn")}</small>
        :<div className="faq-actions">
          <Button variant="primary" onClick={()=>setReview({item,action:'approve'})}>{copy("Xác minh")}</Button>
          <Button onClick={()=>setReview({item,action:'reject'})}>{copy("Từ chối")}</Button>
        </div>}
    </div>)}
    <ListPagination page={cursors.length} hasNext={!!result?.next} count={result?.items?.length}
      onChange={page=>setCursors(page<cursors.length?cursors.slice(0,-1):[...cursors,result.next])}/>
    {search&&result&&<div className="bot-section">
      <h3>{copy("Lịch sử mua hàng")}</h3>
      {!result.customers.length&&<p className="dim">{copy("Chưa tìm thấy khách từng đặt đơn.")}</p>}
      {customers.items.map((customer)=><div className="bot-rule-summary" key={customer.sender_id+'-'+customer.phone}>
        <div><strong>{customer.customer} · {customer.phone}</strong>
          <small className="dim">PSID {customer.sender_id} · {customer.purchases} {copy("đơn ·")} {customer.verified_at?copy("Đã xác minh"):copy("Chưa xác minh")}</small></div>
        {customer.verified_at?<Button onClick={()=>setRevoke(customer)}>{copy("Gỡ xác minh")}</Button>:<Button onClick={()=>setManual({customer,contacts:[]})}>{copy("Xác minh")}</Button>}
      </div>)}
      <ListPagination {...customers.pagination}/>
    </div>}
    {review&&<Dialog title={review.action==='approve'?copy("Xác minh khách hàng"):copy("Từ chối yêu cầu")} close={()=>setReview(null)}
      label={review.action==='approve'?copy("Duyệt xác minh"):copy("Từ chối")} submit={async(form)=>{
        await api('orders/verification','POST',{channel,code:review.item.code,action:review.action,verified:form.has('verified'),sizeVerified:form.has('sizeVerified')});
        setNotice(review.action==='approve'?'Đã xác minh. Đơn sẽ được tạo sau khi Meta xác nhận đã gửi tin nhắn.':'Đã từ chối yêu cầu.');
        refresh();
        refreshOrders();
      }}>
      <p><strong>{review.item.customer}</strong> · {review.item.phone}<br/>{review.item.address}</p>
      <p>PSID {review.item.sender_id} {copy("· Mã")} {review.item.code}</p>
      <p>{orderLinesText(review.item)} · {(orderGoodsTotal(review.item)).toLocaleString('vi-VN')}{copy("đ")}</p>
      {review.action==='approve'&&review.item.items?.some((line)=>line.size&&!line.variant_reviewed)&&
        <label className="check"><input type="checkbox" name="sizeVerified" required/> {copy("Tôi đã kiểm tra đủ hàng theo size khách chọn")}</label>}
      {review.action==='approve'&&<label className="check"><input type="checkbox" name="verified" required/> {copy("Tôi đã xác minh khách hàng và thông tin nhận hàng")}</label>}
    </Dialog>}
    {manual&&<Dialog title={copy("Xác minh thủ công")} label={copy("Lưu xác minh")} close={()=>setManual(null)} submit={async(form)=>{
      await api('orders/verification/manual','POST',{channel,sender:form.get('sender'),phone:form.get('phone'),verified:form.has('verified')});
      setNotice('Đã lưu xác minh cho khách trên Page này.');
      setCursors(['']);setSearch(String(form.get('sender')));setQuery(String(form.get('sender')));refresh();
    }}>
      <p className="dim">{copy("Chọn khách đã nhắn Page hoặc nhập PSID từ cuộc trò chuyện của khách.")}</p>
      {manual.contacts.length>0&&<Field label={copy("Khách đã nhắn Page")}><select defaultValue="" onChange={(event)=>{
        event.currentTarget.form.elements.sender.value=event.target.value;
      }}>
        <option value="">{copy("Chọn khách gần đây")}</option>
        {manual.contacts.map((item)=><option key={item.sender_id} value={item.sender_id}>
          {item.display_name||copy("Khách Messenger")} · {item.sender_id}
        </option>)}
      </select></Field>}
      <Field label={copy("PSID khách")}><input name="sender" defaultValue={manual.customer?.sender_id}
        required pattern="[0-9]{1,40}" maxLength={40}/></Field>
      <Field label={copy("Số điện thoại đã đối chiếu")}><input name="phone" type="tel" required maxLength={30} defaultValue={manual.customer?.phone}/></Field>
      <label className="check"><input type="checkbox" name="verified" required/> {copy("Tôi đã xác minh khách hàng")}</label>
    </Dialog>}
    {revoke&&<Dialog title={copy("Gỡ xác minh khách hàng")} label={copy("Gỡ xác minh")} close={()=>setRevoke(null)} submit={async()=>{
      await api('orders/verification/revoke','POST',{channel,sender:revoke.sender_id,phone:revoke.phone});
      setNotice('Đã gỡ xác minh. Đơn tiếp theo của khách sẽ cần shop duyệt.');
      refresh();
    }}><p>{copy("Shop sẽ xác minh lại")} {revoke.customer} · {revoke.phone} {copy("ở lần đặt hàng tiếp theo.")}</p></Dialog>}
  </section>;
}
