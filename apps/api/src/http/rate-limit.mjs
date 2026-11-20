import { isIP } from 'node:net';
import { throttle } from '../db/store.mjs';

const minute=60_000;
const webhook=/^\/api\/(?:meta\/webhook\/(?:fb|ig|facebook|instagram)|billing\/sepay\/webhook)\/?$/;
const safe=new Set(['GET','HEAD','OPTIONS']);

export function peerIP(req) {
  const proxyIP=req.headers['x-real-ip'];
  return process.env.TRUST_PROXY==='1'&&typeof proxyIP==='string'&&isIP(proxyIP)
    ?proxyIP:req.socket.remoteAddress??'unknown';
}

export function isProviderWebhook(req) {
  return webhook.test(req.path);
}

export function rateLimitPeer(req) {
  const peer=peerIP(req);
  if(isProviderWebhook(req))return throttle('edge:webhook:'+peer,1200,minute);
  const shared=process.env.TRUST_PROXY!=='1';
  return throttle('edge:api:'+peer,shared?2400:360,minute);
}

export async function rateLimitActor(req,actor) {
  const tier=safe.has(req.method)?'read':'write';
  if(!actor)return throttle('api:guest:'+tier+':'+peerIP(req),tier==='read'?240:90,minute);
  await throttle('api:actor:'+tier+':'+actor.id,tier==='read'?240:90,minute);
  let cost;
  if(req.path==='/api/billing/quote')cost='quote';
  if(/^\/api\/(?:catalog\/files|bots\/agent\/documents|shop\/alert-sounds\/[^/]+\/file)(?:\/|$)/.test(req.path)&&tier==='write')cost='upload';
  if(req.path==='/api/replies'||req.path==='/api/comments/private-reply')cost='reply';
  if(cost)await throttle('api:cost:'+cost+':'+actor.id,{quote:30,upload:15,reply:45}[cost],minute);
}


export async function rateLimitShop(req,shopId){
  if(safe.has(req.method))return;
  await throttle('api:shop:write:'+shopId,300,minute);
}
