import { requestVersion } from '../http/versions.mjs';
import { pageNumber } from '../db/pagination.mjs';
import { Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RoutePolicy, type AppRequest } from '../http/session.guard.js';
import { ensure, string } from '../http/validation.mjs';
import { userShops, workspaceShop } from '../shops/tenant.mjs';
import { bytes, json, jsonBody, parse } from '../http/wire.mjs';
import { verifySePay } from './sepay.mjs';
import { adminPaymentHistory, adminRevenueChart, archivePlan, billingOrder, billingOverview, checkoutQuote, createPlan, processTransfer, startCheckout,
  setShopSubscription, subscriptionPlans, updatePlan } from './subscriptions.mjs';

import { billingPolicy, updateBillingPolicy } from './plan-changes.mjs';
import { billingResources, setBillingResources } from './resources.mjs';
import { resetAllowance } from '../ai/usage-quota.mjs';
import { ownedShop } from './subscriptions.mjs';
import { adminTopups, saveTopupSettings, startTopup, topupOrder, topupSettings, walletOverview } from './token-topups.mjs';

async function billingScope(req: AppRequest, value: unknown) {
  const target = string(value, 100, { required: true });
  const selected = req.get('x-shop-id');
  if (selected === undefined) {
    const current = workspaceShop(await userShops(req.actor.id), req.actor.preferred_shop_id);
    ensure(!current || (current.role === 'OWNER' && current.id === target), 403, 'Chuyển về Shop của bạn để sử dụng chức năng này.');
  } else {
    ensure(selected === target, 403, 'Chuyển về Shop của bạn để sử dụng chức năng này.');
  }
  return target;
}

@Controller('api')
export class BillingController {
  @RoutePolicy('session')
  @Get('billing/token-wallet')
  async tokenWallet(@Req() req: AppRequest, @Query('shop') shop: string, @Query('page') page?: string) {
    return walletOverview(req.actor,await billingScope(req,shop),pageNumber(page));
  }

  @RoutePolicy('session')
  @Post('billing/token-wallet/reset')
  async resetTokens(@Req() req: AppRequest) {
    const body=await jsonBody(req,4096);
    const shop=await ownedShop(req.actor,await billingScope(req,body.shop));
    return resetAllowance(shop.id);
  }

  @RoutePolicy('session')
  @Post('billing/token-wallet/orders')
  async buyTokens(@Req() req: AppRequest) {
    const body=await jsonBody(req,4096);
    return startTopup(req.actor,await billingScope(req,body.shop),requestVersion(req));
  }

  @RoutePolicy('session')
  @Get('billing/token-wallet/orders/:id')
  async tokenOrder(@Req() req: AppRequest, @Query('shop') shop: string, @Param('id') id: string) {
    return topupOrder(req.actor,await billingScope(req,shop),string(id,40,{required:true}));
  }

  @RoutePolicy('admin')
  @Get('admin/billing/token-wallet')
  async adminTokenWallet(@Query('page') page?: string) {
    const [settings,orders]=await Promise.all([topupSettings(),adminTopups(pageNumber(page))]);
    return {settings,orders:orders.items,orderPage:{page:orders.page,total:orders.total}};
  }

  @RoutePolicy('admin')
  @Patch('admin/billing/token-wallet')
  async configureTokens(@Req() req: AppRequest) {
    await saveTopupSettings(await jsonBody(req,4096),requestVersion(req));
    return {ok:true};
  }

  @RoutePolicy('session')
  @Get('billing')
  async overview(@Req() req: AppRequest, @Query('shop') shop: string, @Query('page') page?: string) {
    return billingOverview(req.actor, await billingScope(req, shop), pageNumber(page));
  }

  @RoutePolicy('session')
  @Get('billing/resources')
  async resources(@Req() req: AppRequest, @Query('shop') shop: string) {
    return billingResources(req.actor, await billingScope(req, shop));
  }

  @RoutePolicy('session')
  @Patch('billing/resources')
  async saveResources(@Req() req: AppRequest) {
    const body = await jsonBody(req, 131072);
    return setBillingResources(req.actor, await billingScope(req, body.shop), body);
  }

  @RoutePolicy('admin')
  @Patch('admin/shops/:id/subscription')
  async changeShopSubscription(@Req() req: AppRequest, @Param('id') id: string) {
    return setShopSubscription(req.actor, string(id, 100, { required: true }), await jsonBody(req, 4096), requestVersion(req));
  }

  @RoutePolicy('session')
  @Post('billing/quote')
  async quote(@Req() req: AppRequest) {
    const body = await jsonBody(req, 4096);
    return checkoutQuote(req.actor, await billingScope(req, body.shop), body.plan, body.selection);
  }

  @RoutePolicy('session')
  @Post('billing/orders')
  async checkout(@Req() req: AppRequest) {
    const body = await jsonBody(req, 4096);
    return startCheckout(req.actor, await billingScope(req, body.shop), body.plan, body.expectedPrice, body.expectedEndsAt, body.selection);
  }

  @RoutePolicy('session')
  @Get('billing/orders/:id')
  async order(@Req() req: AppRequest, @Param('id') id: string, @Query('shop') shop: string) {
    return billingOrder(req.actor, await billingScope(req, shop), string(id, 40, { required: true }));
  }

  @RoutePolicy('admin')
  @Get('admin/billing')
  async adminOverview(@Query('page') page?: string) {
    const [plans,orders,policy,revenue] = await Promise.all([
      subscriptionPlans({includeArchived:true}), adminPaymentHistory(pageNumber(page)), billingPolicy(), adminRevenueChart(),
    ]);
    return {plans,orders:orders.items,ordersPage:{page:orders.page,total:orders.total},policy,revenue};
  }

  @RoutePolicy('admin')
  @Patch('admin/billing/policy')
  async policy(@Req() req: AppRequest) {
    await updateBillingPolicy(await jsonBody(req,4096),requestVersion(req));
    return {ok:true};
  }

  @RoutePolicy('admin')
  @Patch('admin/billing/plans/:code')
  async configure(@Req() req: AppRequest, @Param('code') code: string) {
    await updatePlan(code, await jsonBody(req, 32768),requestVersion(req));
    return { ok: true };
  }

  @RoutePolicy('admin')
  @Post('admin/billing/plans')
  async addPlan(@Req() req: AppRequest) {
    return createPlan(await jsonBody(req, 32768));
  }

  @RoutePolicy('admin')
  @Delete('admin/billing/plans/:code')
  async removePlan(@Req() req: AppRequest, @Param('code') code: string) {
    await archivePlan(code,requestVersion(req));
    return { ok: true };
  }

  @RoutePolicy('signed')
  @Post('billing/sepay/webhook')
  async payment(@Req() req: AppRequest, @Res() res: Response) {
    const raw = await bytes(req, 65536);
    verifySePay(raw, req.get('x-sepay-timestamp'), req.get('x-sepay-signature'));
    await processTransfer(parse(raw));
    return json(res, 200, { success: true });
  }
}
