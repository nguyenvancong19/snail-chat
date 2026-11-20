import { AppError, ensure } from './validation.mjs';
import { origin } from '../meta/meta.mjs';
import { readSession } from '../auth/session.mjs';
import { sign } from '../auth/crypto.mjs';

sign('config-check','startup');
const url = new URL(origin);
export const secure = url.protocol === 'https:';
ensure(secure || ['localhost','127.0.0.1','[::1]'].includes(url.hostname), 500, 'APP_URL phải dùng HTTPS ngoài môi trường localhost.');
const cookie = secure ? '__Host-reeldesk' : 'reeldesk_dev';
export const refreshCookie = secure ? '__Host-reeldesk-refresh' : 'reeldesk_dev_refresh';
const apiHeaders = {'Cache-Control':'no-store'};

export function cookieValue(token,maxAge,name=cookie) {
  return name+'='+token+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(secure?'; Secure':'');
}
export function authCookies(session){
  return session
    ? [cookieValue(session.token,session.accessAge),cookieValue(session.refreshToken,session.refreshAge,refreshCookie)]
    : [cookieValue('',0),cookieValue('',0,refreshCookie)];
}
export function send(res,status,body='',headers={}) {
  res.writeHead(status,headers);
  res.end(body);
}
export function json(res,status,body,headers={}) {
  send(res,status,JSON.stringify(body),{...apiHeaders,'Content-Type':'application/json; charset=utf-8',...headers});
}
export function redirect(res,dest){send(res,303,'',{...apiHeaders,Location:dest});}
export function readCookie(req,name) {
  return req.headers.cookie?.split(';').map((v)=>v.trim()).find((v)=>v.startsWith(name+'='))?.slice(name.length+1);
}
export function authenticate(req) {
  return readSession(readCookie(req,cookie),origin);
}
export function ownOrigin(req){
  ensure(req.headers.origin===origin,403,'Nguồn yêu cầu không hợp lệ.');
}
export async function bytes(req,max=65536) {
  if(Number(req.headers['content-length']||0)>max)throw new AppError(413,'Yêu cầu vượt quá kích thước cho phép.');
  const chunks=[];let size=0;
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>max)throw new AppError(413,'Yêu cầu vượt quá kích thước cho phép.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,size);
}
export function parse(data,reviver) {
  try{return JSON.parse(data,reviver);}
  catch{throw new AppError(400,'Dữ liệu JSON không hợp lệ.');}
}

export async function jsonBody(req,max) {
  const value=parse(await bytes(req,max));
  ensure(value&&typeof value==='object'&&!Array.isArray(value),400,'Dữ liệu JSON không hợp lệ.');
  return value;
}
