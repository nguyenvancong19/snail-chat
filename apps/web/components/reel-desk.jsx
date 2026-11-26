'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { accountHome, activeShop, api, emptyWorkspace, ensureBrowserSession, selectShop } from '../lib/workspace.js';
import { AdminBilling, ServicePlans } from './billing.jsx';
import { Brand, Button } from './ui.jsx';
import { BotConfiguration, BotKnowledge } from './bot-workspace.jsx';
import { AdminShops, ShopInvitations, ShopMembers } from './shops.jsx';
import { AdminAiSettings } from './ai-settings.jsx';
import { useSystemTheme } from './theme.jsx';
import { appearancePreferences, effectiveTheme, themeStyle } from '../lib/appearance.js';
import { displayCopy, useDisplayCatalog } from '../lib/display-catalog.jsx';
import { DisplayLocale, DisplayCatalog, useDeviceDisplayLocale } from '../lib/display-locale.jsx';
import { message, planDisplayName } from '../lib/locale.js';
import { agentSounds, claimAgentAlert, deviceSoundOn, playAgentSound, soundRequest, unlockAgentAudio } from '../lib/agent-alert-sounds.js';
import { Orders } from './orders.jsx';
import { AlertToast, useWorkspaceAlerts } from './workspace-alerts.jsx';
import { Icon } from './icons.jsx';
import { AccountAvatar, AccountMenu, AccountSettings, AccountSwitcher } from './account-menu.jsx';
import { AddAccountForm, BotForm, ChannelForm, Dialog, Login, PageChoicesForm } from './forms.jsx';
import { AdminOverview, AdminSystem, AdminUsers, Analytics, Channels, Comments, Messages, Notifications, Overview, PublishedPosts } from './views.jsx';

const userGroups=[
  [['dashboard','Tổng quan','grid',Overview]],
  [['channels','Quản lý kênh','channels',Channels],['analytics','Thống kê kênh','chart',Analytics]],
  [['messages','Tin nhắn','send',Messages],['comments','Bình luận','chat',Comments],['posts','Bài đăng','document',PublishedPosts]],
  [['bots','Cấu hình agent','bot',BotConfiguration],['bot-knowledge','FAQ & Chat nhanh','book',BotKnowledge]],
  [['orders','Đơn hàng','package',Orders]],
];
const settingsTabs=['appearance','language','sounds'];
const settingsEntry=['settings','Cài đặt tài khoản','settings',AccountSettings];
const adminNav=[['dashboard','Quản lý Shop','shop',AdminShops],['users-overview','Tổng quan người dùng','grid',AdminOverview],
  ['users','Quản lý người dùng','user',AdminUsers],['system','Thống kê hệ thống','chart',AdminSystem],
  ['billing','Quản lý gói','tag',AdminBilling],['openrouter','Cấu hình AI','bot',AdminAiSettings],settingsEntry];

export default function SnailChat({ adminArea=false, loginArea=false }) {

  const [workspace,setWorkspace]=useState(null), [problem,setProblem]=useState('');
  const [view,setView]=useState('dashboard'), [dialog,setDialog]=useState(null), [mobile,setMobile]=useState(false);
  const [selectedChannel,setSelectedChannel]=useState('');
  const [botKind,setBotKind]=useState('comment');
  const [activityTarget,setActivityTarget]=useState(null);
  const [notice,setNotice]=useState(''), [activityVersion,setActivityVersion]=useState(0);
  const [accessRevision,setAccessRevision]=useState(0);
  const [changingAccount,setChangingAccount]=useState(false);
  const [switching,setSwitching]=useState(false), [pendingAlert,setPendingAlert]=useState(null);
  const deviceLocale=useDeviceDisplayLocale();
  const [appearance,setAppearance]=useState(null),[appearanceTrial,setAppearanceTrial]=useState(null);
  const systemDark=useSystemTheme();
  const accountId=workspace?.user?.id;
  const sidebarKey=accountId ? 'snailchat.sidebar.compact.'+(adminArea?'admin.':'workspace.')+accountId : null;
  const [sidebarPreference,setSidebarPreference]=useState(null);
  const [navHint,setNavHint]=useState(null);
  const mobileMenuButton=useRef(null), mobileCloseButton=useRef(null);
  const sidebarCompact=sidebarPreference?.key===sidebarKey&&sidebarPreference?.compact===true;
  useEffect(()=>{
    if(!sidebarKey)return;
    let compact=false;
    try{compact=window.localStorage.getItem(sidebarKey)==='1';}catch{}
    setSidebarPreference({key:sidebarKey,compact});
  },[sidebarKey]);
  useEffect(()=>{
    const desktop=window.matchMedia('(width > 690px)');
    const clear=()=>{setMobile(false);setNavHint(null);};
    desktop.addEventListener('change',clear);
    return ()=>desktop.removeEventListener('change',clear);
  },[]);
  function toggleSidebar() {
    const compact=!sidebarCompact;
    setNavHint(null);
    setSidebarPreference({key:sidebarKey,compact});
    try{window.localStorage.setItem(sidebarKey,compact?'1':'0');}catch{}
  }
  function closeMobileSidebar() {
    setMobile(false);
    window.requestAnimationFrame(()=>mobileMenuButton.current?.focus());
  }
  function showNavHint(event, text) {
    if(!sidebarCompact||event.currentTarget.contains(event.relatedTarget))return;
    const rect=event.currentTarget.getBoundingClientRect();
    setNavHint({text,left:rect.right+8,top:rect.top+rect.height/2});
  }

  useEffect(()=>{
    setAppearance(null);
    setAppearanceTrial(null);
  },[accountId]);
  const savedAppearance=appearancePreferences(workspace?.theme);
  const appearanceDraft=accountId&&appearance?.accountId===accountId?appearance.draft:savedAppearance;
  const locale=accountId?appearanceDraft.locale:deviceLocale;
  useEffect(()=>{
    if(!accountId)return;
    try{window.localStorage.setItem('snailchat.displayLocale',savedAppearance.locale);}catch{}
  },[accountId,savedAppearance.locale]);
  const displayCatalog=useDisplayCatalog(locale,!!workspace?.user);
  const copy=(source)=>displayCopy(locale,displayCatalog,source);
  const t=(key)=>message(locale,key);
  useEffect(()=>{
    document.documentElement.lang=locale;
    return ()=>{document.documentElement.lang='vi';};
  },[locale]);
  const alerts=useWorkspaceAlerts(workspace?.user?.id,workspace?.activeShopId);
  const {notify}=alerts;
  const requestSequence=useRef(0), lastUnavailableShop=useRef(null);
  const previousAccess=useRef(null);
  useEffect(()=>{
    if(!workspace?.user){previousAccess.current=null;return;}
    const snapshot={
      user:workspace.user.id,shop:workspace.activeShopId,
      permissions:JSON.stringify([workspace.memberRole,workspace.shopAccessLimited,workspace.planFeatures?.feature_flags,
        workspace.shops?.find(({id})=>id===workspace.activeShopId)?.subscriptionPlan,
        workspace.channels.map(({id,purpose,permissions})=>[id,purpose,permissions])]),
    };
    const prior=previousAccess.current;
    previousAccess.current=snapshot;
    if(prior?.user===snapshot.user&&prior.shop===snapshot.shop&&prior.permissions!==snapshot.permissions){
      setNotice('Quyền hoặc tính năng của Shop đã thay đổi.');
    }
  },[workspace]);
  const refresh=useCallback(async({fallback=true}={})=>{
    const request=++requestSequence.current;
    let data;
    try {
      data=await api('bootstrap');
    } catch(error) {
      if(!fallback||error.status!==403||request!==requestSequence.current)throw error;
      selectShop('');
      data=await api('bootstrap');
      if(request===requestSequence.current)setPendingAlert({id:'workspace-access',title:'Shop trước đó không khả dụng',message:error.message});
    }
    if(request===requestSequence.current){
      selectShop(data.activeShopId??'');
      if(data.shopPreferenceUnavailable&&lastUnavailableShop.current!==data.user?.id){
        lastUnavailableShop.current=data.user?.id;
        setPendingAlert({id:'workspace-access',title:'Shop trước đó không khả dụng',
          message:'Shop dùng lần trước đã hết hạn, bị khóa hoặc bạn không còn quyền truy cập.'});
      } else if(!data.user||(!data.shopPreferenceUnavailable&&data.activeShopId)){
        lastUnavailableShop.current=null;
      }
      setWorkspace({...emptyWorkspace,...data});
    }
    return data;
  },[]);
  const go=useCallback((next)=>{
    setActivityTarget(null);
    if(next!=='orders')setAppearanceTrial(null);
    setView(next);
    setMobile(false);
    const destination=adminArea?'/admin#'+next:next==='settings'?'/settings':
      settingsTabs.includes(next)?'/settings#'+next:'/dashboard#'+next;
    if(window.location.pathname+window.location.hash!==destination)window.history.pushState(null,'',destination);
  },[adminArea]);
  useEffect(()=>{
    let live=true;
    const onLocation=()=>{
      setActivityTarget(null);
      const hash=window.location.hash.slice(1);
      if(hash!=='orders')setAppearanceTrial(null);
      setView(window.location.pathname==='/settings'&&!settingsTabs.includes(hash)?'settings':hash||'dashboard');
    };
    onLocation();
    window.addEventListener('hashchange',onLocation);
    window.addEventListener('popstate',onLocation);
    async function start() {
      try {
        const params=new URLSearchParams(window.location.search);
        const status=params.get('meta');
        if(status&&params.get('shop'))selectShop(params.get('shop'));
        const data=await refresh();
        if (!live) return;
        if (!status) return;
        window.history.replaceState(null,'',window.location.pathname+'#channels');
        go('channels');
        if (status==='choose'&&data.memberRole==='OWNER') {
          try {
            const flow=params.get('flow');
            const grant=await api('meta/choices?flow='+encodeURIComponent(flow));
            if(live)setDialog({type:'pages',value:{...grant,flow}});
          } catch(error){if(live)setPendingAlert({id:'meta-connection',title:'Chưa thể kết nối kênh',message:error.message});}
        } else if(status==='ok')setNotice('Đã kết nối kênh Meta.');
        else setPendingAlert({id:'meta-connection',title:'Chưa thể kết nối kênh',message:status});
      } catch(error){if(live)setProblem(error.message);}
    }
    start();
    return ()=>{
      live=false;
      window.removeEventListener('hashchange',onLocation);
      window.removeEventListener('popstate',onLocation);
    };
  },[go,refresh]);
  useEffect(()=>{
    if(!notice)return;
    const timer=setTimeout(()=>setNotice(''),5000);
    return ()=>clearTimeout(timer);
  },[notice]);
  useEffect(()=>{
    if(!workspace?.user||switching||changingAccount||loginArea)return;
    const update=()=>{if(!document.hidden)refresh().catch(()=>{});};
    const timer=setInterval(update,15000);
    const keepSession=setInterval(()=>{if(!document.hidden)ensureBrowserSession(5*60_000).catch(()=>{});},4*60_000);
    window.addEventListener('focus',update);
    return ()=>{clearInterval(timer);clearInterval(keepSession);window.removeEventListener('focus',update);};
  },[workspace?.user?.id,refresh,switching,changingAccount,loginArea]);
  useEffect(()=>{
    if(!workspace||changingAccount)return;
    const user=workspace.user;
    if(!user&&!loginArea)window.location.replace('/login');
    else if(user&&loginArea)window.location.replace(accountHome(user));
    else if(user?.isSuperAdmin&&!adminArea){
      const tab=window.location.hash||(window.location.pathname==='/settings'?'#settings':'');
      window.location.replace('/admin'+tab);
    }else if(user&&adminArea&&!user.isSuperAdmin)window.location.replace('/dashboard');
  },[workspace,adminArea,loginArea,changingAccount]);
  const soundIncluded=workspace?.planFeatures?.feature_flags?.alertSounds===true;
  useEffect(()=>{
    const shop=workspace?.activeShopId;
    if(!accountId||switching||changingAccount||loginArea)return;
    const stream=new EventSource(shop?'/api/events?'+new URLSearchParams({shop}):'/api/events');
    const controller=new AbortController();
    const {signal}=controller;
    const current=()=>!signal.aborted&&activeShop()===(shop??'');
    function unlock(){if(soundIncluded&&deviceSoundOn(shop))unlockAgentAudio();}
    window.addEventListener('pointerdown',unlock);
    window.addEventListener('keydown',unlock);
    let pendingAudio=Promise.resolve();
    stream.addEventListener('agent-alert',event=>{
      let alert;
      try{alert=JSON.parse(event.data);}catch{return;}
      const {kind,target,source,pageId,soundAllowed}=alert??{};
      if(!Object.hasOwn(agentSounds,kind)||!['messages','orders','verification'].includes(target)||!source||!pageId||!current())return;
      const eventId=JSON.stringify([kind,target,pageId,source]);
      const label=target==='messages'?'Mở hội thoại':target==='verification'?'Mở yêu cầu xác minh':'Xem đơn hàng';
      const message=target==='messages'?'Có yêu cầu kiểm tra sản phẩm trong hội thoại.':
        target==='verification'?'Có yêu cầu mới trong danh sách chờ xác minh.':'Đơn đã được lưu vào danh sách đơn hàng.';
      notify({id:'agent:'+eventId,title:agentSounds[kind].phrase,message,action:{view:target==='messages'?'messages':'orders',label,agentTarget:target,source,pageId}},{repeat:false});
      if(!soundIncluded||soundAllowed!==true||!deviceSoundOn(shop))return;
      pendingAudio=pendingAudio.then(async()=>{
        if(!current()||!deviceSoundOn(shop))return;
        try{
          const {sounds}=await soundRequest(shop,'',{signal}).then(response=>response.json());
          if(!current()||!deviceSoundOn(shop)||!sounds[kind]?.enabled||!await claimAgentAlert(shop,eventId))return;
          await playAgentSound(shop,kind,{filename:sounds[kind].filename,signal,shouldPlay:()=>current()&&deviceSoundOn(shop)});
        }catch(error){
          if(current()&&error.status!==403)notify({id:'agent-unavailable',title:'Chưa phát được âm báo',
            message:'Mở cài đặt để nghe thử hoặc đổi file.',action:{view:'sounds',label:'Mở cài đặt'}},{repeat:false});
        }
      });
    });
    let timer,accessChanged=false;
    function updateWorkspace(){
      if(timer)return;
      timer=setTimeout(()=>{
        timer=undefined;
        if(!current())return;
        if(accessChanged){
          accessChanged=false;
          setAccessRevision((value)=>value+1);
        }
        setActivityVersion((value)=>value+1);
        refresh().catch(()=>{});
      },300);
    }
    function invalidateAccess(){
      accessChanged=true;
      updateWorkspace();
    }
    stream.addEventListener('page',updateWorkspace);
    stream.addEventListener('access-changed',invalidateAccess);
    stream.addEventListener('open',invalidateAccess);
    return ()=>{
      controller.abort();
      window.removeEventListener('pointerdown',unlock);
      window.removeEventListener('keydown',unlock);
      clearTimeout(timer);
      stream.close();
    };
  },[accountId,workspace?.activeShopId,switching,changingAccount,loginArea,refresh,notify,soundIncluded]);

  useEffect(()=>{
    if(!pendingAlert||!workspace?.user)return;
    notify(pendingAlert);
    setPendingAlert(null);
  },[pendingAlert,workspace?.user,notify]);

  useEffect(()=>{
    if(!workspace?.shopOverQuota)return;
    notify({id:'shop-quota',title:'Shop vượt hạn mức',message:'Các Page đang tạm dừng xử lý. '+
      (workspace.memberRole==='OWNER'?'Chọn tài nguyên cần giữ hoặc nâng gói.':'Liên hệ chủ Shop để tiếp tục.'),
      action:workspace.memberRole==='OWNER'?{view:'billing',label:'Xem gói dịch vụ'}:null},{repeat:false});
  },[workspace?.shopOverQuota,workspace?.memberRole,notify]);

  async function switchShop(id,next='dashboard') {
    if(!id||id===activeShop())return;
    const previous=activeShop();
    setSwitching(true);
    setSelectedChannel('');
    setDialog(null);
    setActivityTarget(null);
    try{
      await api('shop/preference','POST',{shop:id});
      selectShop(id);
      const data=await refresh({fallback:false});
      go(data.shopAccessLimited?'billing':data.memberRole==='STAFF'?'messages':typeof next==='string'?next:'dashboard');
    }catch(error){
      selectShop(previous);
      notify({id:'shop-switch',title:'Chưa thể chuyển Shop',message:error.message});
      await refresh().catch(()=>{});
    }finally{setSwitching(false);}
  }

  async function login(path,body) {
    const result=await api(path,'POST',body);
    if(path==='login'){
      selectShop('');
      setChangingAccount(true);
      window.location.replace(accountHome(result.user));
    }
    return result;
  }
  async function logout() {
    try {
      await api('logout','POST',{});
      selectShop('');
      setChangingAccount(true);
      window.location.replace('/login');
    } catch(error){notify({id:'logout',title:'Chưa thể đăng xuất',message:error.message});}
  }
  async function save(path, body) {
    await api(path,'POST',body,path==='replies'?AbortSignal.timeout(body instanceof FormData?90_000:8_000):undefined);
    if(path==='account/theme'){
      await refresh();
      setAppearance((current)=>current?.accountId===accountId&&current.draft===body?null:current);
      setAppearanceTrial(null);
      return;
    }
    if(path==='replies'||path==='posts/bot')setActivityVersion((version)=>version+1);
    else await refresh();
    setNotice(path==='replies'?'Đã đưa phản hồi vào hàng đợi.':'Đã lưu thay đổi.');
  }
  const open=(type,value)=>setDialog({type,value});
  const close=()=>setDialog(null);
  async function connect(platform,channelId) {
    if (!workspace.meta?.[platform]) {
      open('meta-config',platform);
      return;
    }
    const query=new URLSearchParams(channelId?{channel:channelId}:{platform});
    query.set('shop',workspace.activeShopId);
    try{
      if(await ensureBrowserSession(3*60_000))window.location.assign('/api/meta/start?'+query);
      else await refresh();
    }catch(error){setNotice(error.message);}
  }
  function openAccountHome(user) {
    const destination=accountHome(user);
    selectShop('');
    if(window.location.pathname===destination){
      window.history.replaceState(null,'',destination);
      window.location.reload();
    }else window.location.replace(destination);
  }

  async function changeAccount(path,body) {
    const result=await api(path,'POST',body);
    // Ignore any workspace response started under the old session.
    requestSequence.current++;
    setChangingAccount(true);
    const user=result.user??await api('session').then(session=>session.user).catch(()=>null);
    openAccountHome(user??{isSuperAdmin:false});
  }

  const addAccount=(body)=>changeAccount('login',body);
  const switchAccount=(id)=>changeAccount('browser-accounts/switch',{id});
  async function choosePages(flow,pages) {
    const result=await api('meta/choices','POST',{flow,pages});
    if(result.connected.length) {
      await refresh();
      setNotice('Đã kết nối '+result.connected.length+' Facebook Page.');
    }
    return result;
  }
  function navigateNotification(kind,target) {
    go(kind==='comment'?'comments':'messages');
    setSelectedChannel(target.item.channelId);
    setActivityTarget({...target,kind,version:crypto.randomUUID()});
  }
  function renderDialog() {
    if(!dialog)return null;
    const channelId=dialog.type==='post-bot'?dialog.value?.channel?.id:
      ['channel','bot','message-bot'].includes(dialog.type)?dialog.value?.id:null;
    if(channelId&&!workspace.channels.some((channel)=>channel.id===channelId))return null;
    if(['bot','post-bot','message-bot'].includes(dialog.type)&&(!owner||!agent||workspace.shopAccessLimited))return null;
    const {type,value}=dialog;
    const common={close,save};
    switch(type) {
      case 'meta-config':return <Dialog key={type} title={copy("Thiết lập kết nối ")+(value==='fb'?'Facebook':'Instagram')} close={close}>
        <p className="notice">{copy("Máy chủ cần cấu hình Meta App và URL HTTPS. Xem hướng dẫn trong README của dự án.")}</p>
      </Dialog>;
      case 'pages':return <PageChoicesForm key={value.flow} grant={value} close={close} connect={choosePages}/>;
      case 'channel':return <ChannelForm key={value.id} channel={value} {...common} connect={connect}/>;
      case 'bot':return <BotForm key={value?.id||'trial'} channel={value} {...common}/>;
      case 'post-bot':return <BotForm key={'post-'+value.post.id} channel={value.channel} post={value.post} {...common}/>;
      case 'message-bot':return <BotForm key={'message-'+value.id} channel={value} messaging {...common}/>;
      case 'create-shop':return <Dialog title={copy("Tạo Shop riêng")} close={close} submit={async(form)=>{
        const {shopId}=await api('shop','POST',{name:form.get('name')});
        await switchShop(shopId);
      }} label={copy("Tạo Shop")}>
        <label className="field">{copy("Tên Shop")}<input name="name" required maxLength={100}/></label>
      </Dialog>;
      case 'add-account':return <AddAccountForm key={type} close={close} add={addAccount}/>;
      case 'switch-account':return <AccountSwitcher key={type} close={close} switchAccount={switchAccount} add={()=>open('add-account')}/>;
      default:return null;
    }
  }

  if (changingAccount) return <main className="loading" role="status">{copy("Đang mở SnailChat…")}</main>;
  if (!workspace) return <main className="loading">{problem
    ? <><p>{copy(problem)}</p><Button onClick={()=>window.location.reload()}>{copy("Tải lại")}</Button></>
    : copy("Đang mở SnailChat…")}</main>;
  const toast=notice&&<div id="toast" className="show" role="status">{copy(notice)}</div>;
  if(loginArea&&!workspace.user)return <DisplayLocale.Provider value={locale}><DisplayCatalog.Provider value={displayCatalog}><Login key={view} startRecovery={view==='forgot-password'} startRegistration={view==='register'} submit={login} resend={(body)=>api('resend-verification','POST',body)}/>{toast}</DisplayCatalog.Provider></DisplayLocale.Provider>;
  const admin=workspace.user?.isSuperAdmin===true;
  if(!workspace.user||loginArea||adminArea!==admin)return <main className="loading" role="status">{copy("Đang mở SnailChat…")}</main>;
  const owner=workspace.memberRole==='OWNER';
  const staff=workspace.memberRole==='STAFF';
  const agent=workspace.planFeatures?.agent_enabled===true;
  const {messages,comments,quickReplies,faq}=workspace.planFeatures?.feature_flags??{};
  const orders=workspace.planFeatures?.order_management===true;
  const catalog=workspace.planFeatures?.catalog_enabled===true;
  const canRecover=!staff&&(owner||(!workspace.activeShopId&&workspace.shops?.some(({role})=>role==='OWNER')));
  const groups=admin?[adminNav]:[
    ...userGroups.map((group)=>group.filter(([key])=>{
      if(key==='channels')return canRecover;
      if(key==='bots')return owner&&!!workspace.activeShopId;
      if(!workspace.activeShopId||workspace.shopAccessLimited)return false;
      if(key==='orders')return orders&&(owner||staff)&&workspace.channels.some((channel)=>channel.permissions?.includes('order:manage'));
      if((key==='messages'&&!messages)||(key==='comments'&&!comments))return false;
      if(key==='bot-knowledge'&&!quickReplies&&!faq)return false;
      return owner||(staff&&['messages','comments'].includes(key));
    }).map((entry)=>entry[0]==='bot-knowledge'&&(!faq||!quickReplies)?[entry[0],faq?'FAQ':'Chat nhanh',...entry.slice(2)]:entry)),
    canRecover?[['billing','Gói dịch vụ','tag',ServicePlans]]:[],
    [
      ...(!staff&&workspace.invitations?.length?[['invitations','Lời mời tham gia Shop','user',ShopInvitations]]:[]),
      ...(owner&&!workspace.shopAccessLimited?[['members','Cài đặt nhân viên','users',ShopMembers]]:[]),
      settingsEntry,
    ],
  ].filter((group)=>group.length);
  const nav=groups.flat();
  const viewGroup=({catalog:'channels','quick-replies':'bot-knowledge',appearance:'settings',language:'settings',sounds:'settings'})[view]??view;
  const defaultView=(!admin&&(!workspace.activeShopId||workspace.shopAccessLimited)
    ?nav.find(([item])=>item==='invitations')??nav.find(([item])=>item==='billing'):null)??nav[0];
  const activeView=nav.find(([item])=>item===viewGroup);
  const [id,originalLabel,,View]=activeView??defaultView;
  const navLabel=(key,fallback)=>{
    const localizedKey=key==='dashboard'&&admin?'adminShops':key==='billing'&&admin?'adminBilling':
      key==='bot-knowledge'&&!faq?'quickReplies':key==='bot-knowledge'&&!quickReplies?'faq':key==='settings'?'accountSettings':key==='system'?'systemStats':key;
    const translated=t(localizedKey);
    return translated===localizedKey?copy(fallback):translated;
  };
  const label=navLabel(id,originalLabel);
  const workspaceTab=activeView&&(view!=='catalog'||catalog)?view:id;
  const currentShop=workspace.shops?.find((shop)=>shop.id===workspace.activeShopId);
  const shopLabel=admin?'Super Admin':currentShop
    ?planDisplayName(locale,currentShop.subscriptionPlan,currentShop.planName)
    :copy('Chưa chọn Shop');
  const shopOptions=workspace.shops??[];
  const section=t(admin?'platformAdmin':'yourWorkspace');
  const counts=Object.values(workspace.stats);
  const pending={comments:counts.reduce((sum,c)=>sum+c.pending_comments,0),messages:counts.reduce((sum,c)=>sum+c.pending_messages,0),
    orders:counts.reduce((sum,c)=>sum+(c.pending_verifications??0),0)};
  const isAppearanceTrial=appearanceTrial?.accountId===accountId&&id==='orders';
  const theme=themeStyle(isAppearanceTrial?appearanceDraft[appearanceTrial.mode]:
    savedAppearance[effectiveTheme(savedAppearance.mode,systemDark)]);
  function tryAppearance(mode){
    if(!nav.some(([item])=>item==='orders'))return false;
    setAppearanceTrial({accountId,mode});
    go('orders');
    return true;
  }
  function openAlert(item){
    alerts.markRead(item.id);
    if(!item.action)return;
    const {agentTarget,source,pageId}=item.action;
    if(agentTarget==='messages'){
      void api('notifications/open','POST',{kind:'message',id:source}).then(target=>{
        if(activeShop()===workspace.activeShopId&&target.item)navigateNotification('message',target);
      }).catch(error=>setNotice(error.message));
      return;
    }
    if(agentTarget){
      go('orders');
      setSelectedChannel(pageId);
      setActivityTarget({kind:agentTarget,source,pageId,version:crypto.randomUUID()});
      return;
    }
    if(item.action.shopId&&item.action.shopId!==workspace.activeShopId)void switchShop(item.action.shopId,item.action.view);
    else go(item.action.view);
  }
  return <DisplayLocale.Provider value={locale}><DisplayCatalog.Provider value={displayCatalog}><div className="account-theme" data-theme={theme.mode} style={theme.style}><div className="layout" data-sidebar-compact={sidebarCompact}>
    {mobile&&<button type="button" className="sidebar-scrim" aria-label={t('closeMenu')} onClick={closeMobileSidebar}/>}
    <aside className={'sidebar '+(mobile?'open':'')} id="workspace-sidebar" onKeyDown={event=>{
      if(event.key==='Escape'){setNavHint(null);if(mobile)closeMobileSidebar();}
    }}>
      <div className="sidebar-head"><Brand/>
        <button type="button" className="iconbtn sidebar-toggle" aria-controls="workspace-navigation" aria-expanded={!sidebarCompact}
          aria-label={t(sidebarCompact?'expandSidebar':'collapseSidebar')} title={t(sidebarCompact?'expandSidebar':'collapseSidebar')}
          onClick={toggleSidebar}><Icon name="sidebar"/></button>
        <button type="button" className="iconbtn sidebar-mobile-close" ref={mobileCloseButton} aria-label={t('closeMenu')}
          onClick={closeMobileSidebar}><Icon name="x"/></button>
      </div>
      {!admin&&<div className="workspace-picker">
        <label className="shop-switcher">{t('workspace')}
          {shopOptions.length>1||!currentShop?<span className="shop-control"><Icon name="grid"/><select value={workspace.activeShopId??''} disabled={switching||!shopOptions.length}
            onChange={(event)=>switchShop(event.target.value)}>
            <option value="" disabled>{t('chooseShop')}</option>
            {shopOptions.map((shop)=>{
              const blocked=shop.status!=='ACTIVE'||(shop.expiredAt!==null&&shop.expiredAt<=Date.now());
              return <option key={shop.id} value={shop.id} disabled={blocked&&shop.role!=='OWNER'}>{shop.name} · {t(shop.role==='OWNER'?'owner':'staff')}{blocked?copy(" · Tạm ngừng"):''}</option>;
            })}
          </select></span>:<span className="shop-control"><Icon name="grid"/><strong>{currentShop.name}</strong></span>}
          {currentShop&&<small className="dim">{t(owner?'owner':'staff')}</small>}
        </label>
        {!staff&&!shopOptions.some(({role})=>role==='OWNER')&&<Button icon="plus" onClick={()=>open('create-shop')}>{copy("Tạo Shop riêng")}</Button>}
      </div>}
      <p className="navcaption">{section}</p>
      <nav className="navgroup" id="workspace-navigation" aria-label={section} onScroll={()=>setNavHint(null)}>
        {groups.map(group=><div className="nav-section" key={group[0][0]}>{group.map(([key,name,icon])=>{
          const itemLabel=navLabel(key,name);
          const count=pending[key]||0;
          const countLabel=count+(key==='orders'?copy(" đơn chờ xác minh"):copy(" cần xử lý"));
          return <button type="button" key={key} className="navbtn" aria-current={key===id?'page':undefined}
            aria-label={count ? itemLabel+', '+countLabel : itemLabel}
            onMouseEnter={event=>showNavHint(event,itemLabel)} onMouseLeave={()=>setNavHint(null)}
            onFocus={event=>showNavHint(event,itemLabel)} onBlur={()=>setNavHint(null)}
            onClick={()=>{setNavHint(null);if(mobile)closeMobileSidebar();go(key);}}>
            <Icon name={icon}/><span className="sidebar-nav-label">{itemLabel}</span>
            {count>0&&<span className="navcount work-count" aria-hidden="true">{count}</span>}
          </button>;
        })}</div>)}
      </nav>
      {sidebarCompact&&navHint&&<span className="sidebar-nav-hint" style={{left:navHint.left,top:navHint.top}} aria-hidden="true">{navHint.text}</span>}
      <div className="sidebottom"><AccountMenu user={workspace.user} shopLabel={shopLabel} go={go} open={open} logout={logout}/></div>
    </aside>
    <div className="main"><header className="topbar"><div className="crumb">
      <button className="iconbtn mobile-menu" type="button" ref={mobileMenuButton} aria-controls="workspace-sidebar" aria-expanded={mobile}
        aria-label={t(mobile?'closeMenu':'openMenu')} onClick={()=>{
          if(mobile){closeMobileSidebar();return;}
          setMobile(true);window.requestAnimationFrame(()=>mobileCloseButton.current?.focus());
        }}><Icon name="menu"/></button>
      <span className="homecrumb">{section}</span><span aria-hidden="true">/</span><b>{label}</b>
    </div><div className="topright"><Notifications key={workspace.user.id+':'+workspace.activeShopId+':'+switching} activityVersion={activityVersion}
        enabled={!admin&&!switching&&!workspace.shopAccessLimited&&!!workspace.activeShopId} alerts={alerts.items} onOpenAlert={openAlert}
        onReadAlerts={()=>alerts.markRead()} onShow={alerts.dismiss} onNavigate={navigateNotification}/>
      <AccountAvatar user={workspace.user}/></div></header>
      <main className="content">
        {['partial','disabled','unavailable'].includes(displayCatalog.status)&&id==='settings'&&workspaceTab==='language'&&
          <p className="dim" role="status">{copy('Một số bản dịch chưa tải được.')}</p>}
        {isAppearanceTrial&&<div className="notice appearance-trial" role="status">
          {t('trial')} <Button onClick={()=>go('appearance')}>{t('backAppearance')}</Button>
        </div>}
        {!admin&&!workspace.activeShopId&&!workspace.invitations?.length&&id!=='billing'&&<p className="notice">{workspace.shopSelectionNeeded?copy("Chọn Shop ở thanh bên để bắt đầu."):copy("Bạn chưa có quyền truy cập Shop đang hoạt động.")}</p>}
        {!admin&&workspace.shopOverQuota&&id!=='billing'&&<div className="notice workspace-quota" role="status">
          {copy("Shop vượt hạn mức Page hoặc nhân viên. Các Page tạm dừng xử lý.")}
          {owner?<Button onClick={()=>go('billing')}>{copy("Chọn tài nguyên hoặc nâng gói")}</Button>:<span> {copy("Liên hệ chủ Shop để tiếp tục.")}</span>}
        </div>}
        {switching?<p className="dim" role="status">{copy("Đang chuyển Shop…")}</p>:<View key={workspace.user.id+':'+(workspace.activeShopId??'')+':'+(activityTarget?.version??id)} state={workspace} workspaceTab={workspaceTab} activityVersion={activityVersion} accessRevision={accessRevision} botKind={botKind} setBotKind={setBotKind} activityTarget={activityTarget} go={go} open={open} connect={connect} save={save} refreshWorkspace={refresh} notify={notify}
        selectedChannel={selectedChannel} setSelectedChannel={(channel)=>{setActivityTarget(null);setSelectedChannel(channel);}} onAcceptInvitation={(id)=>switchShop(id)} onSwitchShop={switchShop}
        appearanceDraft={appearanceDraft} setAppearanceDraft={(draft)=>setAppearance({accountId,draft})}
        systemDark={systemDark} onTryAppearance={tryAppearance} loadInsights={(key)=>api('insights?channel='+encodeURIComponent(key))}/>}
      </main>
    </div>
  </div>{renderDialog()}{toast}{alerts.visible&&<AlertToast item={alerts.visible} onDismiss={alerts.dismiss} onOpen={openAlert}/>}</div></DisplayCatalog.Provider></DisplayLocale.Provider>;
}
