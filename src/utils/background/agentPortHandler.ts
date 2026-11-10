// 处理 AGENT:START Agent 流(命名端口 AGENT_PORT_NAME,薄 loop)
import { getSettings } from '@/utils/storage';
import { getClient } from '@/utils/ai/provider';
import { AGENT_PORT_NAME } from '@/utils/messaging';
import type { AgentPortMessage } from '@/utils/messaging';
import { createThinLoopDriver } from '@/utils/ai/driver';
import type { ToolCall, ToolResult } from '@/utils/domTools/types';
import type { AgentRunPayload, AgentEvent } from '@/utils/ai/agentTypes';
import { doNavigate, executeTabTool } from './tools/tabTools';
import { executeBookmarkTool } from './tools/bookmarkTools';
import { executeHistoryAndDataTool } from './tools/historyTools';
import { executeWorkspaceTool } from './tools/workspaceTools';
import { executeWorkflowTool } from './tools/workflowTools';
import { executeCdpTool } from './tools/cdpTools';
import { callToolInTab } from './tabFallback';

export function setupAgentPortHandler(): void {
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
        // 记录初始页面 origin 并注入当前激活标签页的标题与 URL 上下文
        let currentTabInfo = '';
        let currentTabUrl = '';
        try {
          const tab = await browser.tabs.get(payload.tabId);
          currentOrigin = new URL(tab.url ?? 'about:blank').origin;
          currentTabUrl = tab.url ?? '';
          currentTabInfo = `\n\n【当前激活标签页 (Active Tab)】\n- 标签页 ID: ${payload.tabId}\n- 网页标题: "${tab.title ?? '未命名网页'}"\n- 网页 URL: ${tab.url ?? '未知'}`;
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
          { ...payload, currentTabInfo, currentTabUrl },
          {
            onEvent: sendAgentEvent,
            signal: () => ac?.signal ?? new AbortController().signal,
            getCurrentOrigin: () => currentOrigin,
            executeTool: async (call: ToolCall): Promise<ToolResult> => {
              // 1. 标签页管理相关工具
              const tabResult = await executeTabTool(call, payload.tabId);
              if (tabResult) return tabResult;

              // 2. 书签管理相关工具
              const bookmarkResult = await executeBookmarkTool(call);
              if (bookmarkResult) return bookmarkResult;

              // 3. 历史、误关恢复、数据清理、下载记录
              const historyResult = await executeHistoryAndDataTool(call);
              if (historyResult) return historyResult;

              // 4. 工作区快照管理
              const workspaceResult = await executeWorkspaceTool(call);
              if (workspaceResult) return workspaceResult;

              // 5. 工作流 RPA 录制与回放
              const workflowResult = await executeWorkflowTool(call, payload.tabId, callToolInTab);
              if (workflowResult) return workflowResult;

              // 6. CDP 深度网络拦截与调试工具
              const cdpResult = await executeCdpTool(call, payload.tabId);
              if (cdpResult) return cdpResult;

              // 7. captureMarkedScreen: 视觉多模态 Set-of-Marks 截图与标记提取
              if (call.name === 'captureMarkedScreen') {
                const targetTabId = Number(call.args?.tabId) || payload.tabId;
                const maxMarks = Number(call.args?.maxMarks) || 40;
                try {
                  // 1. 在页面打上数字编号遮罩
                  const injectRes = await callToolInTab(targetTabId, {
                    id: `som_${Date.now()}`,
                    name: 'injectSetOfMarks',
                    args: { maxMarks },
                  });

                  // 等待 80ms 确保 DOM 遮罩绘制完成
                  await new Promise((r) => setTimeout(r, 80));

                  // 2. 截取带有编号标记的可视视口图像
                  const tab = await browser.tabs.get(targetTabId);
                  let screenshotUrl = '';
                  if (typeof browser.tabs.captureVisibleTab === 'function') {
                    screenshotUrl = await browser.tabs.captureVisibleTab(tab.windowId, {
                      format: 'jpeg',
                      quality: 75,
                    });
                  }

                  // 3. 立即清理页面遮罩，保持页面清爽
                  await callToolInTab(targetTabId, {
                    id: `som_clean_${Date.now()}`,
                    name: 'removeSetOfMarks',
                    args: {},
                  });

                  const marks = (injectRes?.data as any)?.marks || [];
                  return {
                    ok: true,
                    data: {
                      screenshot: screenshotUrl,
                      marksCount: marks.length,
                      marksSummary: marks
                        .slice(0, 30)
                        .map((m: any) => `[${m.id}] <${m.tag}> ${m.text || m.selector} (坐标 x:${m.center.x}, y:${m.center.y})`),
                      note: `📸 已成功捕获视口并生成 ${marks.length} 个数字编号标记（可用 clickMark 传编号或 clickCoordinate 直接点击）`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `捕获视觉标记屏幕失败: ${(err as Error).message}` };
                }
              }

              // 8. navigate 页面导航
              if (call.name === 'navigate') {
                const url = String(call.args?.url ?? '');
                const targetTabId = Number(call.args?.tabId) || payload.tabId;
                const result = await doNavigate(targetTabId, url);
                if (result.ok && targetTabId === payload.tabId) {
                  try {
                    const tab = await browser.tabs.get(payload.tabId);
                    currentOrigin = new URL(tab.url ?? 'about:blank').origin;
                  } catch {
                    /* 保持原 origin */
                  }
                }
                return result;
              }

              // 9. 其他 DOM 工具(readPage/extractData/clickMark/clickCoordinate 等)
              const targetTabId = Number(call.args?.tabId) || payload.tabId;
              return callToolInTab(targetTabId, call);
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
}
