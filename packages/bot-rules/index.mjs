export const DEFAULT_REPLY = 'Bạn vui lòng nhắn tin cho Page để được tư vấn thêm nhé!';
export const MAX_BOT_GROUPS = 16;

function normalize(text) {
  return text.toLocaleLowerCase('vi').normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd');
}

function words(text) {
  return normalize(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function legacyRules(value) {
  const groups = [];
  for (const line of value.split('\n')) {
    const [keyword, ...parts] = line.split('=>');
    const reply = parts.join('=>').trim();
    if (keyword.trim() && reply) groups.push({name:keyword.trim(), phrases:[keyword.trim()], reply});
  }
  return {groups, fallback:'', legacy:true};
}

export function validateRules(value) {
  if (!value || !Array.isArray(value.groups) || value.groups.length > MAX_BOT_GROUPS) {
    throw new Error('Mỗi bot có tối đa ' + MAX_BOT_GROUPS + ' nhóm câu hỏi.');
  }
  const bounded = (input, max) => {
    if (typeof input !== 'string' || input.trim().length > max) {
      throw new Error('Một trường cấu hình bot không hợp lệ hoặc vượt quá giới hạn ký tự.');
    }
    return input.trim();
  };
  const groups = value.groups.map((group) => {
    if (!group || !Array.isArray(group.phrases) || group.phrases.length < 1 || group.phrases.length > 20) {
      throw new Error('Mỗi nhóm cần từ 1 đến 20 cụm từ nhận diện.');
    }
    const name = bounded(group.name, 160);
    const phrases = [...new Set(group.phrases.map((phrase) => bounded(phrase, 160)))];
    const reply = bounded(group.reply, 1000);
    if (!name || !reply || phrases.some((phrase) => !words(phrase))) {
      throw new Error('Điền tên nhóm, cụm từ nhận diện và câu trả lời cho từng nhóm.');
    }
    return {name, phrases, reply};
  });
  const config = {groups, fallback:bounded(value.fallback ?? '', 1000)};
  if (new TextEncoder().encode(JSON.stringify(config)).length > 30000) {
    throw new Error('Cấu hình bot quá dài. Hãy rút gọn cụm từ hoặc câu trả lời.');
  }
  return config;
}

export function readRules(value) {
  if (!value) return {groups:[], fallback:''};
  if (typeof value !== 'string') return validateRules(value);
  if (!value.startsWith('{"groups":')) return legacyRules(value);
  try {
    return validateRules(JSON.parse(value));
  } catch {
    return legacyRules(value);
  }
}

export function classifyComment(value, text) {
  const rules = readRules(value);
  const comment = words(text);
  if (rules.legacy) {
    const plain = normalize(text);
    const group = rules.groups.find(({phrases}) => plain.includes(normalize(phrases[0])));
    return group ? {category:group.name, reply:group.reply} : {category:'', reply:''};
  }
  if (!comment) return {category:'', reply:''};

  let match;
  let length = 0;
  const padded = ' ' + comment + ' ';
  for (const group of rules.groups) {
    for (const phrase of group.phrases) {
      const candidate = words(phrase);
      if (candidate.length > length && padded.includes(' ' + candidate + ' ')) {
        length = candidate.length;
        match = group;
      }
    }
  }
  if (match) return {category:match.name, reply:match.reply};
  if (rules.fallback) return {category:'Câu trả lời mặc định', reply:rules.fallback};
  return {category:'', reply:''};
}

export const acknowledgementTemplates = {
  welcome: 'Xin chào! Cảm ơn bạn đã liên hệ. Quản trị viên sẽ phản hồi bạn sớm.',
  wait: 'Cảm ơn bạn đã gửi câu hỏi. Bạn vui lòng chờ quản trị viên vào hỗ trợ nhé.',
};

export function messengerGreeting(template, { customerName, pageName } = {}) {
  if (!Object.hasOwn(acknowledgementTemplates, template)) return '';
  const page = pageName?.trim();
  if (!page) return acknowledgementTemplates[template];
  const customer = customerName?.trim();
  const hello = customer ? 'Xin chào ' + customer + '!' : 'Xin chào!';
  const followUp = template === 'wait'
    ? 'Bạn vui lòng chờ quản trị viên vào hỗ trợ nhé.'
    : 'Quản trị viên sẽ phản hồi bạn sớm.';
  return hello + ' Cảm ơn bạn đã nhắn đến ' + page + '. ' + followUp;
}

export function validateCommentPolicy(value) {
  const phrases = (items) => {
    if (!Array.isArray(items) || items.length > 30 ||
        items.some((item) => typeof item !== 'string' || item.trim().length > 100 || !words(item))) {
      throw new Error('Mỗi danh sách hỗ trợ tối đa 30 cụm từ, mỗi cụm tối đa 100 ký tự.');
    }
    return [...new Set(items.map((item) => item.trim()))];
  };
  if (!Object.hasOwn(acknowledgementTemplates, value?.template ?? '')) {
    throw new Error('Hãy chọn mẫu phản hồi của bot.');
  }
  const include = phrases(value.include);
  if (!include.length) throw new Error('Nhập ít nhất một cụm từ nên phản hồi.');
  return { include, exclude: phrases(value.exclude), template: value.template };
}

export function commentDecision(policy, text) {
  if (!policy) return { category: '', reply: '' };
  const normalized = ' ' + words(text) + ' ';
  const matches = (phrase) => normalized.includes(' ' + words(phrase) + ' ');
  if (policy.exclude.some(matches)) return { category: 'Quy tắc bỏ qua', reply: '' };
  if (!policy.include.some(matches)) return { category: 'Chờ người xử lý', reply: '' };
  return { category: 'Phù hợp quy tắc', reply: acknowledgementTemplates[policy.template] };
}

function moderationWords(text) {
  return text.toLocaleLowerCase('vi').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

export function containsBlockedPhrase(text, phrases=[]) {
  const normalized=' '+moderationWords(text)+' ';
  return phrases.some((phrase)=>normalized.includes(' '+moderationWords(phrase)+' '));
}

export function editableBotPolicy(policy) {
  if (policy?.version === 2) return policy;
  return {
    version:2, blocked:[],
    rules:policy?.include ? [{
      type:'rule', name:'Phản hồi đã cấu hình', include:policy.include, context:[],
      exclude:policy.exclude, reply:acknowledgementTemplates[policy.template], action:'auto',
    }] : [],
  };
}

export function validateBotPolicy(value) {
  function phrases(items, required = false) {
    if (!Array.isArray(items) || items.length > 30 || (required && !items.length) ||
        items.some((item) => typeof item !== 'string' || item.trim().length > 100 || !words(item))) {
      throw new Error('Nhập tối đa 30 cụm từ mỗi ô, mỗi cụm tối đa 100 ký tự. Quy tắc cần có cụm kích hoạt.');
    }
    return [...new Set(items.map((item) => item.trim()))];
  }
  function field(value, limit) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) {
      throw new Error('Điền tên quy tắc và nội dung phản hồi hợp lệ.');
    }
    return value.trim();
  }
  if (value?.version !== 2 || !Array.isArray(value.rules) || value.rules.length > 62 || value.rules.filter((rule)=>rule?.type!=='faq').length > 12 || value.rules.filter((rule)=>rule?.type==='faq').length > 50) {
    throw new Error('Mỗi cấu hình hỗ trợ tối đa 12 quy tắc và 50 FAQ.');
  }
  const rules = value.rules.map((rule) => {
    if (!['auto','review'].includes(rule?.action) && !(rule?.action==='ignore' && rule.type!=='faq')) throw new Error('Chọn cách xử lý cho từng quy tắc.');
    return {
      type:rule.type==='faq'?'faq':'rule',
      ...(rule.type==='faq'?{
        group:rule.group!==undefined&&rule.group!==''?field(rule.group,60):'Chưa phân nhóm',
        enabled:rule.enabled!==false,
        ...(rule.faqId?{faqId:field(rule.faqId,80)}:{}),
      }:{}),
      name:field(rule.name,80), include:phrases(rule.include,true), context:phrases(rule.context),
      exclude:phrases(rule.exclude), ...(rule.type!=='faq'&&rule.action!=='ignore'&&rule.faqRef?{faqRef:field(rule.faqRef,80)}:{}),
      reply:rule.action==='ignore'||(rule.type!=='faq'&&rule.faqRef)?'':field(rule.reply,1000), action:rule.action,
    };
  });
  if (value.conversationAi!==undefined&&!['off','review','auto'].includes(value.conversationAi)) throw new Error('Chọn chế độ OpenRouter hợp lệ.');
  if(value.agentMode!==undefined&&!['off','review','auto'].includes(value.agentMode)) throw new Error('Chọn chế độ AI agent hợp lệ.');
  const agentMarkdown=value.agentMarkdown?field(value.agentMarkdown,8000):'';
  if(value.agentMode&&value.agentMode!=='off'&&!agentMarkdown) throw new Error('Nhập hướng dẫn Markdown cho AI agent.');
  return {version:2, blocked:phrases(value.blocked), rules,
    ...(value.unifiedAgent===true?{unifiedAgent:true}:{}),
    ...(agentMarkdown?{agentMarkdown,agentMode:value.agentMode??'off'}:{}),
    ...(value.conversationAi&&value.conversationAi!=='off'?{conversationAi:value.conversationAi}:{}),
    ...(value.fallback?{fallback:field(value.fallback,500)}:{})};
}

export function decideBotReply(policy, text, {context = '', manualOnly = false, semanticIndex = -1} = {}) {
  const current = ' ' + words(text) + ' ';
  const history = ' ' + words(context) + ' ';
  const contains = (haystack, phrase) => haystack.includes(' ' + words(phrase) + ' ');
  const inCurrent = (phrase) => contains(current, phrase);
  const inContext = (phrase) => inCurrent(phrase) || contains(history, phrase);
  if (containsBlockedPhrase(text,policy.blocked)) return {category:'Nội dung bị chặn', action:'blocked', reply:''};
  const candidates = policy.rules.filter((rule,index) => rule.enabled!==false &&
    (index===semanticIndex||(rule.action==='ignore'?containsBlockedPhrase(text,rule.include):rule.include.some(inCurrent))));
  if (candidates.some((rule) => containsBlockedPhrase(text,rule.exclude))) {
    return {category:'Khớp điều kiện bỏ qua', action:'blocked', reply:''};
  }
  const matches = candidates.filter((rule) => !rule.context.length || rule.context.some(inContext));
  if (semanticIndex>=0&&!matches.includes(policy.rules[semanticIndex])) return {category:'Chờ người xử lý',action:'review',reply:''};
  const ignored=matches.find((rule)=>rule.action==='ignore');
  if(ignored)return {category:'Quy tắc bỏ qua · '+ignored.name,action:'blocked',reply:''};
  const answers=new Map();
  for(const rule of matches){
    const faq=rule.faqRef?policy.rules.find((item)=>item.type==='faq'&&item.enabled!==false&&
      (item.faqId||item.name)===rule.faqRef&&!containsBlockedPhrase(text,item.exclude)&&
      (!item.context.length||item.context.some(inContext))):null;
    if(rule.faqRef&&!faq)continue;
    const answer=faq||rule;
    const action=manualOnly||rule.action==='review'||answer.action==='review'?'review':'auto';
    const prior=answers.get(answer);
    answers.set(answer,{category:answer.name,action:prior?.action==='review'?'review':action,reply:answer.reply});
  }
  if(answers.size===1)return answers.values().next().value;
  return {category:answers.size?'Nhiều quy tắc cùng khớp':'Chờ người xử lý',
    action:'review',reply:answers.size?'':policy.fallback||''};
}

export function renderBotReply(template, {customerName, pageName}) {
  return template.replace(/\{\{(customer_name|page_name)\}\}/g, (_, key) =>
    key === 'customer_name' ? customerName || 'bạn' : pageName).slice(0,1000);
}
