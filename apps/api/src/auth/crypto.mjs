import { createHmac, randomBytes, scrypt, timingSafeEqual, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';
import { promisify } from 'node:util';
import { ensure } from '../http/validation.mjs';

const computeScrypt=promisify(scrypt);
const passwordOptions={N:2**17,r:8,p:1,maxmem:192*1024*1024};
let hashTail=Promise.resolve();
function derive(password,salt) {
  const result=hashTail.then(()=>computeScrypt(password,salt,64,passwordOptions));
  hashTail=result.catch(()=>{});
  return result;
}
const dummySalt=Buffer.alloc(16);
const dummyHash=Buffer.alloc(64);
export async function hashPassword(password) {
  ensure(typeof password==='string'&&password.length>=12&&password.length<=128,400,'Mật khẩu cần từ 12 đến 128 ký tự.');
  const salt=randomBytes(16), hash=await derive(password,salt);
  return 'scrypt-v1$'+salt.toString('base64url')+'$'+hash.toString('base64url');
}
export async function verifyPassword(password,stored) {
  const [,s,h]=stored?.split('$')??[];
  const salt=s?Buffer.from(s,'base64url'):dummySalt, expected=h?Buffer.from(h,'base64url'):dummyHash;
  const actual=await derive(password,salt);
  return expected.length===actual.length&&timingSafeEqual(actual,expected)&&!!stored;
}
export function safeEqual(a,b) {
  const x=Buffer.from(a||''),y=Buffer.from(b||'');
  return x.length===y.length&&timingSafeEqual(x,y);
}
const rootSecret=process.env.JWT_SECRET||'';
function keyFor(label) {
  ensure(Buffer.byteLength(rootSecret)>=32,500,'Thiếu JWT_SECRET ngẫu nhiên có ít nhất 32 byte.');
  return Buffer.from(hkdfSync('sha256',rootSecret,'reeldesk:v1',label,32));
}
export const sign = (label,data,encoding='base64url') => createHmac('sha256',keyFor(label)).update(data).digest(encoding);
export function seal(data) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',keyFor('meta-credentials'),iv);
  const ciphertext=Buffer.concat([cipher.update(data,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64url');
}
export function unseal(value) {
  const bytes=Buffer.from(value,'base64url'), decipher=createDecipheriv('aes-256-gcm',keyFor('meta-credentials'),bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));
  return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');
}
