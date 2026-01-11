import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import type { AIServices, UserSession, InlineQueryResult, AIServiceConfig, ChatMessage } from '../src/types';

// Upstash Redis客户端
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

function getEnv() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN!,
    whitelist: new Set(
      (process.env.WHITELIST || '').split(',').filter(Boolean).map(id => parseInt(id.trim()))
    ),
    services: JSON.parse(process.env.AI_SERVICES || '{}') as AIServices,
  };
}

async function callAI(config: AIServiceConfig, model: string, prompt: string, imageUrl?: string): Promise<string> {
  if (config.type === 'anthropic') {
    const content: any[] = [];
    
    if (imageUrl) {
      // 下载图片并转base64
      const imgResponse = await fetch(imageUrl);
      const imgBuffer = await imgResponse.arrayBuffer();
      const base64 = Buffer.from(imgBuffer).toString('base64');
      const mediaType = imgResponse.headers.get('content-type') || 'image/jpeg';
      
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 }
      });
    }
    content.push({ type: 'text', text: prompt });

    const response = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ 
        model, 
        max_tokens: 1000, 
        messages: [{ role: 'user', content }] 
      }),
    });
    const data = await response.json() as any;
    return data.content?.[0]?.text || 'No response';
  }

  // OpenAI格式
  const content: any[] = [];
  if (imageUrl) {
    content.push({ type: 'image_url', image_url: { url: imageUrl } });
  }
  content.push({ type: 'text', text: prompt });

  const messages = [{ role: 'user', content: content.length === 1 ? prompt : content }];

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

// Telegram API调用
async function tgApi(token: string, method: string, body: any) {
  await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function answerInlineQuery(token: string, queryId: string, results: InlineQueryResult[]) {
  await tgApi(token, 'answerInlineQuery', { inline_query_id: queryId, results, cache_time: 0 });
}

async function sendMessage(token: string, chatId: number, text: string, replyMarkup?: any) {
  await tgApi(token, 'sendMessage', { 
    chat_id: chatId, 
    text, 
    parse_mode: 'Markdown',
    reply_markup: replyMarkup 
  });
}

// 获取图片URL
async function getPhotoUrl(token: string, message: any): Promise<string | undefined> {
  const photo = message.photo;
  if (!photo || photo.length === 0) return undefined;
  
  // 获取最大尺寸的图片
  const fileId = photo[photo.length - 1].file_id;
  const fileResponse = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  const fileData = await fileResponse.json() as any;
  
  if (fileData.ok && fileData.result.file_path) {
    return `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`;
  }
  return undefined;
}

// 从Redis获取用户会话
async function getSession(userId: number, services: AIServices): Promise<UserSession> {
  const cached = await redis.get<UserSession>(`session:${userId}`);
  if (cached) return cached;
  
  const serviceNames = Object.keys(services);
  const defaultService = serviceNames[0];
  return { 
    currentService: defaultService, 
    currentModel: services[defaultService].models[0] 
  };
}

// 保存用户会话到Redis
async function saveSession(userId: number, session: UserSession): Promise<void> {
  await redis.set(`session:${userId}`, session, { ex: 86400 * 30 });
}

// 处理私聊消息
async function handleMessage(token: string, message: any, whitelist: Set<number>, services: AIServices) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text?.trim() || '';

  // 白名单检查 - 无权限用户静默忽略
  if (whitelist.size > 0 && !whitelist.has(userId)) {
    return;
  }

  const session = await getSession(userId, services);

  // 命令处理
  if (text === '/start' || text === '/help') {
    const helpText = `🤖 *AI Bot*

当前: \`${session.currentService}\` / \`${session.currentModel}\`

*命令:*
/services - 切换AI服务
/models - 切换模型
/status - 查看当前状态

直接发送消息即可与AI对话`;
    await sendMessage(token, chatId, helpText);
    return;
  }

  if (text === '/status' || text === '/st') {
    await sendMessage(token, chatId, `📊 当前服务: \`${session.currentService}\`\n当前模型: \`${session.currentModel}\``);
    return;
  }

  if (text === '/services' || text === '/s') {
    const buttons = Object.entries(services).map(([name, config]) => [{
      text: `${name === session.currentService ? '✅' : '⬜'} ${name} (${config.type})`,
      callback_data: `svc:${name}`
    }]);
    await sendMessage(token, chatId, '选择AI服务:', { inline_keyboard: buttons });
    return;
  }

  if (text === '/models' || text === '/m') {
    const svc = services[session.currentService];
    const buttons = svc.models.map(model => [{
      text: `${model === session.currentModel ? '✅' : '⬜'} ${model}`,
      callback_data: `mdl:${model}`
    }]);
    await sendMessage(token, chatId, `选择模型 (${session.currentService}):`, { inline_keyboard: buttons });
    return;
  }

  // AI对话
  const msgText = text || message.caption || '';
  if (msgText && !msgText.startsWith('/')) {
    await tgApi(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
    
    // 处理引用消息
    let prompt = msgText;
    const replyTo = message.reply_to_message;
    if (replyTo?.text) {
      prompt = `引用内容:\n"""\n${replyTo.text}\n"""\n\n我的问题: ${msgText}`;
    } else if (replyTo?.caption) {
      prompt = `引用内容:\n"""\n${replyTo.caption}\n"""\n\n我的问题: ${msgText}`;
    }
    
    // 获取图片 (当前消息或引用消息)
    let imageUrl = await getPhotoUrl(token, message);
    if (!imageUrl && replyTo) {
      imageUrl = await getPhotoUrl(token, replyTo);
    }
    
    try {
      const svc = services[session.currentService];
      const response = await callAI(svc, session.currentModel, prompt, imageUrl);
      await sendMessage(token, chatId, response);
    } catch (e) {
      await sendMessage(token, chatId, `❌ 请求失败: ${e}`);
    }
  }
}

// 处理回调按钮
async function handleCallback(token: string, callback: any, services: AIServices) {
  const userId = callback.from.id;
  const chatId = callback.message.chat.id;
  const data = callback.data;
  const session = await getSession(userId, services);

  if (data.startsWith('svc:')) {
    const name = data.slice(4);
    if (services[name]) {
      session.currentService = name;
      session.currentModel = services[name].models[0];
      await saveSession(userId, session);
      await tgApi(token, 'answerCallbackQuery', { 
        callback_query_id: callback.id, 
        text: `已切换到 ${name}` 
      });
      await sendMessage(token, chatId, `✅ 已切换到 \`${name}\` / \`${session.currentModel}\``);
    }
  } else if (data.startsWith('mdl:')) {
    const model = data.slice(4);
    if (services[session.currentService].models.includes(model)) {
      session.currentModel = model;
      await saveSession(userId, session);
      await tgApi(token, 'answerCallbackQuery', { 
        callback_query_id: callback.id, 
        text: `已切换到 ${model}` 
      });
      await sendMessage(token, chatId, `✅ 已切换到模型 \`${model}\``);
    }
  }
}

// 处理Inline Query
async function handleInlineQuery(token: string, query: any, whitelist: Set<number>, services: AIServices) {
  const userId = query.from.id;
  const text = query.query.trim();

  // 无权限用户静默忽略
  if (whitelist.size > 0 && !whitelist.has(userId)) {
    return;
  }

  const session = await getSession(userId, services);
  let results: InlineQueryResult[] = [];

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
      await saveSession(userId, session);
      results.push({
        type: 'article', id: 'ok', title: `✅ 已切换到 ${name}`,
        input_message_content: { message_text: `已切换: ${name} / ${session.currentModel}` },
      });
    }
  } else if (text.startsWith('/model ')) {
    const model = text.slice(7).trim();
    if (services[session.currentService].models.includes(model)) {
      session.currentModel = model;
      await saveSession(userId, session);
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
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { token, whitelist, services } = getEnv();
  const url = new URL(req.url!, `https://${req.headers.host}`);

  // 设置Webhook
  if (url.pathname === '/setWebhook' || (url.pathname === '/api/webhook' && req.method === 'GET')) {
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

  // 处理私聊消息
  if (update?.message) {
    await handleMessage(token, update.message, whitelist, services);
  }
  
  // 处理回调按钮
  if (update?.callback_query) {
    await handleCallback(token, update.callback_query, services);
  }

  // 处理Inline Query
  if (update?.inline_query) {
    await handleInlineQuery(token, update.inline_query, whitelist, services);
  }

  res.send('OK');
}
