// sidepanel 与 content/background 的通信封装
import type { DocContent } from './pageExtract/types';
import type { AiSettings } from './ai/provider/types';
import { getSettings, saveSettings } from './storage';
import { STREAM_PORT_NAME, AGENT_PORT_NAME } from './messaging';
import type { PortStreamMessage, PortStartMessage, AgentPortMessage } from './messaging';
import type { AiRunPayload, StreamEvent } from './ai/provider/types';
import type { AgentEvent, AgentRunPayload } from './ai/agentTypes';

/** 请求 content 把 HTML 写回当前文档编辑器(末尾追加 / 光标处) */
export async function writebackToDoc(
  tabId: number,
  html: string,
  mode: 'append' | 'cursor',
): Promise<string> {
  const res = await browser.tabs.sendMessage(tabId, {
    type: mode === 'append' ? 'WRITEBACK:APPEND' : 'WRITEBACK:CURSOR',
    html,
  });
  if (!res || res.type !== 'WRITEBACK:RESULT') {
    throw new Error('写回失败:请确认页面已刷新后重试');
  }
  return res.message;
}

export { getSettings, saveSettings };
export type { AiSettings };

export async function getActiveTabId(): Promise<number | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

/**
 * 请求当前标签页 content script 提取文档。
 * 依赖 manifest 自动注入(content script 随页面加载注入)。
 * 若失败(如页面在扩展重载前已打开),引导用户刷新页面——刷新后 content script 自动注入。
 */
export async function requestExtract(tabId: number): Promise<DocContent> {
  const res = await browser.tabs.sendMessage(tabId, { type: 'EXTRACT:REQUEST' });
  if (!res || res.type !== 'EXTRACT:RESULT') {
    const message =
      res && res.type === 'EXTRACT:ERROR'
        ? res.message
        : '内容脚本未注入:请刷新页面后,再点击"重试读取"';
    throw new Error(message);
  }
  return res.doc;
}

export interface AiStreamHandle {
  stop(): void;
}

/** 建立命名 Port 并推送 AI 事件回调 */
export function startAiStream(
  payload: AiRunPayload,
  onEvent: (event: StreamEvent) => void,
  onDisconnect: () => void,
): AiStreamHandle {
  const port = browser.runtime.connect({ name: STREAM_PORT_NAME });
  port.onMessage.addListener((msg: PortStreamMessage) => {
    if (msg?.type === 'AI:EVENT') onEvent(msg.event);
  });
  port.onDisconnect.addListener(onDisconnect);
  port.postMessage({ type: 'AI:START', payload } satisfies PortStartMessage);
  return { stop: () => port.disconnect() };
}

/** 校验设置完整(至少一个配置好的 provider) */
export function hasUsableProvider(settings: AiSettings): boolean {
  return settings.providers.some((p) => p.apiKey && p.model);
}

export interface AgentSessionHandle {
  /** 响应一次安全确认(confirmId 来自 confirm-request 事件) */
  sendConfirm(confirmId: string, approved: boolean): void;
  /** 请求停止当前 Agent 运行(AGENT:STOP) */
  stop(): void;
}

/** 建立 Agent 会话 Port(智能体模式):事件回推 + 确认响应 + 停止(ADR-0007 §5) */
export function startAgentSession(
  payload: AgentRunPayload,
  onEvent: (event: AgentEvent) => void,
  onDisconnect: () => void,
): AgentSessionHandle {
  const port = browser.runtime.connect({ name: AGENT_PORT_NAME });
  port.onMessage.addListener((msg: AgentPortMessage) => {
    if (msg?.type === 'AGENT:EVENT') onEvent(msg.event);
  });
  port.onDisconnect.addListener(onDisconnect);
  port.postMessage({ type: 'AGENT:START', payload } satisfies AgentPortMessage);
  return {
    sendConfirm: (confirmId, approved) => {
      try {
        port.postMessage({ type: 'AGENT:CONFIRM', confirmId, approved } satisfies AgentPortMessage);
      } catch {
        /* port 已断开(运行已结束),忽略 */
      }
    },
    stop: () => {
      try {
        port.postMessage({ type: 'AGENT:STOP' } satisfies AgentPortMessage);
      } catch {
        /* port 已断开,忽略 */
      }
    },
  };
}
