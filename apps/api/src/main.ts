import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { db, initializeDatabase } from './db/store.mjs';
import { AppError } from './http/validation.mjs';
import { rateLimitPeer } from './http/rate-limit.mjs';
import { json, secure } from './http/wire.mjs';

async function main() {
  await initializeDatabase();
  // Keep Meta's exact signature payload available to the controllers.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.disable('x-powered-by');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    // Express trims the mount prefix from req.path.
    rateLimitPeer({path:'/api'+req.path,headers:req.headers,socket:req.socket}).then(()=>next()).catch(error=>{
      if(error instanceof AppError&&error.status===429){
        json(res,429,{error:error.message},{'Retry-After':String(error.retryAfter)});
      }else json(res,503,{error:'Chưa thể kiểm tra giới hạn yêu cầu. Thử lại sau.'});
    });
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 4000), process.env.BIND_HOST || '0.0.0.0');
}

main().catch(async (error) => {
  console.error('Unable to start SnailChat API:', error.message);
  await db.end().catch(() => {});
  process.exitCode = 1;
});
