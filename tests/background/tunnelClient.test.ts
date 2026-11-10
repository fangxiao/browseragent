import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  getOrCreateClientId,
  resolveTunnelUrl,
  sendTunnelMessage,
  connectBrowserTunnel,
  closeBrowserTunnel,
  reconnectBrowserTunnel,
  handleInboundToolCall,
  getTunnelStatus,
  reportActiveTab,
  type TunnelOutboundMessage,
} from '../../src/utils/background/tunnelClient';

describe('tunnelClient(端云协同 WebSocket 双向长连接网关 RFC-2026-002)', () => {
  const originalWebSocket = (globalThis as any).WebSocket;
  const originalBrowser = (globalThis as any).browser;

  let mockWsInstance: any = null;
  let sentMessages: string[] = [];

  beforeEach(() => {
    sentMessages = [];
    mockWsInstance = {
      readyState: 1, // OPEN
      send: vi.fn((data: string) => {
        sentMessages.push(data);
      }),
      close: vi.fn(),
    };

    (globalThis as any).WebSocket = vi.fn().mockImplementation(function (this: any, url: string) {
      mockWsInstance.url = url;
      setTimeout(() => {
        if (this.onopen) this.onopen();
      }, 10);
      return mockWsInstance;
    });
    (globalThis as any).WebSocket.OPEN = 1;
    (globalThis as any).WebSocket.CONNECTING = 0;

    (globalThis as any).browser = {
      storage: {
        local: {
          get: vi.fn(async (key?: string | string[]) => {
            if (key === 'aiSettings') {
              return {
                aiSettings: {
                  enableTunnel: true,
                  platformHost: 'http://localhost:8000',
                  platformToken: 'jwt_test_token_123',
                },
              };
            }
            return {
              browseragent_tunnel_client_id: 'test_client_001',
              aiSettings: {
                enableTunnel: true,
                platformHost: 'http://localhost:8000',
                platformToken: 'jwt_test_token_123',
              },
            };
          }),
          set: vi.fn(async () => {}),
        },
      },
      tabs: {
        query: vi.fn(async () => [
          { id: 101, title: 'Notion 定价', url: 'https://www.notion.so/pricing', active: true },
        ]),
        get: vi.fn(async (tabId: number) => ({
          id: tabId,
          url: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2',
          title: '微信公众平台图文草稿',
          status: 'complete',
        })),
        create: vi.fn(async (opts: any) => ({
          id: 303,
          url: opts?.url,
          title: '新建标签页',
          status: 'complete',
        })),
        update: vi.fn(async () => {}),
        sendMessage: vi.fn(async () => ({
          result: { ok: true, data: { summary: '页面摘要' } },
        })),
        onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      scripting: {
        executeScript: vi.fn(async () => [{ result: true }]),
      },
      runtime: {
        sendMessage: vi.fn(async () => {}),
      },
    };
    closeBrowserTunnel();
  });

  afterEach(() => {
    closeBrowserTunnel();
    (globalThis as any).WebSocket = originalWebSocket;
    (globalThis as any).browser = originalBrowser;
  });

  it('getOrCreateClientId: 获取持久化的 Client ID', async () => {
    const id = await getOrCreateClientId();
    expect(id).toBe('test_client_001');
  });

  it('resolveTunnelUrl: 自动解析拼接 WebSocket 地址与 Token', async () => {
    const url = await resolveTunnelUrl();
    expect(url).toContain('ws://localhost:8000/api/browser/tunnel');
    expect(url).toContain('token=jwt_test_token_123');
    expect(url).toContain('client_id=test_client_001');
  });

  it('sendTunnelMessage: 正常通过 WebSocket 发送消息', async () => {
    await connectBrowserTunnel();

    const msg: TunnelOutboundMessage = {
      type: 'PONG',
      clientId: 'test_client_001',
      timestamp: Date.now(),
    };
    const ok = sendTunnelMessage(msg);
    expect(ok).toBe(true);
    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    expect(sentMessages.some((m) => JSON.parse(m).type === 'PONG')).toBe(true);
  });

  it('connectBrowserTunnel: 建立连接并发送 CLIENT_READY 广播', async () => {
    await connectBrowserTunnel();
    expect((globalThis as any).WebSocket).toHaveBeenCalled();
  });

  it('handleInboundToolCall: 当未打开微信后台标签页时，自动开 Tab 唤起并上报实时协同步骤', async () => {
    (globalThis as any).browser.tabs.query = vi.fn(async () => [
      { id: 101, title: 'Notion', url: 'https://notion.so', active: true },
    ]);
    (globalThis as any).browser.tabs.sendMessage = vi.fn(async () => ({
      result: {
        ok: true,
        data: {
          title: '测试微信标题',
          author: '测试作者',
          digest: '测试摘要',
          savedDraft: true,
          note: '🎉 已成功写入微信公众平台草稿！',
        },
      },
    }));
    await connectBrowserTunnel();

    await handleInboundToolCall(
      'call_test_001',
      {
        name: 'browser.wechat_draft',
        args: {
          title: '测试微信标题',
          author: '测试作者',
          digest: '测试摘要',
          htmlContent: '<p>正文</p>',
        },
      },
      'test_client_001',
    );

    const msgs = sentMessages.map((m) => JSON.parse(m));
    const progressMsgs = msgs.filter((m) => m.type === 'TOOL_PROGRESS' && m.callId === 'call_test_001');
    expect(progressMsgs.length).toBeGreaterThanOrEqual(1);
    expect((globalThis as any).browser.tabs.create).toHaveBeenCalled();

    const resultMsg = msgs.find((m) => m.type === 'TOOL_RESULT' && m.callId === 'call_test_001');
    expect(resultMsg).toBeDefined();
    expect(resultMsg.result.success).toBe(true);
  });

  it('handleInboundToolCall: 当找到微信后台标签页时，成功路由至草稿注入工具', async () => {
    (globalThis as any).browser.tabs.query = vi.fn(async () => [
      { id: 202, title: '微信公众平台图文素材', url: 'https://mp.weixin.qq.com/cgi-bin/appmsg', active: true },
    ]);
    (globalThis as any).browser.tabs.sendMessage = vi.fn(async () => ({
      result: {
        ok: true,
        data: {
          title: 'Python入门',
          author: 'Agent',
          digest: '简介',
          note: '🎉 已成功将精美排版内容写入微信公众平台草稿！',
        },
      },
    }));
    await connectBrowserTunnel();

    await handleInboundToolCall(
      'call_wechat_002',
      {
        name: 'browser.wechat_draft',
        args: {
          title: 'Python入门',
          author: 'Agent',
          digest: '简介',
          htmlContent: '<p>文章内容</p>',
        },
      },
      'test_client_001',
    );

    const resultMsg = sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === 'TOOL_RESULT' && m.callId === 'call_wechat_002');
    expect(resultMsg).toBeDefined();
    expect(resultMsg.result.success).toBe(true);
    expect(resultMsg.result.tabId).toBe(202);
  });

  it('handleInboundToolCall: 处理 browser.list_tabs 请求', async () => {
    await connectBrowserTunnel();
    await handleInboundToolCall(
      'call_tabs_001',
      {
        name: 'browser.list_tabs',
      },
      'test_client_001',
    );

    const resultMsg = sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === 'TOOL_RESULT' && m.callId === 'call_tabs_001');
    expect(resultMsg).toBeDefined();
    expect(resultMsg.result.success).toBe(true);
    expect(resultMsg.result.tabs.length).toBe(1);
  });

  it('reconnectBrowserTunnel: 手动立即重连', async () => {
    const res = await reconnectBrowserTunnel();
    expect(res.ok).toBe(true);
  });
});
