import { assignStaffCode, staffCode } from './work-activity.mjs';
import { lockBillingShop, requireStaffSlot } from '../billing/limits.mjs';
import { all, get, run, throttle, transaction, uid } from '../db/store.mjs';
import { choicesOf, emailOf, ensure, string } from '../http/validation.mjs';
import { deliverAccountEmail, requireMail } from '../auth/email-verification.mjs';
import { origin } from '../meta/meta.mjs';
import { ownerOnly } from './tenant.mjs';

const invitationDuration=7*86_400_000;
const allowed=['chat:read','chat:reply','order:manage','order:create'];

async function lockShop(actor) {
  ownerOnly(actor);
  const shop=await get(`SELECT s.* FROM shops s JOIN shop_members m ON m.shop_id=s.id
    WHERE s.id=$1 AND m.user_id=$2 AND m.role='OWNER' AND m.status='ACTIVE'
      AND s.status='ACTIVE' AND (s.expired_at IS NULL OR s.expired_at>$3) FOR NO KEY UPDATE OF s FOR SHARE OF m`,
    actor.currentShop.id,actor.id,Date.now());
  return ensure(shop,403,'Shop hoặc quyền chủ Shop đã thay đổi.');
}

async function grantsOf(shopId, input) {
  ensure(Array.isArray(input)&&input.length<=200,400,'Danh sách Page không hợp lệ.');
  const grants=input.map((entry)=>{
    const pageId=string(entry?.pageId,100,{required:true});
    ensure(Array.isArray(entry?.permissions)&&entry.permissions.length>0&&entry.permissions.length<=allowed.length,
      400,'Hãy chọn quyền cho từng Page.');
    const permissions=[...new Set(entry.permissions.map((permission)=>choicesOf(permission,allowed)))];
    if(permissions.includes('chat:reply')&&!permissions.includes('chat:read'))permissions.push('chat:read');
    if(permissions.includes('order:create')&&!permissions.includes('order:manage'))permissions.push('order:manage');
    return {pageId,permissions};
  });
  ensure(new Set(grants.map((grant)=>grant.pageId)).size===grants.length,400,'Danh sách Page có mục trùng lặp.');
  const count=await get('SELECT COUNT(*) AS total FROM channels WHERE shop_id=$1 AND id=ANY($2::text[])',
    shopId,grants.map((grant)=>grant.pageId));
  ensure(count.total===grants.length,400,'Danh sách có Page không thuộc Shop.');
  return grants;
}

async function saveGrants(shopId,memberId,grants) {
  await run('DELETE FROM page_assignments WHERE shop_member_id=$1',memberId);
  for(const grant of grants)await run(`INSERT INTO page_assignments(id,shop_id,shop_member_id,page_id,permissions)
    SELECT $1,$2,$3,id,$5 FROM channels WHERE id=$4 AND shop_id=$2`,uid(),shopId,memberId,grant.pageId,grant.permissions);
}

export async function listMembers(actor) {
  ownerOnly(actor);
  const rows=await all(`SELECT m.id,u.name,u.email,m.role,m.status,n.number,m.joined_at AS "joinedAt",m.joined_at AS sort_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('pageId',a.page_id,'permissions',a.permissions))
      FROM page_assignments a WHERE a.shop_member_id=m.id),'[]'::jsonb) AS grants
    FROM shop_members m JOIN users u ON u.id=m.user_id
    LEFT JOIN shop_staff_codes n ON n.shop_id=m.shop_id AND n.user_id=m.user_id
    WHERE m.shop_id=$1 AND m.status<>'INVITED'
    UNION ALL
    SELECT i.id,i.email,i.email,'STAFF','INVITED',NULL,NULL,i.expires_at-$3,i.grants
    FROM shop_invitations i WHERE i.shop_id=$1 AND i.expires_at>$2
    ORDER BY sort_at DESC NULLS LAST,name,id`,actor.currentShop.id,Date.now(),invitationDuration);
  return rows.map(({number,...row})=>({...row,code:staffCode(number)}));
}

export async function inviteMember(actor,body) {
  ownerOnly(actor);
  requireMail();
  const email=emailOf(body.email);
  await throttle('shop-invite:'+actor.id,20,60*60_000);
  const shop=await transaction(async()=>{
    const shop=await lockShop(actor);
    const grants=await grantsOf(shop.id,body.grants??[]);
    const user=await get('SELECT id FROM users WHERE email=$1',email);
    if(user){
      const existing=await get('SELECT status FROM shop_members WHERE shop_id=$1 AND user_id=$2',shop.id,user.id);
      ensure(!existing||existing.status==='INVITED',409,'Tài khoản đã thuộc Shop. Hãy sửa quyền trong danh sách nhân viên.');
    }
    if(!await get('SELECT 1 FROM shop_invitations WHERE shop_id=$1 AND email=$2 AND expires_at>$3',shop.id,email,Date.now())){
      await requireStaffSlot(shop);
    }
    const expiresAt=Date.now()+invitationDuration;
    await run(`INSERT INTO shop_invitations(id,shop_id,email,grants,expires_at) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(shop_id,email) DO UPDATE SET grants=EXCLUDED.grants,expires_at=EXCLUDED.expires_at`,
      uid(),shop.id,email,JSON.stringify(grants),expiresAt);
    if(user)await run(`INSERT INTO shop_members(id,shop_id,user_id,role,status) VALUES($1,$2,$3,'STAFF','INVITED')
      ON CONFLICT(shop_id,user_id) DO NOTHING`,uid(),shop.id,user.id);
    return shop;
  });
  const sent=await deliverAccountEmail(email,{
    subject:'Lời mời tham gia Shop trên SnailChat',
    text:`Bạn được mời tham gia ${shop.name}. Hãy đăng nhập bằng email này hoặc đăng ký và xác minh email, sau đó chấp nhận lời mời trên SnailChat. Lời mời có hiệu lực 7 ngày.\n${origin}/dashboard#invitations`,
  },'shop invitation');
  return {sent};
}

export async function pendingInvitations(actor) {
  return all(`SELECT i.id,s.name FROM shop_invitations i JOIN shops s ON s.id=i.shop_id
    WHERE i.email=$1 AND i.expires_at>$2 AND s.status='ACTIVE' AND (s.expired_at IS NULL OR s.expired_at>$2)
    ORDER BY i.expires_at DESC,i.id DESC`,actor.email,Date.now());
}

export async function acceptInvitation(actor,id) {
  return transaction(async()=>{
    const target=await get('SELECT shop_id FROM shop_invitations WHERE id=$1 AND email=$2',id,actor.email);
    ensure(target,404,'Lời mời không còn hiệu lực.');
    const shop=await lockBillingShop(target.shop_id);
    const user=await get('SELECT id,email FROM users WHERE id=$1 AND active=1 AND email_verified_at IS NOT NULL FOR UPDATE',actor.id);
    ensure(user,403,'Tài khoản không còn hoạt động.');
    const invitation=await get(`SELECT i.* FROM shop_invitations i JOIN shops s ON s.id=i.shop_id
      WHERE i.id=$1 AND i.email=$2 AND i.expires_at>$3 AND s.status='ACTIVE' AND (s.expired_at IS NULL OR s.expired_at>$3)
      FOR UPDATE OF i FOR SHARE OF s`,id,user.email,Date.now());
    ensure(invitation,404,'Lời mời không còn hiệu lực.');
    await requireStaffSlot(shop,{reserved:true});
    const member=await get(`INSERT INTO shop_members(id,shop_id,user_id,role,status,joined_at)
      VALUES($1,$2,$3,'STAFF','ACTIVE',$4) ON CONFLICT(shop_id,user_id)
      DO UPDATE SET status='ACTIVE',joined_at=EXCLUDED.joined_at
      WHERE shop_members.status='INVITED' AND shop_members.role='STAFF' RETURNING id`,
      uid(),invitation.shop_id,user.id,Date.now());
    ensure(member,409,'Trạng thái thành viên đã thay đổi.');
    await assignStaffCode(invitation.shop_id,user.id);
    await saveGrants(invitation.shop_id,member.id,invitation.grants);
    await run('DELETE FROM shop_invitations WHERE id=$1',id);
    return {shopId:invitation.shop_id};
  });
}

export async function changeMember(actor,id,body) {
  return transaction(async()=>{
    const shop=await lockShop(actor);
    const member=await get(`SELECT id,status FROM shop_members WHERE id=$1 AND shop_id=$2 AND role='STAFF'
      AND status IN ('ACTIVE','SUSPENDED') FOR UPDATE`,id,shop.id);
    ensure(member,404,'Không tìm thấy nhân viên.');
    if(body.status!==undefined){
      const next=choicesOf(body.status,['ACTIVE','SUSPENDED']);
      if(next==='ACTIVE'&&member.status!=='ACTIVE')await requireStaffSlot(shop);
      await run('UPDATE shop_members SET status=$1 WHERE id=$2',next,id);
    }
    if(body.grants!==undefined)await saveGrants(shop.id,id,await grantsOf(shop.id,body.grants));
  });
}

export async function removeMember(actor,id) {
  return transaction(async()=>{
    const shop=await lockShop(actor);
    const invitation=await get('DELETE FROM shop_invitations WHERE id=$1 AND shop_id=$2 RETURNING email',id,shop.id);
    if(invitation){
      await run(`DELETE FROM shop_members WHERE shop_id=$1 AND role='STAFF' AND status='INVITED'
        AND user_id=(SELECT id FROM users WHERE email=$2)`,shop.id,invitation.email);
      return;
    }
    const result=await run("DELETE FROM shop_members WHERE id=$1 AND shop_id=$2 AND role='STAFF'",id,shop.id);
    ensure(result.changes,404,'Không tìm thấy nhân viên hoặc lời mời.');
  });
}
