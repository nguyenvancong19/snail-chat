'use client';

import { ListPagination, useListPage } from './list-pagination.jsx';

import { useEffect, useState } from 'react';
import { api, formatDate } from '../lib/workspace.js';
import { Button, Field, FilePicker, Title } from './ui.jsx';
import { Dialog } from './forms.jsx';
import { Icon } from './icons.jsx';
import { useDisplayLocale } from '../lib/display-locale.jsx';
import { AgentAlertSounds } from './agent-alert-sounds.jsx';
import { ThemeSettings } from './theme.jsx';

export function AccountMenu({ user, shopLabel, go, open, logout }) {
  const {t}=useDisplayLocale();
  function choose(event, action) {
    event.currentTarget.closest('details').open=false;
    action();
  }
  return <details className="account-menu">
    <summary className="account-trigger" aria-label={user.name ? t('profile')+': '+user.name : t('profile')}>
      <AccountAvatar user={user}/>
      <span className="account-name"><strong>{user.name}</strong><small>{shopLabel||user.email}</small></span>
      <Icon name="chevron"/>
    </summary>
    <div className="account-popover">
      <Button icon="settings" onClick={(event)=>choose(event,()=>go('settings'))}>{t('accountSettings')}</Button>
      <Button icon="switch" onClick={(event)=>choose(event,()=>open('switch-account'))}>{t('switchAccount')}</Button>
      <Button icon="plus" onClick={(event)=>choose(event,()=>open('add-account'))}>{t('addAccount')}</Button>
      <Button icon="logout" onClick={(event)=>choose(event,logout)}>{t('logout')}</Button>
    </div>
  </details>;
}

export function AccountAvatar({ user }) {
  const initial=(user.name?.trim()||'S').split(/\s+/).slice(0,2).map((part)=>part[0]).join('').toUpperCase();
  return <span className="avatar">{user.avatarVersion
    ?<img src={'/api/profile/avatar?v='+encodeURIComponent(user.avatarVersion)} alt=""/>
    :initial}</span>;
}

function ShopNameForm({ settings, refreshWorkspace }) {
  const {intl,copy,t}=useDisplayLocale();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const locked=settings.nextRenameAt!==null&&settings.nextRenameAt>Date.now();
  async function submit(event) {
    event.preventDefault();
    const name=new FormData(event.currentTarget).get('name');
    setBusy(true);setError('');setSaved(false);
    try{
      await api('shop/name','PATCH',{name});
      await refreshWorkspace();
      setSaved(true);
    }catch(error){
      setError(error.message);
      if(error.status===429)void refreshWorkspace().catch(()=>{});
    }finally{setBusy(false);}
  }
  return <form className="card settings-card shop-name-settings" onSubmit={submit}>
    <h2>{copy("Đổi tên Shop")}</h2>
    <Field label={copy("Tên Shop")}><input key={settings.name} name="name" defaultValue={settings.name} maxLength={100} required readOnly={locked}/></Field>
    <p className="dim">{locked?t('renameAvailableAt',{date:formatDate(settings.nextRenameAt,intl)}):
      settings.cooldownDays?t('renameCooldown',{days:new Intl.NumberFormat(intl).format(settings.cooldownDays)}):t('renameAnytime')}</p>
    {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    {saved&&<p className="notice" role="status">{copy("Đã lưu tên Shop.")}</p>}
    <Button type="submit" variant="primary" disabled={busy||locked}>{copy("Lưu tên Shop")}</Button>
  </form>;
}

export function AccountSettings({state,refreshWorkspace,workspaceTab,go,save,notify,
    appearanceDraft,setAppearanceDraft,systemDark,onTryAppearance}) {
  const {copy,t}=useDisplayLocale();
  const {user}=state;
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function submit(event,avatar=false) {
    event.preventDefault();
    const form=event.currentTarget;
    const fields=new FormData(form);
    setBusy(true);setError('');setNotice('');
    try {
      if(avatar){
        const image=fields.get('avatar');
        if(!image?.size||image.size>2*1024*1024)throw new Error('Hãy chọn ảnh có kích thước tối đa 2 MB.');
        if(!['image/jpeg','image/png','image/webp'].includes(image.type))throw new Error('Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.');
        const response=await fetch('/api/profile/avatar',{method:'POST',headers:{'Content-Type':image.type},body:image});
        if(!response.ok)throw new Error((await response.json().catch(()=>null))?.error||'Chưa tải được ảnh đại diện.');
      } else await api('profile','POST',Object.fromEntries(fields));
      await refreshWorkspace();
      if(avatar)form.reset();
      else for(const name of ['currentPassword','password'])form.elements.namedItem(name).value='';
      setNotice(avatar?'Đã cập nhật ảnh đại diện.':'Đã lưu thông tin tài khoản.');
    }catch(error){setError(error.message);notify({id:avatar?'settings-avatar':'settings-profile',
      title:avatar?'Chưa thể đổi ảnh đại diện':'Chưa thể lưu thông tin',message:error.message});}
    finally{setBusy(false);}
  }
  const customization=['appearance','language'].includes(workspaceTab);
  const soundAvailable=!user.isSuperAdmin&&state.activeShopId&&!state.shopAccessLimited&&
    state.planFeatures?.feature_flags?.alertSounds===true;
  const sounds=soundAvailable&&workspaceTab==='sounds';
  return <>
    <Title title={t(customization?'title':'accountSettings')} subtitle={t(customization?'subtitle':'accountHelp')}/>
    <div className="settings-tabs" role="group" aria-label={t('settings')}>
      <Button icon="user" aria-pressed={!customization&&!sounds} onClick={()=>go('settings')}>{t('profile')}</Button>
      <Button icon="settings" aria-pressed={workspaceTab==='appearance'} onClick={()=>go('appearance')}>{t('appearance')}</Button>
      <Button icon="channels" aria-pressed={workspaceTab==='language'} onClick={()=>go('language')}>{t('language')}</Button>
      {soundAvailable&&<Button icon="bell" aria-pressed={sounds} onClick={()=>go('sounds')}>{copy('Âm thanh thông báo')}</Button>}
    </div>
    {sounds?<AgentAlertSounds key={state.activeShopId} shop={state.activeShopId} owner={state.memberRole==='OWNER'}/>:customization?<ThemeSettings state={state} save={save} draft={appearanceDraft} updateDraft={setAppearanceDraft}
      systemDark={systemDark} languageOnly={workspaceTab==='language'} onTryAppearance={onTryAppearance}/>:<>
    {error&&<p className="notice" role="alert">{copy(error)}</p>}
    {notice&&<p className="notice" role="status">{copy(notice)}</p>}
    <div className="settings-layout">
      <form className="card settings-card" onSubmit={(event)=>submit(event,true)}>
        <h2>{t('avatar')}</h2><AccountAvatar user={user}/>
        <FilePicker label={t('chooseAvatar')} name="avatar" accept="image/jpeg,image/png,image/webp" required/>
        <p className="dim">{copy("JPG, PNG hoặc WebP tĩnh, tối đa 2 MB và 16 megapixel.")}</p>
        <Button type="submit" variant="primary" disabled={busy}>{t('changeAvatar')}</Button>
      </form>
      <form className="card settings-card" onSubmit={(event)=>submit(event)}>
        <h2>{t('personalInfo')}</h2>
        <Field label={t('displayName')}><input name="name" required maxLength={100} defaultValue={user.name} autoComplete="name"/></Field>
        <Field label={t('loginEmail')}><input value={user.email} readOnly/></Field>
        <h2>{t('password')}</h2>
        <Field label={t('currentPassword')}><input type="password" name="currentPassword" maxLength={128} autoComplete="current-password"/></Field>
        <Field label={t('newPassword')}><input type="password" name="password" minLength={12} maxLength={128} autoComplete="new-password"/></Field>
        <Button type="submit" variant="primary" disabled={busy}>{t('saveProfile')}</Button>
      </form>
    </div>
    {state.memberRole==='OWNER'&&state.shopName&&<ShopNameForm settings={state.shopName} refreshWorkspace={refreshWorkspace}/>}
    </>}
  </>;
}

export function AccountSwitcher({ close, switchAccount, add }) {
  const {copy}=useDisplayLocale();
  const [accounts,setAccounts]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const list=useListPage(accounts??[]);
  useEffect(()=>{
    let active=true;
    api('browser-accounts').then((result)=>{if(active)setAccounts(result.accounts);})
      .catch((error)=>{if(active)setError(error.message);});
    return ()=>{active=false;};
  },[]);
  async function choose(account,remove) {
    setBusy(true);setError('');
    try {
      if(remove){
        await api('browser-accounts/remove','POST',{id:account.id});
        setAccounts((items)=>items.filter((item)=>item.id!==account.id));
      } else await switchAccount(account.id);
    } catch(error){setError(error.message);}
    finally{setBusy(false);}
  }
  return <Dialog title={copy("Tài khoản trên thiết bị này")} close={close}>
    <div className="account-list">
      {!accounts&&!error&&<p>{copy("Đang tải tài khoản…")}</p>}
      {list.items.map((account)=><div className="account-list-row" key={account.id}>
        <div><strong>{account.name}</strong><small>{account.email}</small></div>
        {account.active?<small>{copy("Đang dùng")}</small>:<div className="rowactions">
          <Button disabled={busy} onClick={()=>choose(account,false)}>{copy("Chuyển")}</Button>
          <Button disabled={busy} onClick={()=>choose(account,true)} aria-label={copy("Gỡ ")+account.name}>{copy("Gỡ")}</Button>
        </div>}
      </div>)}
      <ListPagination {...list.pagination}/>
      {error&&<p role="alert" className="formerror">{copy(error)}</p>}
      <Button icon="plus" disabled={busy} onClick={add}>{copy("Thêm tài khoản")}</Button>
    </div>
  </Dialog>;
}
