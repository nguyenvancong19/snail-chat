'use client';

import { useEffect, useId, useState } from 'react';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { api } from '../lib/workspace.js';
import { Icon } from './icons.jsx';
import { Button, Chip, Field } from './ui.jsx';

const blankLine={sku:'',color:'',size:'',quantity:1};

export function AgentProductReview({id,review,canRespond,status,paused,latest}) {
  const {copy}=useDisplayLocale();
  const titleId=useId();
  const [items,setItems]=useState(()=>review.items?.length?review.items.map(line=>({...blankLine,...line})):[{...blankLine}]);
  const [catalog,setCatalog]=useState(null);
  const [problem,setProblem]=useState('');
  const [loadFailed,setLoadFailed]=useState(false);
  const [loadRevision,setLoadRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [resolved,setResolved]=useState(null);
  const decision=review.decision?review:resolved;
  const actionable=!decision&&canRespond&&status==='review'&&latest&&!paused;
  const path='messages/'+encodeURIComponent(id)+'/product-review';

  useEffect(()=>{
    if(!actionable)return;
    const controller=new AbortController();
    setLoadFailed(false);
    api(path,'GET',undefined,controller.signal).then(result=>{
      if(!controller.signal.aborted)setCatalog(result.products);
    }).catch(error=>{
      if(!controller.signal.aborted){setProblem(error.message);setLoadFailed(true);}
    });
    return ()=>controller.abort();
  },[actionable,path,loadRevision]);

  function change(index,patch) {
    setItems(previous=>previous.map((item,position)=>position===index?{...item,...patch}:item));
  }

  async function submit(action) {
    setBusy(true);
    setProblem('');
    try{
      const result=await api(path,'PATCH',action==='confirm'?{action,items:items.map(({sku,color,size,quantity})=>({
        sku,color,size,quantity:Number(quantity),
      }))}:{action});
      setResolved(result.orderReview);
    }catch(error){setProblem(error.message);}
    finally{setBusy(false);}
  }

  const known=new Map((catalog??[]).map(product=>[product.sku,product]));
  const valid=items.every(({sku,quantity})=>known.get(sku)?.in_stock===true&&Number.isInteger(Number(quantity))&&Number(quantity)>=1&&Number(quantity)<=99)&&
    new Set(items.map(({sku})=>sku)).size===items.length;
  return <section className="agent-review-card" aria-labelledby={titleId}>
    <header className="agent-review-header">
      <div className="agent-review-heading">
        <span className="agent-review-icon"><Icon name="check"/></span>
        <div>
          <h3 id={titleId}>{copy('Xác nhận sản phẩm cho Agent')}</h3>
          <p>{copy('Shop kiểm tra mẫu, biến thể và số lượng trước khi Agent nhắn tiếp.')}</p>
        </div>
      </div>
      <Chip status={decision?'replied':'review'}>{copy(decision?.decision==='confirm'?'Đã xác nhận':decision?'Đã nhờ hỏi lại':'Cần kiểm tra')}</Chip>
    </header>
    {decision?.decision==='confirm'&&<div className="agent-review-body" role="status">
      <ul>{decision.items.map(({sku,name,color,size,quantity})=>
        <li key={sku}>{quantity} × {name??sku} ({sku}){color?' · '+color:''}{size?' · '+copy('Size')+' '+size:''}</li>)}</ul>
    </div>}
    {!decision&&!actionable&&<div className="agent-review-body"><p>{copy(
      !canRespond?'Cần quyền trả lời tin nhắn để xử lý yêu cầu.':status==='expired'?'Tin nhắn đã hết thời gian phản hồi.':
      !latest?'Khách đã nhắn thêm. Hãy xem tin mới nhất.':paused?'Hãy bật lại Agent để tiếp tục.':'Tin nhắn đang được xử lý hoặc đã được trả lời.',
    )}</p></div>}
    {actionable&&<form className="agent-review-body" onSubmit={event=>{event.preventDefault();if(valid&&!busy)void submit('confirm');}}>
      {!catalog&&!loadFailed&&<p role="status">{copy('Đang tải danh mục sản phẩm…')}</p>}
      {loadFailed&&<div><Button onClick={()=>{setProblem('');setLoadRevision(n=>n+1);}}>{copy('Tải lại danh mục')}</Button></div>}
      {catalog?.length===0&&<p>{copy('Kênh này chưa có sản phẩm trong danh mục.')}</p>}
      {!!catalog?.length&&items.map((item,index)=><div className="agent-review-item" key={index}>
        <div className="agent-review-line">
          <Field label="Sản phẩm"><select required value={item.sku} disabled={busy} onChange={event=>change(index,{sku:event.target.value})}>
            <option value="">{copy('Chọn sản phẩm')}</option>
            {item.sku&&!known.has(item.sku)&&<option value={item.sku} disabled>{item.sku} · {copy('Không còn trong danh mục')}</option>}
            {catalog.map(product=><option key={product.sku} value={product.sku} disabled={!product.in_stock}>
              {product.name} · {product.sku}{!product.in_stock?' · '+copy('Hết hàng'):''}
            </option>)}
          </select></Field>
          <Field label="Màu"><input maxLength={48} value={item.color} disabled={busy} onChange={event=>change(index,{color:event.target.value})}/></Field>
          <Field label="Size"><input maxLength={32} value={item.size} disabled={busy} onChange={event=>change(index,{size:event.target.value})}/></Field>
          <Field label="Số lượng"><input type="number" inputMode="numeric" required min="1" max="99" value={item.quantity} disabled={busy} onChange={event=>change(index,{quantity:event.target.value})}/></Field>
        </div>
        {known.get(item.sku)?.in_stock===false&&<p className="formerror" role="status">{copy('Sản phẩm đã hết hàng.')}</p>}
        {items.length>1&&<Button aria-label={copy('Bỏ sản phẩm')+' '+(index+1)} disabled={busy} onClick={()=>setItems(previous=>previous.filter((_,i)=>i!==index))}>{copy('Bỏ')}</Button>}
      </div>)}
      {!!catalog?.length&&<div className="agent-review-add">
        <Button icon="plus" disabled={busy||items.length>=12} onClick={()=>setItems(previous=>[...previous,{...blankLine}])}>{copy('Thêm sản phẩm')}</Button>
      </div>}
      {problem&&<p className="formerror" role="alert">{copy(problem)}</p>}
      <footer className="agent-review-footer">
        {!!catalog?.length&&<p>{copy('Shop tự kiểm tra tồn theo màu, size và số lượng.')}</p>}
        <div className="agent-review-actions">
          <Button disabled={busy} onClick={()=>submit('clarify')}>{copy('Nhờ Agent hỏi lại')}</Button>
          <Button variant="primary" type="submit" disabled={busy||!valid}>{copy('Xác nhận cho Agent')}</Button>
        </div>
      </footer>
    </form>}
    {!actionable&&problem&&<div className="agent-review-body"><p className="formerror" role="alert">{copy(problem)}</p></div>}
  </section>;
}
