import { activeAiConfig } from './settings.mjs';
import { publicUsage } from './usage-quota.mjs';
import { requestVersion, checkVersion } from '../http/versions.mjs';
import { requireAgentFeature, requirePlanFeature } from '../billing/plan-features.mjs';
import { completeJson, simulateAiRouting } from './openrouter-client.js';
import { publicProviders, resolveProvider } from './providers.js';
import { providerUsage } from './provider-usage.mjs';
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
    const current = await readSettings();
    return json(res, 200, {
      version:current.version, enabled:current.enabled, provider:current.provider, model:current.model,
      configured:!!current.api_key, providers:publicProviders(),
      backup:{enabled:current.backup_enabled, provider:current.backup_provider, model:current.backup_model,
        configured:!!current.backup_api_key},
    });
  }

  @Post('admin/openrouter')
  @RoutePolicy('admin')
  async saveSettings(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req);
    ensure(typeof body.enabled === 'boolean', 400, 'Chọn trạng thái AI.');
    const expected = requestVersion(req);
    const current = await readSettings();
    checkVersion(current.version, expected);
    const primary = proposedConfig(body, current, body.enabled);
    const previousBackup = backupConfig(current);
    const backup = proposedBackup(body.backup, previousBackup);
    ensure(!backup.enabled || backup.provider !== primary.provider, 400,
      'Hãy chọn nhà cung cấp dự phòng khác nhà cung cấp chính.');

    const probes = [];
    if (body.enabled && (!current.enabled || configChanged(primary, current))) probes.push(primary);
    if (backup.enabled && (!previousBackup.enabled || configChanged(backup, previousBackup))) probes.push(backup);
    if (probes.length) {
      await throttle('openrouter-test:' + req.actor.id, 5, 60_000);
      await Promise.all(probes.map(config => checkConnection(config, false)));
    }

    const saved = await run(`UPDATE openrouter_settings SET enabled=$1,provider=$2,model=$3,api_key=$4,
      backup_enabled=$5,backup_provider=$6,backup_model=$7,backup_api_key=$8
      WHERE id=1 AND version=$9`, body.enabled, primary.provider, primary.model, primary.api_key,
      backup.enabled, backup.provider, backup.model, backup.api_key, expected);
    checkVersion(saved.changes ? expected : null, expected);
    return json(res, 200, {ok: true});
  }

  @Get('admin/ai/usage')
  @RoutePolicy('admin')
  async usageOverview(@Req() req: AppRequest) {
    const days = Number(choicesOf(req.query.days ?? '7', ['7', '30']));
    const provider = req.query.provider === undefined ? '' : resolveProvider(req.query.provider);
    return providerUsage(days, provider);
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
    const config = ensure(await activeAiConfig(),
      503, 'Quản trị viên chưa bật AI.');
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
    const config = ensure(await activeAiConfig(),
      503, 'Quản trị viên chưa bật AI.');
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

  @Post('admin/openrouter/simulate')
  @RoutePolicy('admin')
  async simulate(@Req() req: AppRequest) {
    const body = await jsonBody(req);
    const scenario = choicesOf(body.scenario, ['healthy','balance','outage','both']);
    const config = ensure(await activeAiConfig(), 503, 'Quản trị viên chưa bật AI.');
    return simulateAiRouting(config, scenario);
  }

  @Post('admin/openrouter/test')
  @RoutePolicy('admin')
  async test(@Req() req: AppRequest, @Res() res: Response) {
    const body = await jsonBody(req);
    const current = await readSettings();
    const target = choicesOf(body.target ?? 'primary', ['primary','backup']);
    if (target === 'backup' || body.provider !== undefined) checkVersion(current.version, requestVersion(req));
    const saved = target === 'backup' ? backupConfig(current) : current;
    const config = proposedConfig({provider:saved.provider,model:saved.model ?? undefined,...body}, saved, true);
    await throttle('openrouter-test:' + req.actor.id, 5, 60_000);
    const tokens = await checkConnection(config);
    return json(res, 200, {provider:config.provider, model:config.model, tokens});
  }
}

function readSettings() {
  return get(`SELECT version,enabled,provider,model,api_key,backup_enabled,backup_provider,backup_model,backup_api_key
    FROM openrouter_settings WHERE id=1`);
}

function backupConfig(current) {
  return {enabled:current.backup_enabled, provider:current.backup_provider, model:current.backup_model,
    api_key:current.backup_api_key};
}

function proposedBackup(body, current) {
  if (body === undefined) return current;
  ensure(body && typeof body.enabled === 'boolean', 400, 'Chọn trạng thái dự phòng.');
  if (!body.enabled) return {...current, enabled:false};
  return {...proposedConfig(body, current, true), enabled:true};
}

function configChanged(config, current) {
  return config.provider !== current.provider || config.model !== current.model || config.api_key !== current.api_key;
}

async function checkConnection(config, alsoCheckSchema = true) {
  const results: (number | null)[] = [];
  const sampleConfig = {...config, onUsage: (tokens: number | null) => results.push(tokens)};
  const probe = 'Return a JSON object with a string field reply containing OK.';
  const valid = (value) => typeof value?.reply === 'string' && value.reply.trim();
  const plain = await completeJson(sampleConfig, probe, 'Connection test with synthetic data.', 480);
  ensure(valid(plain),502,'Model chưa trả về JSON đúng cấu trúc thử nghiệm.');
  if (alsoCheckSchema) {
    const structured = await completeJson(sampleConfig, probe, 'Connection test with synthetic data.', 480,
      {name:'snailchat_connection_test',fields:['reply']});
    ensure(valid(structured),502,'Model chưa trả về JSON đúng cấu trúc thử nghiệm.');
  }
  return results.every(value => value !== null) ? results.reduce((total, value) => total + (value ?? 0), 0) : null;
}

function proposedConfig(body, current, required: boolean) {
  const provider = resolveProvider(body.provider ?? 'openrouter');
  const model = string(body.model, 160, {required});
  const key = string(body.apiKey, 512);
  const modelPattern = provider === 'openrouter'
    ? /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i : /^[a-z0-9][a-z0-9._:/-]*$/i;
  ensure(!model || modelPattern.test(model), 400, 'Nhập mã model theo định dạng của nhà cung cấp.');
  ensure(!key || /^[\x21-\x7E]+$/.test(key) && (provider !== 'openrouter' || /^sk-or-[A-Za-z0-9_-]+$/.test(key)),
    400, 'API key không đúng định dạng của nhà cung cấp.');
  ensure(provider === current.provider || key, 400, 'Nhập API key mới khi đổi nhà cung cấp.');
  const api_key = key ? seal(key) : current.api_key;
  ensure(!required || api_key, 400, 'Nhập API key để tiếp tục.');
  return {provider, model, api_key};
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
  return ensure(second, 502, 'Model chưa trả được bản nháp đúng cấu trúc.');
}
