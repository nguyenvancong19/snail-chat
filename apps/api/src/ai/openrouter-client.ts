import { unseal } from '../auth/crypto.mjs';
import { reserveTokens, settleTokens } from './usage-quota.mjs';
import { throttle } from '../db/store.mjs';
import { AppError } from '../http/validation.mjs';

function upstreamError(status: number) {
  const messages = {
    400: 'Kiểm tra mã model và khả năng trả JSON của model.',
    401: 'API key bị từ chối. Kiểm tra khóa đã lưu trong Admin → OpenRouter.',
    402: 'Kiểm tra số dư OpenRouter và hạn mức chi tiêu của API key.',
    403: 'Kiểm tra quyền của API key và cài đặt quyền riêng tư trên OpenRouter.',
    404: 'Không tìm thấy model hoặc nhà cung cấp phù hợp. Kiểm tra mã model và cài đặt định tuyến.',
    429: 'Đã chạm giới hạn lượt gọi. Thử lại sau.',
    503: 'Nhà cung cấp model tạm thời không khả dụng. Thử lại sau.',
  };
  return new AppError(502, `OpenRouter (${status}). ${messages[status] ?? 'Không xử lý được yêu cầu lúc này.'}`);
}

function tokenSum(prompt: unknown, completion: unknown) {
  if(typeof prompt!=='number'||typeof completion!=='number'||prompt<0||completion<0||
    !Number.isSafeInteger(prompt)||!Number.isSafeInteger(completion))return null;
  const sum=prompt+completion;
  return Number.isSafeInteger(sum)&&sum>0?sum:null;
}

async function reportedTokens(data, key: string) {
  const total=data?.usage?.total_tokens;
  if(Number.isSafeInteger(total)&&total>0)return total;
  const inline=tokenSum(data?.usage?.prompt_tokens,data?.usage?.completion_tokens);
  if(inline!==null)return inline;

  if(typeof data?.id!=='string'||!data.id.startsWith('gen-'))return null;
  const url=new URL('https://openrouter.ai/api/v1/generation');
  url.searchParams.set('id',data.id);
  try{
    const response=await fetch(url,{
      redirect:'error',headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(2500),
    });
    if(!response.ok)return null;
    const generation=(await response.json())?.data;
    return tokenSum(generation?.tokens_prompt,generation?.tokens_completion);
  }catch{return null;}
}

export async function completeJson(config, instruction: string, input, maxTokens: number, schema?: {name: string; fields: string[]}) {
  let key;
  try { key = unseal(config.api_key); }
  catch { throw new AppError(502, 'SnailChat không đọc được API key đã lưu. Nhập lại khóa trong Admin → OpenRouter.'); }

  const messages=[{role:'system',content:instruction},{role:'user',content:input}];
  if(config.shopId)await throttle('llm:shop:'+config.shopId,60,60_000);
  // All shop callers use text. UTF-8 bytes plus generation allowance are a conservative reservation.
  const reserve=Buffer.byteLength(JSON.stringify({messages,schema}))+maxTokens+256;
  const reservation=config.shopId?await reserveTokens(config.shopId,reserve):null;
  try{await throttle('llm:global',240,60_000);}
  catch(error){await settleTokens(reservation,0);throw error;}
  let response: globalThis.Response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: config.model, max_tokens: maxTokens, usage:{include:true},
        response_format: schema ? { type: 'json_schema', json_schema: {
          name: schema.name, strict: true, schema: {
            type: 'object', additionalProperties: false, required: schema.fields,
            properties: Object.fromEntries(schema.fields.map((field) => [field, { type: 'string' }])),
          },
        } } : { type: 'json_object' },
        ...(schema ? { provider: { require_parameters: true } } : {}),
        messages,
      }),
    });
  } catch (error) {
    await settleTokens(reservation,reserve);
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new AppError(504, 'OpenRouter chưa phản hồi sau 20 giây. Thử lại sau.');
    }
    throw new AppError(502, 'Máy chủ SnailChat không kết nối được OpenRouter. Kiểm tra kết nối Internet của container API.');
  }
  const data = await response.json().catch(() => null);
  if(reservation){
    const used=await reportedTokens(data,key);
    if(used!==null)await settleTokens(reservation,used);
    else if(response.status>=400&&response.status<500&&!data?.id)await settleTokens(reservation,0);
    else await settleTokens(reservation,reserve);
  }
  if (!response.ok) throw upstreamError(response.status);
  const choice = data?.choices?.[0];
  const code = Number(data?.error?.code ?? choice?.error?.code);
  if (Number.isInteger(code) && code >= 400 && code <= 599) throw upstreamError(code);
  if (choice?.finish_reason === 'length') throw new AppError(502, 'Model trả về bản nháp bị cắt. Thử mô tả ngắn hơn hoặc đổi model.');
  let result;
  try {
    result = JSON.parse(choice.message.content.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, ''));
  } catch { throw new AppError(502, 'Model không trả về bản nháp JSON hợp lệ. Thử lại hoặc đổi model trong Admin → OpenRouter.'); }
  return result;
}
