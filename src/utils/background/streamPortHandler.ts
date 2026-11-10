// 处理 AI:START 对话流(命名端口 STREAM_PORT_NAME)
import { getSettings } from '@/utils/storage';
import { getClient } from '@/utils/ai/provider';
import { buildSystemFor } from '@/utils/ai/prompts';
import { STREAM_PORT_NAME } from '@/utils/messaging';
import type { PortStartMessage, PortStreamMessage } from '@/utils/messaging';
import type { AiRunPayload, StreamEvent } from '@/utils/ai/provider/types';

export function setupStreamPortHandler(): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== STREAM_PORT_NAME) return;

    let ac: AbortController | null = null;
    let running = false;

    const sendEvent = (event: StreamEvent) => {
      try {
        port.postMessage({ type: 'AI:EVENT', event } satisfies PortStreamMessage);
      } catch {
        // port 已断开
      }
    };

    const runAI = async (payload: AiRunPayload) => {
      if (running) return;
      running = true;
      try {
        const settings = await getSettings();
        const cfg = settings.providers.find(
          (p) => p.id === (payload.providerId || settings.activeProviderId),
        );
        if (!cfg || !cfg.apiKey) {
          sendEvent({ type: 'error', message: '未配置 API Key,请先在设置中配置' });
          return;
        }
        ac = new AbortController();
        const client = getClient(cfg.kind);
        // 对话式:system 按能力生成并固定,历史由 sidepanel 携带
        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: buildSystemFor(payload.capability) },
          ...payload.messages,
        ];
        for await (const ev of client.stream(
          { model: cfg.model, messages, signal: ac.signal },
          { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey },
        )) {
          sendEvent(ev);
          if (ev.type === 'done') break;
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          sendEvent({ type: 'error', message: (err as Error).message });
        }
      } finally {
        running = false;
        ac = null;
      }
    };

    port.onMessage.addListener((msg: PortStartMessage) => {
      if (msg?.type === 'AI:START' && msg.payload) void runAI(msg.payload);
    });

    port.onDisconnect.addListener(() => {
      ac?.abort();
      ac = null;
    });
  });
}
