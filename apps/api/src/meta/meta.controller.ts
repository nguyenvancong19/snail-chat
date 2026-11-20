import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { access } from '../db/store.mjs';
import { RoutePolicy, type AppRequest } from '../http/session.guard.js';
import { AppError, choicesOf, ensure, string } from '../http/validation.mjs';
import { bytes, json, jsonBody, parse, redirect, send } from '../http/wire.mjs';
import {
  choosePages, oauthCallback, oauthStart, origin, pageChoices,
  signedWebhook, verifySubscription, webhookEvents,
} from './meta.mjs';

const platformOf = (id: string) => ensure(['fb', 'ig'].includes(id) && id, 404, 'Nền tảng không hợp lệ.');
const connectionError = (error: unknown) => error instanceof AppError
  ? error.message : 'Meta không thể hoàn tất kết nối. Vui lòng thử lại.';

@Controller('api/meta')
export class MetaController {
  @Get('start')
  async start(@Req() req: AppRequest, @Res() res: Response) {
    ensure(['same-origin', 'none'].includes(req.get('sec-fetch-site') ?? ''), 403, 'Nguồn yêu cầu không hợp lệ.');
    const params = new URL(req.originalUrl, origin).searchParams;
    const id = params.get('channel');
    const channel = id ? await access(req.actor, id) : null;
    const platform = channel?.platform ?? choicesOf(params.get('platform'), ['fb', 'ig']);
    try {
      return redirect(res, await oauthStart(req.actor, platform, channel));
    } catch (error) {
      return redirect(res, '/dashboard?meta=' + encodeURIComponent(connectionError(error)) + '#channels');
    }
  }

  @RoutePolicy('session')
  @Get('callback/:platform')
  async callback(@Req() req: AppRequest, @Res() res: Response, @Param('platform') id: string) {
    const platform = platformOf(id);
    try {
      return redirect(res, await oauthCallback(req.actor, platform, new URL(req.originalUrl, origin).searchParams));
    } catch (error) {
      return redirect(res, '/dashboard?meta=' + encodeURIComponent(connectionError(error)) + '#channels');
    }
  }

  @Get('choices')
  async choices(@Req() req: AppRequest, @Res() res: Response) {
    const flow = new URL(req.originalUrl, origin).searchParams.get('flow');
    const { row, options } = await pageChoices(req.actor, flow);
    return json(res, 200, { single: !!row.channel_id, options: options.map(({ id, name }) => ({ id, name: name || id })) });
  }

  @Post('choices')
  async choose(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req);
    const selected = body.pages ?? [body.page];
    ensure(Array.isArray(selected) && selected.length > 0 && selected.length <= 5, 400, 'Chọn từ 1 đến 5 Facebook Page mỗi lần.');
    const ids = [...new Set<string>(selected.map((value: unknown) => string(value, 50, { required: true })))];
    return json(res, 200, await choosePages(req.actor, string(body.flow, 50), ids));
  }

  @RoutePolicy('signed')
  @Get('webhook/:platform')
  verify(@Req() req: AppRequest, @Res() res: Response, @Param('platform') id: string) {
    return send(res, 200, verifySubscription(platformOf(id), new URL(req.originalUrl, origin).searchParams),
      { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  @RoutePolicy('signed')
  @Post('webhook/:platform')
  async webhook(@Req() req: AppRequest, @Res() res: Response, @Param('platform') id: string) {
    const platform = platformOf(id);
    const raw = await bytes(req, 1024 * 1024);
    signedWebhook(platform, raw, req.get('x-hub-signature-256'));
    // Meta can emit IDs as JSON integers larger than JavaScript's safe range.
    const body = parse(raw, (_key, value, context) =>
      typeof value === 'number' && !Number.isSafeInteger(value) && /^\d+$/.test(context?.source ?? '')
        ? context.source : value);
    await webhookEvents(platform, body);
    return send(res, 200, 'OK', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}
