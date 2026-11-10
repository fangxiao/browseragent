import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  startNetworkRecording,
  stopNetworkRecording,
  mockNetworkResponse,
  emulateDevice,
  executeCdpTool,
} from '../../src/utils/background/tools/cdpTools';

describe('cdpTools(Chrome DevTools Protocol 深度网络拦截与调试)', () => {
  const originalChrome = (globalThis as any).chrome;
  let mockEventHandlers: Array<(source: any, method: string, params: any) => void> = [];
  let sentCommands: Array<{ tabId: number; method: string; params: any }> = [];

  beforeEach(() => {
    mockEventHandlers = [];
    sentCommands = [];

    (globalThis as any).chrome = {
      debugger: {
        attach: vi.fn(async () => {}),
        detach: vi.fn(async () => {}),
        sendCommand: vi.fn(async ({ tabId }: any, method: string, params: any) => {
          sentCommands.push({ tabId, method, params });
          if (method === 'Network.getResponseBody') {
            return { body: '{"code":0,"data":{"userId":123}}', base64Encoded: false };
          }
          return {};
        }),
        onEvent: {
          addListener: vi.fn((fn: any) => {
            mockEventHandlers.push(fn);
          }),
        },
        onDetach: {
          addListener: vi.fn(),
        },
      },
    };
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
  });

  it('startNetworkRecording & stopNetworkRecording: 开启网络监听并捕获 API 请求', async () => {
    const tabId = 101;
    const startRes = await startNetworkRecording(tabId, { filterUrls: ['api.example.com'] });
    expect(startRes.ok).toBe(true);

    // 模拟 CDP 事件到达
    for (const handler of mockEventHandlers) {
      handler(
        { tabId },
        'Network.requestWillBeSent',
        {
          requestId: 'req_1',
          type: 'XHR',
          request: {
            url: 'https://api.example.com/v1/user/info',
            method: 'GET',
            headers: { Authorization: 'Bearer token123' },
          },
        },
      );
      handler(
        { tabId },
        'Network.responseReceived',
        {
          requestId: 'req_1',
          response: {
            status: 200,
            statusText: 'OK',
            mimeType: 'application/json',
            headers: { 'content-type': 'application/json' },
          },
        },
      );
    }

    const stopRes = await stopNetworkRecording(tabId, { fetchBodies: true });
    expect(stopRes.ok).toBe(true);
    const data = stopRes.data as any;
    expect(data?.totalRequests).toBe(1);
    expect(data?.apiCount).toBe(1);
    expect(data?.apiRequests?.[0]?.url).toBe('https://api.example.com/v1/user/info');
    expect(data?.apiRequests?.[0]?.responsePreview).toContain('userId');
  });

  it('mockNetworkResponse: 成功配置 Fetch 拦截规则', async () => {
    const tabId = 102;
    const res = await mockNetworkResponse(tabId, {
      urlPattern: '*/api/order/list*',
      responseJson: { success: true, list: [{ id: 1, name: '订单A' }] },
      statusCode: 200,
    });

    expect(res.ok).toBe(true);
    expect((res.data as any)?.urlPattern).toBe('*/api/order/list*');
    expect(sentCommands.some((c) => c.method === 'Fetch.enable')).toBe(true);
  });

  it('emulateDevice: 通过 CDP 模拟移动端视口', async () => {
    const tabId = 103;
    const res = await emulateDevice(tabId, {
      width: 390,
      height: 844,
      mobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    });

    expect(res.ok).toBe(true);
    expect((res.data as any)?.width).toBe(390);
    expect(sentCommands.some((c) => c.method === 'Emulation.setDeviceMetricsOverride')).toBe(true);
    expect(sentCommands.some((c) => c.method === 'Emulation.setUserAgentOverride')).toBe(true);
  });

  it('executeCdpTool: 统一路由分发工具调用', async () => {
    const callRes = await executeCdpTool(
      {
        id: 'call_1',
        name: 'emulateDevice',
        args: { width: 375, height: 667, tabId: 201 },
      },
      201,
    );

    expect(callRes?.ok).toBe(true);
    expect((callRes?.data as any)?.width).toBe(375);
  });
});
