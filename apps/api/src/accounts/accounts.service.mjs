import { checkVersion } from '../http/versions.mjs';
import { get, run, transaction } from '../db/store.mjs';
import { ensure, string } from '../http/validation.mjs';

export async function setUserActive(user,id,body,expected) {
  const userId=string(id,50,{required:true});
  ensure(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===1&&typeof body.active==='boolean',
    400,'Chỉ chấp nhận trạng thái hoạt động active (true hoặc false).');
  await transaction(async()=>{
    ensure(await get('SELECT 1 FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id=$1 AND sessions.user_id=$2 AND sessions.expires>$3 AND users.is_super_admin AND users.active=1',
      user.session_id,user.id,Date.now()),403,'Phiên Admin đã hết hiệu lực.');
    const target=await get('SELECT role,is_super_admin,version FROM users WHERE id=$1 FOR UPDATE',userId);
    ensure(target,404,'Không tìm thấy tài khoản.');
    ensure(userId!==user.id&&target.role==='user'&&!target.is_super_admin,403,'Chỉ có thể đổi trạng thái của tài khoản người dùng.');
    checkVersion(target.version,expected);
    await run('UPDATE users SET active=$1 WHERE id=$2',body.active?1:0,userId);
    if(!body.active){
      await run('DELETE FROM sessions WHERE user_id=$1',userId);
      await run('DELETE FROM password_resets WHERE user_id=$1',userId);
    }
  });
}
