import { all, get, run } from '../db/store.mjs';
import { choicesOf, ensure } from '../http/validation.mjs';

export const soundUploadLimit=5*1024*1024;
const kinds=['order','product','customer'];
export const soundKind=(kind)=>choicesOf(kind,kinds);

export async function listAlertSounds(shopId) {
  const rows=await all('SELECT kind,enabled,filename FROM shop_alert_sounds WHERE shop_id=$1',shopId);
  return Object.fromEntries(kinds.map(kind=>{
    const row=rows.find(item=>item.kind===kind);
    return [kind,{enabled:row?.enabled??true,filename:row?.filename??null}];
  }));
}

export function readAlertSound(shopId,kind) {
  return get('SELECT audio,mime FROM shop_alert_sounds WHERE shop_id=$1 AND kind=$2',shopId,kind);
}

export async function uploadAlertSound(shopId,kind,audio,filename) {
  const wav=audio.length>=44&&audio.toString('ascii',0,4)==='RIFF'&&audio.toString('ascii',8,12)==='WAVE';
  const mp3=audio.length>=4&&(audio.toString('ascii',0,3)==='ID3'||(audio[0]===255&&(audio[1]&224)===224&&(audio[1]&6)===2));
  ensure(wav||mp3,400,'Chỉ hỗ trợ file MP3 hoặc WAV hợp lệ.');
  const mime=wav?'audio/wav':'audio/mpeg';
  await run(`INSERT INTO shop_alert_sounds(shop_id,kind,filename,mime,audio) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(shop_id,kind) DO UPDATE SET filename=excluded.filename,mime=excluded.mime,audio=excluded.audio`,
    shopId,kind,filename,mime,audio);
}

export async function toggleAlertSound(shopId,kind,enabled) {
  ensure(typeof enabled==='boolean',400,'Trạng thái âm báo không hợp lệ.');
  await run(`INSERT INTO shop_alert_sounds(shop_id,kind,enabled) VALUES($1,$2,$3)
    ON CONFLICT(shop_id,kind) DO UPDATE SET enabled=excluded.enabled`,shopId,kind,enabled);
}

export async function resetAlertSound(shopId,kind) {
  await run('UPDATE shop_alert_sounds SET filename=NULL,mime=NULL,audio=NULL WHERE shop_id=$1 AND kind=$2',shopId,kind);
}
