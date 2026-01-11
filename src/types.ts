// AI服务配置类型
export interface AIServiceConfig {
  baseUrl: string;
  apiKey: string;
  models: string[];
  type: 'openai' | 'anthropic';
}

export interface AIServices {
  [serviceName: string]: AIServiceConfig;
}

// 用户会话状态
export interface UserSession {
  currentService: string;
  currentModel: string;
}

// 环境变量
export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  WHITELIST: string; // 逗号分隔的用户ID
  AI_SERVICES: string; // JSON字符串
  USER_SESSIONS: KVNamespace; // Cloudflare KV存储用户会话
}

// AI消息格式
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Telegram Inline Query Result
export interface InlineQueryResult {
  type: 'article';
  id: string;
  title: string;
  input_message_content: {
    message_text: string;
    parse_mode?: string;
  };
  description?: string;
}
