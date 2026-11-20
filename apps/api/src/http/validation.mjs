import { validateRules } from '@reeldesk/bot-rules';

export class AppError extends Error {
  constructor(status,message){super(message);this.status=status;this.retryAfter=null;}
}
export function ensure(value,status,message) {
  if(!value) throw new AppError(status,message);
  return value;
}
export function string(value,max,{required=false,min=0}={}) {
  ensure(typeof value==='string'||value===undefined,400,'Dữ liệu văn bản không hợp lệ.');
  const clean=(value??'').trim();
  ensure(clean.length<=max&&clean.length>=min&&(!required||clean.length>0),400,'Nội dung bị thiếu hoặc có độ dài không hợp lệ.');
  return clean;
}
export function emailOf(value) {
  const email=string(value,254,{required:true}).toLowerCase();
  ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'Email không hợp lệ.');
  return email;
}
export const publicUser=(u)=>({id:u.id,name:u.name,avatarVersion:u.avatar_version??null,email:u.email,role:u.role,isSuperAdmin:u.is_super_admin===true,active:!!u.active,emailVerified:u.email_verified_at!=null});
export const choicesOf=(value,options)=>ensure(options.includes(value)&&value,400,'Lựa chọn không hợp lệ.');
export function rulesOf(value) {
  if(value&&typeof value==='object'){
    let config;
    try {config=validateRules(value);}
    catch(error){throw new AppError(400,error.message);}
    return config.groups.length||config.fallback?JSON.stringify(config):'';
  }
  const rules=string(value,6000);
  ensure(rules.split('\n').every((line)=>!line.trim()||/^.{1,160}=>.{1,1000}$/.test(line)&&line.split('=>').every((part)=>part.trim())),400,'Mỗi quy tắc cần có từ khóa và câu trả lời.');
  return rules;
}
