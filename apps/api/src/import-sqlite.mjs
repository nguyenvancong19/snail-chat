import { DatabaseSync } from 'node:sqlite';
import { copyFile, stat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { db, get, initializeDatabase, run, transaction } from './db/store.mjs';
import { backfillShops } from './db/migrations/001-shops.mjs';
import { mediaPath } from './media/paths.mjs';
import { ensure } from './http/validation.mjs';

const mappings = {
  users: ['id','name','email','password','role','active','email_verified_at'],
  channels: ['id','name','handle','platform','topic','voice','days','time','bot_mode','rules','meta_id','token','expires','webhook','owner_id'],
  access: ['user_id','channel_id'],
  videos: ['id','channel_id','title','filename','bytes','created'],
  posts: ['id','channel_id','video_id','title','caption','scheduled','status','bot_mode','rules','ai','error','remote_id','alias_id','permalink','step','upload_url','next_check','attempts','claim_until','uncertain'],
  comments: ['id','post_id','channel_id','remote_id','author','text','status','reply','automatic','created','bot_category'],
};
const copied = [];
let source;

function normalized(table, row) {
  if (table==='users') return {...row,email_verified_at:0};
  if (table==='videos') return {...row,created:row.legacy_position};
  if (table==='comments') return {...row,bot_category:row.bot_category??'',status:row.status==='sending'?'uncertain':row.status};
  if (table==='posts'&&row.status==='working') {
    return {...row,status:'failed',uncertain:1,claim_until:0,error:'Kiểm tra trạng thái bài này trên Meta trước khi đăng lại.'};
  }
  return row;
}

try {
  ensure(process.argv[2],400,'Cách dùng: npm run import:sqlite -- /duong-dan/reeldesk.sqlite [/duong-dan/videos]');
  const sourcePath=resolve(process.argv[2]);
  const sourceVideos=resolve(process.argv[3]??resolve(dirname(sourcePath),'videos'));
  source=new DatabaseSync(sourcePath,{readOnly:true});
  ensure(source.prepare("PRAGMA table_info(channels)").all().some(({name})=>name==='owner_id'),400,
    'Hãy nâng cấp bản SQLite sang phiên bản ReelDesk có owner_id trước khi nhập.');
  await initializeDatabase();
  const counts=await transaction(async()=>{
    const tables=Object.keys(mappings);
    await run('LOCK TABLE '+tables.join(',')+' IN ACCESS EXCLUSIVE MODE');
    for(const table of tables) {
      ensure(!await get('SELECT 1 FROM '+table+' LIMIT 1'),409,'PostgreSQL đích phải trống.');
    }
    const totals={};
    for(const [table,columns] of Object.entries(mappings)) {
      const select=table==='videos'?'SELECT *, rowid AS legacy_position FROM videos ORDER BY rowid':'SELECT * FROM '+table;
      const insert='INSERT INTO '+table+' ('+columns.join(',')+') VALUES ('+columns.map((_,i)=>'$'+(i+1)).join(',')+')';
      totals[table]=0;
      for(const value of source.prepare(select).iterate()) {
        const row=normalized(table,value);
        if(table==='videos') {
          ensure(/^[a-f0-9-]{36}$/.test(row.id),400,'ID tệp video không hợp lệ.');
          const input=resolve(sourceVideos,row.id+'.mp4'), output=mediaPath(row.id);
          const info=await stat(input);
          ensure(info.isFile()&&info.size===row.bytes,400,'Tệp MP4 thiếu hoặc sai kích thước: '+row.id);
          await copyFile(input,output,constants.COPYFILE_EXCL);
          copied.push(output);
        }
        await run(insert,...columns.map((column)=>row[column]??null));
        totals[table]++;
      }
    }
    await run("UPDATE users SET is_super_admin=TRUE WHERE role='admin'");
    await run(backfillShops);
    return totals;
  });
  console.log('Đã nhập dữ liệu:',JSON.stringify(counts));
} catch(error) {
  await Promise.allSettled(copied.map((file)=>unlink(file)));
  console.error('Nhập dữ liệu thất bại:',error.message);
  process.exitCode=1;
} finally {
  source?.close();
  await db.end();
}
