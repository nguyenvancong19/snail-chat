import { shopFeatures } from '../billing/plan-features.mjs';
import { EventEmitter } from 'node:events';
import { db } from '../db/store.mjs';
import { authenticate } from '../http/wire.mjs';
import { pageGrants, requireShop, usableShop, userShops } from './tenant.mjs';
import { ensure } from '../http/validation.mjs';

const topic='snailchat_page_activity';
const events=new EventEmitter().setMaxListeners(0);
let listener;
let connecting;
let stopListener;

async function listen() {
  if(listener)return;
  if(connecting)return connecting;
  connecting=(async()=>{
    const client=await db.connect();
    function disconnected(error) {
      if(listener===client){listener=undefined;stopListener=undefined;}
      client.removeAllListeners('notification');
      client.removeListener('error',disconnected);
      client.removeListener('end',disconnected);
      client.release(error||true);
      events.emit('disconnect');
    }
    try {
      await client.query('LISTEN '+topic);
    } catch(error) {
      client.release(error);
      throw error;
    }
    client.once('error',disconnected);
    client.once('end',disconnected);
    client.on('notification',({channel,payload})=>{
      if(channel!==topic)return;
      try {
        const event=JSON.parse(payload);
        if(typeof event.access==='string'&&(event.access==='admin'||/^(shop|user):.+/.test(event.access))){
          events.emit('access:'+event.access);
          return;
        }
        if(typeof event.room==='string'&&event.room.startsWith('page:')&&
          ['chat:read','chat:reply','order:manage'].includes(event.permission))events.emit(event.room,event);
      } catch {}
    });
    listener=client;
    stopListener=disconnected;
  })().finally(()=>{connecting=undefined;});
  return connecting;
}

export async function stopPageEvents() {
  await connecting?.catch(()=>{});
  stopListener?.();
}

const counts=new Map();

export async function openPageEvents(req,res) {
  const actor=req.actor;
  const key=actor.session_id;
  const requestedShop=typeof req.query.shop==='string'?req.query.shop:null;
  const accessRooms=['access:user:'+actor.id];
  if(actor.is_super_admin)accessRooms.push('access:admin');
  function accessChanged() {
    if(!closed)send('access-changed',{});
  }
  ensure((counts.get(key)??0)<6,429,'Đã có quá nhiều kết nối cập nhật.');
  counts.set(key,(counts.get(key)??0)+1);
  let grants,owner,soundAllowed,timer,lifetime;
  let closed=false;
  let checking;
  let pending=new Map();
  const rooms=new Map();
  const send=(event,data)=>res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');
  function close() {
    if(closed)return;
    closed=true;
    for(const [room,handler] of rooms)events.off(room,handler);
    events.off('disconnect',close);
    for(const room of accessRooms)events.off(room,accessChanged);
    clearInterval(timer);
    clearTimeout(lifetime);
    const remaining=counts.get(key)-1;
    if(remaining)counts.set(key,remaining);
    else counts.delete(key);
    if(res.headersSent&&!res.writableEnded)res.end();
  }
  res.once('close',close);

  async function updateRooms() {
    const current=await authenticate(req);
    if(closed)return;
    if(!current||current.session_id!==key){
      if(res.headersSent)accessChanged();
      return close();
    }
    if(!current.is_super_admin)events.off('access:admin',accessChanged);
    const shop=requestedShop&&(await userShops(current.id)).find(({id})=>id===requestedShop);
    if(!shop||!usableShop(shop,Date.now())){
      grants=new Map();
      for(const [room,handler] of rooms)events.off(room,handler);
      rooms.clear();
      return;
    }
    const authorized=await requireShop(current,shop.id);
    owner=authorized.memberRole==='OWNER';
    const [pages,plan]=await Promise.all([pageGrants(authorized),shopFeatures(authorized.currentShop.id)]);
    soundAllowed=plan?.feature_flags.alertSounds===true;
    const allowed={'chat:reply':plan?.feature_flags.messages,'chat:read':plan?.feature_flags.messages||plan?.feature_flags.comments,
      'order:manage':plan?.feature_flags.orders};
    grants=new Map(pages.map(({id,permissions})=>['page:'+id,permissions.filter(permission=>allowed[permission]&&(permission!=='chat:reply'||permissions.includes('chat:read')))]));
    if(closed)return;
    for(const [room,handler] of rooms)if(!grants.has(room)){
      events.off(room,handler);
      rooms.delete(room);
    }
    for(const room of grants.keys())if(!rooms.has(room)){
      const handler=(event)=>{
        if(!grants.get(room)?.includes(event.permission))return;
        if(!pending.has(room))pending.set(room,new Map());
        const key=event.alert?JSON.stringify([event.alert.kind,event.alert.target,event.alert.source]):event.permission;
        pending.get(room).set(key,event);
        if(!checking)checking=flush().finally(()=>{checking=undefined;});
      };
      rooms.set(room,handler);
      events.on(room,handler);
    }
  }

  async function flush() {
    try{
      // Never deliver against permissions cached before revocation.
      while(pending.size&&!closed){
        const batch=pending;
        pending=new Map();
        await updateRooms();
        if(closed)return;
        for(const [room,entries] of batch){
          const authorized=[...entries.values()].filter(event=>grants.get(room)?.includes(event.permission)&&
            (event.alert?.target!=='verification'||owner));
          const pageId=room.slice(5);
          if(authorized.some(event=>!event.alert))send('page',{pageId});
          for(const {alert} of authorized)if(alert)send('agent-alert',{...alert,pageId,soundAllowed});
        }
      }
    }catch{close();}
  }

  try{
    await listen();
    if(requestedShop&&(await userShops(actor.id)).some(({id})=>id===requestedShop)){
      accessRooms.push('access:shop:'+requestedShop);
    }
    await updateRooms();
    if(closed){
      if(!res.destroyed)ensure(false,403,'Phiên cập nhật đã hết hiệu lực.');
      return;
    }
    events.on('disconnect',close);
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform',
      'X-Accel-Buffering':'no'});
    res.write('retry: 3000\n: connected\n\n');
    for(const room of accessRooms)events.on(room,accessChanged);
    timer=setInterval(()=>{
      updateRooms().then(()=>{if(!closed)res.write(': heartbeat\n\n');}).catch(close);
    },12_000);
    lifetime=setTimeout(close,70_000);
  }catch(error){
    close();
    throw error;
  }
}
