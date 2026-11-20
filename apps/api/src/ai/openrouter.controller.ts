import { publicUsage } from './usage-quota.mjs';
import { requestVersion, checkVersion } from '../http/versions.mjs';
import { requireAgentFeature, requirePlanFeature } from '../billing/plan-features.mjs';
import { completeJson } from './openrouter-client.js';
import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { seal } from '../auth/crypto.mjs';
import { access, all, get, run, throttle } from '../db/store.mjs';
import { RoutePolicy, type AppRequest } from '../http/session.guard.js';
import { choicesOf, ensure, string } from '../http/validation.mjs';
import { json, jsonBody } from '../http/wire.mjs';

@Controller('api')
export class OpenRouterController {
  @Get('admin/openrouter')
  @RoutePolicy('admin')
  async settings(@Res() res: Response) {
    const row = await get('SELECT version,enabled,model,api_key IS NOT NULL AS configured FROM openrouter_settings WHERE id=1');
    return json(res, 200, row ?? { enabled: false, model: '', configured: false });
  }

  @Post('admin/openrouter')
  @RoutePolicy('admin')
  async saveSettings(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req);
    ensure(typeof body.enabled === 'boolean', 400, 'Chọn trạng thái OpenRouter.');
    const model = string(body.model, 160, { required: body.enabled });
    const key = string(body.apiKey, 512);
    ensure(!model || /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(model), 400, 'Nhập mã model dạng nhà-cung-cấp/tên-model.');
    ensure(!key || /^sk-or-[A-Za-z0-9_-]+$/.test(key), 400, 'API key OpenRouter không hợp lệ.');
    const expected=requestVersion(req);
    const current=await get('SELECT version,api_key IS NOT NULL AS configured FROM openrouter_settings WHERE id=1');
    checkVersion(current.version,expected);
    ensure(!body.enabled || key || current.configured,400,'Nhập API key trước khi bật OpenRouter.');
    const saved=await run(`UPDATE openrouter_settings SET enabled=$1,model=$2,api_key=COALESCE($3,api_key) WHERE id=1 AND version=$4`,
      body.enabled,model,key?seal(key):null,expected);
    checkVersion(saved.changes?expected:null,expected);
    return json(res, 200, { ok: true });
  }

  @Get('ai/usage')
  async usage(@Req() req: AppRequest) {
    return publicUsage(req.actor.currentShop.id);
  }

  @Post('ai/draft')
  async draft(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req);
    const channel = await access(req.actor, string(body.channel, 50, { required: true }));
    const kind = choicesOf(body.kind, ['faq', 'reply']);
    if(kind==='faq')await requirePlanFeature(channel.shop_id,'faq');
    else await requireAgentFeature(channel.shop_id);
    const prompt = string(body.prompt, 2000, { required: true });
    const config = ensure(await get('SELECT model,api_key FROM openrouter_settings WHERE id=1 AND enabled AND api_key IS NOT NULL'),
      503, 'Quản trị viên chưa bật OpenRouter.');
    await throttle('openrouter-user:' + req.actor.id, 8, 60_000);
    await throttle('openrouter-global', 60, 60_000);

    return json(res, 200, await generateDraft({...config,shopId:channel.shop_id}, kind, { page: channel.name, input: prompt }));
  }

  @Post('ai/faqs')
  async faqs(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req);
    const channel = await access(req.actor, string(body.channel, 50, { required: true }));
    await requirePlanFeature(channel.shop_id,'faq');
    const surface = choicesOf(body.surface, ['message', 'comment']);
    const count = body.count;
    ensure(Number.isInteger(count) && count >= 1 && count <= 8, 400, 'Chọn từ 1 đến 8 FAQ.');
    const prompt = string(body.prompt, 2000);
    const config = ensure(await get('SELECT model,api_key FROM openrouter_settings WHERE id=1 AND enabled AND api_key IS NOT NULL'),
      503, 'Quản trị viên chưa bật OpenRouter.');
    await throttle('openrouter-user:' + req.actor.id, 8, 60_000);
    await throttle('openrouter-global', 60, 60_000);
    const products = channel.page_purpose === 'sales'
      ? await all('SELECT sku,name,price,in_stock FROM catalog_products WHERE channel_id=$1 ORDER BY sku', channel.id) : [];
    const policy = surface === 'message' ? channel.message_bot_policy : channel.comment_policy;
    const result = await completeJson({...config,shopId:channel.shop_id},
      `Tạo tối đa ${count} FAQ tiếng Việt cho Page và kênh được cung cấp. Trả JSON dạng {"items":[{"question":"...","reply":"...","group":"...","alternatives":["..."]}]}. Câu hỏi tối đa 80 ký tự, câu trả lời tối đa 500, nhóm tối đa 60. Chỉ dùng dữ kiện được cung cấp. Khi thiếu dữ kiện hãy đề nghị khách hỏi quản trị viên. Tránh trùng các FAQ hiện tại. Không đưa giá hoặc tồn kho cụ thể vào FAQ vì chúng thay đổi. Với Page tin tức hoặc giải trí, không giả định Page bán hàng.`,
      JSON.stringify({page:channel.name,purpose:channel.page_purpose,knowledge:channel.page_knowledge,
        surface,prompt,products,existing:(policy?.rules??[]).filter((rule)=>rule.type==='faq').map((rule)=>rule.name)}), 2400);
    ensure(Array.isArray(result?.items), 502, 'Model chưa trả về danh sách FAQ hợp lệ.');
    const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0,max) : '';
    const items = result.items.slice(0,8).map((item)=>({
      question:clean(item?.question,80), reply:clean(item?.reply,500), group:clean(item?.group,60),
      alternatives:Array.isArray(item?.alternatives)?item.alternatives.slice(0,8).map((value)=>clean(value,100)).filter(Boolean):[],
    })).filter((item)=>item.question && item.reply).slice(0,count);
    ensure(items.length, 502, 'Model chưa tạo được FAQ hợp lệ.');
    return json(res, 200, { items });
  }

  @Post('admin/openrouter/test')
  @RoutePolicy('admin')
  async test(@Req() req: AppRequest, @Res() res: Response) {
    const config = ensure(await get('SELECT model,api_key FROM openrouter_settings WHERE id=1 AND api_key IS NOT NULL AND model<>$1', ''),
      400, 'Lưu API key và model trước khi thử.');
    await throttle('openrouter-test:' + req.actor.id, 5, 60_000);
    const sample = await generateDraft(config, 'faq', { page: 'Page thử nghiệm', input: 'Câu hỏi về giờ làm việc. Page làm việc từ 9h đến 17h.' });
    return json(res, 200, { model: config.model, sample });
  }
}

async function generateDraft(config, kind: 'faq' | 'reply', input: { page: string; input: string }) {
  const instruction = kind === 'faq'
    ? 'Soạn một FAQ tiếng Việt. Trả đúng một object JSON với hai khóa question và reply, cả hai đều là chuỗi. question tối đa 80 ký tự. Ví dụ hình dạng: {"question":"Câu hỏi","reply":"Câu trả lời"}.'
    : 'Soạn một câu trả lời mẫu tiếng Việt. Trả đúng object JSON có khóa reply là chuỗi. Ví dụ hình dạng: {"reply":"Câu trả lời"}.';
  const prompt = instruction + ' Giữ nguyên tên khóa tiếng Anh, không lồng object. Chỉ dùng dữ kiện đã nhập, trả lời tối đa 1000 ký tự. Khi thiếu dữ kiện, hãy đề nghị nhân viên xác nhận.';
  const payload = JSON.stringify(input);
  const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  function normalize(result) {
    const item = [result, result?.faq, ...(Array.isArray(result?.items) ? result.items.slice(0, 1) : [])]
      .find((entry) => clean(entry?.reply, 1000) || clean(entry?.answer, 1000));
    const reply = clean(item?.reply, 1000) || clean(item?.answer, 1000);
    const question = clean(item?.question, 80);
    return reply && (kind !== 'faq' || question) ? { reply, ...(kind === 'faq' ? { question } : {}) } : null;
  }
  const first = normalize(await completeJson(config, prompt, payload, 900));
  if (first) return first;
  const second = normalize(await completeJson(config, prompt, payload, 900, {
    name: kind === 'faq' ? 'snailchat_faq' : 'snailchat_reply',
    fields: kind === 'faq' ? ['question', 'reply'] : ['reply'],
  }));
  return ensure(second, 502, 'OpenRouter đã phản hồi nhưng model chưa trả được bản nháp đúng cấu trúc.');
}
