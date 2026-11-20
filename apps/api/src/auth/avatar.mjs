import sharp from 'sharp';
import { get, run, throttle, transaction, uid } from '../db/store.mjs';
import { AppError, ensure } from '../http/validation.mjs';

export const avatarUploadLimit=2*1024*1024;
const acceptedFormats={ 'image/jpeg':'jpeg', 'image/png':'png', 'image/webp':'webp' };

export async function updateAvatar(user,body,type) {
  const format=acceptedFormats[type];
  ensure(format,415,'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.');
  await throttle('avatar:'+user.id,12,60_000);
  let image;
  try {
    const input=sharp(body,{limitInputPixels:16_000_000,failOn:'error'});
    const metadata=await input.metadata();
    if(metadata.format!==format||metadata.pages>1)throw new Error('Invalid avatar');
    image=await input.rotate().resize(256,256,{fit:'cover',withoutEnlargement:true}).webp({quality:85}).toBuffer();
  } catch {
    throw new AppError(422,'Ảnh không hợp lệ. Dùng ảnh tĩnh JPG, PNG hoặc WebP tối đa 16 megapixel.');
  }
  await transaction(async()=>{
    await run('UPDATE users SET avatar_version=$2 WHERE id=$1',user.id,uid());
    await run(`INSERT INTO user_avatars(user_id,image) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET image=EXCLUDED.image`,user.id,image);
  });
}

export function readAvatar(user) {
  return get('SELECT image FROM user_avatars WHERE user_id=$1',user.id);
}
