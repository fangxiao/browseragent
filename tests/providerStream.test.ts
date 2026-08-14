import { describe, expect, it, vi } from 'vitest';
import { createOpenAICompatClient } from '../src/utils/ai/provider/openaiCompat';
import { anthropicClient } from '../src/utils/ai/provider/anthropic';
import type { StreamEvent } from '../src/utils/ai/provider/types';

/** 构造模拟 SSE Response */
function sseResponse(lines: string[], status = 200): Response {
  const body = new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(new TextEncoder().encode(`${l}\n`));
      c.close();
    },
  });
  return new Response(body, { status });
}

async function collect(client: { stream(...args: never[]): AsyncIterable<StreamEvent> }, url: string) {
  const events: StreamEvent[] = [];
  for await (const ev of client.stream(
    { model: 'm', messages: [{ role: 'user', content: 'hi' }] } as never,
    { baseUrl: url, apiKey: 'k' } as never,
  )) {
    events.push(ev);
  }
  return events;
}

describe('openai-compat 流解析', () => {
  it('累积 delta 并结束', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}',
        'data: {"choices":[{"delta":{"content":"好"}}]}',
        'data: [DONE]',
      ]),
    ));
    const events = await collect(createOpenAICompatClient('deepseek'), 'https://api.deepseek.com');
    expect(events.map((e) => (e.type === 'text-delta' ? e.text : e.type))).toEqual(['你', '好', 'done']);
    vi.unstubAllGlobals();
  });

  it('HTTP 错误抛出异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 401 })));
    await expect(collect(createOpenAICompatClient('deepseek'), 'https://api.deepseek.com')).rejects.toThrow(
      /401/,
    );
    vi.unstubAllGlobals();
  });

  it('拼接 /v1/chat/completions 端点', async () => {
    const spy = vi.fn(async () => sseResponse(['data: [DONE]']));
    vi.stubGlobal('fetch', spy);
    await collect(createOpenAICompatClient('deepseek'), 'https://api.deepseek.com');
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(JSON.parse(String(init?.body ?? '{}')).stream).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('anthropic 流解析', () => {
  it('解析 content_block_delta 并结束', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"开始"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"完成"}}',
        'data: {"type":"message_stop"}',
      ]),
    ));
    const events = await collect(anthropicClient, 'https://api.anthropic.com');
    expect(events.map((e) => (e.type === 'text-delta' ? e.text : e.type))).toEqual(['开始', '完成', 'done']);
    vi.unstubAllGlobals();
  });

  it('携带 x-api-key 与 anthropic-version 头', async () => {
    const spy = vi.fn(async () => sseResponse(['data: {"type":"message_stop"}']));
    vi.stubGlobal('fetch', spy);
    await collect(anthropicClient, 'https://api.anthropic.com');
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    vi.unstubAllGlobals();
  });
});
