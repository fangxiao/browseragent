// 后台入口:消息路由 + AI 请求(规避 content 侧 CORS)。见 docs/design/design.md §1、docs/design/agent.md
// 流式:sidepanel 经 Port 发起 AI:START(对话流)/ AGENT:START(Agent 流),background 逐事件推送
import { getSettings, saveSettings } from '@/utils/storage';
import { getClient } from '@/utils/ai/provider';
import { buildSystemFor } from '@/utils/ai/prompts';
import { STREAM_PORT_NAME, AGENT_PORT_NAME } from '@/utils/messaging';
import type { BgRequest, PortStartMessage, PortStreamMessage, AgentPortMessage } from '@/utils/messaging';
import type { AiRunPayload, StreamEvent } from '@/utils/ai/provider/types';
import type { AgentRunPayload, AgentEvent } from '@/utils/ai/agentTypes';
import { createThinLoopDriver } from '@/utils/ai/driver';
import type { ToolCall, ToolResult } from '@/utils/domTools/types';

export default defineBackground(() => {
  // 点击扩展图标 → 自动打开侧边栏(Chrome 116+)
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => console.warn('[ai-agent] setPanelBehavior 失败'));

  // 一次性消息:设置读写 / 打开侧边栏
  browser.runtime.onMessage.addListener(
    (msg: BgRequest): Promise<unknown> | undefined => {
      if (msg?.type === 'SETTINGS:GET') {
        return getSettings().then((settings) => ({ type: 'SETTINGS:RESULT', settings }));
      }
      if (msg?.type === 'SETTINGS:SAVE') {
        return saveSettings(msg.settings).then(() => ({ type: 'OK' }));
      }
      if (msg?.type === 'OPEN_SIDEPANEL') {
        return browser.sidePanel
          .open({ windowId: (globalThis as any).currentWindowId })
          .catch(() => browser.action?.openPopup?.());
      }
      return undefined;
    },
  );

  // 流式 AI:sidepanel 建立命名 port 后发送 AI:START
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

  // Agent 流:sidepanel 经命名 port 发起 AGENT:START(ADR-0007/0008,薄 loop)
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AGENT_PORT_NAME) return;

    let ac: AbortController | null = null;
    let running = false;
    // 待处理的安全确认:confirmId → 用户响应
    const pendingConfirms = new Map<string, (approved: boolean) => void>();
    // 当前页面 origin(navigate 跨域判定;navigate 后更新)
    let currentOrigin = '';

    const sendAgentEvent = (event: AgentEvent) => {
      try {
        port.postMessage({ type: 'AGENT:EVENT', event } satisfies AgentPortMessage);
      } catch {
        // port 已断开
      }
    };

    /** navigate 由 background 经 tabs.update 执行(E6:content 侧为占位,见 actions.ts) */
    const doNavigate = async (tabId: number, url: string): Promise<ToolResult> => {
      try {
        await browser.tabs.update(tabId, { url });
        // 等待新文档加载完成(content script 随导航自动注入)
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const tab = await browser.tabs.get(tabId);
          if (tab.status === 'complete') return { ok: true, data: { url } };
          await new Promise((r) => setTimeout(r, 300));
        }
        return { ok: true, data: { url, note: '导航已发起(加载超时,请稍候继续操作)' } };
      } catch (err) {
        return { ok: false, error: `导航失败:${(err as Error).message}` };
      }
    };

    const runAgent = async (payload: AgentRunPayload) => {
      if (running) return;
      running = true;
      ac = new AbortController();
      try {
        const settings = await getSettings();
        const cfg = settings.providers.find(
          (p) => p.id === (payload.providerId || settings.activeProviderId),
        );
        if (!cfg || !cfg.apiKey) {
          sendAgentEvent({ type: 'error', message: '未配置 API Key,请先在设置中配置' });
          return;
        }
        const client = getClient(cfg.kind);
        // 记录初始页面 origin(供 navigate 跨域判定)
        try {
          const tab = await browser.tabs.get(payload.tabId);
          currentOrigin = new URL(tab.url ?? 'about:blank').origin;
        } catch {
          currentOrigin = '';
        }
        const driver = createThinLoopDriver({
          streamProvider: ({ messages, tools, signal }) =>
            client.stream(
              { model: cfg.model, messages, signal, tools },
              { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey },
            ),
        });
        await driver.run(
          payload,
          {
            onEvent: sendAgentEvent,
            signal: () => ac?.signal ?? new AbortController().signal,
            getCurrentOrigin: () => currentOrigin,
            executeTool: async (call: ToolCall) => {
              // navigate 不走 content(占位),由 background 直接 tabs.update
              if (call.name === 'navigate') {
                const url = String(call.args?.url ?? '');
                const result = await doNavigate(payload.tabId, url);
                if (result.ok) {
                  try {
                    const tab = await browser.tabs.get(payload.tabId);
                    currentOrigin = new URL(tab.url ?? 'about:blank').origin;
                  } catch {
                    /* 保持原 origin */
                  }
                }
                return result;
              }
              const res = await browser.tabs.sendMessage(payload.tabId, { type: 'TOOL:CALL', call });
              return res?.result ?? { ok: false, error: '内容脚本未注入或已失效,请刷新页面' };
            },
            requestConfirm: async (_call, _reason, confirmId) => {
              return new Promise<boolean>((resolve) => {
                pendingConfirms.set(confirmId, resolve);
              });
            },
          },
        );
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          sendAgentEvent({ type: 'error', message: (err as Error).message });
        }
      } finally {
        running = false;
        ac = null;
        pendingConfirms.clear();
      }
    };

    port.onMessage.addListener((msg: AgentPortMessage) => {
      if (msg?.type === 'AGENT:START' && msg.payload) void runAgent(msg.payload);
      else if (msg?.type === 'AGENT:CONFIRM') {
        const resolve = pendingConfirms.get(msg.confirmId);
        if (resolve) {
          pendingConfirms.delete(msg.confirmId);
          resolve(msg.approved);
        }
      } else if (msg?.type === 'AGENT:STOP') {
        ac?.abort();
        ac = null;
      }
    });

    port.onDisconnect.addListener(() => {
      ac?.abort();
      ac = null;
      pendingConfirms.clear();
    });
  });
});
