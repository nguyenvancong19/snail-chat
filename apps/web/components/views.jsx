'use client';

import { ListPagination, listPageSize, useListPage } from './list-pagination.jsx';

import { useDisplayLocale } from '../lib/display-locale.jsx';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { activityLabels, api, botLabels, channelIdentity, formatDate, platformLabel } from '../lib/workspace.js';
import { Button, CardHead, Chip, Empty, Field, MetricGrid, PageAvatar, PlatformIcon, PostThumbnail, Title } from './ui.jsx';
import { ConversationTakeover } from './inbox-workflow.jsx';
import { BotReplyPicker, Dialog } from './forms.jsx';
import { CatalogPage } from './catalog.jsx';
import { OrderOverview } from './orders.jsx';
import { Icon } from './icons.jsx';
import { chartDate, ComparisonChart, DonutChart, TimeChart } from './stat-charts.jsx';
import { ChannelResources } from './channel-resources.jsx';
import { MessengerComposer, MessengerTemplates, MessengerTimeline } from './messenger.jsx';

export function Overview({ state, go, setSelectedChannel }) {
  const {copy,t}=useDisplayLocale();
  const total=(name)=>Object.values(state.stats).reduce((sum,item)=>sum+item[name],0);
  return <>
    <Title title={t('dashboard')} subtitle={t('overviewHelp')}
      action={state.memberRole==='OWNER'&&<Button variant="primary" icon="link" onClick={()=>go('channels')}>{t('connectChannel')}</Button>}/>
    <MetricGrid metrics={[
      [t('connectedChannels'),state.channels.filter((c)=>c.connected).length,copy("Facebook và Instagram"),'channels'],
      [t('pendingComments'),total('pending_comments'),t('commentInbox'),'chat','amber'],
      [t('pendingMessages'),total('pending_messages'),t('messengerInbox'),'send','rose'],
      [t('replied'),total('comment_replies')+total('message_replies'),t('messagesComments'),'check','mint'],
    ]}/>
    {state.planFeatures?.order_management===true&&<OrderOverview state={state} go={go} setSelectedChannel={setSelectedChannel}/>}
    <div className="dashgrid">
      <section className="card"><CardHead title={t('interactionInbox')} subtitle={t('viewByChannel')}/>
        <div className="chart-body rowactions">
          <Button icon="chat" onClick={()=>go('comments')}>{t('comments')}</Button>
          <Button icon="send" onClick={()=>go('messages')}>{t('messages')}</Button>
          {state.memberRole==='OWNER'&&<Button icon="chart" onClick={()=>go('posts')}>{t('posts')}</Button>}
        </div>
      </section>
      <section className="card"><CardHead title={t('managedChannels')} action={state.memberRole==='OWNER'&&<Button variant="subtle" onClick={()=>go('channels')}>{t('manage')}</Button>}/>
        {state.channels.length?<div className="channel-list">{state.channels.slice(0,4).map((c)=><div key={c.id} className="channelrow">
          <PageAvatar channel={c}/><div><strong>{c.name}</strong><small>{channelIdentity(c)}</small></div>
          <Chip status={c.connected?'active':'off'}>{t(c.connected?'connected':'disconnected')}</Chip>
        </div>)}</div>:<Empty>{t('noChannels')}</Empty>}
      </section>
    </div>
  </>;
}

export function Channels({ state, open, connect, workspaceTab, go, selectedChannel, setSelectedChannel, refreshWorkspace }) {
  const {copy,t}=useDisplayLocale();
  const [term,setTerm]=useState(''), [platform,setPlatform]=useState('');
  const channels=state.channels.filter((c)=>(!platform||c.platform===platform)&&
    (c.name+' '+c.handle+' '+c.topic).toLowerCase().includes(term.toLowerCase()));
  const list=useListPage([...channels].sort((a,b)=>(b.createdAt??0)-(a.createdAt??0)));
  const hasCatalog=state.planFeatures?.catalog_enabled===true;
  const catalog=hasCatalog&&workspaceTab==='catalog';
  const channel=state.channels.find((item)=>item.id===selectedChannel)??state.channels[0];
  return <>
    <Title title={copy("Quản lý kênh")} subtitle={hasCatalog?copy("Kết nối Facebook hoặc Instagram và quản lý danh mục theo từng kênh."):t('channelSetupHelp')}/>
    <ChannelResources state={state} refreshWorkspace={refreshWorkspace}/>
    {state.memberRole==='OWNER'&&!state.shopAccessLimited?<>
    {hasCatalog&&<div className="toolbar" role="group" aria-label={copy("Quản lý kênh")}>
      <Button variant={catalog?'':'primary'} aria-pressed={!catalog} onClick={()=>go('channels')}>{t('connectChannel')}</Button>
      <Button variant={catalog?'primary':''} aria-pressed={catalog} onClick={()=>go('catalog')}>{t('pageCatalog')}</Button>
    </div>}
    {catalog?(channel?<><div className="toolbar"><label htmlFor="catalog-page">{t('channel')}</label>
      <select id="catalog-page" value={channel.id} onChange={(event)=>setSelectedChannel(event.target.value)}>
        {state.channels.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select></div><CatalogPage key={channel.id+':'+channel.purpose+':'+channel.aiToolsEnabled} channel={channel}/></>:<Empty>{copy("Kết nối một kênh để tạo danh mục.")}</Empty>):<>
    <div className="analytics-grid">{['fb','ig'].map((p)=><section className="card tile connect-tile" key={p}>
      <PlatformIcon platform={p}/><h2>{platformLabel(p)}</h2>
      <p>{p==='fb'?copy("Đăng nhập Facebook, cấp quyền cho SnailChat và chọn các Page bạn muốn quản lý."):copy("Đăng nhập tài khoản Instagram Business hoặc Creator để cấp quyền.")}</p>
      <div><Button variant="primary" icon="link" onClick={()=>connect(p)}>{t('continuePlatform',{platform:p==='fb'?'Facebook':'Instagram'})}</Button></div>
    </section>)}</div>
    {!!state.channels.length&&<div className="toolbar channel-toolbar">
      <input aria-label={t('searchChannel')} placeholder={t('searchChannelName')} value={term} onChange={(e)=>{setTerm(e.target.value);list.pagination.onChange(1);}}/>
      <select aria-label={t('platformFilter')} value={platform} onChange={(e)=>{setPlatform(e.target.value);list.pagination.onChange(1);}}>
        <option value="">{t('allPlatforms')}</option><option value="fb">Facebook</option><option value="ig">Instagram</option>
      </select>
    </div>}
    {channels.length?<><div className="tile-grid">{list.items.map((c)=><section className="card tile" key={c.id}>
      <div className="tile-top"><PageAvatar channel={c}/><Chip status={c.connected?'active':'off'}>{t(c.connected?'connected':'disconnected')}</Chip></div>
      <div><h2>{c.name}</h2><p>{channelIdentity(c)}</p></div><p>{c.topic||t('noTopic')}</p>
      {c.platform==='fb'&&<p>{t(c.messenger?'messengerGranted':'messengerDenied')}</p>}
      <div className="tile-actions"><Button icon="edit" onClick={()=>open('channel',c)}>{t('configure')}</Button>
        {hasCatalog&&<Button onClick={()=>{setSelectedChannel(c.id);go('catalog');}}>{t('catalog')}</Button>}
        {c.connected?c.aiToolsEnabled===true&&<Button variant="subtle" icon="bot" onClick={()=>{
          if(c.platform==='fb'){setSelectedChannel(c.id);go('bots');}
          else open('bot',c);
        }}>{c.platform==='fb'?'AI agent':'Bot'}</Button>:
          <Button variant="primary" icon="link" onClick={()=>connect(c.platform,c.id)}>{t('connectAccount')}</Button>}
      </div>
    </section>)}</div><ListPagination {...list.pagination}/></>:<Empty>{t(state.channels.length?'noMatchingChannel':'noConnectedChannel')}</Empty>}
    </>}
    </>:<Empty>{copy("Chọn Shop đang hoạt động mà bạn sở hữu để kết nối và cấu hình kênh.")}</Empty>}
  </>;
}

export function Analytics({ state, go, loadInsights, selectedChannel, setSelectedChannel, activityVersion }) {
  const {t,text,intl}=useDisplayLocale();
  const number=new Intl.NumberFormat(intl);
  const format=(value)=>value==null?'—':number.format(value);
  const [retry,retryChart]=useState(0);
  const [result,setResult]=useState(null), [busy,setBusy]=useState(false);
  const channel=state.channels.find((c)=>c.id===selectedChannel)??state.channels[0];
  const [days,setDays]=useState('7'),[trend,setTrend]=useState(null);
  const channelId=channel?.id;
  const shopId=state.activeShopId;
  useEffect(()=>{
    if(!channelId)return;
    const controller=new AbortController();
    const query=new URLSearchParams({channel:channelId,days});
    api('channel-activity-chart?'+query,'GET',undefined,controller.signal)
      .then(({items})=>{if(!controller.signal.aborted)setTrend({channelId,shopId,days,items});})
      .catch(()=>{if(!controller.signal.aborted)setTrend({channelId,shopId,days,error:true});});
    return ()=>controller.abort();
  },[channelId,shopId,days,activityVersion,retry]);
  const chart=trend?.channelId===channelId&&trend?.shopId===shopId&&trend?.days===days?trend:null;
  const stats=state.stats[channelId];
  const recent=(field)=>format(chart?.items?.reduce((sum,row)=>sum+row[field],0));
  const count=(key)=>({count:number.format(Number(key))});
  async function refresh() {
    setBusy(true);
    try { setResult({id:channel.id,data:await loadInsights(channel.id)}); }
    catch{setResult({id:channel.id,data:{messageKey:'metaLoadError'}});}
    finally{setBusy(false);}
  }
  const insights=result?.id===channel?.id?result?.data:null;
  const insightStatus=insights?.messageKey?t(insights.messageKey):
    insights?.message?text(insights.message):t(channel?.connected?'metaPrompt':'metaConnect');
  return <>
    <Title title={t('analytics')} subtitle={t('analyticsIntro')} action={<Button icon="link" variant="primary" onClick={()=>go('channels')}>{t('connectChannel')}</Button>}/>
    {channel&&<div className="toolbar"><label htmlFor="analytics-channel">{t('viewingChannel')}</label>
      <select id="analytics-channel" value={channel.id} onChange={(e)=>setSelectedChannel(e.target.value)}>{state.channels.map((c)=><option key={c.id} value={c.id}>{c.name} · {platformLabel(c.platform)}</option>)}</select>
      <label htmlFor="analytics-range">{t('range')}</label>
      <select id="analytics-range" value={days} onChange={(event)=>setDays(event.target.value)}>
        <option value="7">{t('days',count(7))}</option><option value="30">{t('days',count(30))}</option>
      </select>
      <Chip status={channel.connected?'active':'off'}>{t(channel.connected?'connected':'disconnected')}</Chip>
    </div>}
    {!channel&&<Empty>{t('noAnalyticsChannel')}</Empty>}
    {channel&&<MetricGrid metrics={[
      [t('newComments'),recent('comments'),t('lastDays',count(days)),'chat'],
      [t('answeredComments'),format(stats?.comment_replies),t('lifetime'),'check','mint'],
      [t('newMessages'),recent('messages'),t('lastDays',count(days)),'send','rose'],
      [t('answeredMessages'),format(stats?.message_replies),t('lifetime'),'check','amber'],
    ]}/>}
    {channel&&<>
      {chart?.items&&<TimeChart key={shopId+':'+channelId+':'+days} title={t('dailyActivity')}
        subtitle={t('activitySources')+' · '+t('vietnamTime')}
        rows={chart.items.map(({date,messages,comments})=>({label:chartDate(date,intl),values:{messages,comments}}))}
        series={[{key:'messages',name:t('messages'),color:'primary'},{key:'comments',name:t('comments'),color:'secondary'}]}/>}
      {!chart&&<p className="dim" role="status">{t('activityLoading')}</p>}
      {chart?.error&&<p className="notice" role="alert">{t('activityError')} <Button onClick={()=>{setTrend(null);retryChart((n)=>n+1);}}>{t('refresh')}</Button></p>}
    </>}
    <section className="card"><CardHead title="Meta Insights" subtitle={t('metaPerformance')}
      action={channel?.connected&&<Button variant="subtle" icon="chart" disabled={busy} onClick={refresh}>{t(busy?'loading':'loadMeta')}</Button>}/>
      <div className="chart-body">{insights?.metrics?.length?
        <MetricGrid metrics={insights.metrics.map(({key,label,value})=>[key?t(key):text(label),format(value),t('metaData'),'chart'])}/>:
        <p className="dim">{insightStatus}</p>}
      </div>
    </section>
  </>;
}

function usePages(path,param,{revision=0,refreshMs=0}={}) {
  const [history,setHistory]=useState(['']), [result,setResult]=useState(null), [error,setError]=useState('');
  const cursor=history.at(-1);
  useEffect(()=>{
    if(!path)return;
    let active=true, loading=false;
    const controller=new AbortController();
    async function load() {
      if(loading)return;
      loading=true;
      try {
        const timeout=refreshMs?8_000:35_000;
        const data=await api(path+(cursor?'&'+param+'='+encodeURIComponent(cursor):''),'GET',undefined,
          AbortSignal.any([controller.signal,AbortSignal.timeout(timeout)]));
        if(active){setResult(data);setError('');}
      } catch(error){if(active)setError(error.message);}
      finally{loading=false;}
    }
    const refresh=()=>{if(!document.hidden)load();};
    load();
    const interval=refreshMs?setInterval(refresh,refreshMs):undefined;
    if(refreshMs){
      document.addEventListener('visibilitychange',refresh);
      window.addEventListener('online',refresh);
    }
    return ()=>{
      active=false;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange',refresh);
      window.removeEventListener('online',refresh);
    };
  },[path,param,cursor,revision,refreshMs]);
  function move(next) {
    setResult(null);setError('');
    setHistory((previous)=>next?[...previous,next]:previous.slice(0,-1));
  }
  return {result,error,page:history.length,move,reset:(clear=false)=>{if(clear)setResult(null);setError('');setHistory(['']);}};
}

function Pagination({page,move,next,count}) {
  return <ListPagination page={page} hasNext={!!next} count={count}
    onChange={target=>move(target<page?null:next)}/>;
}

function CommentCheck({ channel, post, onSynced }) {
  const {intl,copy}=useDisplayLocale();
  const [busy,setBusy]=useState(false), [result,setResult]=useState(null), [error,setError]=useState('');
  async function check() {
    setBusy(true);setError('');setResult(null);
    try{
      setResult(await api('comments/check','POST',{id:channel.id,media:post.id},AbortSignal.timeout(18_000)));
      onSynced?.();
    }catch(error){setError(error.message);}
    finally{setBusy(false);}
  }
  const outcomes={stored:'đã lưu',updated:'đã bổ sung nội dung',duplicate:'đã có trong hộp',filtered:'bị lọc'};
  return <div>
    <Button variant="subtle" icon="chat" disabled={busy} onClick={check}>
      {busy?copy("Đang kiểm tra…"):copy("Kiểm tra bình luận")}
    </Button>
    {error&&<div className="formerror" role="alert">{copy(error)}</div>}
    {result&&<div className="dim" role="status">
      <div><strong>{copy("Đọc từ Meta")}</strong> · {result.readError||(result.received+copy(" bình luận · ")+(result.importError||result.imported+copy(" đã thêm hoặc cập nhật trong hộp Bình luận")))}</div>
      <div><strong>{copy("Đăng ký feed")}</strong> · {result.subscriptionError||(result.feed===true?copy("Đã đăng ký trên Page"):result.feed===false?copy("Chưa đăng ký trên Page"):copy("Meta chưa xác nhận trường feed"))}</div>
      <div><strong>{copy("Webhook bình luận của Page")}</strong> · {result.lastFeed
        ?formatDate(result.lastFeed,intl)+' · '+outcomes[result.feedResult]:copy("Chưa ghi nhận từ khi nâng cấp")}</div>
    </div>}
  </div>;
}

function CommentSyncPicker({ channel, onSynced, queueEnabled }) {
  const {copy,t}=useDisplayLocale();
  const [selected,setSelected]=useState('');
  const [watchOverrides,setWatchOverrides]=useState({});
  const [busy,setBusy]=useState(false), [watchError,setWatchError]=useState('');
  const {result,error,page,move}=usePages('published-posts?channel='+encodeURIComponent(channel.id),'after');
  const post=result?.items.find((item)=>item.id===selected)??result?.items[0];
  const isWatched=(item)=>watchOverrides[item.id]??!!item.commentSync;
  const watched=post&&isWatched(post);
  async function toggleWatch() {
    setBusy(true);setWatchError('');
    try{
      const {enabled}=await api('comments/watch','POST',{id:channel.id,media:post.id,enabled:!watched},AbortSignal.timeout(8_000));
      setWatchOverrides((previous)=>({...previous,[post.id]:enabled}));
    }catch(error){setWatchError(error.message);}
    finally{setBusy(false);}
  }
  return <section className="card comment-sync-settings" aria-label={t('watchFacebook')}>
    {error&&<p role="alert">{copy(error)}</p>}
    {!result&&!error&&<p>{t('postLoading')}</p>}
    {result?.items.length===0&&<p>{copy("Meta chưa trả bài đăng nào cho Page này.")}</p>}
    {post&&<div className="toolbar">
      <label htmlFor="comment-sync-post">{t('posts')}</label>
      <select id="comment-sync-post" value={post.id} disabled={busy}
        onChange={(event)=>{setSelected(event.target.value);setWatchError('');}}>
        {result.items.map((item)=><option value={item.id} key={item.id}>{item.text.slice(0,80)||copy("Bài ")+item.id}{isWatched(item)?copy(" · Đang theo dõi"):''}</option>)}
      </select>
      <Button variant={watched?'':'primary'} disabled={busy} onClick={toggleWatch}>
        {busy?copy("Đang lưu…"):watched?copy("Tắt tự đồng bộ"):copy("Bật tự đồng bộ")}
      </Button>
    </div>}
    {watchError&&<p className="formerror" role="alert">{watchError}</p>}
    {post&&<p className="dim" role="status">{queueEnabled===false?copy("Hàng đợi tự đồng bộ đang tắt trên máy chủ.")
      :watched?copy("Đã bật tự đồng bộ · Khoảng 8 giây/lần"):copy("Bật tự đồng bộ để SnailChat định kỳ lấy bình luận của bài này.")}</p>}
    {post&&<details key={post.id}><summary>{copy("Kiểm tra kết nối và đồng bộ ngay")}</summary>
      <CommentCheck channel={channel} post={post} onSynced={onSynced}/>
    </details>}
    <Pagination page={page} move={move} next={result?.next} count={result?.items?.length}/>
  </section>;
}

function PostsTable({ channel, revision, open }) {
  const {copy,t,intl}=useDisplayLocale();
  const facebook=channel.platform==='fb';
  const canSync=facebook&&channel.commentsEnabled;
  const bot=channel.aiToolsEnabled===true&&!channel.messageBotPolicy?.unifiedAgent;
  const {result,error,page,move}=usePages('published-posts?channel='+encodeURIComponent(channel.id),'after',{revision});
  // Instagram does not expose shares here. Exclude incomplete rows from the ranking.
  const ranking=(result?.items??[]).filter((item)=>item.reactions!==null&&item.comments!==null)
    .map((item)=>({
      id:item.id,
      label:item.text.trim().slice(0,85)+(item.text.trim().length>85?'…':'')||t('postPlaceholder',{id:item.id}),
      value:item.reactions+item.comments,
      href:item.permalink.startsWith('https://')?item.permalink:null,
    })).sort((a,b)=>b.value-a.value).slice(0,5);
  return <>
    {!!ranking.length&&<ComparisonChart title={t('postRanking')} rows={ranking}
      subtitle={t('postRankHelp')}/>}
    <section className="card">
    <CardHead title={channel.name} subtitle={t('postStatsHelp')}/>
    {error&&<p className="notice" role="alert">{copy(error)}</p>}
    {!result&&!error&&<Empty>{t('postLoading')}</Empty>}
    {result?.items.length>0&&<div className="table-wrap"><table>
      <thead><tr><th>{t('posts')}</th><th>{t('publishedDate')}</th><th>{t(facebook?'reactions':'likes')}</th><th>{t('comments')}</th>{facebook&&<th>{t('shares')}</th>}<th>{t('link')}</th>{(canSync||bot)&&<th>{bot&&!facebook?'Bot':t(bot?'botAndComments':'syncComments')}</th>}</tr></thead>
      <tbody>{result.items.map((item)=><tr key={item.id}>
        <td className="post-text"><div className="post-preview"><PostThumbnail post={item}/>
          <span>{item.type&&<small className="dim">{item.type}<br/></small>}{item.text||t('postPlaceholder',{id:item.id})}</span>
        </div></td>
        <td>{formatDate(item.publishedAt,intl)}</td><td>{item.reactions??'—'}</td><td>{item.comments??'—'}</td>
        {facebook&&<td>{item.shares??'—'}</td>}
        <td>{item.permalink.startsWith('https://')?<a href={item.permalink} target="_blank" rel="noopener noreferrer">{t('openPost')}</a>:'—'}</td>
        {(canSync||bot)&&<td>
          {bot&&<Button variant="subtle" icon="bot" onClick={()=>open('post-bot',{channel,post:item})}>{t('configure')}</Button>}
          {canSync&&<CommentCheck channel={channel} post={item}/>}
          {canSync&&item.commentSync&&<div className="dim">
            {item.commentSync.error|| (item.commentSync.lastSync
              ?t('syncedAt',{date:formatDate(item.commentSync.lastSync,intl)}):t('waitingCommentSync'))}
          </div>}
        </td>}
      </tr>)}</tbody>
    </table></div>}
    {result?.items.length===0&&<Empty>{t('noMetaPosts')}</Empty>}
    <div className="chart-body"><Pagination page={page} move={move} next={result?.next} count={result?.items?.length}/></div>
    </section>
  </>;
}

export function PublishedPosts({ state, go, open, activityVersion, selectedChannel, setSelectedChannel }) {
  const {copy,t}=useDisplayLocale();
  const [revision,setRevision]=useState(0);
  const channel=state.channels.find((c)=>c.id===selectedChannel)??state.channels[0];
  return <>
    <Title title={copy("Thống kê bài đăng")} subtitle={t('postHelp')}
      action={<Button icon="link" onClick={()=>go('channels')}>{t('manageConnection')}</Button>}/>
    {channel?<><div className="toolbar">
      <select aria-label={t('pickPostChannel')} value={channel.id} onChange={(event)=>setSelectedChannel(event.target.value)}>
        {state.channels.map((c)=><option value={c.id} key={c.id}>{c.name} · {platformLabel(c.platform)}</option>)}
      </select>
      <Button icon="chart" disabled={!channel.connected} onClick={()=>setRevision((v)=>v+1)}>{t('updateStats')}</Button>
    </div>{channel.connected?<PostsTable key={channel.id} channel={channel} revision={revision+activityVersion} open={open}/>:
      <Empty>{t('postAccess')}</Empty>}</>:<Empty>{t('connectPosts')}</Empty>}
  </>;
}

function usePostPreview(channelId,mediaId,enabled=true) {
  const [post,setPost]=useState(null);
  useEffect(()=>{
    if(!enabled||!mediaId)return;
    let active=true;
    const query=new URLSearchParams({channel:channelId,media:mediaId});
    api('post-context?'+query).then((result)=>{if(active)setPost(result.post);}).catch(()=>{});
    return ()=>{active=false;};
  },[channelId,mediaId,enabled]);
  return post;
}

function NotificationRow({ item, onOpen, busy }) {
  const {intl,copy}=useDisplayLocale();
  const post=usePostPreview(item.channel_id,item.media_id,item.kind==='comment');
  return <button type="button" className={'notification-row'+(item.unread?' unread':'')} disabled={busy}
    onClick={()=>onOpen(item)}>
    <strong>{item.kind==='comment'?copy("Bình luận mới"):copy("Tin nhắn mới")} · {item.page}</strong>
    {item.kind==='comment'&&<span>{post?.text||item.post_title||(item.media_id?copy("Bài ")+item.media_id:copy("Bài đăng"))}</span>}
    <span>{item.author} · {item.text}</span>
    <small>{formatDate(item.created,intl)}{item.unread?copy(" · Chưa đọc"):''}</small>
    {item.unread&&<span className="notification-unread-dot" aria-hidden="true"/>}
  </button>;
}

export function Notifications({ onNavigate, activityVersion=0, enabled, alerts, onOpenAlert, onReadAlerts, onShow }) {
  const {copy,t,intl}=useDisplayLocale();
  const [open,setOpen]=useState(false), [busy,setBusy]=useState(false), [problem,setProblem]=useState('');
  const [revision,setRevision]=useState(0), [filter,setFilter]=useState('all');
  const [page,setPage]=useState(1),[result,setResult]=useState(null),[error,setError]=useState('');
  const visibleAlerts=filter==='unread'?alerts.filter(item=>item.unread):alerts;
  const alertsCount=visibleAlerts.length;
  const pageTotal=alertsCount+(enabled?(result?.total??0):0);
  const current=Math.min(page,Math.max(1,Math.ceil(pageTotal/listPageSize)));
  const start=(current-1)*listPageSize;
  const local=visibleAlerts.slice(start,start+listPageSize);
  const offset=Math.max(0,start-alertsCount);
  const limit=listPageSize-local.length;
  const path='notifications?'+new URLSearchParams({filter,offset,limit});
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();
    let pending=false;
    async function load(){
      if(pending)return;
      pending=true;
      try{
        const response=await api(path,'GET',undefined,controller.signal);
        if(!controller.signal.aborted){setResult({...response,path});setError('');}
      }catch(problem){if(!controller.signal.aborted)setError(problem.message);}
      finally{pending=false;}
    }
    load();
    const timer=setInterval(()=>{if(!document.hidden)void load();},5000);
    return ()=>{controller.abort();clearInterval(timer);};
  },[path,revision,activityVersion,enabled]);
  const unread=enabled?(result?.unread??0):0;
  const items=enabled&&result?.path===path?result.items:[];
  async function select(item) {
    setBusy(true);setProblem('');
    try {
      const target=await api('notifications/open','POST',{kind:item.kind,id:item.id},AbortSignal.timeout(8_000));
      setOpen(false);setPage(1);setRevision((value)=>value+1);
      onNavigate(item.kind,target);
    } catch(error){setProblem(error.message);}
    finally{setBusy(false);}
  }
  const count=unread+alerts.filter((item)=>item.unread).length;
  function changeFilter(next) {
    if(next===filter)return;
    setPage(1);setFilter(next);setProblem('');
  }
  async function markAll() {
    setBusy(true);setProblem('');
    try {
      if(enabled)await api('notifications/read-all','POST',{},AbortSignal.timeout(8_000));
      onReadAlerts();
      setResult(null);setPage(1);setRevision((value)=>value+1);
    } catch(error){setProblem(error.message);}
    finally{setBusy(false);}
  }
  return <div className="notifications" onKeyDown={(event)=>{if(event.key==='Escape')setOpen(false);}}>
    <button type="button" className="iconbtn notification-bell" aria-label={t('notifications')+(count?' · '+count+' · '+t('unread'):'')}
      aria-expanded={open} onClick={()=>{setOpen(!open);if(!open){onShow();setPage(1);setRevision((value)=>value+1);}}}>
      <Icon name="bell"/>{count>0&&<span>{count>99?'99+':count}</span>}
    </button>
    {open&&<section className="notification-panel card" aria-label={t('notifications')}>
      <header><strong>{t('notifications')}</strong><Button variant="subtle" onClick={()=>setOpen(false)}>{t('close')}</Button></header>
      <div className="notification-controls">
        <div className="notification-filters" role="group" aria-label={t('notificationsFilter')}>
          <Button variant="subtle" aria-pressed={filter==='all'} onClick={()=>changeFilter('all')}>{t('all')}</Button>
          <Button variant="subtle" aria-pressed={filter==='unread'} onClick={()=>changeFilter('unread')}>{t('unread')}</Button>
        </div>
        <Button variant="subtle" disabled={busy||!count} onClick={markAll}>{t('readAll')}</Button>
      </div>
      {(error||problem)&&<p className="notice" role="alert">{problem||error}</p>}
      {enabled&&!result&&!error&&<Empty>{t('loadingNotifications')}</Empty>}
      {!visibleAlerts.length&&(!enabled||result?.items.length===0)&&
        <Empty>{t(filter==='unread'?'allRead':'noNotifications')}</Empty>}
      <div className="notification-list">
        {local.map((item)=><button type="button" key={item.id}
          className={'notification-row workspace-alert-row'+(item.unread?' unread':'')}
          onClick={()=>{setOpen(false);onOpenAlert(item);}}>
          <span className="alert-icon"><Icon name="alert"/></span>
          <div><strong>{item.titleSource?copy(item.titleSource)+item.titleSuffix:copy(item.title)}</strong><p>{copy(item.message)}</p>
            <small>{formatDate(item.created,intl)}{item.action?' · '+item.action.label:''}</small></div>
          {item.unread&&<span className="notification-unread-dot" aria-hidden="true"/>}
        </button>)}
        {items.map((item)=><NotificationRow key={item.kind+':'+item.id} item={item} onOpen={select} busy={busy}/>)}
      </div>
      <ListPagination page={current} total={pageTotal} onChange={setPage}/>
    </section>}
  </div>;
}

function PostReference({ item, channel }) {
  const {copy}=useDisplayLocale();
  const post=usePostPreview(channel.id,item.mediaId);
  return <div className="post-reference">
    <PostThumbnail post={post}/>
    <div><small>{copy("Bài đăng")}</small><strong>{post?.text||item.source||copy("Bài viết của kênh")}</strong>
      {post?.permalink?.startsWith('https://')&&<a href={post.permalink} target="_blank" rel="noopener noreferrer">{copy("Mở bài gốc")}</a>}
    </div>
  </div>;
}

function useOlderMessenger(path, latest) {
  const [older,setOlder]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const request=useRef(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const next=older?older.next:latest?.next;
  async function loadOlder(beforeMerge){
    if(!next||request.current)return;
    const controller=new AbortController();
    request.current=controller;
    setLoading(true);setError('');
    try{
      const data=await api(path+'&before='+encodeURIComponent(next),'GET',undefined,
        AbortSignal.any([controller.signal,AbortSignal.timeout(8_000)]));
      if(controller.signal.aborted)return;
      beforeMerge?.();
      setOlder((previous)=>({...data,items:[...(previous?.items??[]),...data.items],
        outbound:[...(previous?.outbound??[]),...(data.outbound??[])]}));
    }catch(problem){
      if(!controller.signal.aborted)setError(problem.message);
    }finally{
      request.current=null;
      if(!controller.signal.aborted)setLoading(false);
    }
  }
  function merge(key){
    if(!latest||!older)return latest;
    const unique=(items,id)=>{
      const seen=new Set();
      return items.filter((item)=>{
        const key=id(item);
        if(seen.has(key))return false;
        seen.add(key);
        return true;
      });
    };
    return {...latest,items:unique([...latest.items,...older.items],key),
      outbound:unique([...(latest.outbound??[]),...older.outbound],(item)=>item.mid)};
  }
  return {older,next,error,loading,loadOlder,merge};
}

function ThreadMessages({ item, channel, save, revision, templateRevision, focus, openPlans }) {
  const {copy}=useDisplayLocale();
  const query=new URLSearchParams({kind:'message',channel:item.channelId,sender:item.senderId});
  const path='activity?'+query;
  const {result:latest,error}=usePages(path,'before',{revision,refreshMs:2_000});
  const history=useOlderMessenger(path,latest);
  const result=history.merge((entry)=>entry.id);
  const [quote,setQuote]=useState(null);
  const conversation=useRef(null),followLatest=useRef(true),anchor=useRef(null),focusedOnce=useRef(false);
  useLayoutEffect(()=>{
    const area=conversation.current;
    if(!area||!latest)return;
    if(anchor.current){
      const {height,top}=anchor.current;
      area.scrollTop=top+area.scrollHeight-height;
      anchor.current=null;
    }else if(followLatest.current){
      const focused=focus&&!focusedOnce.current&&area.querySelector('.focused-comment');
      if(focused){
        focusedOnce.current=true;
        area.scrollTop+=focused.getBoundingClientRect().top-area.getBoundingClientRect().top;
        followLatest.current=false;
      }else area.scrollTop=area.scrollHeight;
    }
  },[latest,history.older,focus]);
  function loadOlder(){
    return history.loadOlder(()=>{
      const area=conversation.current;
      if(area)anchor.current={height:area.scrollHeight,top:area.scrollTop};
    });
  }
  return <>
    {channel.aiToolsEnabled&&channel.messenger&&channel.messageBotMode!=='off'&&
      <ConversationTakeover item={item} openPlans={openPlans} lastReplyError={latest?.items[0]?.replyError} resumeAt={latest?.items[0]?.agentResumeAt??item.agentResumeAt??0} canReply={channel.permissions?.includes('chat:reply')}/>}
    {error&&<p className="notice" role="alert">{copy(error)}</p>}
    {!result&&!error&&<p className="dim">{copy("Đang tải cuộc trò chuyện…")}</p>}
    {history.error&&<p className="notice" role="alert">{history.error} <Button onClick={loadOlder}>{copy("Thử lại")}</Button></p>}
    {history.loading&&<small role="status" className="dim">{copy("Đang tải tin nhắn cũ…")}</small>}
    <div className="conversation" ref={conversation} style={{overflowAnchor:'none'}} onScroll={(event)=>{
      const area=event.currentTarget;
      followLatest.current=area.scrollHeight-area.scrollTop-area.clientHeight<60;
      if(!followLatest.current&&area.scrollTop<80&&!history.error)loadOlder();
    }}><MessengerTimeline canRespond={channel.permissions?.includes('chat:reply')} latestId={latest?.items[0]?.id} aiToolsEnabled={channel.aiToolsEnabled} productReviewEnabled={channel.purpose==='sales'} outbound={result?.outbound} focusMid={focus?.mid} items={result && focus && !result.items.some((entry)=>entry.id===focus.id)?[...result.items,focus]:result?.items} selectedMid={quote?.mid} onQuote={channel.permissions?.includes('chat:reply')?setQuote:undefined}/></div>
    {channel.permissions?.includes('chat:reply')&&<MessengerComposer {...{item,channel,save,quote,setQuote,templateRevision}}
      reviewItem={result?.items.find((message)=>message.mid===(quote?.by==='customer'?quote.mid:item.mid))??item}/>}
  </>;
}

function ActivityReplyForm({ item, channel, kind, save, rules }) {
  const {copy,t}=useDisplayLocale();
  const [text,setText]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const request=useRef(null);
  async function reply(event) {
    event.preventDefault();
    const reply=text.trim();
    if(!reply)return;
    if(request.current?.text!==reply)request.current={text:reply,id:crypto.randomUUID(),itemId:item.id};
    setBusy(true);setError('');
    try {
      await save('replies',{id:request.current.itemId,kind,reply,requestId:request.current.id});
      setText('');request.current=null;
    } catch(error){
      if(error.status>=400&&error.status<500)request.current=null;
      setError(error.message);
    }
    finally{setBusy(false);}
  }
  return <form className="inbox-reply" onSubmit={reply}>
    <BotReplyPicker item={item} channel={channel} rules={rules} onInsert={setText} disabled={busy}/>
    <label><span>{kind==='comment'
      ?<>{t('reply')} <strong>{item.author}</strong> {copy("từ")} {channel.name}</>
      :<>{copy("Trả lời từ")} <strong>{channel.name}</strong></>}</span>
      {kind==='comment'&&<small className="dim reply-target-preview">{item.text}</small>}
      <textarea value={text} onChange={(event)=>setText(event.target.value)} maxLength={1000} rows={3} required placeholder={t('writeReply')}/>
    </label>
    {error&&<p className="formerror" role="alert">{copy(error)}</p>}
    <Button type="submit" variant="primary" icon="send" disabled={busy||!text.trim()}>{busy?copy("Đang xử lý…"):copy("Gửi phản hồi")}</Button>
  </form>;
}

function CommentThread({ item, channel, save, activityVersion, focus, onHandled }) {
  const {intl,copy,t}=useDisplayLocale();
  const canReply=channel.permissions?.includes('chat:reply');
  const [selectedTarget,setSelectedTarget]=useState('');
  const [privateTarget,setPrivateTarget]=useState(null);
  const [privateRevision,setPrivateRevision]=useState(0);
  const [privateNotice,setPrivateNotice]=useState('');
  const {result,error,page,move}=usePages('comments/thread?comment='+encodeURIComponent(item.id),'offset',
    {revision:activityVersion+privateRevision,refreshMs:3_000});
  const comments=result?.items??[item];
  const original=comments.find((comment)=>comment.id===result?.original?.id)??result?.original;
  const [handling,setHandling]=useState(false);
  const [handlingError,setHandlingError]=useState('');
  const pending=comments.filter((comment)=>comment.status==='review'&&!comment.handled);
  const target=selectedTarget?pending.find((comment)=>comment.id===selectedTarget)
    :pending.find((comment)=>comment.id===item.id)||pending.at(-1);
  const entries=comments.flatMap((comment)=>[
    ...(comment.id===result?.original?.id?[]:[{comment,pageReply:false,created:comment.created}]),
    ...(comment.reply?[{comment,pageReply:true,created:comment.sentAt??comment.created}]:[]),
  ]).sort((a,b)=>a.created-b.created);
  const history=useRef(null), followLatest=useRef(true);
  useEffect(()=>{
    const area=history.current;
    if(area&&followLatest.current){
      const focused=focus&&area.querySelector('.focused-comment');
      if(focused)area.scrollTop+=focused.getBoundingClientRect().top-area.getBoundingClientRect().top;
      else area.scrollTop=area.scrollHeight;
    }
  },[result,focus]);

  function privateAction(comment) {
    if(!canReply||channel.platform!=='fb'||!channel.messenger||!channel.privateRepliesEnabled||!comment)return null;
    if(comment.privateReply==='sent')return <Chip status="replied">{comment.privateReplyAutomatic?copy("Bot đã nhắn riêng"):copy("Đã nhắn riêng")}</Chip>;
    if(comment.privateReply==='sending')return <Chip status="sending">{copy("Đang nhắn riêng")}</Chip>;
    if(comment.privateReply==='uncertain')return <Chip status="review">{copy("Kiểm tra tin trong Messenger")}</Chip>;
    if(!comment.privateReplyInWindow)return null;
    return <Button variant="subtle" onClick={()=>{setPrivateNotice('');setPrivateTarget(comment);}}>
      {channel.aiToolsEnabled===true&&comment.privateReplyDraft?copy("Duyệt tin nhắn riêng"):copy("Gửi tin nhắn riêng")}
    </Button>;
  }

  async function changeHandled(comment) {
    setHandling(true);setHandlingError('');
    try{
      await api('comments/'+encodeURIComponent(comment.id)+'/handled','PATCH',{handled:!comment.handled});
      setSelectedTarget('');
      setPrivateRevision(revision=>revision+1);
      onHandled();
    }catch(error){setHandlingError(error.message);}
    finally{setHandling(false);}
  }
  function handledActions(comment) {
    return <>
      {comment.handled&&<Chip status="replied">{copy('Đã xử lý')}</Chip>}
      {comment.handled==='agent'&&<small>{copy('Agent đã trả lời công khai')}</small>}
      {canReply&&comment.status==='review'&&<Button variant="subtle" disabled={handling} onClick={()=>changeHandled(comment)}>
        {copy(comment.handled==='manual'?'Hoàn tác':'Đánh dấu đã xử lý')}
      </Button>}
    </>;
  }

  async function sendPrivateReply(form) {
    try {
      await api('comments/private-reply','POST',{id:privateTarget.id,text:form.get('text')},AbortSignal.timeout(20_000));
      setPrivateNotice('Đã gửi tin nhắn riêng cho '+privateTarget.author+'.');
    } finally {
      setPrivateRevision((revision)=>revision+1);
    }
  }

  return <>
    {handlingError&&<p className="notice" role="alert">{copy(handlingError)}</p>}
    {privateNotice&&<p className="notice" role="status">{privateNotice}</p>}
    {privateTarget&&<Dialog key={channel.aiToolsEnabled} title={copy("Gửi tin nhắn riêng")} label={t('sendMessage')}
      close={()=>setPrivateTarget(null)} submit={sendPrivateReply}>
      <p>{copy("Gửi từ")} <strong>{channel.name}</strong> {copy("đến")} <strong>{privateTarget.author}</strong> qua Messenger.</p>
      <Field label={t('messages')}><textarea name="text" rows={4} maxLength={1000} defaultValue={channel.aiToolsEnabled===true?privateTarget.privateReplyDraft??'':''} required
        placeholder={t('writePrivate')}/></Field>
    </Dialog>}
    {error&&<p className="notice" role="alert">{copy(error)}</p>}
    {result?.original&&<div className={'original-comment'+(original?.id===item.id?' focused-comment':'')}>
      <div className="comment-turn-meta"><strong>{copy("Bình luận gốc ·")} {result.original.author}</strong>
        {original?.status==='review'&&!original.handled&&<><Chip status="review">{t('reviewStatus')}</Chip>
          {canReply&&<Button variant="subtle" aria-pressed={target?.id===original.id} onClick={()=>setSelectedTarget(original.id)}>{t('reply')}</Button>}</>}
        {original&&handledActions(original)}
        {privateAction(original)}
      </div><p>{result.original.text}</p>
      {channel.aiToolsEnabled===true&&original?.botCategory&&<small className="bot-category">{original.botCategory}</small>}
      {original?.privateReplyError&&<small className="formerror">{original.privateReplyError}</small>}
      {original?.status!=='replied'&&original?.replyError&&<small className="formerror">{original.replyError}</small>}
    </div>}
    <Pagination page={page} move={(next)=>{setSelectedTarget('');move(next);}} next={result?.next} count={result?.items?.length}/>
    <div className="comment-thread" ref={history} onScroll={(event)=>{
      const area=event.currentTarget;
      followLatest.current=area.scrollHeight-area.scrollTop-area.clientHeight<60;
    }}>
      {entries.map(({comment,pageReply,created})=>pageReply
        ?<div className="bubble sent" key={'page-'+comment.id}>
          <small>{comment.automatic?'Bot':channel.name} · {copy(activityLabels[comment.status])}
            {comment.sentAt?' · '+formatDate(created,intl):''}</small><p>{comment.reply}</p>
          {comment.status==='replied'&&comment.replyError&&<small className="reply-placement-note">{comment.replyError}</small>}
        </div>
        :<article className={'comment-content'+(comment.nested?' nested':'')+(comment.status==='review'&&!comment.handled?' needs-review':'')+(comment.id===item.id?' focused-comment':'')} key={comment.id}>
          <header className="comment-turn-meta"><strong>{comment.author}</strong>
            <time dateTime={new Date(created).toISOString()}>{formatDate(created,intl)}</time>
            {comment.status==='review'&&!comment.handled&&<Chip status="review">{comment.nested?copy("Bình luận con cần xử lý"):copy("Chờ xử lý")}</Chip>}
            {canReply&&comment.status==='review'&&!comment.handled&&<Button variant="subtle" aria-pressed={target?.id===comment.id}
              onClick={()=>setSelectedTarget(comment.id)}>{t('reply')}</Button>}
            {handledActions(comment)}
            {privateAction(comment)}
          </header>
          <p>{comment.text}</p>
          {comment.privateReplyError&&<small className="formerror">{comment.privateReplyError}</small>}
          {channel.aiToolsEnabled===true&&comment.botCategory&&<small className="bot-category">{comment.botCategory}</small>}
          {comment.status!=='replied'&&comment.replyError&&<small className="formerror">{comment.replyError}</small>}
        </article>)}
    </div>
    {canReply&&target&&<ActivityReplyForm key={target.id} item={target} channel={channel} kind="comment" save={save} rules={result?.botRules}/>}
  </>;
}

function ActivityDetail({ item, channel, kind, save, activityVersion, templateRevision, focus, onHandled, openPlans }) {
  const {copy,t}=useDisplayLocale();
  const messaging=kind==='message';
  if(!messaging)return <section className="card inbox-detail comment-inbox-detail" aria-label={t('commentDetail')}>
    <header className="inbox-detail-header"><PageAvatar channel={channel}/>
      <div><h2>{t('commentThread')}</h2><small>{channel.name}</small></div>
    </header>
    <PostReference key={item.mediaId??item.id} item={item} channel={channel}/>
    <CommentThread {...{item,channel,save,activityVersion,focus,onHandled}}/>
  </section>;
  return <section className="card inbox-detail" aria-label={t('conversations')}>
    <header className="inbox-detail-header"><PageAvatar channel={channel}/>
      <div><h2>{item.author}</h2><small>{channel.name} · PSID {item.senderId}</small></div>
      <Chip status={item.status}>{copy(activityLabels[item.status])}</Chip>
    </header>
    <ThreadMessages key={item.channelId+':'+item.senderId} {...{item,channel,save,templateRevision,focus,openPlans}} revision={activityVersion}/>
    {item.status==='working'&&<p className="dim" role="status">{copy("Đang gửi phản hồi…")}</p>}
  </section>;
}

function CommentGroup({ items, selected, onSelect, showPreview, expanded, toggle }) {
  const {intl,copy}=useDisplayLocale();
  const reference=items[0];
  const post=usePostPreview(reference.channelId,reference.mediaId,showPreview||items.some((item)=>item.id===selected));
  const rowsId=useId();
  const pending=items.filter((item)=>item.pending>0).length;
  return <section className="comment-group">
    <h4 className="comment-group-heading">
      <button type="button" className="comment-group-head" aria-expanded={expanded} aria-controls={rowsId} onClick={toggle}>
        <PostThumbnail post={post}/>
        <span className="comment-group-title">{post?.text||reference.source||copy("Bài đăng")}</span>
        <span className={'comment-group-count'+(pending?' pending':'')}>
          {pending?pending+copy(" luồng cần xử lý"):items.length+copy(" luồng")}
        </span>
        <Icon name="chevron"/>
      </button>
    </h4>
    <div id={rowsId} hidden={!expanded}>
    {items.map((item)=><button type="button" className="comment-row" aria-pressed={item.id===selected}
      key={item.id} onClick={()=>onSelect(item.id)}>
      <span className="comment-row-title"><strong>{item.author}</strong><time dateTime={new Date(item.created).toISOString()}>{formatDate(item.created,intl)}</time></span>
      <span className="comment-row-text">{item.nested?'↳ ':''}{item.text}</span>
      {item.pendingChildren>0&&<Chip status="review">{item.pendingChildren} {copy("bình luận con cần xử lý")}</Chip>}
      {item.pending>item.pendingChildren&&<Chip status="review">{copy("Bình luận gốc cần xử lý")}</Chip>}
      {!item.pending&&<Chip status={item.handled?'replied':item.status}>{copy(item.handled?'Đã xử lý':activityLabels[item.status])}</Chip>}
    </button>)}
    </div>
  </section>;
}

function CommentInboxList({ items, channels, selected, onSelect }) {
  const {copy,t}=useDisplayLocale();
  const [collapsed,setCollapsed]=useState(()=>new Set());
  const byId=new Map(channels.map((channel)=>[channel.id,channel]));
  const pages=Map.groupBy(items,(item)=>item.channelId);
  function toggle(key) {
    setCollapsed((previous)=>{
      const next=new Set(previous);
      if(next.has(key))next.delete(key);
      else next.add(key);
      return next;
    });
  }
  return <section className="card inbox-list comment-inbox-list" aria-label={t('commentList')}>
    {[...pages].map(([channelId,pageItems])=>{
      const channel=byId.get(channelId);
      const posts=Map.groupBy(pageItems,(item)=>{
        const media=item.mediaId??item.source;
        if(!media)return item.id;
        return channel?.platform==='fb'?media.replace(/^\d+_/,''):media;
      });
      return <section className="comment-page-group" key={channelId}>
        <h3 className="comment-inbox-heading"><PageAvatar channel={channel}/>{channel?.name??copy("Kênh")}</h3>
        {[...posts].map(([postId,comments],index)=>{
          const key=JSON.stringify([channelId,postId]);
          return <CommentGroup key={postId} items={comments} selected={selected} onSelect={onSelect}
            showPreview={index<3} expanded={!collapsed.has(key)} toggle={()=>toggle(key)}/>;
        })}
      </section>;
    })}
  </section>;
}

function ActivityItems({ kind, channel, status, state, save, activityVersion, templateRevision, target, onHandled, openPlans }) {
  const {copy,t}=useDisplayLocale();
  const messaging=kind==='message';
  const query=new URLSearchParams({kind,channel,status,...(messaging?{threads:'1'}:{})});
  const path=(messaging?'activity?':'comments/inbox?')+query;
  const {result,error,page,move}=usePages(path,'before',{revision:activityVersion,refreshMs:messaging?2_000:3_000});
  const [selected,setSelected]=useState('');
  const [showTarget,setShowTarget]=useState(!!target);
  const key=(item)=>messaging?item.channelId+':'+item.senderId:item.id;
  const readable=new Set(state.channels.filter(({permissions})=>permissions.includes('chat:read')).map(({id})=>id));
  const items=result?.items.filter(({channelId})=>readable.has(channelId))??[];
  const targetItem=showTarget&&readable.has(target?.item?.channelId)?target.item:null;
  const current=targetItem?(items.find((item)=>key(item)===key(targetItem))??targetItem)
    :items.find((item)=>key(item)===selected)??items[0];
  const currentKey=current?key(current):'';
  useEffect(()=>{
    if(currentKey)setSelected(currentKey);
  },[currentKey]);
  const currentChannel=state.channels.find((c)=>c.id===current?.channelId);
  return <>
    {error&&<p className="notice" role="alert">{copy(error)}</p>}
    {!result&&!error&&<Empty>{t('loadingData')}</Empty>}
    {result&&!items.length&&!current&&<Empty>{t(messaging?'noConversations':'noComments')}</Empty>}
    {(items.length>0||current)&&<div className={'inbox-grid'+(messaging?'':' comments-grid')}>
      {messaging?<section className="card inbox-list" aria-label={t('conversations')}>
        {items.map((item)=>{
          const source=state.channels.find((c)=>c.id===item.channelId);
          return <button type="button" className="inbox-row" key={key(item)} aria-pressed={key(current)===key(item)}
            onClick={()=>{setShowTarget(false);setSelected(key(item));}}>
            <PageAvatar channel={source}/>
            <span className="inbox-row-copy"><strong>{item.author}</strong><span>{source?.name}</span>
              <small>{item.text||item.attachments?.[0]?.name}</small></span>
            {item.agentResumeAt>Date.now()?<Chip status="review">{copy('Tiếp quản')}</Chip>:
              item.status==='review'&&<span className="unread-dot" aria-label={t('reviewStatus')}/>}
          </button>;
        })}
      </section>:<CommentInboxList items={items} channels={state.channels} selected={currentKey} onSelect={(id)=>{setShowTarget(false);setSelected(id);}}/>}
      {current&&currentChannel&&<ActivityDetail key={key(current)} item={current} channel={currentChannel}
        {...{kind,save,activityVersion,templateRevision,onHandled,openPlans}} focus={targetItem?(target?.focus??targetItem):null}/>}
    </div>}
    <Pagination page={page} move={(next)=>{setShowTarget(false);setSelected('');move(next);}} next={result?.next} count={result?.items?.length}/>
  </>;
}

function Activity({ state, save, go, activityVersion, kind, selectedChannel, setSelectedChannel, activityTarget, refreshWorkspace }) {
  const {t,text}=useDisplayLocale();
  const [status,setStatus]=useState('');
  const [syncOpen,setSyncOpen]=useState(false), [syncRevision,setSyncRevision]=useState(0);
  const [templatesOpen,setTemplatesOpen]=useState(false), [templateRevision,setTemplateRevision]=useState(0);
  const messaging=kind==='message';
  const channels=state.channels.filter((c)=>c.permissions.includes('chat:read')&&(!messaging||c.platform==='fb'));
  const source=channels.find((c)=>c.id===selectedChannel);
  const channel=source?.id??'';
  const canSync=!messaging&&source?.platform==='fb'&&source.connected;
  function showSync() {
    if(canSync){setSyncOpen((open)=>!open);return;}
    const facebook=channels.find((c)=>c.platform==='fb'&&c.connected);
    if(facebook){setSelectedChannel(facebook.id);setSyncOpen(true);}
    else go('channels');
  }
  const revision=activityVersion+syncRevision;
  function onHandled(){
    setSyncRevision(value=>value+1);
    void refreshWorkspace().catch(()=>{});
  }
  return <>
    <Title title={t(messaging?'messagesHeading':'comments')} subtitle={t(messaging?'messageHelp':'commentHelp')}
      action={state.memberRole==='OWNER'&&(messaging
        ?state.planFeatures?.feature_flags?.quickReplies&&channels.length>0&&<Button icon="document" onClick={()=>setTemplatesOpen(true)}>{t('quickTemplates')}</Button>
        :<Button icon="document" aria-expanded={!!(canSync&&syncOpen)} onClick={showSync}>{t('watchFacebook')}</Button>)}/>
    {messaging&&!channels.some((c)=>c.messenger)&&<p className="notice">{t('messengerEnable')}</p>}
    <div className="toolbar inbox-toolbar">
      <label htmlFor="inbox-channel">{t('channel')}</label>
      <select id="inbox-channel" value={channel} onChange={(event)=>setSelectedChannel(event.target.value)}>
        <option value="">{t('allChannels')}</option>{channels.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {messaging?<><label htmlFor="inbox-status">{t('status')}</label>
        <select id="inbox-status" value={status} onChange={(event)=>setStatus(event.target.value)}>
          <option value="">{t('allStatuses')}</option>{Object.entries(activityLabels)
            .map(([id,label])=><option key={id} value={id}>{text(label)}</option>)}
        </select></>:<div className="comment-status-filters" role="group" aria-label={t('commentStatus')}>
        {['','review','handled','working','uncertain'].map((id)=><Button key={id} aria-pressed={status===id}
          onClick={()=>setStatus(id)}>{id?text(id==='handled'?'Đã xử lý':activityLabels[id]):t('all')}</Button>)}
      </div>}
    </div>
    {canSync&&syncOpen&&<CommentSyncPicker key={channel} channel={source} queueEnabled={state.meta?.commentSync}
      onSynced={()=>{setStatus('');setSyncRevision((value)=>value+1);}}/>}
    <ActivityItems openPlans={state.shops?.some(shop=>shop.id===state.activeShopId&&shop.role==='OWNER')?()=>go('billing'):undefined} key={kind+':'+channel+':'+status+':'+(activityTarget?.version??'')} {...{kind,channel,status,state,save,templateRevision,onHandled}} target={activityTarget?.kind===kind?activityTarget:null} activityVersion={revision}/>
    {messaging&&templatesOpen&&channels.length>0&&<MessengerTemplates channels={channels} selectedChannel={channel}
      close={()=>setTemplatesOpen(false)} onChange={()=>setTemplateRevision((value)=>value+1)}/>}
  </>;
}

export function Comments(props) { return <Activity {...props} kind="comment"/>; }
export function Messages(props) { return <Activity {...props} kind="message"/>; }

export function AdminOverview({ state, go }) {
  const {copy}=useDisplayLocale();
  const {total=0,customers=0,active=0}=state.accountTotals??{};
  return <>
    <section className="admin-hero"><div className="admin-hero-icon"><Icon name="user"/></div>
      <div><div className="admin-kicker">{copy("QUẢN TRỊ NỀN TẢNG")}</div><h1>{copy("Tổng quan người dùng")}</h1><p>{copy("Theo dõi tài khoản và trạng thái hoạt động.")}</p></div>
      <Button variant="primary" icon="arrow" onClick={()=>go('users')}>{copy("Quản lý người dùng")}</Button>
    </section>
    <MetricGrid metrics={[
      [copy("Khách hàng"),customers,copy("Tài khoản Người dùng"),'user'],[copy("Đang hoạt động"),active,copy("Tài khoản đang mở"),'check','mint'],
      [copy("Đã khóa"),customers-active,copy("Tài khoản bị tạm khóa"),'lock','rose'],['Admin',total-customers,copy("Quản trị nền tảng"),'grid','amber'],
    ]}/>
    <div className="analytics-grid"><DonutChart title={copy("Trạng thái tài khoản")} subtitle={copy("Tỷ trọng tài khoản khách hàng đang mở hoặc bị khóa.")}
      segments={[{label:copy("Đang hoạt động"),value:active},{label:copy("Đã khóa"),value:customers-active}]}/>
      <section className="card"><CardHead title={copy("Hoạt động nền tảng")} subtitle={copy("Số liệu tổng hợp toàn hệ thống")}/><div className="chart-body">
        <Button variant="primary" icon="chart" onClick={()=>go('system')}>{copy("Xem thống kê hệ thống")}</Button>
      </div></section>
    </div>
  </>;
}
export function AdminUsers({ state, refreshWorkspace, accessRevision }) {
  const {copy}=useDisplayLocale();
  const [query,setQuery]=useState('');
  const [target,setTarget]=useState(null);
  const [page,setPage]=useState(1),[revision,setRevision]=useState(0);
  const [result,setResult]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    api('users?'+new URLSearchParams({page,q:query.trim()}),'GET',undefined,controller.signal).then(data=>{
      if(!controller.signal.aborted){setResult(data);setError('');}
    }).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[page,query,revision,accessRevision]);
  const statusAction=target?.active?copy("Khóa"):copy("Mở khóa");
  const users=result?.items??[];
  return <>
    <Title title={copy("Quản lý người dùng")} subtitle={copy("Tra cứu tài khoản và khóa hoặc mở khóa quyền truy cập.")}
      action={<Button onClick={()=>setRevision(value=>value+1)}>{copy("Tải lại")}</Button>}/>
    <div className="toolbar"><input aria-label={copy("Tìm tài khoản")} value={query} placeholder={copy("Tìm theo tên hoặc email…")} maxLength={150} onChange={(e)=>{setQuery(e.target.value);setPage(1);}}/></div>
    {error&&<p className="notice" role="alert">{copy(error)}</p>}
    <section className="card"><CardHead title={copy("Danh sách tài khoản")} subtitle={result?result.accounts+copy(" tài khoản trên nền tảng"):undefined}/>
      <div className="table-wrap"><table><thead><tr><th>{copy("Tài khoản")}</th><th>{copy("Vai trò")}</th><th>{copy("Kênh kết nối")}</th><th>{copy("Xác minh email")}</th><th>{copy("Trạng thái")}</th><th>{copy("Thao tác")}</th></tr></thead>
        <tbody>{users.length?users.map((u)=><tr key={u.id}><td><b>{u.name}</b><div className="dim">{u.email}</div></td>
          <td>{u.role==='admin'?'Admin':copy("Người dùng")}</td><td>{u.role==='admin'?'—':u.connectedChannels??0}</td>
          <td>{u.emailVerified?copy("Đã xác minh"):copy("Chờ xác minh")}</td>
          <td><Chip status={u.active?'active':'disabled'}>{u.active?copy("Hoạt động"):copy("Đã khóa")}</Chip></td>
          <td>{u.role==='user'&&!u.isSuperAdmin&&u.id!==state.user.id
            ?<Button onClick={()=>setTarget(u)}>{u.active?copy("Khóa"):copy("Mở khóa")}</Button>
            :'—'}</td>
        </tr>):<tr><td colSpan={6}><Empty>{copy(result?"Chưa có tài khoản phù hợp.":"Đang tải tài khoản…")}</Empty></td></tr>}</tbody>
      </table></div>
      {result&&<ListPagination page={result.page} total={result.total} onChange={setPage}/>}
    </section>
    {target&&<Dialog title={statusAction} label={statusAction} close={()=>setTarget(null)} submit={async()=>{
      await api('users/'+encodeURIComponent(target.id)+'/status','PATCH',{active:!target.active},undefined,target.version);
      setRevision(value=>value+1);
      await refreshWorkspace();
    }}>
      <p>{statusAction} <strong>{target.email}</strong>?</p>
      {target.active&&<p className="dim">{copy("Các phiên đăng nhập của tài khoản này sẽ bị thu hồi.")}</p>}
    </Dialog>}
  </>;
}
export function AdminSystem({ state }) {
  const {copy}=useDisplayLocale();
  const s=state.system??{};
  return <>
    <Title title={copy("Thống kê hệ thống")} subtitle={copy("Số liệu tổng hợp trên toàn bộ SnailChat.")}/>
    <MetricGrid metrics={[
      [copy("Kênh đã kết nối"),(s.facebook??0)+(s.instagram??0),copy("Facebook và Instagram"),'channels'],
      [copy("Bình luận"),s.comments??0,copy("Ghi nhận trong hệ thống"),'chat','amber'],
      [copy("Tin nhắn"),s.messages??0,copy("Tin nhắn Messenger"),'send','rose'],
      [copy("Đã phản hồi"),(s.replied??0)+(s.messages_replied??0),copy("Bình luận và tin nhắn"),'check','mint'],
    ]}/>
    <div className="analytics-grid">
      <TimeChart title={copy("Kênh theo nền tảng")} subtitle={copy("Kênh đang kết nối")} label={copy("Nền tảng")} type="column"
        rows={[{label:'Facebook',values:{count:s.facebook??0}},{label:'Instagram',values:{count:s.instagram??0}}]}
        series={[{key:'count',name:copy("Kênh"),color:'primary'}]}/>
      <ComparisonChart title={copy("Tỷ lệ đã phản hồi")} subtitle={copy("So sánh số lượt đã trả lời trên tổng lượt ghi nhận.")} stacked
        rows={[{label:copy("Tin nhắn"),value:s.messages_replied??0,total:s.messages??0},
          {label:copy("Bình luận"),value:s.replied??0,total:s.comments??0}]}/>
    </div>
  </>;
}
