import type { AIServiceConfig, ChatMessage } from './types';

// OpenAI格式API调用
async function callOpenAIFormat(
  config: AIServiceConfig,
  model: string,
  messages: ChatMessage[]
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json() as any;
  return data.choices[0]?.message?.content || 'No response';
}

// Anthropic格式API调用
async function callAnthropicFormat(
  config: AIServiceConfig,
  model: string,
  messages: ChatMessage[]
): Promise<string> {
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

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
      system: systemMsg?.content,
      messages: chatMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json() as any;
  return data.content[0]?.text || 'No response';
}

// 统一调用入口
export async function callAI(
  config: AIServiceConfig,
  model: string,
  prompt: string
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'user', content: prompt }
  ];

  if (config.type === 'anthropic') {
    return callAnthropicFormat(config, model, messages);
  }
  return callOpenAIFormat(config, model, messages);
}
