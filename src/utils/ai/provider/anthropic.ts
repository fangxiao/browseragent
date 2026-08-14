// Anthropic Messages API 客户端(SSE;tool use 支持,ADR-0007)
import type { ProviderClient, StreamEvent, StreamRequest } from './types';
import { readSSEStream } from '../streaming';
import { AnthropicToolUseParser } from '../toolCallParsing';

const stripSlash = (s: string): string => s.replace(/\/+$/, '');

export const anthropicClient: ProviderClient = {
  kind: 'anthropic',
  async *stream(req: StreamRequest, opts: { baseUrl: string; apiKey: string }): AsyncGenerator<StreamEvent> {
    const base = stripSlash(opts.baseUrl);
    const url = `${base}/v1/messages`;
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const messages = req.messages.filter((m) => m.role !== 'system');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        system: system || undefined,
        messages,
        stream: true,
        max_tokens: 4096,
        // 工具调用(Agent 会话)
        ...(req.tools && req.tools.length > 0
          ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })) }
          : {}),
      }),
      signal: req.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[anthropic] HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const parser = new AnthropicToolUseParser();
    try {
      for await (const line of readSSEStream(res, req.signal)) {
        if (!line) continue;
        try {
          const json = JSON.parse(line);
          parser.feed(json);
          if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
            yield { type: 'text-delta', text: json.delta.text };
          } else if (json.type === 'error') {
            yield { type: 'error', message: json.error?.message ?? 'anthropic error' };
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
