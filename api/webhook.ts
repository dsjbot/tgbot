import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { AIServices, UserSession, InlineQueryResult, AIServiceConfig, ChatMessage } from '../src/types';

// 简化的内存存储 (Vercel无状态，生产环境建议用Redis/KV)
const sessions = new Map<number, UserSession>();

function getEnv() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN!,
    whitelist: new Set(
      (process.env.WHITELIST || '').split(',').filter(Boolean).map(id => parseInt(id.trim()))
    ),
    services: JSON.parse(process.env.AI_SERVICES || '{}') as AIServices,
  };
}

async function callAI(config: AIServiceConfig, model: string, prompt: string): Promise<string> {
  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

  if (config.type === 'anthropic') {
    const response = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 1000, messages }),
    });
    const data = await response.json() as any;
    return data.content?.[0]?.text || 'No response';
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: 1000 }),
  });
  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || 'No response';
}

async function answerInlineQuery(token: string, queryId: string, results: InlineQueryResult[]) {
  await fetch(`https://api.telegram.org/bot${token}/answerInlineQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inline_query_id: queryId, results, cache_time: 0 }),
  });
}

function getSession(userId: number, services: AIServices): UserSession {
  if (sessions.has(userId)) return sessions.get(userId)!;
  const serviceNames = Object.keys(services);
  const defaultService = serviceNames[0];
  return { currentService: defaultService, currentModel: services[defaultService].models[0] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { token, whitelist, services } = getEnv();
  const url = new URL(req.url!, `https://${req.headers.host}`);

  if (url.pathname === '/setWebhook' || url.pathname === '/api/webhook' && req.method === 'GET') {
    const webhookUrl = `https://${req.headers.host}/webhook`;
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });
    return res.json(await response.json());
  }

  if (url.pathname === '/health') {
    return res.send('OK');
  }

  if (req.method !== 'POST') {
    return res.send('Telegram AI Bot');
  }

  const update = req.body;
  if (!update?.inline_query) {
    return res.send('OK');
  }

  const query = update.inline_query;
  const userId = query.from.id;
  const text = query.query.trim();

  // 白名单检查
  if (whitelist.size > 0 && !whitelist.has(userId)) {
    await answerInlineQuery(token, query.id, [{
      type: 'article', id: 'denied', title: '⛔ 无权限',
      input_message_content: { message_text: '您没有使用此机器人的权限' },
    }]);
    return res.send('OK');
  }

  const session = getSession(userId, services);
  let results: InlineQueryResult[] = [];

  // 命令处理
  if (text === '/s' || text === '/services') {
    for (const [name, config] of Object.entries(services)) {
      results.push({
        type: 'article', id: `svc:${name}`,
        title: `${name === session.currentService ? '✅' : '⬜'} ${name}`,
        description: `${config.type} - ${config.models.length}个模型`,
        input_message_content: { message_text: `/use ${name}` },
      });
    }
  } else if (text === '/m' || text === '/models') {
    const svc = services[session.currentService];
    for (const model of svc.models) {
      results.push({
        type: 'article', id: `mdl:${model}`,
        title: `${model === session.currentModel ? '✅' : '⬜'} ${model}`,
        input_message_content: { message_text: `/model ${model}` },
      });
    }
  } else if (text.startsWith('/use ')) {
    const name = text.slice(5).trim();
    if (services[name]) {
      session.currentService = name;
      session.currentModel = services[name].models[0];
      sessions.set(userId, session);
      results.push({
        type: 'article', id: 'ok', title: `✅ 已切换到 ${name}`,
        input_message_content: { message_text: `已切换: ${name} / ${session.currentModel}` },
      });
    }
  } else if (text.startsWith('/model ')) {
    const model = text.slice(7).trim();
    if (services[session.currentService].models.includes(model)) {
      session.currentModel = model;
      sessions.set(userId, session);
      results.push({
        type: 'article', id: 'ok', title: `✅ 已切换到 ${model}`,
        input_message_content: { message_text: `已切换模型: ${model}` },
      });
    }
  } else if (!text) {
    results = [
      { type: 'article', id: 'st', title: `📊 ${session.currentService}/${session.currentModel}`,
        input_message_content: { message_text: `当前: ${session.currentService}/${session.currentModel}` } },
      { type: 'article', id: 'h1', title: '🔄 /s 切换服务',
        input_message_content: { message_text: '/s' } },
      { type: 'article', id: 'h2', title: '🤖 /m 切换模型',
        input_message_content: { message_text: '/m' } },
    ];
  } else {
    // AI查询
    try {
      const svc = services[session.currentService];
      const response = await callAI(svc, session.currentModel, text);
      results.push({
        type: 'article', id: `ai-${Date.now()}`, title: '💬 AI回复',
        description: response.slice(0, 100),
        input_message_content: { message_text: response, parse_mode: 'Markdown' },
      });
    } catch (e) {
      results.push({
        type: 'article', id: 'err', title: '❌ 请求失败',
        input_message_content: { message_text: `错误: ${e}` },
      });
    }
  }

  await answerInlineQuery(token, query.id, results);
  res.send('OK');
}
