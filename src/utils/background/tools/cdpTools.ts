// Chrome DevTools Protocol (CDP) 深度网络截获、API 抓取诊断与响应 Mock 工具
import type { ToolCall, ToolResult } from '@/utils/domTools/types';

export interface NetworkRequestRecord {
  requestId: string;
  url: string;
  method: string;
  resourceType?: string;
  statusCode?: number;
  statusText?: string;
  mimeType?: string;
  durationMs?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  isApi: boolean;
  failed?: boolean;
  errorText?: string;
  startTime: number;
}

interface CdpSession {
  tabId: number;
  startTime: number;
  filterUrls?: string[];
  maxRequests: number;
  requests: Map<string, NetworkRequestRecord>;
  mockPatterns: Array<{
    urlPattern: string;
    statusCode: number;
    responseBody: string;
    contentType: string;
  }>;
}

const activeCdpSessions = new Map<number, CdpSession>();
let cdpListenerRegistered = false;

function ensureCdpEventListener(): void {
  if (cdpListenerRegistered) return;
  const chromeGlobal = (globalThis as any).chrome;
  if (typeof chromeGlobal?.debugger?.onEvent?.addListener !== 'function') return;

  chromeGlobal.debugger.onEvent.addListener(
    (source: { tabId?: number }, method: string, params: any) => {
      const tabId = source.tabId;
      if (!tabId) return;
      const session = activeCdpSessions.get(tabId);
      if (!session) return;

      // 1. 请求即将发出
      if (method === 'Network.requestWillBeSent') {
        const req = params.request;
        const requestId = params.requestId;
        if (!req || !requestId) return;

        const isApi =
          params.type === 'XHR' ||
          params.type === 'Fetch' ||
          /\/api\/|\.json(\?|$)|graphql/i.test(req.url);

        // URL 过滤
        if (session.filterUrls && session.filterUrls.length > 0) {
          const match = session.filterUrls.some((f) => req.url.toLowerCase().includes(f.toLowerCase()));
          if (!match) return;
        }

        if (session.requests.size < session.maxRequests) {
          session.requests.set(requestId, {
            requestId,
            url: req.url,
            method: req.method,
            resourceType: params.type,
            requestHeaders: req.headers,
            requestBody: req.postData,
            isApi,
            startTime: Date.now(),
          });
        }
      }

      // 2. 收到响应头
      if (method === 'Network.responseReceived') {
        const requestId = params.requestId;
        const record = session.requests.get(requestId);
        if (record && params.response) {
          record.statusCode = params.response.status;
          record.statusText = params.response.statusText;
          record.mimeType = params.response.mimeType;
          record.responseHeaders = params.response.headers;
          record.durationMs = Date.now() - record.startTime;
        }
      }

      // 3. 请求加载失败
      if (method === 'Network.loadingFailed') {
        const requestId = params.requestId;
        const record = session.requests.get(requestId);
        if (record) {
          record.failed = true;
          record.errorText = params.errorText || '加载失败';
        }
      }

      // 4. Fetch 请求拦截 (用于 Mock)
      if (method === 'Fetch.requestPaused') {
        const requestId = params.requestId;
        const requestUrl = params.request?.url || '';

        const mockRule = session.mockPatterns.find((p) =>
          new RegExp(p.urlPattern.replace(/\*/g, '.*'), 'i').test(requestUrl),
        );

        if (mockRule) {
          // 构造模拟响应
          const base64Body = btoa(unescape(encodeURIComponent(mockRule.responseBody)));
          chromeGlobal.debugger
            .sendCommand(
              { tabId },
              'Fetch.fulfillRequest',
              {
                requestId,
                responseCode: mockRule.statusCode,
                responseHeaders: [
                  { name: 'Content-Type', value: mockRule.contentType },
                  { name: 'Access-Control-Allow-Origin', value: '*' },
                ],
                body: base64Body,
              },
            )
            .catch(() => {});
        } else {
          // 放行其他未匹配请求
          chromeGlobal.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId }).catch(() => {});
        }
      }
    },
  );

  // 监听调试器主动断开
  if (typeof chromeGlobal?.debugger?.onDetach?.addListener === 'function') {
    chromeGlobal.debugger.onDetach.addListener((source: { tabId?: number }) => {
      if (source.tabId) activeCdpSessions.delete(source.tabId);
    });
  }

  cdpListenerRegistered = true;
}

/** 开启 CDP 网络捕获 */
export async function startNetworkRecording(
  tabId: number,
  options?: { filterUrls?: string[]; maxRequests?: number },
): Promise<ToolResult> {
  const chromeGlobal = (globalThis as any).chrome;
  if (!chromeGlobal?.debugger?.attach) {
    return { ok: false, error: '当前环境不支持 Chrome Debugger API (需 debugger 权限)' };
  }

  try {
    ensureCdpEventListener();

    // 先尝试挂载 (若已挂载则忽略异常)
    try {
      await chromeGlobal.debugger.attach({ tabId }, '1.3');
    } catch (attachErr: any) {
      if (!/already attached/i.test(attachErr?.message || '')) {
        return { ok: false, error: `CDP 挂载失败: ${attachErr.message}` };
      }
    }

    await chromeGlobal.debugger.sendCommand({ tabId }, 'Network.enable', {
      maxTotalBufferSize: 10 * 1024 * 1024,
      maxResourceBufferSize: 5 * 1024 * 1024,
    });

    const session: CdpSession = {
      tabId,
      startTime: Date.now(),
      filterUrls: options?.filterUrls,
      maxRequests: options?.maxRequests || 100,
      requests: new Map(),
      mockPatterns: [],
    };
    activeCdpSessions.set(tabId, session);

    return {
      ok: true,
      data: {
        tabId,
        status: 'recording',
        note: '📡 已通过 CDP 开启深度网络请求截获与 API 抓取',
      },
    };
  } catch (err) {
    return { ok: false, error: `开启 CDP 网络捕获失败: ${(err as Error).message}` };
  }
}

/** 停止 CDP 网络捕获并返回提取到的结构化 API 请求数据 */
export async function stopNetworkRecording(
  tabId: number,
  options?: { fetchBodies?: boolean },
): Promise<ToolResult> {
  const chromeGlobal = (globalThis as any).chrome;
  const session = activeCdpSessions.get(tabId);
  if (!session) {
    return { ok: false, error: `未找到标签页 ${tabId} 的活跃 CDP 捕获会话` };
  }

  try {
    const list = Array.from(session.requests.values());

    // 可选读取 API 响应体
    if (options?.fetchBodies !== false && chromeGlobal?.debugger?.sendCommand) {
      const apiReqs = list.filter((r) => r.isApi && r.statusCode === 200).slice(0, 15);
      for (const req of apiReqs) {
        try {
          const res = await chromeGlobal.debugger.sendCommand(
            { tabId },
            'Network.getResponseBody',
            { requestId: req.requestId },
          );
          if (res?.body) {
            req.responseBody = res.base64Encoded ? atob(res.body).slice(0, 2000) : res.body.slice(0, 2000);
          }
        } catch {
          /* 忽略单条响应体获取失败 */
        }
      }
    }

    // 断开调试器
    try {
      await chromeGlobal.debugger.detach({ tabId });
    } catch {
      /* ignore */
    }
    activeCdpSessions.delete(tabId);

    const apiRequests = list.filter((r) => r.isApi);
    const summary = `共捕获 ${list.length} 个网络请求，其中核心 API 接口 ${apiRequests.length} 个`;

    return {
      ok: true,
      data: {
        totalRequests: list.length,
        apiCount: apiRequests.length,
        apiRequests: apiRequests.map((r) => ({
          url: r.url,
          method: r.method,
          status: r.statusCode,
          durationMs: r.durationMs,
          responsePreview: r.responseBody ? `${r.responseBody.slice(0, 200)}...` : undefined,
        })),
        allRequestsPreview: list.slice(0, 30).map((r) => `[${r.method}] ${r.statusCode || '...'} ${r.url}`),
        summary,
        note: `🎉 ${summary}`,
      },
    };
  } catch (err) {
    activeCdpSessions.delete(tabId);
    return { ok: false, error: `结束 CDP 捕获失败: ${(err as Error).message}` };
  }
}

/** 拦截并 Mock 指定 URL 的网络响应 */
export async function mockNetworkResponse(
  tabId: number,
  options: {
    urlPattern: string;
    responseJson?: any;
    responseBody?: string;
    statusCode?: number;
    contentType?: string;
  },
): Promise<ToolResult> {
  const chromeGlobal = (globalThis as any).chrome;
  if (!chromeGlobal?.debugger?.attach) {
    return { ok: false, error: '当前环境不支持 Chrome Debugger API' };
  }

  try {
    ensureCdpEventListener();
    try {
      await chromeGlobal.debugger.attach({ tabId }, '1.3');
    } catch {
      /* ignore if already attached */
    }

    let session = activeCdpSessions.get(tabId);
    if (!session) {
      session = {
        tabId,
        startTime: Date.now(),
        maxRequests: 50,
        requests: new Map(),
        mockPatterns: [],
      };
      activeCdpSessions.set(tabId, session);
    }

    const bodyText = options.responseBody || (options.responseJson ? JSON.stringify(options.responseJson) : '{}');
    session.mockPatterns.push({
      urlPattern: options.urlPattern,
      statusCode: options.statusCode || 200,
      responseBody: bodyText,
      contentType: options.contentType || 'application/json; charset=utf-8',
    });

    // 开启 Fetch 拦截
    await chromeGlobal.debugger.sendCommand({ tabId }, 'Fetch.enable', {
      patterns: [{ urlPattern: options.urlPattern, requestStage: 'Request' }],
    });

    return {
      ok: true,
      data: {
        urlPattern: options.urlPattern,
        statusCode: options.statusCode || 200,
        note: `🎭 已成功配置 CDP 接口 Mock 拦截规则: ${options.urlPattern}`,
      },
    };
  } catch (err) {
    return { ok: false, error: `设置 Mock 失败: ${(err as Error).message}` };
  }
}

/** 通过 CDP 模拟移动端视口与 User-Agent */
export async function emulateDevice(
  tabId: number,
  options: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
    mobile?: boolean;
    userAgent?: string;
  },
): Promise<ToolResult> {
  const chromeGlobal = (globalThis as any).chrome;
  if (!chromeGlobal?.debugger?.attach) {
    return { ok: false, error: '当前环境不支持 Chrome Debugger API' };
  }

  try {
    try {
      await chromeGlobal.debugger.attach({ tabId }, '1.3');
    } catch {
      /* ignore */
    }

    await chromeGlobal.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
      width: options.width,
      height: options.height,
      deviceScaleFactor: options.deviceScaleFactor || 2,
      mobile: options.mobile ?? true,
    });

    if (options.userAgent) {
      await chromeGlobal.debugger.sendCommand({ tabId }, 'Emulation.setUserAgentOverride', {
        userAgent: options.userAgent,
      });
    }

    return {
      ok: true,
      data: {
        width: options.width,
        height: options.height,
        mobile: options.mobile ?? true,
        note: `📱 已成功通过 CDP 切换为设备视口 (${options.width}x${options.height})`,
      },
    };
  } catch (err) {
    return { ok: false, error: `设备模拟失败: ${(err as Error).message}` };
  }
}

/** CDP 相关后台工具统一执行器 */
export async function executeCdpTool(call: ToolCall, defaultTabId: number): Promise<ToolResult | null> {
  const targetTabId = Number(call.args?.tabId) || defaultTabId;

  if (call.name === 'startNetworkRecording') {
    const filterUrls = Array.isArray(call.args?.filterUrls) ? (call.args.filterUrls as string[]) : undefined;
    const maxRequests = Number(call.args?.maxRequests) || 100;
    return startNetworkRecording(targetTabId, { filterUrls, maxRequests });
  }

  if (call.name === 'stopNetworkRecording') {
    const fetchBodies = call.args?.fetchBodies !== false;
    return stopNetworkRecording(targetTabId, { fetchBodies });
  }

  if (call.name === 'mockNetworkResponse') {
    const urlPattern = String(call.args?.urlPattern ?? '').trim();
    if (!urlPattern) return { ok: false, error: '未指定要拦截的 urlPattern' };
    return mockNetworkResponse(targetTabId, {
      urlPattern,
      responseJson: call.args?.responseJson,
      responseBody: call.args?.responseBody ? String(call.args.responseBody) : undefined,
      statusCode: Number(call.args?.statusCode) || 200,
      contentType: call.args?.contentType ? String(call.args.contentType) : undefined,
    });
  }

  if (call.name === 'emulateDevice') {
    const width = Number(call.args?.width) || 390;
    const height = Number(call.args?.height) || 844;
    const mobile = call.args?.mobile !== false;
    const userAgent = call.args?.userAgent ? String(call.args.userAgent) : undefined;
    return emulateDevice(targetTabId, { width, height, mobile, userAgent });
  }

  return null;
}
