# Telegram AI Inline Bot

支持多AI服务的Telegram Inline Bot，可部署到Cloudflare Workers或Vercel。

## 功能

- ✅ Inline Bot模式
- ✅ 支持OpenAI格式API（OpenAI、DeepSeek、Groq等）
- ✅ 支持Anthropic格式API
- ✅ 自定义baseURL
- ✅ 白名单控制
- ✅ 多服务/模型快捷切换

## 使用方法

在任意聊天中输入 `@你的机器人名`:

- 空白 - 显示帮助和当前状态
- `/s` - 查看/切换AI服务
- `/m` - 查看/切换模型
- 直接输入问题 - 向AI提问

## 环境变量

```bash
TELEGRAM_BOT_TOKEN=你的Bot Token

# 白名单（可选，留空允许所有人）
WHITELIST=123456789,987654321

# AI服务配置
AI_SERVICES='{
  "openai": {
    "type": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-xxx",
    "models": ["gpt-4o", "gpt-4o-mini"]
  },
  "claude": {
    "type": "anthropic",
    "baseUrl": "https://api.anthropic.com/v1",
    "apiKey": "sk-ant-xxx",
    "models": ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"]
  },
  "deepseek": {
    "type": "openai",
    "baseUrl": "https://api.deepseek.com/v1",
    "apiKey": "sk-xxx",
    "models": ["deepseek-chat", "deepseek-coder"]
  }
}'
```

## 部署到Cloudflare Workers

1. 安装依赖: `npm install`
2. 创建KV命名空间: `wrangler kv:namespace create USER_SESSIONS`
3. 更新 `wrangler.toml` 添加KV绑定
4. 设置环境变量: `wrangler secret put TELEGRAM_BOT_TOKEN`
5. 部署: `npm run deploy:cf`
6. 访问 `https://你的域名/setWebhook` 设置Webhook

## 部署到Vercel

1. Fork或上传到GitHub
2. 在Vercel导入项目
3. 设置环境变量
4. 部署后访问 `https://你的域名/setWebhook`

## 获取Telegram User ID

向 @userinfobot 发送消息即可获取你的User ID。
