# Telegram AI Inline Bot

支持多AI服务的Telegram Inline Bot，可部署到Cloudflare Workers或Vercel。

## ✨ 功能特性

- 🤖 Inline Bot模式 - 在任意聊天中使用
- 🔄 支持OpenAI格式API（OpenAI、DeepSeek、Groq、OpenRouter等）
- 🧠 支持Anthropic格式API（Claude）
- 🔗 自定义baseURL - 兼容各种API代理
- 🔒 白名单控制 - 限制使用者
- ⚡ 多服务/模型快捷切换

---

## 📋 准备工作

### 1. 创建Telegram Bot

1. 在Telegram中搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot`，按提示设置名称
3. 保存获得的 `Bot Token`（格式如：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`）
4. **重要**：发送 `/setinline` 选择你的bot，设置inline placeholder（如：`输入问题...`）

### 2. 获取你的User ID（用于白名单）

向 [@userinfobot](https://t.me/userinfobot) 发送任意消息，它会回复你的User ID。

### 3. 准备AI服务API Key

根据需要准备以下服务的API Key：
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/
- DeepSeek: https://platform.deepseek.com/
- 或其他兼容OpenAI格式的服务

---

## 🚀 部署方式

### 方式一：部署到 Vercel（推荐，简单）

#### 步骤1：Fork仓库
点击GitHub页面右上角的 `Fork` 按钮，将仓库复制到你的账号下。

#### 步骤2：导入到Vercel
1. 访问 [Vercel](https://vercel.com)，使用GitHub登录
2. 点击 `Add New Project`
3. 选择你fork的 `tgbot` 仓库
4. 点击 `Import`

#### 步骤3：配置环境变量
在部署页面，展开 `Environment Variables`，添加以下变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `TELEGRAM_BOT_TOKEN` | `123456789:ABC...` | 从BotFather获取 |
| `WHITELIST` | `123456789,987654321` | 允许使用的用户ID，逗号分隔，留空允许所有人 |
| `AI_SERVICES` | `{"openai":{...}}` | AI服务配置JSON（见下方） |

#### 步骤4：部署
点击 `Deploy`，等待部署完成。

#### 步骤5：设置Webhook
部署完成后，访问：
```
https://你的项目名.vercel.app/setWebhook
```
看到 `{"ok":true,"result":true}` 表示设置成功。

---

### 方式二：部署到 Cloudflare Workers

#### 步骤1：安装依赖
```bash
git clone https://github.com/dsjbot/tgbot.git
cd tgbot
npm install
```

#### 步骤2：创建KV命名空间
```bash
npx wrangler kv:namespace create USER_SESSIONS
```
记下输出的 `id`，如：`id = "xxxx-xxxx-xxxx"`

#### 步骤3：修改wrangler.toml
在 `wrangler.toml` 末尾添加：
```toml
[[kv_namespaces]]
binding = "USER_SESSIONS"
id = "你的KV命名空间ID"
```

#### 步骤4：设置环境变量
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
# 输入你的Bot Token

npx wrangler secret put WHITELIST
# 输入用户ID，如：123456789,987654321

npx wrangler secret put AI_SERVICES
# 输入AI服务配置JSON
```

#### 步骤5：部署
```bash
npm run deploy:cf
```

#### 步骤6：设置Webhook
访问：
```
https://你的worker名.你的子域.workers.dev/setWebhook
```

---

## ⚙️ AI_SERVICES 配置详解

这是一个JSON对象，包含你要使用的所有AI服务：

```json
{
  "openai": {
    "type": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-xxxxxxxx",
    "models": ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"]
  },
  "claude": {
    "type": "anthropic",
    "baseUrl": "https://api.anthropic.com/v1",
    "apiKey": "sk-ant-xxxxxxxx",
    "models": ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"]
  },
  "deepseek": {
    "type": "openai",
    "baseUrl": "https://api.deepseek.com",
    "apiKey": "sk-xxxxxxxx",
    "models": ["deepseek-chat", "deepseek-coder"]
  },
  "groq": {
    "type": "openai",
    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKey": "gsk_xxxxxxxx",
    "models": ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"]
  }
}
```

### 配置说明

| 字段 | 说明 |
|------|------|
| 键名（如`openai`） | 服务名称，用于切换时显示 |
| `type` | API格式：`openai` 或 `anthropic` |
| `baseUrl` | API地址，可使用代理地址 |
| `apiKey` | 你的API密钥 |
| `models` | 该服务可用的模型列表 |

### 使用API代理示例

如果你使用API代理服务，只需修改 `baseUrl`：

```json
{
  "openai-proxy": {
    "type": "openai",
    "baseUrl": "https://your-proxy.com/v1",
    "apiKey": "your-key",
    "models": ["gpt-4o"]
  }
}
```

---

## 📱 使用方法

在任意Telegram聊天中输入 `@你的机器人用户名`（注意有个空格），然后：

| 输入 | 功能 |
|------|------|
| （空白） | 显示当前状态和帮助 |
| `/s` 或 `/services` | 查看所有AI服务，点击切换 |
| `/m` 或 `/models` | 查看当前服务的模型，点击切换 |
| `/st` 或 `/status` | 查看当前使用的服务和模型 |
| `你的问题` | 直接向AI提问 |

### 使用示例

1. 在任意聊天输入框输入：`@myaibot 今天天气怎么样`
2. 等待AI回复出现在下拉列表
3. 点击回复，发送到当前聊天

### 切换服务/模型

1. 输入 `@myaibot /s` 查看服务列表
2. 点击想要的服务
3. 输入 `@myaibot /m` 查看模型列表
4. 点击想要的模型

---

## ❓ 常见问题

### Q: Inline模式不工作？
确保在BotFather中执行了 `/setinline` 命令开启Inline模式。

### Q: 提示无权限？
检查 `WHITELIST` 配置，确保包含你的User ID，或留空允许所有人。

### Q: AI请求失败？
1. 检查API Key是否正确
2. 检查baseUrl是否正确
3. 检查模型名称是否正确

### Q: 如何添加更多服务？
修改 `AI_SERVICES` 环境变量，添加新的服务配置即可。

### Q: Vercel部署后会话不保存？
Vercel是无状态的，每次请求可能在不同实例。如需持久化会话，建议：
1. 使用Cloudflare Workers + KV
2. 或接入Redis等外部存储

---

## 📄 License

MIT
