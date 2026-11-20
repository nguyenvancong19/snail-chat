import { checkVersion, requestVersion } from '../http/versions.mjs';
import { pageNumber, readPage } from '../db/pagination.mjs';
import { Controller, Delete, Get, Param, Query, Patch, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { get, run } from '../db/store.mjs';
import { RoutePolicy, type AppRequest } from '../http/session.guard.js';
import { choicesOf, ensure, string } from '../http/validation.mjs';
import { json, jsonBody } from '../http/wire.mjs';
import { acceptInvitation, changeMember, inviteMember, listMembers, pendingInvitations, removeMember } from './members.mjs';

import { subscriptionPlans } from '../billing/subscriptions.mjs';
import { renameShop, setShopNameSettings, shopNameSettings } from './names.mjs';
import { createPersonalShop, rememberShop } from './tenant.mjs';

@Controller('api')
export class ShopsController {
  @RoutePolicy('session')
  @Post('shop')
  async create(@Req() req: AppRequest) {
    const body=await jsonBody(req,4096);
    return createPersonalShop(req.actor,string(body.name,100,{required:true}));
  }

  @RoutePolicy('session')
  @Post('shop/preference')
  async preference(@Req() req: AppRequest) {
    const body=await jsonBody(req,4096);
    return rememberShop(req.actor,string(body.shop,100,{required:true}));
  }

  @Patch('shop/name')
  async rename(@Req() req: AppRequest) {
    return renameShop(req.actor,(await jsonBody(req,4096)).name);
  }

  @RoutePolicy('admin')
  @Patch('admin/shops/rename-settings')
  async renameSettings(@Req() req: AppRequest) {
    return setShopNameSettings((await jsonBody(req,4096)).cooldownDays,requestVersion(req));
  }

  @Get('shop/members')
  async members(@Req() req: AppRequest) {
    return { items: await listMembers(req.actor) };
  }

  @Post('shop/members')
  async invite(@Req() req: AppRequest, @Res() res: Response) {
    return json(res, 201, await inviteMember(req.actor, await jsonBody(req)));
  }

  @Patch('shop/members/:id')
  async change(@Req() req: AppRequest, @Param('id') id: string) {
    await changeMember(req.actor, string(id, 100, { required: true }), await jsonBody(req));
    return { ok: true };
  }

  @Delete('shop/members/:id')
  async remove(@Req() req: AppRequest, @Param('id') id: string) {
    await removeMember(req.actor, string(id, 100, { required: true }));
    return { ok: true };
  }

  @RoutePolicy('session')
  @Get('shop/invitations')
  async invitations(@Req() req: AppRequest) {
    return { items: await pendingInvitations(req.actor) };
  }

  @RoutePolicy('session')
  @Post('shop/invitations/:id/accept')
  async accept(@Req() req: AppRequest, @Param('id') id: string, @Res() res: Response) {
    return json(res, 200, await acceptInvitation(req.actor, string(id, 100, { required: true })));
  }

  @RoutePolicy('admin')
  @Get('admin/shops')
  async shops(@Query('page') page?: string, @Query('q') query?: string) {
    const list = await readPage(`SELECT s.id,s.name,s.status,s.version,s.expired_at AS "expiredAt",
      s.subscription_plan AS "subscriptionPlan",u.email AS "ownerEmail",s.created_at,
      (SELECT COUNT(*) FROM channels c WHERE c.shop_id=s.id) AS "pageCount",
      (SELECT COUNT(*) FROM shop_members m WHERE m.shop_id=s.id AND m.role='STAFF' AND m.status='ACTIVE') AS "staffCount"
      FROM shops s JOIN users u ON u.id=s.owner_id
      WHERE strpos(lower(s.name||' '||u.email),lower($1))>0 OR $1=''`,
      'created_at DESC,id DESC',[string(query,150)],pageNumber(page));
    const totals=await get(`SELECT (SELECT count(*) FROM shops) AS shops,
      (SELECT count(*) FROM channels WHERE shop_id IS NOT NULL) AS pages`);
    const messages = await get(`SELECT (SELECT COUNT(*) FROM inbox_messages m JOIN channels c ON c.id=m.channel_id WHERE c.shop_id IS NOT NULL)
      +(SELECT COUNT(*) FROM messenger_page_messages m JOIN channels c ON c.id=m.channel_id WHERE c.shop_id IS NOT NULL) AS total`);
    return { plans:await subscriptionPlans({includeArchived:true}), rename:await shopNameSettings(), shops:list.items, shopsPage:{total:list.total,page:list.page}, totals:{...totals,messages:messages.total} };
  }

  @RoutePolicy('admin')
  @Patch('admin/shops/:id/status')
  async status(@Req() req: AppRequest, @Param('id') id: string) {
    const body = await jsonBody(req, 4096);
    const status = choicesOf(body.status, ['ACTIVE', 'SUSPENDED']);
    const expected=requestVersion(req);
    const result = await get('UPDATE shops SET status=$1 WHERE id=$2 AND version=$3 RETURNING version',
      status, string(id, 100, { required: true }),expected);
    checkVersion(result?expected:null,expected);
    return { ok: true, status,version:result.version };
  }
}
