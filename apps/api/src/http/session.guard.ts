import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { authenticate, ownOrigin } from './wire.mjs';
import { requireShop, userShops } from '../shops/tenant.mjs';
import { rateLimitActor, rateLimitShop } from './rate-limit.mjs';
import { ensure } from './validation.mjs';

type Policy = 'user' | 'admin' | 'session' | 'open' | 'signed';
type Shop = { id: string; role: 'OWNER' | 'STAFF'; status: string; expiredAt: number | null };
type Actor = { id: string; role: 'admin' | 'user'; session_id: string; is_super_admin: boolean;
  email: string; access_expires?: number; preferred_shop_id?: string | null; currentShop?: Shop; memberRole?: Shop['role'] };
export type AppRequest = Request & { actor?: Actor };
const policyKey = 'reeldesk.route.policy';
export const RoutePolicy = (policy: Policy) => SetMetadata(policyKey, policy);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const policy = this.reflector.getAllAndOverride<Policy>(policyKey, [
      context.getHandler(), context.getClass(),
    ]) ?? 'user';
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (policy === 'signed') return true;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) ownOrigin(request);
    const actor = await authenticate(request);
    request.actor = actor;
    await rateLimitActor(request,actor);
    if (policy === 'open') return true;
    ensure(actor, 401, 'Vui lòng đăng nhập.');
    if (policy === 'session') return true;
    if (policy === 'admin') {
      ensure(actor.is_super_admin === true, 403, 'Chỉ Super Admin có quyền thực hiện thao tác này.');
      return true;
    }
    await new ShopTenantGuard().authorize(request);
    await rateLimitShop(request,request.actor.currentShop.id);
    return true;
  }
}

export class ShopTenantGuard {
  async authorize(request: AppRequest) {
    const queryAllowed = ['/api/meta/start', '/api/channel-avatar', '/api/events'].includes(request.path);
    const requested = request.get('x-shop-id') ?? (queryAllowed ? request.query.shop : undefined);
    const shops = requested === undefined ? await userShops(request.actor.id) : [];
    request.actor = await requireShop(request.actor, requested ?? (shops.length === 1 ? shops[0].id : undefined));
    return true;
  }
}
