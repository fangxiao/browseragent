// OpenAI 兼容客户端(覆盖 DeepSeek / OpenAI 兼容端点;tool calling 支持,ADR-0007)
import type { ProviderClient, ProviderKind, StreamEvent, StreamRequest } from './types';
import { readSSEStream } from '../streaming';
import { OpenAIToolCallParser } from '../toolCallParsing';

const stripSlash = (s: string): string => s.replace(/\/+$/, '');

export function createOpenAICompatClient(kind: 'deepseek' | 'openai-compat'): ProviderClient {
  return {
    kind,
    async *stream(req: StreamRequest, opts: { baseUrl: string; apiKey: string }): AsyncGenerator<StreamEvent> {
      const base = stripSlash(opts.baseUrl);
      const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: true,
          // 工具调用(Agent 会话)
          ...(req.tools && req.tools.length > 0
            ? {
                tools: req.tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.input_schema },
                })),
              }
            : {}),
        }),
        signal: req.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`[${kind}] HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const parser = new OpenAIToolCallParser();
      try {
        for await (const line of readSSEStream(res, req.signal)) {
          if (!line || line === '[DONE]') continue;
          try {
            const json = JSON.parse(line);
            parser.feed(json);
            const delta = json?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta) {
              yield { type: 'text-delta', text: delta };
            }
          } catch {
            // 忽略无法解析的行
          }
        }
        for (const call of parser.take()) yield { type: 'tool-use', call };
        yield { type: 'done' };
      } catch (err) {
        yield { type: 'error', message: (err as Error).message };
      }
    },
  };
}
