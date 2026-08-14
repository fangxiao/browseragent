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

/** 设置页"新增 provider"模板 */
export const PROVIDER_TEMPLATES: Record<ProviderKind, { label: string; baseUrl: string; model: string }> = {
  anthropic: { label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  'openai-compat': { label: 'OpenAI 兼容', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
};
