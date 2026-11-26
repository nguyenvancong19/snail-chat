import { unseal } from '../auth/crypto.mjs';
import { reserveTokens, settleTokens } from './usage-quota.mjs';
import { recordProviderUsage } from './provider-usage.mjs';
import { throttle } from '../db/store.mjs';
import { AppError } from '../http/validation.mjs';
import { providerEndpoint } from './providers.js';

class ProviderUnavailable extends AppError {}

const upstreamCodes = new Map([
  ['insufficient_quota', 402], ['insufficient_balance', 402], ['insufficient_credits', 402],
  ['billing_hard_limit_reached', 402], ['payment_required', 402], ['resource_exhausted', 429],
  ['rate_limit_exceeded', 429], ['service_unavailable', 503],
]);

function upstreamError(status: number, label: string) {
  const messages = {
    400: 'Kiểm tra mã model và khả năng trả JSON của model.',
    401: 'API key bị từ chối. Kiểm tra nhà cung cấp và khóa đã nhập.',
    402: 'Kiểm tra số dư và hạn mức chi tiêu của API key.',
    403: 'Kiểm tra quyền truy cập model và cài đặt của nhà cung cấp.',
    404: 'Không tìm thấy model. Kiểm tra mã model của nhà cung cấp.',
    429: 'Đã chạm giới hạn lượt gọi. Thử lại sau.',
    503: 'Nhà cung cấp model tạm thời không khả dụng. Thử lại sau.',
  };
  const ErrorType = [401, 402, 403, 404, 408, 429].includes(status) || status >= 500
    ? ProviderUnavailable : AppError;
  return new ErrorType(502, `${label} (${status}). ${messages[status] ?? 'Không xử lý được yêu cầu lúc này.'}`);
}

function tokenSum(prompt: unknown, completion: unknown) {
  if (typeof prompt !== 'number' || typeof completion !== 'number' || prompt < 0 || completion < 0 ||
    !Number.isSafeInteger(prompt) || !Number.isSafeInteger(completion)) return null;
  const sum = prompt + completion;
  return Number.isSafeInteger(sum) && sum > 0 ? sum : null;
}

async function reportedTokens(data, key: string, provider: string) {
  const total = data?.usage?.total_tokens;
  if (Number.isSafeInteger(total) && total > 0) return total;
  const inline = tokenSum(data?.usage?.prompt_tokens, data?.usage?.completion_tokens);
  if (inline !== null) return inline;

  if (provider !== 'openrouter' || typeof data?.id !== 'string' || !data.id.startsWith('gen-')) return null;
  const url = new URL('https://openrouter.ai/api/v1/generation');
  url.searchParams.set('id', data.id);
  try {
    const response = await fetch(url, {
      redirect: 'error', headers: {Authorization: 'Bearer ' + key}, signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const generation = (await response.json())?.data;
    return tokenSum(generation?.tokens_prompt, generation?.tokens_completion);
  } catch { return null; }
}

type Schema = {name: string; fields: string[]};

export async function completeJson(config, instruction: string, input, maxTokens: number, schema?: Schema) {
  return routeAiRequest(config, provider => completeWithProvider(provider, instruction, input, maxTokens, schema));
}

async function routeAiRequest(config, execute) {
  try {
    return await execute(config);
  } catch (error) {
    if (!(error instanceof ProviderUnavailable) || !config.backup_enabled ||
      !config.backup_provider || !config.backup_model || !config.backup_api_key) throw error;

    return execute({
      ...config, provider:config.backup_provider, model:config.backup_model, api_key:config.backup_api_key,
    });
  }
}

async function completeWithProvider(config, instruction: string, input, maxTokens: number, schema?: Schema) {
  const provider = config.provider ?? 'openrouter';
  let endpoint;
  try { endpoint = providerEndpoint(provider); }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    throw new ProviderUnavailable(error.status, error.message);
  }
  const {label,url,structured,maxTokenField} = endpoint;
  let key;
  try { key = unseal(config.api_key); }
  catch { throw new ProviderUnavailable(502, 'SnailChat không đọc được API key đã lưu. Nhập lại khóa trong Admin → Cấu hình AI.'); }

  const system = schema && !structured
    ? instruction+' Return exactly these JSON fields as strings: '+schema.fields.join(', ')+'.'
    : instruction;
  const messages = [{role:'system', content:system}, {role:'user', content:input}];
  if (config.shopId) await throttle('llm:shop:' + config.shopId, 60, 60_000);
  const reserve = Buffer.byteLength(JSON.stringify({messages,schema})) + maxTokens + 256;
  const reservation = config.shopId ? await reserveTokens(config.shopId, reserve) : null;
  try { await throttle('llm:global', 240, 60_000); }
  catch (error) { await settleTokens(reservation, 0); throw error; }

  const startedAt = Date.now();
  let failed = true;
  let reported: number | null = null;
  let estimated = reserve;
  try {
    let response: globalThis.Response;
    const signal = AbortSignal.timeout(20_000);
    try {
      response = await fetch(url, {
        method: 'POST', redirect: 'error',
        headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
        signal,
        body: JSON.stringify({
          model: config.model,
          [maxTokenField ?? 'max_tokens']: maxTokens,
          ...(provider === 'openrouter' ? {usage:{include:true}, ...(schema ? {provider:{require_parameters:true}} : {})} : {}),
          response_format: schema && structured ? {type:'json_schema', json_schema:{
            name:schema.name, strict:true, schema:{
              type:'object', additionalProperties:false, required:schema.fields,
              properties:Object.fromEntries(schema.fields.map(field => [field, {type:'string'}])),
            },
          }} : {type:'json_object'},
          messages,
        }),
      });
    } catch (error) {
      await settleTokens(reservation, reserve);
      if (signal.aborted || error instanceof Error && error.name === 'TimeoutError') {
        throw new ProviderUnavailable(504, 'Nhà cung cấp AI chưa phản hồi sau 20 giây. Thử lại sau.');
      }
      throw new ProviderUnavailable(502, 'Máy chủ SnailChat không kết nối được nhà cung cấp AI.');
    }

    let bodyReadError;
    const data = await response.json().catch(error => { bodyReadError = error; return null; });
    const choice = data?.choices?.[0];
    const providerError = data?.error ?? choice?.error;
    const code = Number(providerError?.code);
    const numericCode = Number.isInteger(code) && code >= 400 && code <= 599 ? code : undefined;
    const symbolicCode = [providerError?.code, providerError?.type, providerError?.status]
      .map(value => typeof value === 'string' ? upstreamCodes.get(value.toLowerCase()) : undefined)
      .find(value => value !== undefined);
    // Some gateways return a billing error in an HTTP 400 response.
    const status = response.ok ? numericCode ?? symbolicCode ?? response.status
      : response.status === 400 ? symbolicCode ?? response.status : response.status;
    reported = await reportedTokens(data, key, provider);
    estimated = reported !== null || (status >= 400 && status < 500 && !data?.id) ? 0 : reserve;
    await settleTokens(reservation, reported ?? estimated);
    if (status >= 400) throw upstreamError(status, label);
    if (bodyReadError && signal.aborted) {
      throw new ProviderUnavailable(504, 'Nhà cung cấp AI chưa phản hồi sau 20 giây. Thử lại sau.');
    }
    if (bodyReadError instanceof TypeError) {
      throw new ProviderUnavailable(502, 'Máy chủ SnailChat không kết nối được nhà cung cấp AI.');
    }
    if (choice?.finish_reason === 'length') throw new AppError(502, 'Model trả về bản nháp bị cắt. Thử mô tả ngắn hơn hoặc đổi model.');
    let result;
    try {
      result = JSON.parse(choice.message.content.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, ''));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    } catch { throw new AppError(502, 'Model không trả về JSON hợp lệ. Kiểm tra model trong Admin → Cấu hình AI.'); }
    config.onUsage?.(reported);
    failed = false;
    return result;
  } finally {
    if (!config.onUsage) await recordProviderUsage(provider, startedAt, failed, reported ?? 0, estimated);
  }
}
