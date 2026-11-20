'use client';

import { useEffect, useState } from 'react';
import { locales } from '../lib/locale.js';
import { appearancePreferences, effectiveTheme, hexPattern, palettes, themeStyle } from '../lib/appearance.js';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { Button, CardHead } from './ui.jsx';
import { Icon } from './icons.jsx';

export function useSystemTheme() {
  const [dark,setDark]=useState(false);
  useEffect(()=>{
    const media=window.matchMedia?.('(prefers-color-scheme: dark)');
    if(!media)return;
    const sync=()=>setDark(media.matches);
    sync();
    media.addEventListener('change',sync);
    return ()=>media.removeEventListener('change',sync);
  },[]);
  return dark;
}

function ColorField({color,value,onChange}) {
  const {t}=useDisplayLocale();
  const [text,setText]=useState(null);
  return <div className="appearance-color">
    <div><strong>{t(color)}</strong><small>{t(color+'Hint')}</small></div>
    <div className="appearance-color-input">
      <input type="color" aria-label={t(color)} value={value} onChange={(event)=>{setText(null);onChange(event.target.value);}}/>
      <input type="text" className="appearance-hex" aria-label={t(color)+' HEX'} value={text??value}
        maxLength={7} spellCheck={false} onBlur={()=>setText(null)} onChange={(event)=>{
          const next=event.target.value;
          setText(next);
          if(hexPattern.test(next))onChange(next.toLowerCase());
        }}/>
    </div>
  </div>;
}

const sample=[
  {id:'SC-1048',date:Date.UTC(2026,10,18),status:'shipping',amount:349000},
  {id:'SC-1047',date:Date.UTC(2026,10,17),status:'delivered',amount:189000},
  {id:'SC-1046',date:Date.UTC(2026,10,16),status:'delivered',amount:590000},
];

function PreviewApp({palette,expanded=false}) {
  const {t,intl}=useDisplayLocale();
  const theme=themeStyle(palette);
  const date=new Intl.DateTimeFormat(intl,{dateStyle:'short',timeZone:'Asia/Ho_Chi_Minh'});
  const money=new Intl.NumberFormat(intl,{style:'currency',currency:'VND'});
  return <div className={'account-theme appearance-mini'+(expanded?' appearance-expanded':'')} data-theme={theme.mode} style={theme.style}>
    <div className="appearance-mini-top"><i/><i/><i/> SnailChat</div>
    <div className="appearance-mini-body">
      <div className="appearance-mini-nav">
        {[['dashboard','grid'],['orders','document'],['settings','settings']].map(([name,icon])=>
          <span key={name} data-active={name==='orders'}><Icon name={icon}/>{t(name)}</span>)}
      </div>
      <div className="appearance-mini-content">
        <div className="appearance-mini-heading"><strong>{t('orders')}</strong>
          <span className="button primary"><Icon name="plus"/>{t('create')}</span></div>
        <div className="appearance-mini-tabs"><b>{t('all')}</b><span>{t('shipping')}</span><span>{t('delivered')}</span></div>
        <div className="appearance-mini-table"><table aria-label={t('recent')}><thead><tr>
          {['id','date','status','amount'].map((name)=><th scope="col" key={name}>{t(name)}</th>)}
        </tr></thead><tbody>{sample.map((row)=><tr key={row.id}>
          <th scope="row">{row.id}</th><td>{date.format(row.date)}</td>
          <td><span className="order-state" data-status={row.status}>{t(row.status)}</span></td><td>{money.format(row.amount)}</td>
        </tr>)}</tbody></table></div>
      </div>
    </div>
  </div>;
}

export function ThemeSettings({state,save,draft,updateDraft,systemDark,languageOnly,onTryAppearance}) {
  const {copy,t}=useDisplayLocale();
  const saved=appearancePreferences(state.theme);
  const activeMode=effectiveTheme(draft.mode,systemDark);
  const [editing,setEditing]=useState(null),[preview,setPreview]=useState(null),[expanded,setExpanded]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[savedNotice,setSavedNotice]=useState(false);
  const editMode=editing??activeMode, previewMode=preview??activeMode;
  const dirty=JSON.stringify(saved)!==JSON.stringify(draft);
  const change=(value)=>{
    setSavedNotice(false);
    updateDraft(value);
  };
  function setColor(color,value){
    setPreview(editMode);
    change({...draft,[editMode]:{...draft[editMode],[color]:value}});
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);setError('');
    try{await save('account/theme',draft);setSavedNotice(true);}
    catch(problem){setError(problem.message);}
    finally{setBusy(false);}
  }
  return <form className="appearance-editor" onSubmit={submit}>
    <div className="appearance-grid">
      <div className="appearance-controls">
      {languageOnly?<section className="card appearance-panel">
        <h2>{t('languageLabel')}</h2><p>{t('languageHelp')}</p>
        <label className="appearance-language"><span className="sr-only">{t('languageLabel')}</span>
          <select value={draft.locale} onChange={(event)=>change({...draft,locale:event.target.value})}>
            {Object.entries(locales).map(([key,locale])=><option key={key} lang={key} value={key}>{locale.name}</option>)}
          </select>
        </label>
      </section>:<>
      <section className="card appearance-panel">
        <h2>{t('mode')}</h2><p>{t('modeHelp')}</p>
        <div className="appearance-mode-options">{['light','dark','system'].map((mode)=>
          <button type="button" key={mode} className="appearance-choice" aria-pressed={draft.mode===mode} onClick={()=>{
            setEditing(null);setPreview(null);change({...draft,mode});
          }}>
            <span className={'appearance-sample '+mode} aria-hidden="true"/><span>{t(mode)}{draft.mode===mode&&<Icon name="check"/>}</span>
          </button>)}</div>
      </section>
      <section className="card appearance-panel">
        <CardHead title={t('customize')} subtitle={t('paletteHelp')}/>
        <label className="appearance-edit">{t('editing')}
          <select value={editMode} onChange={(event)=>{setEditing(event.target.value);setPreview(event.target.value);}}>
            <option value="light">{t('light')}</option><option value="dark">{t('dark')}</option>
          </select>
        </label>
        <div className="appearance-palettes">{Object.entries(palettes).map(([name,variants])=>{
          const pair=variants[editMode];
          const selected=pair.background===draft[editMode].background&&pair.accent===draft[editMode].accent;
          return <button type="button" key={name} className="appearance-choice" aria-pressed={selected} onClick={()=>{
            setPreview(editMode);change({...draft,[editMode]:pair});
          }}><i aria-hidden="true" style={{background:'linear-gradient(125deg,'+pair.background+' 50%,'+pair.accent+' 50%)'}}/>{t(name)}</button>;
        })}</div>
        {['background','accent'].map((color)=><ColorField key={editMode+color} color={color} value={draft[editMode][color]}
          onChange={(value)=>setColor(color,value)}/>)}
      </section>
      </>}
      </div>
      <section className="card appearance-panel appearance-preview">
        <CardHead title={t('preview')} subtitle={t('previewHint')}
          action={<select aria-label={t('compare')} value={preview??''} onChange={(event)=>setPreview(event.target.value||null)}>
            <option value="">{t('systemPreview')}</option><option value="light">{t('light')}</option><option value="dark">{t('dark')}</option>
          </select>}/>
        <PreviewApp palette={draft[previewMode]}/>
        <div className="appearance-footer"><small><Icon name="check"/> {t('contrast')}</small>
          <Button onClick={()=>{if(!onTryAppearance(previewMode))setExpanded(true);}}>{t('full')}</Button>
        </div>
      </section>
    </div>
    {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    <div className="appearance-footer appearance-save">
      <span role="status">{t(dirty?'dirty':savedNotice?'saved':'upToDate')}</span>
      <div className="rowactions"><Button disabled={busy} onClick={()=>{
        setEditing(null);setPreview(null);change(appearancePreferences());
      }}>{t('reset')}</Button>
      <Button type="submit" variant="primary" icon="check" disabled={busy||!dirty}>{t('save')}</Button></div>
    </div>
    {expanded&&<ExpandedPreview palette={draft[previewMode]} close={()=>setExpanded(false)}/>}
  </form>;
}

function ExpandedPreview({palette,close}) {
  const {t}=useDisplayLocale();
  return <dialog className="appearance-full-dialog" ref={(element)=>{
    if(element&&!element.open)element.showModal();
  }} onClose={close} aria-label={t('preview')}>
    <PreviewApp palette={palette} expanded/>
    <div className="appearance-footer"><Button autoFocus onClick={close}>{t('close')}</Button></div>
  </dialog>;
}
