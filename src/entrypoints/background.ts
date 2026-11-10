// 后台入口:消息路由 + AI 请求(规避 content 侧 CORS)。见 docs/design/design.md §1、docs/design/agent.md
// 流式:sidepanel 经 Port 发起 AI:START(对话流)/ AGENT:START(Agent 流),background 逐事件推送
import { getSettings, saveSettings } from '@/utils/storage';
import { fetchAndSyncCloudConfig } from '@/utils/ai/remoteConfig';
import type { BgRequest } from '@/utils/messaging';
import { setupStreamPortHandler } from '@/utils/background/streamPortHandler';
import { setupAgentPortHandler } from '@/utils/background/agentPortHandler';
import {
  setupBrowserTunnel,
  getTunnelStatus,
  reconnectBrowserTunnel,
  connectBrowserTunnel,
  closeBrowserTunnel,
} from '@/utils/background/tunnelClient';
import { appendActionToSession } from '@/utils/workflow/storage';

export default defineBackground(() => {
  console.log('[ai-agent] background service worker started');

  // 扩展安装/更新/重新加载监听: 标记需要开启全新会话
  browser.runtime.onInstalled.addListener((details) => {
    console.log('[ai-agent] extension installed/updated:', details.reason);
    void browser.storage.local.set({
      extension_needs_fresh_session: true,
      last_installed_reason: details.reason,
      last_installed_at: Date.now(),
    });
  });

  // 后台启动时静默尝试同步一次云端 Agent 规则(无网络时自动降级使用内置规则)
  void fetchAndSyncCloudConfig().catch(() => {});

  // 自动为已有打开的标签页注入 content script(避免重载扩展后老标签页无 content script)
  const injectContentScriptToExistingTabs = async () => {
    try {
      const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
      for (const tab of tabs) {
        if (tab.id != null) {
          browser.scripting
            .executeScript({
              target: { tabId: tab.id },
              files: ['/content-scripts/content.js'],
            })
            .catch(() => {});
        }
      }
    } catch {
      /* 忽略异常 */
    }
  };
  void injectContentScriptToExistingTabs();

  // 监听设置变化(实时启停隧道与更新服务配置)
  browser.storage?.local?.onChanged?.addListener((changes) => {
    if (changes.aiSettings?.newValue) {
      const newSettings = changes.aiSettings.newValue as any;
      if (newSettings.enableTunnel) {
        void connectBrowserTunnel();
      } else {
        closeBrowserTunnel();
      }
    }
  });

  // 点击扩展图标 → 自动打开侧边栏(Chrome 116+)
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => console.warn('[ai-agent] setPanelBehavior 失败'));

  // 一次性消息:设置读写 / 打开侧边栏 / 隧道管理 / 工作流打开 URL
  browser.runtime.onMessage.addListener(
    (msg: BgRequest): Promise<unknown> | undefined => {
      if (msg?.type === 'SETTINGS:GET') {
        return getSettings().then((settings) => ({ type: 'SETTINGS:RESULT', settings }));
      }
      if (msg?.type === 'SETTINGS:SAVE') {
        return saveSettings(msg.settings).then(() => {
          if (msg.settings.enableTunnel) {
            void connectBrowserTunnel();
          } else {
            closeBrowserTunnel();
          }
          return { type: 'OK' };
        });
      }
      if (msg?.type === 'TUNNEL:GET_STATUS') {
        return Promise.resolve({ ok: true, status: getTunnelStatus() });
      }
      if (msg?.type === 'TUNNEL:RECONNECT') {
        return reconnectBrowserTunnel().then((res) => ({ ok: true, status: res.status }));
      }
      if (msg?.type === 'TUNNEL:AUTO_DETECT_TOKEN') {
        return import('@/utils/background/tunnelClient').then(({ tryAutoDetectPlatformToken }) =>
          tryAutoDetectPlatformToken().then((token) => ({ ok: Boolean(token), token })),
        );
      }
      if (msg?.type === 'OPEN_SIDEPANEL') {
        return browser.sidePanel
          .open({ windowId: (globalThis as any).currentWindowId })
          .catch(() => browser.action?.openPopup?.());
      }
      if ((msg as any)?.type === 'WORKFLOW:OPEN_URL') {
        const targetUrl = (msg as any).url;
        const isBlank = (msg as any).target === '_blank';
        if (isBlank) {
          return browser.tabs.create({ url: targetUrl, active: true }).then((tab) => ({ ok: true, tabId: tab.id }));
        }
        return browser.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
          if (activeTab?.id) {
            return browser.tabs.update(activeTab.id, { url: targetUrl }).then(() => ({ ok: true }));
          }
          return browser.tabs.create({ url: targetUrl, active: true }).then((tab) => ({ ok: true, tabId: tab.id }));
        });
      }
      if ((msg as any)?.type === 'WORKFLOW:RECORD_ACTION') {
        const action = (msg as any).action;
        if (action) {
          return appendActionToSession(action).then((count) => ({ ok: true, count }));
        }
      }
      return undefined;
    },
  );

  // 监听网页划词即问与局部透镜消息
  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type === 'SIDEBAR:QUICK_ASK' && msg.prompt) {
      if ((browser.sidePanel as any)?.open) {
        try {
          if (sender.tab?.id != null) {
            void (browser.sidePanel as any).open({ tabId: sender.tab.id });
          } else if (sender.tab?.windowId != null) {
            void (browser.sidePanel as any).open({ windowId: sender.tab.windowId });
          }
        } catch {
          /* 忽略异常 */
        }
      }
      setTimeout(() => {
        try {
          void browser.runtime.sendMessage({
            type: 'SIDEBAR:APPLY_PROMPT',
            prompt: msg.prompt,
          });
        } catch {
          /* 忽略异常 */
        }
      }, 150);
    }
  });

  // 注册对话流与 Agent 端口处理器
  setupStreamPortHandler();
  setupAgentPortHandler();

  // 启动与 AgentPlatform 平台的双向长连接网关 (RFC-E1)
  setupBrowserTunnel();
});
