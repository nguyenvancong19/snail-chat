import { workDetails, workOverview } from '../shops/work-activity.mjs';
import { pageNumber, pageSize } from '../db/pagination.mjs';
import { ownerOnly } from '../shops/tenant.mjs';
import { listAlertSounds, readAlertSound, resetAlertSound, soundKind, soundUploadLimit, toggleAlertSound, uploadAlertSound } from '../shops/alert-sounds.mjs';
import { requirePlanFeature } from '../billing/plan-features.mjs';
import { Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { openPageEvents } from '../shops/page-events.mjs';
import { access, get, throttle } from '../db/store.mjs';
import { channelAvatar, channelInsights, postContext, publishedPosts } from '../meta/meta.mjs';
import { RoutePolicy, type AppRequest } from '../http/session.guard.js';
import { choicesOf, ensure, string } from '../http/validation.mjs';
import { channelActivityChart } from './chart-data.mjs';
import { bytes, json, jsonBody, redirect, send } from '../http/wire.mjs';
import { resolveProductReview, reviewProducts } from './agent-product-review.mjs';
import { setCommentHandled, setConversationTakeover } from './inbox-workflow.mjs';
import { activity, bootstrap, commentInbox, commentThread, notifications, openNotification, readAllNotifications, saveChannel } from './workspace.service.mjs';

@Controller('api')
export class WorkspaceController {
  @RoutePolicy('signed')
  @Get('health')
  async health() {
    await get('SELECT 1');
    return { ok: true };
  }

  @RoutePolicy('open')
  @Get('bootstrap')
  async bootstrap(@Req() req: AppRequest, @Res() res: Response) {
    return json(res, 200, await bootstrap(req.actor, req.get('x-shop-id'), req.get('x-snailchat-account-list')==='paged'));
  }

  @Get('shop/work-activity')
  async workOverview(@Req() req: AppRequest, @Query('channel') channel?: string, @Query('days') days?: string) {
    return workOverview(req.actor,{channel:string(channel,50),days:Number(choicesOf(days??'7',['7','30']))});
  }

  @Get('shop/work-activity/details')
  async workDetails(@Req() req: AppRequest, @Query('channel') channel?: string, @Query('days') days?: string,
    @Query('person') person?: string, @Query('role') role?: string, @Query('page') page?: string) {
    return workDetails(req.actor,{channel:string(channel,50),days:Number(choicesOf(days??'7',['7','30'])),
      person:string(person,100,{required:true}),role:choicesOf(role,['OWNER','STAFF']),page:pageNumber(page)});
  }

  @Get('shop/alert-sounds')
  async alertSounds(@Req() req: AppRequest) {
    await requirePlanFeature(req.actor.currentShop.id, 'alertSounds');
    return { sounds: await listAlertSounds(req.actor.currentShop.id) };
  }

  @Get('shop/alert-sounds/:kind/file')
  async alertSound(@Req() req: AppRequest, @Param('kind') kind: string, @Res() res: Response) {
    await requirePlanFeature(req.actor.currentShop.id, 'alertSounds');
    const entry = ensure(await readAlertSound(req.actor.currentShop.id, soundKind(kind)), 404, 'Chưa có file âm báo.');
    ensure(entry.audio, 404, 'Chưa có file âm báo.');
    return send(res, 200, entry.audio, {
      'Content-Type': entry.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    });
  }

  @Post('shop/alert-sounds/:kind/file')
  async uploadSound(@Req() req: AppRequest, @Param('kind') kind: string, @Query('name') name: string) {
    ownerOnly(req.actor);
    await requirePlanFeature(req.actor.currentShop.id, 'alertSounds');
    const filename = string(name, 160, { required: true });
    await uploadAlertSound(req.actor.currentShop.id, soundKind(kind), await bytes(req, soundUploadLimit), filename);
    return { sounds: await listAlertSounds(req.actor.currentShop.id) };
  }

  @Delete('shop/alert-sounds/:kind/file')
  async resetSound(@Req() req: AppRequest, @Param('kind') kind: string) {
    ownerOnly(req.actor);
    await requirePlanFeature(req.actor.currentShop.id, 'alertSounds');
    await resetAlertSound(req.actor.currentShop.id, soundKind(kind));
    return { sounds: await listAlertSounds(req.actor.currentShop.id) };
  }

  @Patch('shop/alert-sounds/:kind')
  async toggleSound(@Req() req: AppRequest, @Param('kind') kind: string) {
    ownerOnly(req.actor);
    await requirePlanFeature(req.actor.currentShop.id, 'alertSounds');
    await toggleAlertSound(req.actor.currentShop.id, soundKind(kind), (await jsonBody(req)).enabled);
    return { sounds: await listAlertSounds(req.actor.currentShop.id) };
  }

  @RoutePolicy('session')
  @Get('events')
  async events(@Req() req: AppRequest, @Res() res: Response) {
    await openPageEvents(req, res);
  }

  @Get('activity')
  async activity(@Req() req: AppRequest, @Res() res: Response,
    @Query('kind') rawKind?: string, @Query('channel') rawChannel?: string,
    @Query('status') rawStatus?: string, @Query('before') rawBefore?: string,
    @Query('sender') rawSender?: string, @Query('threads') threads?: string) {
    const kind = choicesOf(rawKind ?? 'comment', ['comment', 'message']);
    const channel = string(rawChannel, 50);
    const status = string(rawStatus, 20);
    if (status) choicesOf(status, ['review', 'working', 'replied', 'uncertain', 'expired']);
    const cursor = string(rawBefore, 64);
    const match = cursor ? /^(\d{1,15}):([\da-f-]{36})$/.exec(cursor) : null;
    ensure(!cursor || match, 400, 'Vị trí phân trang không hợp lệ.');
    const before = match ? { created: Number(match[1]), id: match[2] } : null;
    const sender = string(rawSender, 40);
    ensure(!sender || (kind === 'message' && channel && /^\d+$/.test(sender)), 400, 'Cuộc trò chuyện không hợp lệ.');
    return json(res, 200, await activity(req.actor, { kind, channel, status, before, sender, threads: threads === '1' }));
  }

  @Get('comments/inbox')
  async commentsInbox(@Req() req: AppRequest, @Res() res: Response, @Query('channel') rawChannel: string,
    @Query('status') rawStatus: string, @Query('before') rawBefore: string) {
    const status = string(rawStatus,20);
    if(status) choicesOf(status,['review','handled','replied','working','uncertain']);
    const cursor = string(rawBefore,64);
    const match = cursor ? /^([01]):(-?\d{1,15}):([\da-f-]{36})$/.exec(cursor) : null;
    ensure(!cursor || match,400,'Vị trí phân trang không hợp lệ.');
    const before = match ? {priority:Number(match[1]),created:Number(match[2]),id:match[3]} : null;
    return json(res,200,await commentInbox(req.actor,{channel:string(rawChannel,50),status,before}));
  }

  @Patch('comments/:id/handled')
  async handleComment(@Req() req: AppRequest, @Param('id') id: string, @Res() res: Response) {
    const body=await jsonBody(req,1024);
    return json(res,200,await setCommentHandled(req.actor,string(id,50,{required:true}),body.handled));
  }

  @Get('messages/:id/product-review')
  async reviewProducts(@Req() req: AppRequest, @Param('id') id: string, @Res() res: Response) {
    return json(res,200,await reviewProducts(req.actor,string(id,50,{required:true})));
  }

  @Patch('messages/:id/product-review')
  async resolveProductReview(@Req() req: AppRequest, @Param('id') id: string, @Res() res: Response) {
    return json(res,200,await resolveProductReview(req.actor,string(id,50,{required:true}),await jsonBody(req,8192)));
  }

  @Patch('messenger/takeover')
  async takeover(@Req() req: AppRequest, @Res() res: Response) {
    return json(res,200,await setConversationTakeover(req.actor,await jsonBody(req,2048)));
  }

  @Get('notifications')
  async notifications(@Req() req: AppRequest, @Res() res: Response, @Query('offset') rawOffset: string, @Query('filter') rawFilter: string, @Query('limit') rawLimit?: string) {
    const offset=string(rawOffset,8);
    const filter=choicesOf(rawFilter??'all',['all','unread']);
    ensure(!offset || /^\d+$/.test(offset),400,'Vị trí phân trang không hợp lệ.');
    const size=rawLimit===undefined?pageSize:Number(rawLimit);
    ensure(rawLimit===undefined||/^\d{1,2}$/.test(rawLimit)&&size<=pageSize,400,'Kích thước trang không hợp lệ.');
    return json(res,200,await notifications(req.actor,Number(offset),filter==='unread',size));
  }

  @Post('notifications/read-all')
  async readAllNotifications(@Req() req: AppRequest, @Res() res: Response) {
    return json(res,200,await readAllNotifications(req.actor));
  }

  @Post('notifications/open')
  async openNotification(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req);
    return json(res,200,await openNotification(req.actor,choicesOf(body.kind,['comment','message']),string(body.id,50,{required:true})));
  }

  @Get('channel-avatar')
  async avatar(@Req() req: AppRequest, @Query('channel') id: string, @Res() res: Response) {
    const channel = await access(req.actor, string(id, 50, { required: true }), 'ANY');
    const url = ensure(await channelAvatar(channel), 404, 'Kênh chưa có ảnh đại diện.');
    return redirect(res, url);
  }

  @Get('comments/thread')
  async commentThread(@Req() req: AppRequest, @Query('comment') id: string, @Res() res: Response, @Query('offset') rawOffset: string) {
    const offset=string(rawOffset,8);
    ensure(!offset || /^\d+$/.test(offset),400,'Vị trí phân trang không hợp lệ.');
    return json(res, 200, await commentThread(req.actor, string(id, 50, { required: true }),Number(offset)));
  }

  @Get('post-context')
  async post(@Req() req: AppRequest, @Res() res: Response, @Query('channel') id: string, @Query('media') value: string) {
    await requirePlanFeature(req.actor.currentShop.id,'comments');
    const channel = await access(req.actor, string(id, 50, { required: true }), 'chat:read');
    const media = string(value, 100, { required: true });
    ensure(await get(`SELECT 1 FROM comments m LEFT JOIN posts p ON p.id=m.post_id
      WHERE m.channel_id=$1 AND COALESCE(m.media_id,p.alias_id,p.remote_id)=$2 LIMIT 1`,channel.id,media),
      404, 'Bài đăng chưa có bình luận trong SnailChat.');
    return json(res, 200, { post: await postContext(channel, media) });
  }

  @Post('channels')
  async channels(@Req() req: AppRequest, @Res() res: Response) {
    await saveChannel(req.actor, await jsonBody(req));
    return json(res, 200, { ok: true });
  }

  @Get('published-posts')
  async published(@Req() req: AppRequest, @Res() res: Response,
    @Query('channel') rawId: string, @Query('after') rawAfter?: string) {
    const channel = await access(req.actor, string(rawId, 50, { required: true }));
    const after = string(rawAfter, 2048);
    await throttle('published-posts:' + req.actor.id, 40, 5 * 60_000);
    return json(res, 200, await publishedPosts(channel, after));
  }

  @Get('channel-activity-chart')
  async activityChart(@Req() req: AppRequest, @Res() res: Response,
    @Query('channel') id: string, @Query('days') days?: string) {
    const length = choicesOf(days ?? '7', ['7', '30']);
    return json(res, 200, {items: await channelActivityChart(req.actor, string(id, 50, {required:true}), Number(length))});
  }

  @Get('insights')
  async insights(@Req() req: AppRequest, @Query('channel') id: string, @Res() res: Response) {
    const channel = await access(req.actor, typeof id === 'string' ? id : '');
    await throttle('insights:' + req.actor.id, 30, 15 * 60_000);
    return json(res, 200, await channelInsights(channel));
  }
}
