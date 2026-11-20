import { origin } from '../meta/meta.mjs';
import { rotateRefresh } from './session.mjs';
import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RoutePolicy, type AppRequest } from '../http/session.guard.js';
import { ensure, publicUser } from '../http/validation.mjs';
import { authCookies, bytes, json, jsonBody, readCookie, refreshCookie, send } from '../http/wire.mjs';
import { login, register, requestPasswordReset, resetPassword, resendVerification, updateProfile } from './auth.service.mjs';
import { listBrowserAccounts, logoutBrowserAccount, removeBrowserAccount, switchBrowserAccount } from './browser-accounts.mjs';
import { verifyEmail } from './email-verification.mjs';

import { avatarUploadLimit, readAvatar, updateAvatar } from './avatar.mjs';

@Controller('api')
export class AuthController {
  @RoutePolicy('open')
  @Get('session')
  session(@Req() req: AppRequest, @Res() res: Response) {
    return json(res, 200, { user: req.actor ? publicUser(req.actor) : null, accessExpiresAt:req.actor?.access_expires??null });
  }

  @RoutePolicy('open')
  @Post('session/refresh')
  async refresh(@Req() req: AppRequest, @Res() res: Response) {
    const session=await rotateRefresh(readCookie(req,refreshCookie),origin);
    if(!session)return json(res,401,{error:'Phiên đã hết hạn. Hãy đăng nhập lại.'},{'Set-Cookie':authCookies(null)});
    return json(res,200,{ok:true},{'Set-Cookie':authCookies(session)});
  }

  @RoutePolicy('open')
  @Post('login')
  async login(@Req() req: AppRequest, @Res() res: Response) {
    return login(req, res, await jsonBody(req, 8192));
  }

  @RoutePolicy('open')
  @Post('register')
  async register(@Req() req: AppRequest, @Res() res: Response) {
    ensure(!req.actor, 409, 'Đăng xuất trước khi đăng ký tài khoản mới.');
    return register(req, res, await jsonBody(req, 8192));
  }

  @RoutePolicy('open')
  @Post('verify-email')
  async verify(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req, 4096);
    await verifyEmail(body.token);
    return json(res, 200, { ok: true });
  }

  @RoutePolicy('open')
  @Post('resend-verification')
  async resend(@Req() req: AppRequest, @Res() res: Response) {
    return resendVerification(req, res, await jsonBody(req, 4096));
  }

  @RoutePolicy('open')
  @Post('forgot-password')
  async forgotPassword(@Req() req: AppRequest, @Res() res: Response) {
    return requestPasswordReset(req, res, await jsonBody(req, 4096));
  }

  @RoutePolicy('open')
  @Post('reset-password')
  async resetPassword(@Req() req: AppRequest, @Res() res: Response) {
    await resetPassword(req, await jsonBody(req, 4096));
    return json(res, 200, { ok: true });
  }

  @RoutePolicy('session')
  @Post('logout')
  logout(@Req() req: AppRequest, @Res() res: Response) {
    return logoutBrowserAccount(req, res);
  }
  @RoutePolicy('session')
  @Get('browser-accounts')
  async accounts(@Req() req: AppRequest, @Res() res: Response) {
    return json(res, 200, { accounts: await listBrowserAccounts(req) });
  }

  @RoutePolicy('session')
  @Post('browser-accounts/switch')
  async switchAccount(@Req() req: AppRequest, @Res() res: Response) {
    return switchBrowserAccount(req, res, (await jsonBody(req, 4096)).id);
  }

  @RoutePolicy('session')
  @Post('browser-accounts/remove')
  async removeAccount(@Req() req: AppRequest, @Res() res: Response) {
    return removeBrowserAccount(req, res, (await jsonBody(req, 4096)).id);
  }

  @RoutePolicy('session')
  @Get('profile/avatar')
  async avatar(@Req() req: AppRequest, @Res() res: Response) {
    const avatar=await readAvatar(req.actor);
    return avatar?send(res,200,avatar.image,{'Content-Type':'image/webp','Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff'}):send(res,404);
  }

  @RoutePolicy('session')
  @Post('profile/avatar')
  async uploadAvatar(@Req() req: AppRequest, @Res() res: Response) {
    await updateAvatar(req.actor,await bytes(req,avatarUploadLimit),req.get('content-type'));
    return json(res,200,{ok:true});
  }

  @RoutePolicy('session')
  @Post('profile')
  async profile(@Req() req: AppRequest, @Res() res: Response) {
    await updateProfile(req.actor, await jsonBody(req, 4096));
    return json(res, 200, { ok: true });
  }

}
