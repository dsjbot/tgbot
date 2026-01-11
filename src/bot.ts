import type { Env, AIServices, UserSession, InlineQueryResult } from './types';
import { callAI } from './ai-client';

export class TelegramBot {
  private token: string;
  private whitelist: Set<number>;
  private services: AIServices;
  private kv: KVNamespace;

  constructor(env: Env) {
    this.token = env.TELEGRAM_BOT_TOKEN;
    this.whitelist = new Set(
      env.WHITELIST.split(',').map(id => parseInt(id.trim()))
    );
    this.services = JSON.parse(env.AI_SERVICES);
    this.kv = env.USER_SESSIONS;
  }

  // 获取用户会话
  private async getSession(userId: number): Promise<UserSession> {
    const cached = await this.kv.get(`session:${userId}`);
    if (cached) return JSON.parse(cached);
    
    const serviceNames = Object.keys(this.services);
    const defaultService = serviceNames[0];
    const defaultModel = this.services[defaultService].models[0];
    
    return { currentService: defaultService, currentModel: defaultModel };
  }

  // 保存用户会话
  private async saveSession(userId: number, session: UserSession): Promise<void> {
    await this.kv.put(`session:${userId}`, JSON.stringify(session));
  }

  // 检查白名单
  private isAllowed(userId: number): boolean {
    return this.whitelist.size === 0 || this.whitelist.has(userId);
  }

  // 处理Inline Query
  async handleInlineQuery(query: any): Promise<Response> {
    const userId = query.from.id;
    const text = query.query.trim();

    if (!this.isAllowed(userId)) {
      return this.answerInlineQuery(query.id, [{
        type: 'article',
        id: 'denied',
        title: '⛔ 无权限',
        input_message_content: { message_text: '您没有使用此机器人的权限' },
      }]);
    }

    // 命令处理
    if (text.startsWith('/')) {
      return this.handleCommand(query, text);
    }

    // 空查询显示帮助
    if (!text) {
      return this.showHelp(query);
    }

    // AI查询
    return this.handleAIQuery(query, text);
  }

  // 处理命令
  private async handleCommand(query: any, text: string): Promise<Response> {
    const userId = query.from.id;
    const session = await this.getSession(userId);
    const results: InlineQueryResult[] = [];

    if (text === '/services' || text === '/s') {
      // 列出所有服务
      for (const [name, config] of Object.entries(this.services)) {
        const isCurrent = name === session.currentService;
        results.push({
          type: 'article',
          id: `service:${name}`,
          title: `${isCurrent ? '✅' : '⬜'} ${name}`,
          description: `${config.type} - ${config.models.length}个模型`,
          input_message_content: { message_text: `/use ${name}` },
        });
      }
    } else if (text === '/models' || text === '/m') {
      // 列出当前服务的模型
      const service = this.services[session.currentService];
      for (const model of service.models) {
        const isCurrent = model === session.currentModel;
        results.push({
          type: 'article',
          id: `model:${model}`,
          title: `${isCurrent ? '✅' : '⬜'} ${model}`,
          description: `服务: ${session.currentService}`,
          input_message_content: { message_text: `/model ${model}` },
        });
      }
    } else if (text.startsWith('/use ')) {
      const serviceName = text.slice(5).trim();
      if (this.services[serviceName]) {
        session.currentService = serviceName;
        session.currentModel = this.services[serviceName].models[0];
        await this.saveSession(userId, session);
        results.push({
          type: 'article',
          id: 'switched',
          title: `✅ 已切换到 ${serviceName}`,
          input_message_content: { message_text: `已切换到服务: ${serviceName}\n模型: ${session.currentModel}` },
        });
      }
    } else if (text.startsWith('/model ')) {
      const modelName = text.slice(7).trim();
      const service = this.services[session.currentService];
      if (service.models.includes(modelName)) {
        session.currentModel = modelName;
        await this.saveSession(userId, session);
        results.push({
          type: 'article',
          id: 'model-switched',
          title: `✅ 已切换到 ${modelName}`,
          input_message_content: { message_text: `已切换到模型: ${modelName}` },
        });
      }
    } else if (text === '/status' || text === '/st') {
      results.push({
        type: 'article',
        id: 'status',
        title: `📊 当前状态`,
        description: `${session.currentService} / ${session.currentModel}`,
        input_message_content: { 
          message_text: `当前服务: ${session.currentService}\n当前模型: ${session.currentModel}` 
        },
      });
    }

    return this.answerInlineQuery(query.id, results.length ? results : [{
      type: 'article',
      id: 'unknown',
      title: '❓ 未知命令',
      input_message_content: { message_text: '未知命令，输入空白查看帮助' },
    }]);
  }

  // 显示帮助
  private async showHelp(query: any): Promise<Response> {
    const userId = query.from.id;
    const session = await this.getSession(userId);
    
    const results: InlineQueryResult[] = [
      {
        type: 'article',
        id: 'help-status',
        title: `📊 ${session.currentService} / ${session.currentModel}`,
        description: '当前使用的服务和模型',
        input_message_content: { message_text: `当前: ${session.currentService} / ${session.currentModel}` },
      },
      {
        type: 'article',
        id: 'help-services',
        title: '🔄 /services 或 /s',
        description: '查看并切换AI服务',
        input_message_content: { message_text: '输入 /s 查看服务列表' },
      },
      {
        type: 'article',
        id: 'help-models',
        title: '🤖 /models 或 /m',
        description: '查看并切换模型',
        input_message_content: { message_text: '输入 /m 查看模型列表' },
      },
      {
        type: 'article',
        id: 'help-ask',
        title: '💬 直接输入问题',
        description: '向AI提问',
        input_message_content: { message_text: '直接输入问题即可向AI提问' },
      },
    ];

    return this.answerInlineQuery(query.id, results);
  }

  // 处理AI查询
  private async handleAIQuery(query: any, text: string): Promise<Response> {
    const userId = query.from.id;
    const session = await this.getSession(userId);
    const service = this.services[session.currentService];

    try {
      const response = await callAI(service, session.currentModel, text);
      
      return this.answerInlineQuery(query.id, [{
        type: 'article',
        id: `ai-${Date.now()}`,
        title: '💬 AI回复',
        description: response.slice(0, 100) + (response.length > 100 ? '...' : ''),
        input_message_content: { 
          message_text: response,
          parse_mode: 'Markdown',
        },
      }]);
    } catch (error) {
      return this.answerInlineQuery(query.id, [{
        type: 'article',
        id: 'error',
        title: '❌ 请求失败',
        description: String(error),
        input_message_content: { message_text: `请求失败: ${error}` },
      }]);
    }
  }

  // 发送Inline Query响应
  private async answerInlineQuery(queryId: string, results: InlineQueryResult[]): Promise<Response> {
    await fetch(`https://api.telegram.org/bot${this.token}/answerInlineQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inline_query_id: queryId,
        results,
        cache_time: 0,
      }),
    });
    return new Response('OK');
  }

  // Webhook入口
  async handleWebhook(request: Request): Promise<Response> {
    const update = await request.json() as any;
    
    if (update.inline_query) {
      return this.handleInlineQuery(update.inline_query);
    }

    return new Response('OK');
  }
}
