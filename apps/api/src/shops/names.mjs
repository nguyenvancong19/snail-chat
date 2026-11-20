import { checkVersion } from '../http/versions.mjs';
import { get, run, transaction } from '../db/store.mjs';
import { ensure, string } from '../http/validation.mjs';
import { ownerOnly } from './tenant.mjs';

const dayMs=86_400_000;
const localDate=new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'});

export function shopNameSettings() {
  return get('SELECT cooldown_days AS "cooldownDays",version FROM shop_name_settings WHERE id=1');
}

export async function setShopNameSettings(cooldownDays,expected) {
  ensure(Number.isInteger(cooldownDays)&&cooldownDays>=0&&cooldownDays<=365,400,
    'Thời gian chờ đổi tên phải là số nguyên từ 0 đến 365 ngày.');
  const changed=await get('UPDATE shop_name_settings SET cooldown_days=$1 WHERE id=1 AND ($2::integer IS NULL OR version=$2) RETURNING version',
    cooldownDays,expected??null);
  checkVersion(changed?expected:null,expected);
  return {cooldownDays,version:changed.version};
}

function renameState(shop,cooldownDays) {
  return {name:shop.name,cooldownDays,
    nextRenameAt:shop.renamed_at===null||cooldownDays===0?null:shop.renamed_at+cooldownDays*dayMs};
}

export async function shopNameDetails(shop) {
  return renameState(shop,(await shopNameSettings()).cooldownDays);
}

export async function renameShop(actor,value) {
  ownerOnly(actor);
  const name=string(value,100,{required:true});
  return transaction(async()=>{
    const {cooldownDays}=await get('SELECT cooldown_days AS "cooldownDays" FROM shop_name_settings WHERE id=1 FOR SHARE');
    const now=Date.now();
    const shop=ensure(await get(`SELECT s.name,s.renamed_at FROM shops s JOIN shop_members m ON m.shop_id=s.id
      WHERE s.id=$1 AND s.owner_id=$2 AND s.status='ACTIVE' AND (s.expired_at IS NULL OR s.expired_at>$3)
        AND m.user_id=$2 AND m.role='OWNER' AND m.status='ACTIVE'
      FOR UPDATE OF s FOR SHARE OF m`,actor.currentShop.id,actor.id,now),403,'Bạn không có quyền đổi tên Shop này.');
    const current=renameState(shop,cooldownDays);
    if(shop.name===name)return current;
    const renamedAt=Date.now();
    ensure(current.nextRenameAt===null||current.nextRenameAt<=renamedAt,429,
      current.nextRenameAt===null?'Shop chưa thể đổi tên.':'Bạn có thể đổi tên Shop từ '+localDate.format(current.nextRenameAt)+' (giờ Việt Nam).');
    await run('UPDATE shops SET name=$2,renamed_at=$3 WHERE id=$1',actor.currentShop.id,name,renamedAt);
    return renameState({name,renamed_at:renamedAt},cooldownDays);
  });
}
