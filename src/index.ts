import type { Env } from './types';
import { TelegramBot } from './bot';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 设置Webhook的端点
    if (url.pathname === '/setWebhook') {
      const webhookUrl = `${url.origin}/webhook`;
      const response = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl }),
        }
      );
      const result = await response.json();
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Webhook处理
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const bot = new TelegramBot(env);
      return bot.handleWebhook(request);
    }

    // 健康检查
    if (url.pathname === '/health') {
      return new Response('OK');
    }

    return new Response('Telegram AI Bot', { status: 200 });
  },
};
