import { getSettings, saveSettings } from '../storage';
import type { ToolCall, ToolResult } from '../domTools/types';
import { callToolInTab } from './tabFallback';
import { executeTabTool } from './tools/tabTools';
import { executeCdpTool } from './tools/cdpTools';
import { executeBookmarkTool } from './tools/bookmarkTools';
import { executeHistoryAndDataTool } from './tools/historyTools';
import { executeWorkspaceTool } from './tools/workspaceTools';
import { executeWorkflowTool } from './tools/workflowTools';

export type TunnelStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

export interface TunnelInboundMessage {
  type: 'TOOL_CALL' | 'PING' | 'GET_TABS' | 'BROADCAST_STATUS';
  callId?: string;
  toolCall?: {
    name: string;
    args?: Record<string, unknown>;
    tabId?: number;
  };
}

export interface TunnelOutboundResult {
  success: boolean;
  ok?: boolean;
  message?: string;
  error?: string;
  tabId?: number;
  data?: unknown;
  tabs?: Array<{ id: number; title: string; url: string; active: boolean }>;
  [key: string]: unknown;
}

export interface TunnelProgressUpdate {
  step: string;
  message: string;
  percent?: number;
  data?: Record<string, unknown>;
}

export interface TunnelOutboundMessage {
  type:
    | 'TOOL_RESULT'
    | 'TOOL_PROGRESS'
    | 'PONG'
    | 'PING'
    | 'TABS_LIST'
    | 'CLIENT_READY'
    | 'STATUS_UPDATE'
    | 'TAB_UPDATE';
  callId?: string;
  clientId: string;
  progress?: TunnelProgressUpdate;
  result?: TunnelOutboundResult;
  tabs?: Array<{ id: number; title: string; url: string; active: boolean }>;
  tab?: {
    id: number;
    title: string;
    url: string;
  };
  timestamp: number;
}

const CLIENT_ID_KEY = 'browseragent_tunnel_client_id';
const TUNNEL_STATUS_KEY = 'browseragent_tunnel_status';
const DEFAULT_TUNNEL_URL = 'ws://localhost:8000/api/browser/tunnel';

let ws: WebSocket | null = null;
let reconnectTimer: any = null;
let tabReportTimer: any = null;
let isConnecting = false;
let cachedClientId = '';
let currentTunnelStatus: TunnelStatus = 'disconnected';
let backoffDelay = 1000; // 指数退避起始延迟 (1s, 2s, 4s, 8s...)
let listenersAttached = false;

/** 更新并广播当前连接状态 */
function updateTunnelStatus(status: TunnelStatus): void {
  currentTunnelStatus = status;
  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      void browser.storage.local.set({ [TUNNEL_STATUS_KEY]: status });
    }
    if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
      void browser.runtime.sendMessage({ type: 'TUNNEL:STATUS_CHANGE', status }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

/** 获取当前隧道连接状态 */
export function getTunnelStatus(): TunnelStatus {
  return currentTunnelStatus;
}

/** 跨平台发送隧道上行消息 */
export function sendTunnelMessage(msg: TunnelOutboundMessage): boolean {
  if (!ws || (ws.readyState !== 1 && (typeof WebSocket === 'undefined' || ws.readyState !== WebSocket.OPEN))) {
    return false;
  }
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

/** 向平台网关上报工具执行的中间步骤进度 (SSE 协同流) */
export function sendTunnelProgress(
  callId: string,
  clientId: string,
  step: string,
  message: string,
  percent?: number,
  data?: Record<string, unknown>,
): boolean {
  return sendTunnelMessage({
    type: 'TOOL_PROGRESS',
    callId,
    clientId,
    progress: {
      step,
      message,
      percent,
      data,
    },
    timestamp: Date.now(),
  });
}

/** 在目标标签页中渲染轻量级拟态协同进度悬浮窗与反馈通知 */
export async function showInTabFeedbackToast(
  tabId: number,
  title: string,
  message: string,
  type: 'info' | 'success' | 'warning' = 'info',
): Promise<void> {
  if (typeof browser === 'undefined' || !browser.scripting?.executeScript) return;
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: (t, m, typ) => {
        const TOAST_ID = '__browseragent_collab_toast__';
        let container = document.getElementById(TOAST_ID);
        if (!container) {
          container = document.createElement('div');
          container.id = TOAST_ID;
          container.style.cssText = `
            position: fixed;
            top: 24px;
            right: 24px;
            z-index: 2147483647;
            padding: 12px 18px;
            border-radius: 10px;
            background: rgba(15, 23, 42, 0.95);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.15);
            display: flex;
            align-items: center;
            gap: 12px;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: auto;
            max-width: 440px;
          `;
          document.body.appendChild(container);
        }
        const icon = typ === 'success' ? '✅' : typ === 'warning' ? '⚠️' : '🤖';
        const borderColor = typ === 'success' ? '#10b981' : typ === 'warning' ? '#f59e0b' : '#3b82f6';
        container.style.borderLeft = `4px solid ${borderColor}`;
        container.innerHTML = `
          <span style="font-size: 20px;">${icon}</span>
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <div style="font-weight: 600; font-size: 13px; color: #f8fafc; display: flex; align-items: center; gap: 6px;">
              <span>${t}</span>
              <span style="font-size: 10px; background: rgba(59, 130, 246, 0.3); color: #93c5fd; padding: 1px 5px; border-radius: 4px;">端云协同</span>
            </div>
            <div style="font-size: 12px; color: #cbd5e1; line-height: 1.4;">${m}</div>
          </div>
        `;
        if ((container as any)._timeout) clearTimeout((container as any)._timeout);
        (container as any)._timeout = setTimeout(() => {
          container?.remove();
        }, 5000);
      },
      args: [title, message, type],
    });
  } catch {
    /* ignore tab script injection failure */
  }
}

/** 获取或持久化生成唯一的 Browser Client ID */
export async function getOrCreateClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId;
  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      const res = (await browser.storage.local.get(CLIENT_ID_KEY)) as { [CLIENT_ID_KEY]?: string };
      if (res[CLIENT_ID_KEY]) {
        cachedClientId = res[CLIENT_ID_KEY];
        return cachedClientId;
      }
    }
  } catch {
    /* ignore */
  }
  cachedClientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    void browser.storage.local.set({ [CLIENT_ID_KEY]: cachedClientId });
  }
  return cachedClientId;
}

/** 判断 JWT Token 是否已过期 */
export function isTokenExpired(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payloadPart = parts[1];
    if (!payloadPart) return false;
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = atob(base64);
    const payload = JSON.parse(jsonStr);
    if (typeof payload.exp === 'number') {
      return Date.now() >= payload.exp * 1000;
    }
  } catch {
    /* ignore parse error */
  }
  return false;
}

/** 尝试自动从已打开的平台标签页获取登录凭证 JWT Token */
export async function tryAutoDetectPlatformToken(): Promise<string | null> {
  if (typeof browser === 'undefined' || !browser.tabs?.query || !browser.scripting?.executeScript) {
    return null;
  }
  try {
    const tabs = await browser.tabs.query({});
    const platformTabs = tabs.filter(
      (t) => t.id && t.url && /localhost|127\.0\.0\.1|agentplatform/i.test(t.url),
    );
    for (const tab of platformTabs) {
      if (tab.id != null) {
        try {
          const res = await browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              try {
                return (
                  localStorage.getItem('agentplatform_token') ||
                  localStorage.getItem('token') ||
                  localStorage.getItem('access_token') ||
                  ''
                );
              } catch {
                return '';
              }
            },
          });
          const found = res?.[0]?.result;
          if (found && typeof found === 'string' && found.length > 20) {
            const candidate = found.trim();
            if (!isTokenExpired(candidate)) {
              return candidate;
            }
          }
        } catch {
          /* ignore tab scripting error */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 计算最终的 WebSocket 连接完整 URL (含 token 与 client_id) */
export async function resolveTunnelUrl(): Promise<string> {
  const settings = await getSettings().catch(() => null);
  const clientId = await getOrCreateClientId();

  let rawUrl = (settings?.tunnelUrl || '').trim();
  if (!rawUrl && settings?.platformHost) {
    let host = settings.platformHost.trim();
    host = host.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    if (!host.startsWith('ws://') && !host.startsWith('wss://')) {
      host = `ws://${host}`;
    }
    if (!host.includes('/api/browser/tunnel')) {
      host = `${host.replace(/\/+$/, '')}/api/browser/tunnel`;
    }
    rawUrl = host;
  }
  if (!rawUrl) {
    rawUrl = DEFAULT_TUNNEL_URL;
  }

  let token = (settings?.platformToken || '').trim();
  // 若存储的 Token 已过期，自动清空避免发送失效凭证
  if (token && isTokenExpired(token)) {
    token = '';
    if (settings) {
      void saveSettings({ ...settings, platformToken: '' });
    }
  }

  if (!token) {
    // 尝试从打开的平台网页中自动读取最新有效 Token
    const detected = await tryAutoDetectPlatformToken();
    if (detected) {
      token = detected;
      if (settings) {
        void saveSettings({ ...settings, platformToken: detected });
      }
    }
  }

  // 本地开发环境直连增强: 若未检测到有效 token 且连接目标为 localhost/127.0.0.1，自动补全 dev 开发令牌
  if (!token && (rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1'))) {
    token = 'dev';
  }

  const separator = rawUrl.includes('?') ? '&' : '?';
  let fullUrl = `${rawUrl}${separator}client_id=${encodeURIComponent(clientId)}`;
  if (token) {
    fullUrl += `&token=${encodeURIComponent(token)}`;
  }
  return fullUrl;
}

/** 执行平台下发的工具调用并严格格式化回填结果 */
export async function handleInboundToolCall(
  callId: string,
  toolCallSpec: { name: string; args?: Record<string, unknown>; tabId?: number },
  clientId: string,
): Promise<void> {
  const name = toolCallSpec.name;
  const rawArgs = toolCallSpec.args || {};
  let targetTabId = toolCallSpec.tabId ?? (typeof rawArgs.tabId === 'number' ? rawArgs.tabId : undefined);

  let formattedResult: TunnelOutboundResult;

  try {
    // 1. 微信公众号草稿注入 (browser.wechat_draft / writeWechatDraft)
    if (name === 'browser.wechat_draft' || name === 'writeWechatDraft' || name === 'wechat_draft') {
      sendTunnelProgress(
        callId,
        clientId,
        'PREPARING',
        '端侧 BrowserAgent 已收到排版注入任务，正在感知浏览器环境...',
        15,
        { title: rawArgs.title },
      );

      let wechatTabId = targetTabId;
      if (!wechatTabId && typeof browser !== 'undefined' && browser.tabs?.query) {
        const allTabs = await browser.tabs.query({});
        const matched = allTabs.find((t) => t.url && /mp\.weixin\.qq\.com/i.test(t.url));
        if (matched?.id != null) {
          wechatTabId = matched.id;
        }
      }

      // 如果未检测到已打开的微信公众平台标签页，自动开 Tab 唤起新建图文页
      if (!wechatTabId && typeof browser !== 'undefined' && browser.tabs?.create) {
        sendTunnelProgress(
          callId,
          clientId,
          'OPENING_TAB',
          '未检测到已打开的微信草稿页，正在为您自动打开微信公众平台【新建图文】页面...',
          30,
        );
        try {
          const newTab = await browser.tabs.create({
            url: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2',
            active: true,
          });
          if (newTab.id != null) {
            wechatTabId = newTab.id;
            // 轮询等待页面加载与 DOM 渲染就绪 (最多等待 12 秒)
            const startTime = Date.now();
            while (Date.now() - startTime < 12000) {
              await new Promise((r) => setTimeout(r, 600));
              try {
                const curTab = await browser.tabs.get(newTab.id);
                // 检查是否重定向到登录页面
                if (
                  curTab.url &&
                  !curTab.url.includes('appmsg_edit') &&
                  (curTab.url.includes('login') || curTab.url.includes('mp.weixin.qq.com/cgi-bin/home'))
                ) {
                  sendTunnelProgress(
                    callId,
                    clientId,
                    'WAITING_LOGIN',
                    '检测到微信公众号未登录，已为您打开登录页，请扫码登录后自动继续...',
                    45,
                  );
                  await showInTabFeedbackToast(
                    wechatTabId,
                    '微信公众平台未登录',
                    '请先在当前页面扫码登录，登录后系统将自动继续为您注入草稿',
                    'warning',
                  );
                  break;
                }
                if (curTab.status === 'complete') {
                  break;
                }
              } catch {
                break;
              }
            }
          }
        } catch {
          /* ignore tab create error */
        }
      }

      if (!wechatTabId) {
        formattedResult = {
          success: false,
          ok: false,
          error: '未检测到微信公众平台草稿页，请先在浏览器打开 mp.weixin.qq.com',
        };
      } else {
        // 激活并聚焦微信标签页
        if (typeof browser !== 'undefined' && browser.tabs?.update) {
          await browser.tabs.update(wechatTabId, { active: true }).catch(() => {});
        }

        await showInTabFeedbackToast(
          wechatTabId,
          'AgentPlatform 协同任务进行中',
          `正在自动注入《${rawArgs.title || '图文长文'}》的标题、摘要与全内联排版正文...`,
          'info',
        );

        sendTunnelProgress(
          callId,
          clientId,
          'INJECTING_DOM',
          '已锁定微信公众平台编辑页，正在自动注入爆款标题、作者、120字摘要及科技蓝全内联主题正文...',
          60,
          { tabId: wechatTabId },
        );

        const wechatToolCall: ToolCall = {
          id: callId,
          name: 'writeWechatDraft',
          args: {
            title: rawArgs.title,
            author: rawArgs.author,
            digest: rawArgs.digest,
            htmlContent: rawArgs.htmlContent ?? rawArgs.contentHtml,
            contentMarkdown: rawArgs.contentMarkdown,
            theme: rawArgs.theme || 'tech-blue',
          },
        };
        const execRes = await callToolInTab(wechatTabId, wechatToolCall);
        if (execRes.ok !== false) {
          sendTunnelProgress(
            callId,
            clientId,
            'SAVING_DRAFT',
            '正文与样式注入完成，已自动触发微信「保存为草稿」并成功落盘！',
            95,
          );

          await showInTabFeedbackToast(
            wechatTabId,
            '🎉 协同任务已完成',
            `《${rawArgs.title || '图文长文'}》已成功注入微信草稿箱并保存！`,
            'success',
          );

          formattedResult = {
            success: true,
            ok: true,
            message: (execRes.data as any)?.note || `已成功注入微信公众平台草稿箱 (标题: "${rawArgs.title || '无'}")`,
            tabId: wechatTabId,
            data: execRes.data,
          };
        } else {
          await showInTabFeedbackToast(
            wechatTabId,
            '⚠️ 协同注入未完成',
            execRes.error || '未检测到微信图文编辑框，请确保处于【新建图文】页面',
            'warning',
          );

          formattedResult = {
            success: false,
            ok: false,
            error: execRes.error || '微信公众号草稿注入失败',
            tabId: wechatTabId,
          };
        }
      }
    } else if (name === 'browser.list_tabs' || name === 'list_tabs' || name === 'listTabs') {
      // 2. 标签页列表获取
      let tabsList: Array<{ id: number; title: string; url: string; active: boolean }> = [];
      if (typeof browser !== 'undefined' && browser.tabs?.query) {
        const rawTabs = await browser.tabs.query({ currentWindow: true });
        tabsList = rawTabs.filter((t) => t.id && t.url).map((t) => ({
          id: t.id!,
          title: t.title || '未命名网页',
          url: t.url!,
          active: Boolean(t.active),
        }));
      }
      formattedResult = {
        success: true,
        ok: true,
        tabs: tabsList,
        message: `共获取到 ${tabsList.length} 个标签页`,
      };
    } else if (name === 'browser.extract_dom' || name === 'extract_dom') {
      // 3. 页面 DOM / 表格数据提取
      if (!targetTabId && typeof browser !== 'undefined' && browser.tabs?.query) {
        const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
        targetTabId = activeTab?.id;
      }
      targetTabId = targetTabId || 1;

      const subAction = rawArgs.format === 'table' || rawArgs.mode === 'table' ? 'extractData' : 'readPage';
      const domToolCall: ToolCall = {
        id: callId,
        name: subAction,
        args: rawArgs,
      };
      const res = await callToolInTab(targetTabId, domToolCall);
      formattedResult = {
        success: res.ok !== false,
        ok: res.ok !== false,
        data: res.data,
        error: res.error,
        message: res.ok !== false ? 'DOM/网页数据提取成功' : undefined,
        tabId: targetTabId,
      };
    } else if (name === 'browser.action' || name === 'action') {
      // 4. 拟人化点击 / 输入 / 滚动动作
      if (!targetTabId && typeof browser !== 'undefined' && browser.tabs?.query) {
        const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
        targetTabId = activeTab?.id;
      }
      targetTabId = targetTabId || 1;

      const actionName = (rawArgs.action as string) || (rawArgs.name as string) || 'clickElement';
      const actionToolCall: ToolCall = {
        id: callId,
        name: actionName,
        args: rawArgs,
      };
      const res = await callToolInTab(targetTabId, actionToolCall);
      formattedResult = {
        success: res.ok !== false,
        ok: res.ok !== false,
        data: res.data,
        error: res.error,
        message: res.ok !== false ? '页面动作执行完成' : undefined,
        tabId: targetTabId,
      };
    } else {
      // 5. 通用工具 Fallback 链路
      if (!targetTabId && typeof browser !== 'undefined' && browser.tabs?.query) {
        const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
        targetTabId = activeTab?.id;
      }
      targetTabId = targetTabId || 1;

      const toolCall: ToolCall = {
        id: callId,
        name,
        args: rawArgs,
      };

      let res: ToolResult | null = null;
      res = await executeTabTool(toolCall, targetTabId);
      if (!res) res = await executeCdpTool(toolCall, targetTabId);
      if (!res) res = await executeBookmarkTool(toolCall);
      if (!res) res = await executeHistoryAndDataTool(toolCall);
      if (!res) res = await executeWorkspaceTool(toolCall);
      if (!res) res = await executeWorkflowTool(toolCall, targetTabId, callToolInTab);
      if (!res) res = await callToolInTab(targetTabId, toolCall);

      formattedResult = {
        success: res.ok !== false,
        ok: res.ok !== false,
        data: res.data,
        error: res.error,
        message: (res.data as any)?.note || (res.ok !== false ? '执行成功' : res.error),
        tabId: targetTabId,
      };
    }
  } catch (err) {
    formattedResult = {
      success: false,
      ok: false,
      error: `隧道执行异常: ${(err as Error).message}`,
    };
  }

  // 严格按规范回传 TOOL_RESULT
  sendTunnelMessage({
    type: 'TOOL_RESULT',
    callId,
    clientId,
    result: formattedResult,
    timestamp: Date.now(),
  });
}

/** 上报当前活跃标签页更新 (TAB_UPDATE) */
export async function reportActiveTab(): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (tabReportTimer) clearTimeout(tabReportTimer);
  tabReportTimer = setTimeout(async () => {
    try {
      if (typeof browser !== 'undefined' && browser.tabs?.query) {
        const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.id != null && activeTab.url) {
          const clientId = await getOrCreateClientId();
          sendTunnelMessage({
            type: 'TAB_UPDATE',
            clientId,
            tab: {
              id: activeTab.id,
              title: activeTab.title || '未命名网页',
              url: activeTab.url,
            },
            timestamp: Date.now(),
          });
        }
      }
    } catch {
      /* ignore */
    }
  }, 150);
}

/** 建立与云端网关的 WebSocket 双向连接 */
export async function connectBrowserTunnel(): Promise<void> {
  if (typeof WebSocket === 'undefined') return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (isConnecting) return;

  const settings = await getSettings().catch(() => null);
  // 仅在用户开启端云隧道开关时连接，避免无本地服务时控制台报错
  if (!settings?.enableTunnel) {
    isConnecting = false;
    updateTunnelStatus('disconnected');
    return;
  }

  isConnecting = true;
  updateTunnelStatus(currentTunnelStatus === 'connected' ? 'connecting' : 'reconnecting');

  const clientId = await getOrCreateClientId();
  const fullUrl = await resolveTunnelUrl();

  try {
    ws = new WebSocket(fullUrl);

    ws.onopen = async () => {
      isConnecting = false;
      backoffDelay = 1000; // 重置指数退避
      updateTunnelStatus('connected');
      console.log('[browser-tunnel] Connected to AgentPlatform WebSocket Bridge:', fullUrl);

      // 上报 Client 准备就绪并携带初始活跃 Tab 列表
      let tabsList: any[] = [];
      if (typeof browser !== 'undefined' && browser.tabs?.query) {
        try {
          const rawTabs = await browser.tabs.query({ currentWindow: true });
          tabsList = rawTabs.filter((t) => t.id && t.url).map((t) => ({
            id: t.id!,
            title: t.title || '未命名网页',
            url: t.url!,
            active: Boolean(t.active),
          }));
        } catch {
          /* ignore */
        }
      }

      sendTunnelMessage({
        type: 'CLIENT_READY',
        clientId,
        tabs: tabsList,
        timestamp: Date.now(),
      });
    };

    ws.onmessage = async (evt) => {
      try {
        const data = JSON.parse(evt.data) as TunnelInboundMessage;
        if (!data || !data.type) return;

        if (data.type === 'PING') {
          sendTunnelMessage({ type: 'PONG', clientId, timestamp: Date.now() });
          return;
        }

        if (data.type === 'GET_TABS') {
          let tabsList: any[] = [];
          if (typeof browser !== 'undefined' && browser.tabs?.query) {
            const rawTabs = await browser.tabs.query({ currentWindow: true });
            tabsList = rawTabs.filter((t) => t.id && t.url).map((t) => ({
              id: t.id!,
              title: t.title || '未命名网页',
              url: t.url!,
              active: Boolean(t.active),
            }));
          }
          sendTunnelMessage({
            type: 'TABS_LIST',
            clientId,
            tabs: tabsList,
            timestamp: Date.now(),
          });
          return;
        }

        if (data.type === 'TOOL_CALL' && data.callId && data.toolCall) {
          void handleInboundToolCall(data.callId, data.toolCall, clientId);
        }
      } catch {
        /* ignore invalid json */
      }
    };

    ws.onerror = () => {
      isConnecting = false;
    };

    ws.onclose = (evt: CloseEvent) => {
      isConnecting = false;
      ws = null;
      void getSettings().then((curr) => {
        if (curr?.enableTunnel) {
          // 若因服务端鉴权拒绝 (1008) 断开，自动清空已失效的平台 Token，便于下次重试自动采用最新凭据/开发降级
          if (evt?.code === 1008 && curr.platformToken) {
            void saveSettings({ ...curr, platformToken: '' });
          }
          updateTunnelStatus('reconnecting');
          if (reconnectTimer) clearTimeout(reconnectTimer);
          const delay = backoffDelay;
          backoffDelay = Math.min(backoffDelay * 2, 30000); // 1s, 2s, 4s, 8s, 16s, 30s
          reconnectTimer = setTimeout(() => {
            void connectBrowserTunnel();
          }, delay);
        } else {
          updateTunnelStatus('disconnected');
        }
      });
    };
  } catch {
    isConnecting = false;
    void getSettings().then((curr) => {
      if (curr?.enableTunnel) {
        updateTunnelStatus('reconnecting');
        if (reconnectTimer) clearTimeout(reconnectTimer);
        const delay = backoffDelay;
        backoffDelay = Math.min(backoffDelay * 2, 30000);
        reconnectTimer = setTimeout(() => {
          void connectBrowserTunnel();
        }, delay);
      } else {
        updateTunnelStatus('disconnected');
      }
    });
  }
}

/** 手动触发立即重连 */
export async function reconnectBrowserTunnel(): Promise<{ ok: boolean; status: TunnelStatus }> {
  closeBrowserTunnel();
  backoffDelay = 1000;
  await connectBrowserTunnel();
  return { ok: true, status: currentTunnelStatus };
}

/** 启动长连接隧道服务并绑定标签页感知监听器 */
export function setupBrowserTunnel(): void {
  if (!listenersAttached && typeof browser !== 'undefined' && browser.tabs) {
    listenersAttached = true;
    const onTabChange = () => {
      void reportActiveTab();
    };
    try {
      browser.tabs.onActivated?.addListener(onTabChange);
      browser.tabs.onUpdated?.addListener((_tabId, changeInfo) => {
        if (changeInfo.url || changeInfo.status === 'complete') {
          onTabChange();
        }
      });
    } catch {
      /* ignore */
    }
  }

  void connectBrowserTunnel();
}

/** 关闭长连接隧道 */
export function closeBrowserTunnel(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (tabReportTimer) clearTimeout(tabReportTimer);
  tabReportTimer = null;
  isConnecting = false;
  if (ws) {
    try {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  updateTunnelStatus('disconnected');
}
