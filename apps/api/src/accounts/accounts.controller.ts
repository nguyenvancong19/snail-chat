import { requestVersion } from '../http/versions.mjs';
import { pageNumber, readPage } from '../db/pagination.mjs';
import { get, run } from '../db/store.mjs';
import { choicesOf, ensure, publicUser, string } from '../http/validation.mjs';
import { Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RoutePolicy, type AppRequest } from '../http/session.guard.js';
import { json, jsonBody } from '../http/wire.mjs';
import { setUserActive } from './accounts.service.mjs';

@RoutePolicy('admin')
@Controller('api/users')
export class AccountsController {
  @Get()
  async users(@Query('page') page?: string, @Query('q') query?: string) {
    const result=await readPage(`SELECT u.id,u.name,u.email,u.role,u.active,u.version,u.email_verified_at,u.is_super_admin,
      COALESCE(u.created_at,NULLIF(u.email_verified_at,0)) AS created_at,
      (SELECT count(*) FROM channels c JOIN shops s ON s.id=c.shop_id WHERE s.owner_id=u.id
        AND c.token IS NOT NULL AND (c.expires IS NULL OR c.expires>$1)) AS connected
      FROM users u WHERE strpos(lower(u.name||' '||u.email),lower($2))>0 OR $2=''`,
      'created_at DESC NULLS LAST,id DESC',[Date.now(),string(query,150)],pageNumber(page));
    return {...result,items:result.items.map(u=>({...publicUser(u),connectedChannels:u.connected,version:u.version})),
      accounts:(await get('SELECT count(*) AS total FROM users')).total};
  }

  @Patch(':id/status')
  async setStatus(@Param('id') id: string, @Req() req: AppRequest, @Res() res: Response) {
    await setUserActive(req.actor, id, await jsonBody(req),requestVersion(req));
    return json(res, 200, { ok: true });
  }
}


@RoutePolicy('session')
@Controller('api/account/theme')
export class ThemeController {
  @Post()
  async save(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req);
    const mode=choicesOf(body.mode,['light','dark','system']);
    const validColor=(value: unknown, required=false)=>{
      const color=string(value,7,{required});
      return ensure(!color||/^#[a-f0-9]{6}$/i.test(color),400,'Màu cần có dạng #RRGGBB.')&&color.toLowerCase();
    };
    const palette=(value: {background?: unknown; accent?: unknown})=>{
      ensure(value&&typeof value==='object'&&!Array.isArray(value),400,'Bảng màu không hợp lệ.');
      return {background:validColor(value.background,true),accent:validColor(value.accent,true)};
    };
    const locale=body.locale===undefined?undefined:choicesOf(body.locale,['vi','en','ko','ja','zh','th','lo']);
    const prior=(await get('SELECT ui_theme FROM users WHERE id=$1',req.actor.id))?.ui_theme??{};
    const {background:_background,accent:_accent,...previous}=prior;
    const theme=body.light!==undefined||body.dark!==undefined
      ?{mode,locale:locale??prior.locale??'vi',light:palette(body.light),dark:palette(body.dark)}
      :{...previous,mode,locale:locale??prior.locale??'vi',
        ...(prior.mode==='light'||prior.mode==='dark'
          ?{[prior.mode]:prior[prior.mode]??{background:_background,accent:_accent}}:{})};
    if(body.light===undefined&&body.dark===undefined){
      ensure(mode!=='system',400,'Chế độ theo thiết bị cần cả bảng màu sáng và tối.');
      Object.assign(theme,{[mode]:{background:validColor(body.background),accent:validColor(body.accent)}});
    }
    await run('UPDATE users SET ui_theme=$2 WHERE id=$1',req.actor.id,JSON.stringify(theme));
    return json(res,200,{ok:true});
  }
}
