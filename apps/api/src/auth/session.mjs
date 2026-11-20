import { createHash,randomBytes } from 'node:crypto';
import { uid,get,run,transaction } from '../db/store.mjs';
import { safeEqual,sign } from './crypto.mjs';

const jwtHeader=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
const accessSeconds=15*60;
export const sessionSeconds=30*24*60*60;
const refreshHash=(token)=>createHash('sha256').update(token).digest('hex');

function credentials({id,user_id,expires},issuer,refreshToken){
  const now=Math.floor(Date.now()/1000);
  const exp=Math.min(Math.floor(expires/1000),now+accessSeconds);
  const payload=Buffer.from(JSON.stringify({iss:issuer,aud:'reeldesk',sub:user_id,jti:id,iat:now,exp})).toString('base64url');
  const content=jwtHeader+'.'+payload;
  return {id,token:content+'.'+sign('session-jwt',content),accessAge:Math.max(0,exp-now),
    refreshToken,refreshAge:Math.max(0,Math.floor(expires/1000)-now)};
}

async function issueRefresh(session,issuer){
  const token=randomBytes(32).toString('base64url');
  await run('UPDATE session_refresh_tokens SET used=TRUE WHERE session_id=$1 AND NOT used',session.id);
  await run('INSERT INTO session_refresh_tokens(token_hash,session_id) VALUES($1,$2)',refreshHash(token),session.id);
  return credentials(session,issuer,token);
}

export function createSession(userId,issuer){
  return transaction(async()=>{
    const session={id:uid(),user_id:userId,expires:Date.now()+sessionSeconds*1000};
    await run('INSERT INTO sessions(id,user_id,expires) VALUES($1,$2,$3)',session.id,userId,session.expires);
    return issueRefresh(session,issuer);
  });
}

function lockActiveSession(id){
  return get(`SELECT s.id,s.user_id,s.expires,u.is_super_admin FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=$1 AND s.expires>$2 AND u.active=1 AND u.email_verified_at IS NOT NULL FOR UPDATE OF s`,id,Date.now());
}

export function reissueBrowserSession(id,issuer){
  return transaction(async()=>{
    const session=await lockActiveSession(id);
    if(!session)return null;
    const credentials=await issueRefresh(session,issuer);
    return {...credentials,user:{id:session.user_id,isSuperAdmin:session.is_super_admin===true}};
  });
}

export async function rotateRefresh(token,issuer){
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
  const hash=refreshHash(token);
  return transaction(async()=>{
    const row=await get('SELECT session_id FROM session_refresh_tokens WHERE token_hash=$1',hash);
    if(!row)return null;
    const session=await lockActiveSession(row.session_id);
    if(!session)return null;
    const current=await get('SELECT used FROM session_refresh_tokens WHERE token_hash=$1',hash);
    if(!current)return null;
    if(current.used){
      // The secret was previously issued and spent. Revoke the entire session family.
      await run('DELETE FROM sessions WHERE id=$1',session.id);
      return null;
    }
    return issueRefresh(session,issuer);
  });
}

export function readSession(token,issuer){
  if(!token||token.length>1200)return;
  try{
    const [header,payload,signature,rest]=token.split('.');
    if(rest!==undefined||header!==jwtHeader||!signature||!safeEqual(signature,sign('session-jwt',header+'.'+payload)))return;
    const p=JSON.parse(Buffer.from(payload,'base64url').toString());
    if(p.iss!==issuer||p.aud!=='reeldesk'||!Number.isInteger(p.exp)||p.exp<=Date.now()/1000)return;
    return get(`SELECT users.*, sessions.id AS session_id FROM sessions JOIN users ON users.id=sessions.user_id
      WHERE sessions.id=$1 AND sessions.user_id=$2 AND sessions.expires>$3 AND users.active=1 AND users.email_verified_at IS NOT NULL`,
      p.jti,p.sub,Date.now()).then(user=>user?{...user,access_expires:p.exp*1000}:undefined);
  }catch{}
}
