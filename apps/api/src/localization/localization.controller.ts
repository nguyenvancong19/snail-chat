import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { RoutePolicy, type AppRequest } from '../http/session.guard.js';
import { throttle } from '../db/store.mjs';
import { jsonBody } from '../http/wire.mjs';
import { displayTranslations } from './catalog.mjs';

@Controller('api/localization')
@RoutePolicy('session')
export class LocalizationController {
  @Post('display')
  @HttpCode(200)
  async display(@Req() request: AppRequest) {
    await throttle('display-locale:'+request.actor.id,120,60_000);
    const body=await jsonBody(request,4096);
    return displayTranslations(body.locale,body.keys,body.cachedOnly===true);
  }
}
