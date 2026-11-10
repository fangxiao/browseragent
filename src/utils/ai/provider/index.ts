// provider 客户端工厂与预设模板
import type { ProviderClient, ProviderKind } from './types';
import { anthropicClient } from './anthropic';
import { createOpenAICompatClient } from './openaiCompat';

const cache: Partial<Record<ProviderKind, ProviderClient>> = {};

export function getClient(kind: ProviderKind): ProviderClient {
  let c = cache[kind];
  if (c) return c;
  c = kind === 'anthropic' ? anthropicClient : createOpenAICompatClient(kind);
  cache[kind] = c;
  return c;
}

export interface PresetTemplate {
  key: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  model: string;
  hint?: string;
}

export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    key: 'deepseek',
    kind: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hint: '国内直连推荐，性价比极高，完全遵循 OpenAI 格式',
  },
  {
    key: 'anthropic',
    kind: 'anthropic',
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-7-sonnet-20250219',
    hint: 'Anthropic 原生协议 (/v1/messages)，代码与复杂推理首选',
  },
  {
    key: 'openai',
    kind: 'openai-compat',
    label: 'OpenAI (GPT-4o)',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    hint: 'OpenAI 官方及标准兼容端点 (/v1/chat/completions)',
  },
  {
    key: 'kimi',
    kind: 'openai-compat',
    label: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    hint: 'OpenAI 兼容协议，支持长文档处理',
  },
  {
    key: 'qwen',
    kind: 'openai-compat',
    label: '通义千问 Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    hint: '阿里云 DashScope OpenAI 兼容端点',
  },
  {
    key: 'ollama',
    kind: 'openai-compat',
    label: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:latest',
    hint: '本地开源模型部署，免 API Key / 本地私有运行',
  },
];

/** 设置页"新增 provider"模板兼容映射 */
export const PROVIDER_TEMPLATES: Record<ProviderKind, { label: string; baseUrl: string; model: string }> = {
  anthropic: { label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com', model: 'claude-3-7-sonnet-20250219' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  'openai-compat': { label: 'OpenAI 兼容', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
};
