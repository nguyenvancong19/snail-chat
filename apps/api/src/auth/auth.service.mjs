import { peerIP } from '../http/rate-limit.mjs';
import { randomBytes } from 'node:crypto';
import { get, run, uid, throttle, transaction } from '../db/store.mjs';
import { ensureDefaultShop, userShops } from '../shops/tenant.mjs';
import { emailOf, ensure, publicUser, string } from '../http/validation.mjs';
import { json } from '../http/wire.mjs';
import { hashPassword, safeEqual, sign, verifyPassword } from './crypto.mjs';
import { createSession } from './session.mjs';
import { loginCookies } from './browser-accounts.mjs';
import { origin } from '../meta/meta.mjs';
import { deliverAccountEmail, hashToken, requireMail, sendVerification } from './email-verification.mjs';
import { passwordResetEmail } from './verification-email-template.mjs';
let logins=0;
let resetDeliveries=0;
const receiptLifetime=60*60_000;

function resendSignature(id,email,expires) {
  return sign('email-resend-status',id+'.'+email+'.'+expires);
}

export async function register(req,res,body) {
  ensure(body&&typeof body==='object'&&!Array.isArray(body),400,'Dữ liệu đăng ký không hợp lệ.');
  const name=string(body.name,100,{required:true}), email=emailOf(body.email);
  requireMail();
  ensure(logins<8,429,'Máy chủ đang xử lý xác thực. Vui lòng thử lại.');
  logins++;
  try {
    await throttle('register-ip:'+peerIP(req),12,60*60000);
    await throttle('register-email:'+email,4,60*60000);
    const password=await hashPassword(body.password), id=uid();
    ensure((await run("INSERT INTO users(id,name,email,password,role,active) VALUES($1,$2,$3,$4,'user',1) ON CONFLICT (email) DO NOTHING",
      id,name,email,password)).changes,409,'Email này đã có tài khoản. Hãy đăng nhập hoặc chọn gửi lại thư xác minh.');
    const sent=await sendVerification(id,email);
    const expires=Date.now()+receiptLifetime;
    json(res,201,{verificationRequired:true,sent,resendReceipt:expires+'.'+resendSignature(id,email,expires)});
  }finally{logins--;}
}

export async function resendVerification(req,res,body) {
  const email=emailOf(body.email);
  requireMail();
  await throttle('verify-resend-ip:'+peerIP(req),12,60*60000);
  await throttle('verify-resend-email:'+email,4,60*60000);
  const user=await get('SELECT id FROM users WHERE email=$1 AND active=1 AND email_verified_at IS NULL',email);
  if(!user)return json(res,200,{ok:true});
  const sent=await sendVerification(user.id,email);
  // Only the browser that registered this account receives its SMTP delivery status.
  const receipt=typeof body.receipt==='string'&&/^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(body.receipt);
  if(receipt&&Number(receipt[1])>Date.now()&&safeEqual(receipt[2],resendSignature(user.id,email,receipt[1]))){
    return json(res,200,{ok:true,sent});
  }
  return json(res,200,{ok:true});
}

export async function requestPasswordReset(req,res,body) {
  const email=emailOf(body?.email);
  requireMail();
  await throttle('password-reset-ip:'+peerIP(req),12,60*60_000);
  await throttle('password-reset-email:'+email,4,60*60_000);
  ensure(resetDeliveries<8,503,'Dịch vụ gửi email đang bận. Vui lòng thử lại sau.');
  resetDeliveries++;
  // Return before looking up the address or contacting SMTP.
  void issuePasswordReset(email).catch((error)=>{
    console.error('SnailChat password reset:',error.code??error.name);
  }).finally(()=>{resetDeliveries--;});
  return json(res,200,{ok:true});
}

async function issuePasswordReset(email) {
  const token=randomBytes(32).toString('base64url');
  const issued=await transaction(async()=>{
    const user=await get('SELECT id FROM users WHERE email=$1 AND active=1 AND email_verified_at IS NOT NULL FOR UPDATE',email);
    if(!user)return false;
    await run('INSERT INTO password_resets(token_hash,user_id,email,expires) VALUES($1,$2,$3,$4)',
      hashToken(token),user.id,email,Date.now()+30*60_000);
    return true;
  });
  if(issued)await deliverAccountEmail(email,passwordResetEmail(origin+'/reset-password#'+token),'password reset');
}

export async function resetPassword(req,body) {
  await throttle('password-confirm-ip:'+peerIP(req),24,15*60_000);
  const message='Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.';
  ensure(typeof body?.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(body.token),400,message);
  ensure(typeof body.password==='string'&&body.password===body.confirmPassword,400,'Hai mật khẩu cần trùng nhau.');
  const tokenHash=hashToken(body.token);
  const pending=await get('SELECT user_id FROM password_resets WHERE token_hash=$1 AND expires>$2',tokenHash,Date.now());
  ensure(pending,400,message);
  ensure(logins<8,429,'Máy chủ đang xử lý xác thực. Vui lòng thử lại.');
  logins++;
  try{
    const password=await hashPassword(body.password);
    await transaction(async()=>{
      const user=await get('SELECT email,active,email_verified_at FROM users WHERE id=$1 FOR UPDATE',pending.user_id);
      const token=await get('SELECT email FROM password_resets WHERE token_hash=$1 AND expires>$2',tokenHash,Date.now());
      ensure(user?.active&&user.email_verified_at!==null&&token?.email===user.email,400,message);
      await run('UPDATE users SET password=$1 WHERE id=$2',password,pending.user_id);
      await run('DELETE FROM password_resets WHERE user_id=$1',pending.user_id);
      await run('DELETE FROM sessions WHERE user_id=$1',pending.user_id);
    });
  }finally{logins--;}
}

export async function login(req,res,body) {
  ensure(body&&typeof body==='object'&&!Array.isArray(body),400,'Dữ liệu đăng nhập không hợp lệ.');
  const email=emailOf(body.email);
  ensure(typeof body.password==='string'&&body.password.length>0&&body.password.length<=128,400,'Email hoặc mật khẩu không hợp lệ.');
  ensure(logins<8,429,'Máy chủ đang xử lý đăng nhập. Vui lòng thử lại.');
  const peer=peerIP(req);
  logins++;
  try{
    await throttle('ip:'+peer,24,15*60000);
    await throttle('email:'+email,10,15*60000);
    const user=await get('SELECT * FROM users WHERE email=$1',email);
    const valid=await verifyPassword(body.password,user?.password);
    const session=await transaction(async()=>{
      const current=user&&await get('SELECT * FROM users WHERE id=$1 FOR UPDATE',user.id);
      ensure(valid&&current?.active&&current.password===user.password&&current.email===email,401,'Email hoặc mật khẩu không đúng.');
      ensure(current.email_verified_at!==null,403,'Bạn cần xác minh email trước khi đăng nhập.');
      await ensureDefaultShop(current);
      const shops=await userShops(user.id);
      return { ...(await createSession(user.id,origin)), user:publicUser(current), shops };
    });
    await run('DELETE FROM login_attempts WHERE key=$1','email:'+email);
    json(res,200,{ok:true,user:{...session.user,shops:session.shops},shops:session.shops},{'Set-Cookie':await loginCookies(req,session)});
  }finally{logins--;}
}

export async function updateProfile(user,body) {
  const name=string(body.name,100,{required:true});
  let password=null;
  const previous=await get('SELECT password FROM users WHERE id=$1',user.id);
  if(body.password){
    ensure(typeof body.currentPassword==='string'&&body.currentPassword.length<=128&&
      await verifyPassword(body.currentPassword,previous?.password),400,'Mật khẩu hiện tại không đúng.');
    password=await hashPassword(body.password);
  }
  await transaction(async()=>{
    const current=await get('SELECT password,active FROM users WHERE id=$1 FOR UPDATE',user.id);
    ensure(current?.active&&(!password||previous?.password===current.password),409,'Phiên đã thay đổi. Hãy đăng nhập lại.');
    await run('UPDATE users SET name=$1,password=COALESCE($2,password) WHERE id=$3',name,password,user.id);
    if(password){
      await run('DELETE FROM sessions WHERE user_id=$1',user.id);
      await run('DELETE FROM password_resets WHERE user_id=$1',user.id);
    }
  });
}
