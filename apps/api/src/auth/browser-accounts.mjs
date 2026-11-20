import { all, run } from '../db/store.mjs';
import { ensure, string } from '../http/validation.mjs';
import { authCookies, cookieValue, json, readCookie, secure } from '../http/wire.mjs';
import { origin } from '../meta/meta.mjs';
import { safeEqual, sign } from './crypto.mjs';
import { reissueBrowserSession } from './session.mjs';

const name = secure ? '__Host-reeldesk-accounts' : 'reeldesk_dev_accounts';
const maxAccounts = 6;
const signature = (payload) => sign('browser-accounts', origin+'\n'+payload);

function rememberedIds(req) {
  const value = readCookie(req, name);
  if (!value || value.length > 600) return [];
  const [payload, sig, extra] = value.split('.');
  if (extra !== undefined || !sig || !safeEqual(sig, signature(payload))) return [];
  try {
    const ids = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Array.isArray(ids) && ids.length <= maxAccounts && ids.every((id) =>
      typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) ? ids : [];
  } catch { return []; }
}

async function accounts(req, prefer = []) {
  const ids = [...new Set([...prefer, req.actor?.session_id, ...rememberedIds(req)].filter(Boolean))];
  const rows = await all(`SELECT s.id,s.user_id,s.expires,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=ANY($1::text[]) AND s.expires>$2 AND u.active=1 AND u.email_verified_at IS NOT NULL`, ids, Date.now());
  const byId = new Map(rows.map((row) => [row.id,row]));
  const seen = new Set();
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row || seen.has(row.user_id)) return [];
    seen.add(row.user_id);
    return [row];
  }).slice(0,maxAccounts);
}

function accountsCookie(rows) {
  if (!rows.length) return cookieValue('',0,name);
  const payload = Buffer.from(JSON.stringify(rows.map((row)=>row.id))).toString('base64url');
  return cookieValue(payload+'.'+signature(payload),8*60*60,name);
}

export async function loginCookies(req, session) {
  return [...authCookies(session), accountsCookie(await accounts(req,[session.id]))];
}

export async function listBrowserAccounts(req) {
  return (await accounts(req)).map((row)=>({
    id:row.user_id,name:row.name,email:row.email,active:row.id===req.actor.session_id,
  }));
}

export async function switchBrowserAccount(req,res,value) {
  const id=string(value,50,{required:true});
  const rows=await accounts(req);
  const target=ensure(rows.find((row)=>row.user_id===id),404,'Phiên đã hết hạn. Hãy thêm lại tài khoản.');
  const session=ensure(await reissueBrowserSession(target.id,origin),404,'Phiên đã hết hạn. Hãy thêm lại tài khoản.');
  return json(res,200,{ok:true,user:session.user},{'Set-Cookie':[...authCookies(session),accountsCookie(rows)]});
}

export async function removeBrowserAccount(req,res,value) {
  const id=string(value,50,{required:true});
  ensure(id!==req.actor.id,409,'Hãy đăng xuất để gỡ tài khoản đang dùng.');
  const rows=await accounts(req);
  const target=ensure(rows.find((row)=>row.user_id===id),404,'Phiên đã hết hạn.');
  await run('DELETE FROM sessions WHERE id=$1 AND user_id=$2',target.id,target.user_id);
  return json(res,200,{ok:true},{'Set-Cookie':accountsCookie(rows.filter((row)=>row.id!==target.id))});
}

export async function logoutBrowserAccount(req,res) {
  await run('DELETE FROM sessions WHERE id=$1',req.actor.session_id);
  return json(res,200,{ok:true},{'Set-Cookie':[...authCookies(null),accountsCookie(await accounts(req))]});
}
