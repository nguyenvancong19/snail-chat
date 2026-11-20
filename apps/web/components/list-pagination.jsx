'use client';

import { useEffect, useRef, useState } from 'react';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { Button } from './ui.jsx';

export const listPageSize=10;

export function useListPage(items) {
  const [requested,setPage]=useState(1);
  const page=Math.min(requested,Math.max(1,Math.ceil(items.length/listPageSize)));
  useEffect(()=>{if(page!==requested)setPage(page);},[page,requested]);
  return {items:items.slice((page-1)*listPageSize,page*listPageSize),
    pagination:{page,total:items.length,onChange:setPage}};
}

function pageLinks(page,last){
  if(last<=6)return Array.from({length:last},(_,index)=>index+1);
  const middle=page<=3?[2,3,4]:page>=last-2?[last-3,last-2,last-1]:[page-1,page,page+1];
  return [...new Set([1,...middle,last])]
    .sort((left,right)=>left-right);
}

export function ListPagination({page=1,total,hasNext=false,count,onChange,busy=false}) {
  const {t,copy,intl}=useDisplayLocale();
  const nav=useRef(null);
  const focusAfterMove=useRef(false);
  useEffect(()=>{
    if(!focusAfterMove.current)return;
    focusAfterMove.current=false;
    nav.current?.querySelector('[aria-current=page]')?.focus();
  },[page]);
  function move(next){
    focusAfterMove.current=true;
    onChange(next);
  }
  const known=Number.isSafeInteger(total);
  const last=known?Math.max(1,Math.ceil(total/listPageSize)):null;
  if(known?last===1:page===1&&!hasNext)return null;
  const number=new Intl.NumberFormat(intl);
  const start=(page-1)*listPageSize+1;
  const end=known?Math.min(page*listPageSize,total):start+count-1;
  const links=known?pageLinks(page,last):[page];
  return <nav ref={nav} className="list-pagination" aria-label={copy('Phân trang')} aria-busy={busy}>
    <span className="dim" aria-live="polite">
      {known?<>{copy('Hiển thị')} {number.format(start)}–{number.format(end)} {copy('trên')} {number.format(total)}</>:
        count>0?<>{t('pageNumber',{count:page})} · {number.format(count)} {copy('bản ghi')}</>:t('pageNumber',{count:page})}
    </span>
    <div className="list-pagination-actions">
      <Button disabled={busy||page<=1} onClick={()=>move(page-1)}>{t('prevPage')}</Button>
      {links.map((value,index)=><span className="list-pagination-link" key={value}>
        {index>0&&value>links[index-1]+1&&<span aria-hidden="true">…</span>}
        <Button aria-label={t('pageNumber',{count:value})} aria-current={value===page?'page':undefined}
          disabled={busy&&value!==page} onClick={()=>{if(value!==page)move(value);}}>{number.format(value)}</Button>
      </span>)}
      <Button disabled={busy||(known?page>=last:!hasNext)} onClick={()=>move(page+1)}>{t('nextPage')}</Button>
    </div>
  </nav>;
}
