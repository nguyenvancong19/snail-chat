import { agentDocument, agentDocuments, changeAgentDocuments } from '../ai/agent-documents.mjs';
import { requireAgentFeature, requireOrderFeature, requirePlanFeature, shopFeatures, withoutFaqs } from '../billing/plan-features.mjs';
import { isDeepStrictEqual } from 'node:util';
import { acknowledgementTemplates, editableBotPolicy, validateBotPolicy, validateCommentPolicy } from '@reeldesk/bot-rules';
import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { access, all, get, run, throttle, transaction } from '../db/store.mjs';
import { AppError, choicesOf, ensure, string } from '../http/validation.mjs';
import { type AppRequest } from '../http/session.guard.js';
import { bytes, json, jsonBody } from '../http/wire.mjs';
import { checkFacebookComments, messengerEnabled, postBot, postKey, queueReply, sendFacebookPrivateReply } from '../meta/meta.mjs';
import { messengerUpload, messengerUploadLimit } from '../meta/messenger-media.mjs';

function facebookMediaId(channel: { platform: string; meta_id?: string }, media: string) {
  const mediaId = postKey(channel, media);
  return ensure(channel.platform === 'fb' && channel.meta_id && /^\d+$/.test(mediaId) && mediaId,
    400, 'Chọn bài Facebook thuộc Page này để đồng bộ bình luận.');
}

async function setCommentWatch(channelId: string, mediaId: string, enabled: boolean) {
  if (enabled) {
    await run(`INSERT INTO facebook_comment_sync(channel_id,media_id,enabled_at) VALUES($1,$2,$3)
      ON CONFLICT(channel_id,media_id) DO NOTHING`, channelId, mediaId, Date.now());
  } else {
    await run('DELETE FROM facebook_comment_sync WHERE channel_id=$1 AND media_id=$2', channelId, mediaId);
  }
}

function policyFor(mode: string, value: unknown) {
  try {
    if (['auto', 'review', 'rules'].includes(mode) && (value as {version?: number})?.version === 2)
      return JSON.stringify(validateBotPolicy(value));
    if (mode === 'rules') return JSON.stringify(validateBotPolicy(value));
    return mode === 'auto' ? JSON.stringify(validateCommentPolicy(value)) : null;
  }
  catch (error) { throw new AppError(400, error.message); }
}

async function listTemplates(channel: string) {
  const rows = await all('SELECT command,text,image_name FROM messenger_templates WHERE channel_id=$1 ORDER BY created_at DESC NULLS LAST,command', channel);
  return rows.map(({command,text,image_name}) => ({command,text,...(image_name ? {imageName:image_name} : {})}));
}

@Controller('api')
export class EngagementController {
  @Get('messenger/templates')
  async messengerTemplates(@Req() req: AppRequest, @Res() res: Response, @Query('channel') id: string) {
    await requirePlanFeature(req.actor.currentShop.id,'quickReplies');
    const channel = await access(req.actor, string(id, 50, { required: true }), 'chat:read');
    ensure(channel.platform === 'fb', 400, 'Hãy chọn Facebook Page.');
    return json(res, 200, { items: await listTemplates(channel.id) });
  }

  @Post('messenger/templates')
  async saveMessengerTemplate(@Req() req: AppRequest, @Res() res: Response) {
    await requirePlanFeature(req.actor.currentShop.id,'quickReplies');
    const contentType = req.get('content-type') ?? '';
    let body, image;
    if (contentType.toLowerCase().startsWith('multipart/form-data;')) {
      await throttle('messenger-template-image:' + req.actor.id, 12, 60_000);
      const data = await bytes(req, 8 * 1024 * 1024 + 32_768);
      let form;
      try { form = await new Response(data, {headers:{'content-type':contentType}}).formData(); }
      catch { throw new AppError(400, 'Dữ liệu ảnh không hợp lệ.'); }
      ensure(form.getAll('attachment').length === 1 && form.get('attachment') instanceof File, 400, 'Chọn một ảnh mẫu.');
      const file = form.get('attachment') as File;
      ensure(/\.(png|jpe?g|webp|gif)$/i.test(file.name), 415, 'Chọn ảnh PNG, JPG, WEBP hoặc GIF.');
      image = await messengerUpload(file);
      body = Object.fromEntries(form);
    } else body = await jsonBody(req);
    const channel = await access(req.actor, string(body.channel, 50, { required: true }));
    ensure(channel.platform === 'fb', 400, 'Hãy chọn Facebook Page.');
    const command = string(body.command, 33, { required: true }).toLowerCase().replace(/^\//, '');
    ensure(/^[a-z0-9][a-z0-9_-]{0,31}$/.test(command), 400, 'Lệnh dùng chữ không dấu, số, dấu gạch ngang hoặc gạch dưới.');
    if (body.remove === true) {
      await run('DELETE FROM messenger_templates WHERE channel_id=$1 AND command=$2', channel.id, command);
    } else {
      const text = string(body.text, 1000, { required: !image });
      ensure(!image || !text, 400, 'Mỗi mẫu dùng văn bản hoặc một ảnh.');
      await transaction(async () => {
        await get('SELECT id FROM channels WHERE id=$1 FOR UPDATE', channel.id);
        const count = await get('SELECT count(*) AS total FROM messenger_templates WHERE channel_id=$1', channel.id);
        ensure(count.total < 100 || await get('SELECT 1 FROM messenger_templates WHERE channel_id=$1 AND command=$2', channel.id, command),
          409, 'Page đã có 100 mẫu tin nhanh.');
        await run(`INSERT INTO messenger_templates(channel_id,command,text,image_name,image_type,image_data)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(channel_id,command) DO UPDATE
          SET text=excluded.text,image_name=excluded.image_name,image_type=excluded.image_type,image_data=excluded.image_data`,
          channel.id, command, text, image?.name ?? null, image?.contentType ?? null, image?.data ?? null);
      });
    }
    return json(res, 200, { items: await listTemplates(channel.id) });
  }

  @Post('comments/check')
  async checkComments(@Req() req: AppRequest, @Res() res: Response) {
    await requirePlanFeature(req.actor.currentShop.id,'comments');
    const body = await jsonBody(req);
    const channel = await access(req.actor, string(body.id, 50, { required: true }));
    const media = string(body.media, 100, { required: true });
    const mediaId = facebookMediaId(channel, media);
    await throttle('comment-check:' + channel.id, 12, 60_000);
    return json(res, 200, await checkFacebookComments(channel, channel.meta_id + '_' + mediaId));
  }

  @Post('comments/watch')
  async watchComments(@Req() req: AppRequest, @Res() res: Response) {
    await requirePlanFeature(req.actor.currentShop.id,'comments');
    const body = await jsonBody(req);
    const channel = await access(req.actor, string(body.id, 50, { required: true }));
    const mediaId = facebookMediaId(channel, string(body.media, 100, { required: true }));
    ensure(typeof body.enabled === 'boolean', 400, 'Chọn trạng thái tự đồng bộ.');
    await throttle('comment-watch:' + req.actor.id, 40, 60_000);
    await transaction(async () => {
      if (body.enabled) {
        const current = await postBot(channel, mediaId);
        const mode = ['off','review','auto'].includes(current?.bot_mode) ? current.bot_mode : 'inherit';
        await run(`INSERT INTO post_bot_settings(channel_id,media_id,bot_mode,rules) VALUES($1,$2,$3,'')
          ON CONFLICT(channel_id,media_id) DO NOTHING`, channel.id, mediaId, mode);
      }
      await setCommentWatch(channel.id, mediaId, body.enabled);
    });
    return json(res, 200, { enabled: body.enabled });
  }

  @Get('bots/agent/documents')
  async listAgentDocuments(@Req() req: AppRequest, @Res() res: Response, @Query('channel') id: string, @Query('file') file?: string) {
    const channel=await access(req.actor,string(id,50,{required:true}));
    await requireAgentFeature(channel.shop_id);
    ensure(channel.platform==='fb',400,'Chọn Facebook Page.');
    if(file){
      const document=await agentDocument(channel.id,string(file,50,{required:true}));
      return json(res,200,ensure(document,404,'Không tìm thấy tệp.'));
    }
    return json(res,200,{files:await agentDocuments(channel.id)});
  }

  @Post('bots/agent/documents')
  async writeAgentDocuments(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req,256*1024);
    const channel=await access(req.actor,string(body.channel,50,{required:true}));
    await requireAgentFeature(channel.shop_id);
    ensure(channel.platform==='fb',400,'Chọn Facebook Page.');
    await changeAgentDocuments(channel.id,body);
    return json(res,200,{files:await agentDocuments(channel.id)});
  }

  @Post('bots/agent')
  async saveAgent(@Req() req: AppRequest, @Res() res: Response) {
    const body=await jsonBody(req,64*1024);
    const channel=await access(req.actor,string(body.id,50,{required:true}));
    await requireAgentFeature(channel.shop_id);
    const agentMode=choicesOf(body.mode,['off','review','auto']);
    const agentMarkdown=string(body.markdown,8000);
    ensure(channel.platform==='fb',400,'Chọn Facebook Page.');
    ensure(agentMode==='off'||(messengerEnabled&&channel.messenger),409,'Hãy cấp quyền Messenger cho Page.');
    ensure(body.checkout===undefined||typeof body.checkout==='boolean',400,'Chọn chế độ chốt đơn hợp lệ.');
    if(body.checkout)await requireOrderFeature(channel.shop_id);
    await transaction(async()=>{
      const current=await get('SELECT * FROM channels WHERE id=$1 AND shop_id=$2 FOR UPDATE',channel.id,req.actor.currentShop.id);
      ensure(current,404,'Không tìm thấy Page.');
      ensure(!body.checkout||(current.platform==='fb'&&current.page_purpose==='sales'),400,'Chọn danh mục Bán hàng cho Page để chốt đơn.');
      ensure(agentMode==='off'||agentMarkdown||await get('SELECT id FROM agent_documents WHERE channel_id=$1 LIMIT 1',channel.id),
        400,'Nhập hướng dẫn chung hoặc tải lên ít nhất một tệp hướng dẫn.');
      const policy={...editableBotPolicy(current.message_bot_policy),agentMode,agentMarkdown,unifiedAgent:true};
      await run('UPDATE channels SET message_bot_policy=$2,message_bot_mode=$3,orders_enabled=COALESCE($4,orders_enabled) WHERE id=$1',
        channel.id,JSON.stringify(policy),agentMode==='off'?'off':'rules',body.checkout??null);
    });
    return json(res,200,{ok:true});
  }

  @Post('bots')
  async channelBot(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req, 512 * 1024);
    const channel = await access(req.actor, string(body.id, 50));
    const kind = choicesOf(body.kind ?? 'comment', ['comment', 'message']);
    await requireAgentFeature(channel.shop_id);
    const plan=await shopFeatures(channel.shop_id);
    await transaction(async () => {
      const current = await get('SELECT * FROM channels WHERE id=$1 AND shop_id=$2 FOR UPDATE', channel.id, req.actor.currentShop.id);
      ensure(current, 404, 'Không tìm thấy kênh được phép truy cập.');
      ensure(!current.message_bot_policy?.unifiedAgent,409,'Cấu hình Page này trong mục AI agent.');
      let policy = body.policy;
      if ((body.keepFaqs === true || !plan?.feature_flags.faq) && policy?.version === 2) {
        ensure(Array.isArray(policy.rules), 400, 'Danh sách quy tắc không hợp lệ.');
        const saved = editableBotPolicy(kind === 'message' ? current.message_bot_policy : current.comment_policy);
        policy = {...policy, rules:[
          ...policy.rules.filter((rule) => rule?.type !== 'faq'),
          ...saved.rules.filter((rule) => rule.type === 'faq'),
        ]};
      }
      if (kind === 'message') {
          const mode = choicesOf(body.botMode, ['off', 'greeting', 'rules']);
          ensure(channel.platform === 'fb', 400, 'Bot tin nhắn chỉ áp dụng cho Facebook Page.');
          ensure(mode === 'off' || (messengerEnabled && channel.messenger), 409,
            'Hãy cấp lại quyền Messenger cho Page trước khi bật bot.');
          const template = choicesOf(body.template ?? 'welcome', Object.keys(acknowledgementTemplates));
          ensure(body.personalize === undefined || typeof body.personalize === 'boolean', 400, 'Chọn tùy chọn cá nhân hóa hợp lệ.');
          await run('UPDATE channels SET message_bot_mode=$1,message_greeting=$2,message_personalize=$3,message_bot_policy=COALESCE($4,message_bot_policy) WHERE id=$5',
            mode, template, body.personalize ?? channel.message_personalize, policyFor(mode, policy), channel.id);
      } else {
          const mode = choicesOf(body.botMode, ['off', 'review', 'auto']);
          await run('UPDATE channels SET bot_mode=$1,comment_policy=COALESCE($2,comment_policy) WHERE id=$3', mode, policyFor(mode, policy), channel.id);
      }
    });
    return json(res, 200, { ok: true });
  }

  @Post('bots/faqs')
  async saveFaqs(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req, 1024 * 1024);
    const channel = await access(req.actor, string(body.id, 50, { required: true }));
    await requirePlanFeature(channel.shop_id,'faq');
    const kind = choicesOf(body.kind, ['comment', 'message']);
    ensure(kind === 'comment' || channel.platform === 'fb', 400, 'FAQ Messenger chỉ áp dụng cho Facebook Page.');
    ensure(Array.isArray(body.items) && Array.isArray(body.previous)
      && body.items.every((item) => item?.type === 'faq'), 400, 'Danh sách FAQ không hợp lệ.');
    const column = kind === 'message' ? 'message_bot_policy' : 'comment_policy';
    await transaction(async () => {
      const locked = await get(`SELECT ${column} AS policy FROM channels WHERE id=$1 AND shop_id=$2 FOR UPDATE`,
        channel.id, req.actor.currentShop.id);
      ensure(locked, 404, 'Không tìm thấy kênh được phép truy cập.');
      const policy = editableBotPolicy(locked.policy);
      const previous = policy.rules.filter((rule) => rule.type === 'faq');
      ensure(isDeepStrictEqual(previous, body.previous), 409, 'FAQ vừa được thay đổi. Tải lại trang và thử lại.');
      let updated;
      try {
        updated = validateBotPolicy({...policy, rules:[
          ...policy.rules.filter((rule) => rule.type !== 'faq'), ...body.items,
        ]});
      } catch (error) { throw new AppError(400, error.message); }
      await run(`UPDATE channels SET ${column}=$1 WHERE id=$2`, JSON.stringify(updated), channel.id);
    });
    return json(res, 200, { ok: true });
  }

  @Post('posts/bot')
  async postBot(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req, 512 * 1024);
    const channel = await access(req.actor, string(body.id, 50, { required: true }));
    const media = string(body.media, 100, { required: true });
    ensure(channel.meta_id && /^[0-9]+(?:_[0-9]+)?$/.test(media), 400, 'Mã bài đăng không hợp lệ.');
    const mode = choicesOf(body.botMode, ['inherit', 'off', 'review', 'auto']);
    await requireAgentFeature(channel.shop_id);
    const mediaId = postKey(channel, media);
    const syncComments = body.syncComments;
    if (syncComments !== undefined) {
      ensure(channel.platform === 'fb' && typeof syncComments === 'boolean' && /^[0-9]+$/.test(mediaId),
        400, 'Chỉ có thể đồng bộ bình luận trên bài Facebook thuộc Trang này.');
    }
    const policy = policyFor(mode, withoutFaqs(body.policy,await shopFeatures(channel.shop_id)));
    await transaction(async () => {
      await run(`INSERT INTO post_bot_settings(channel_id,media_id,bot_mode,rules,comment_policy) VALUES($1,$2,$3,'',$4)
        ON CONFLICT(channel_id,media_id) DO UPDATE SET bot_mode=excluded.bot_mode,comment_policy=COALESCE(excluded.comment_policy,post_bot_settings.comment_policy)`,
        channel.id, mediaId, mode, policy);
      if (syncComments !== undefined) await setCommentWatch(channel.id, mediaId, syncComments);
    });
    return json(res, 200, { ok: true });
  }

  @Post('comments/private-reply')
  async privateReply(@Req() req: AppRequest, @Res() res: Response) {
    await requirePlanFeature(req.actor.currentShop.id,'comments');
    const body=await jsonBody(req,8192);
    const id=string(body.id,80,{required:true});
    const text=string(body.text,1000,{required:true});
    await requirePlanFeature(req.actor.currentShop.id,'messages');
    const comment=ensure(await get(`SELECT m.* FROM comments m JOIN channels c ON c.id=m.channel_id
      WHERE m.id=$1 AND c.shop_id=$2 AND c.platform='fb'`,id,req.actor.currentShop.id),
    404,'Không tìm thấy bình luận Facebook của bạn.');
    const channel=await access(req.actor,comment.channel_id,'chat:reply');
    await throttle('facebook-private-reply:'+channel.id,20,60_000);
    await sendFacebookPrivateReply(channel,comment,text);
    return json(res,200,{ok:true});
  }

  @Post('replies')
  async reply(@Req() req: AppRequest, @Res() res: Response) {
    const contentType = req.get('content-type') ?? '';
    let body, file;
    if (contentType.toLowerCase().startsWith('multipart/form-data;')) {
      await throttle('messenger-upload:' + req.actor.id, 12, 60_000);
      const data = await bytes(req, messengerUploadLimit + 32_768);
      let form;
      try { form = await new Response(data, { headers: { 'content-type': contentType } }).formData(); }
      catch { throw new AppError(400, 'Dữ liệu tệp đính kèm không hợp lệ.'); }
      ensure(form.getAll('attachment').length === 1, 400, 'Mỗi lần gửi chọn một tệp.');
      body = Object.fromEntries(form);
      file = form.get('attachment');
      ensure(file instanceof File, 400, 'Hãy chọn tệp cần gửi.');
    } else {
      body = await jsonBody(req);
    }
    const messaging = choicesOf(body.kind ?? 'comment', ['comment', 'message']) === 'message';
    ensure(messaging || (!file && body.quoteMid === undefined), 400, 'Tệp đính kèm và trích dẫn dùng cho tin nhắn Messenger.');
    await requirePlanFeature(req.actor.currentShop.id,messaging?'messages':'comments');
    const table = messaging ? 'inbox_messages' : 'comments';
    const item = ensure(await get('SELECT * FROM ' + table + ' WHERE id=$1', string(body.id, 50)),
      404, 'Không tìm thấy nội dung cần phản hồi.');
    const channel = await access(req.actor, item.channel_id, 'chat:reply');
    ensure(!messaging || channel.messenger, 409, 'Hãy cấp lại quyền Messenger cho Facebook Page.');
    const templateCommand = string(body.templateCommand, 32);
    ensure(!templateCommand || (messaging && !file && !body.reply), 400, 'Mẫu ảnh chỉ dùng cho tin nhắn Messenger.');
    if(templateCommand)await requirePlanFeature(channel.shop_id,'quickReplies');
    const template = templateCommand ? ensure(await get(`SELECT image_name,image_type,image_data FROM messenger_templates
      WHERE channel_id=$1 AND command=$2 AND image_data IS NOT NULL`,channel.id,templateCommand),
      404,'Mẫu ảnh đã bị xóa hoặc thay đổi.') : null;
    const requestId = string(body.requestId, 50, { required: !!file || !!template });
    const reply = string(body.reply, 1000, { required: !file && !template });
    ensure(!file || !reply, 400, 'Hãy gửi nội dung và tệp đính kèm thành hai tin nhắn.');
    const quoteMid = string(body.quoteMid, 512);
    const attachment = file ? await messengerUpload(file) : template ? {
      type:'image', name:template.image_name, contentType:template.image_type,
      size:template.image_data.length, data:template.image_data,
    } : null;
    await queueReply(item, reply, messaging, requestId || null, { quoteMid, attachment, actorId: req.actor.id });
    return json(res, 200, { ok: true });
  }
}
