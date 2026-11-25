import { createHash } from 'node:crypto';
import { ensure } from '../http/validation.mjs';

type Provider = {
  label: string;
  url: string;
  structured: boolean;
  maxTokenField?: 'max_completion_tokens';
  example?: string;
  custom?: boolean;
};

const providers = new Map<string, Provider>([
  ['openrouter', {label:'OpenRouter', url:'https://openrouter.ai/api/v1/chat/completions', example:'openai/gpt-4.1-mini', structured:true}],
  ['openai', {label:'OpenAI', url:'https://api.openai.com/v1/chat/completions', example:'gpt-4.1-mini', structured:true, maxTokenField:'max_completion_tokens'}],
  ['gemini', {label:'Google Gemini', url:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', example:'gemini-2.5-flash', structured:true}],
  ['deepseek', {label:'DeepSeek', url:'https://api.deepseek.com/chat/completions', structured:false}],
  ['groq', {label:'Groq', url:'https://api.groq.com/openai/v1/chat/completions', structured:false, maxTokenField:'max_completion_tokens'}],
]);
const normalizedName = (name: string) => name.trim().toLowerCase().replace(/\s+/g,'');
const names = new Map<string,string>();
for (const [id,{label}] of providers) {
  names.set(id,id);
  names.set(normalizedName(label),id);
}

if (process.env.SNAILCHAT_AI_PROVIDERS) {
  const configured = JSON.parse(process.env.SNAILCHAT_AI_PROVIDERS);
  if (!Array.isArray(configured) || configured.length > 25) {
    throw new Error('SNAILCHAT_AI_PROVIDERS must be a JSON array with at most 25 entries.');
  }
  for (const entry of configured) {
    if (typeof entry?.name !== 'string' || !/^[a-z][a-z0-9 -]{1,47}$/i.test(entry.name) ||
        typeof entry.endpoint !== 'string' || (entry.structured !== undefined && typeof entry.structured !== 'boolean')) {
      throw new Error('Invalid name, endpoint or structured setting in SNAILCHAT_AI_PROVIDERS.');
    }
    const label = entry.name.trim();
    const alias = normalizedName(label);
    const url = new URL(entry.endpoint);
    if (names.has(alias) || url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.search || url.hash || !/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i.test(url.hostname) ||
        !url.pathname.endsWith('/chat/completions')) {
      throw new Error('Custom AI providers need a unique name and an HTTPS Chat Completions endpoint.');
    }
    // Bind the stored credential to this endpoint. A changed endpoint requires a new credential.
    const digest = createHash('sha256').update(alias+'\n'+url.href).digest('hex').slice(0,24);
    const id = 'custom-' + digest;
    names.set(alias,id);
    providers.set(id,{label,url:url.href,structured:entry.structured===true,custom:true});
  }
}

export function resolveProvider(value: unknown): string {
  const id = typeof value === 'string' && (providers.has(value) ? value : names.get(normalizedName(value)));
  return ensure(id,400,'Nhà cung cấp chưa được đăng ký trên máy chủ.');
}

export function providerEndpoint(id: string): Provider {
  return ensure(providers.get(id),503,'Nhà cung cấp chưa được đăng ký trên máy chủ.');
}

export function publicProviders() {
  return Array.from(providers, ([id,{label,example,custom}])=>({id,label,example,custom:!!custom}));
}
