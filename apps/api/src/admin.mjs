import { db, get, initializeDatabase, run, transaction, uid } from './db/store.mjs';
import { hashPassword } from './auth/crypto.mjs';
import { emailOf, ensure } from './http/validation.mjs';

try {
  const email = emailOf(process.argv[2]);
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const password = await hashPassword(Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, ''));
  await initializeDatabase();
  await transaction(async () => {
    await run('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    ensure(!await get("SELECT 1 FROM users WHERE is_super_admin"), 409,
      'Đã có Admin. Hãy quản lý tài khoản trong bảng quản trị.');
    await run("INSERT INTO users (id,name,email,password,role,active,email_verified_at,is_super_admin) VALUES ($1,$2,$3,$4,'admin',1,0,TRUE)",
      uid(), 'Quản trị viên', email, password);
  });
  console.log('Đã tạo Admin SnailChat.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
