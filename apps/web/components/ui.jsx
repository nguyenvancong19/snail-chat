'use client';

import { useEffect, useRef, useState } from 'react';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { screenTitle } from '../lib/locale.js';
import { activeShop } from '../lib/workspace.js';
import { Icon } from './icons.jsx';

export function Brand({href}={}) {
  const content=<><span className="brandmark"><Icon name="logo"/></span><span className="brand-name">SnailChat</span></>;
  return href?<a className="brand" href={href}>{content}</a>:<div className="brand">{content}</div>;
}
export function Button({ icon, variant='', type='button', children, ...props }) {
  return <button type={type} className={'button '+variant} {...props}>{icon && <Icon name={icon}/>} {children}</button>;
}
export function Title({ title, subtitle, action }) {
  const {locale}=useDisplayLocale();
  return <div className="section-head"><div><h1>{screenTitle(locale,title)}</h1><p>{subtitle}</p></div>{action}</div>;
}
export function CardHead({ title, subtitle, action }) {
  return <header className="card-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>;
}
export function Chip({ status, children }) { return <span className={'chip '+status}>{children}</span>; }
export function Empty({children}) { return <div className="empty">{children}</div>; }
export function PlatformIcon({ platform }) {
  return <span className={'platform-icon '+platform}><Icon name={platform}/></span>;
}
export function Field({label,children}) {
  const {copy}=useDisplayLocale();
  return <label className="field">{copy(label)}{children}</label>;
}
export function FilePicker({label,onChange,...props}) {
  const {copy}=useDisplayLocale();
  const input=useRef(null);
  const [name,setName]=useState('');
  useEffect(()=>{
    const form=input.current?.form;
    const reset=()=>setName('');
    form?.addEventListener('reset',reset);
    return ()=>form?.removeEventListener('reset',reset);
  },[]);
  return <div className="field">
    <span>{label}</span>
    <div className="localized-file-picker">
      <span className="button localized-file-action">
        <span aria-hidden="true">{copy('Chọn tệp')}</span>
        <input {...props} ref={input} type="file" aria-label={label} onChange={(event)=>{
          setName(event.target.files?.[0]?.name??'');
          onChange?.(event);
        }}/>
      </span>
      <span className="localized-file-name" role="status">{name||copy('Chưa chọn tệp')}</span>
    </div>
  </div>;
}
export function MetricGrid({ metrics }) {
  const {t}=useDisplayLocale();
  return <section className="metrics" aria-label={t('metricSummary')}>{metrics.map(([name, value, note, icon, color]) =>
    <article className="metric" key={name}><div className="metric-top">{name}<span className={'metric-icon '+(color??'')}><Icon name={icon}/></span></div><b>{value}</b>{note && <small>{note}</small>}</article>)}</section>;
}
export function Chart({ title, subtitle, data }) {
  const {copy}=useDisplayLocale();
  const max=Math.max(1,...data.map(([,value])=>value));
  return <section className="card"><CardHead title={title} subtitle={subtitle}/><div className="chart-body">
    <ul className="chart-rows">{data.map(([name,value], index)=><li key={name}>
      <div className="chart-label"><b>{name}</b><span>{value}</span></div>
      <div className="chart-track" aria-hidden="true"><span className={'chart-fill chart-fill-'+index%3} style={{width:(value/max*100)+'%'}}/></div>
    </li>)}</ul>{!data.some(([,n])=>n>0) && <p className="chart-empty">{copy("Chưa có dữ liệu để hiển thị.")}</p>}
  </div></section>;
}

export function PageAvatar({ channel }) {
  return <span className={'page-avatar '+(channel?.platform??'fb')} aria-hidden="true">
    <Icon name={channel?.platform??'fb'}/>
    {channel?.id&&<img key={channel.id} src={'/api/channel-avatar?'+new URLSearchParams({channel:channel.id,shop:activeShop()})} alt=""
      loading="lazy" onError={(event)=>{event.currentTarget.hidden=true;}}/>}
  </span>;
}

export function PostThumbnail({ post }) {
  return <span className="post-thumbnail" aria-hidden="true">
    <Icon name="document"/>
    {post?.thumbnail&&<img key={post.thumbnail} src={post.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer"
      onError={(event)=>{event.currentTarget.hidden=true;}}/>}
  </span>;
}
