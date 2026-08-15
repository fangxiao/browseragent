// 后台入口:消息路由 + AI 请求(规避 content 侧 CORS)。见 docs/design/design.md §1、docs/design/agent.md
// 流式:sidepanel 经 Port 发起 AI:START(对话流)/ AGENT:START(Agent 流),background 逐事件推送
import { getSettings, saveSettings } from '@/utils/storage';
import { getClient } from '@/utils/ai/provider';
import { buildSystemFor } from '@/utils/ai/prompts';
import { STREAM_PORT_NAME, AGENT_PORT_NAME } from '@/utils/messaging';
import type { BgRequest, PortStartMessage, PortStreamMessage, AgentPortMessage } from '@/utils/messaging';
import type { AiRunPayload, StreamEvent } from '@/utils/ai/provider/types';
import { createThinLoopDriver } from '@/utils/ai/driver';
import { fetchAndSyncCloudConfig } from '@/utils/ai/remoteConfig';
import type { ToolCall, ToolResult } from '@/utils/domTools/types';
import type { AgentRunPayload, AgentEvent } from '@/utils/ai/agentTypes';
import { markdownToWechatHtml } from '@/utils/wechat/styleInliner';

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

    /** 向标签页执行一次 TOOL:CALL;系统页优雅降级,休眠标签页静默自动唤醒,无接收端时主动注入 func/content script */
    const callToolInTab = async (tabId: number, call: ToolCall): Promise<ToolResult> => {
      let tabUrl = '';
      let tabTitle = '';
      let isDiscarded = false;
      let isUnloaded = false;
      try {
        const tab = await browser.tabs.get(tabId);
        tabUrl = tab.url ?? '';
        tabTitle = tab.title ?? '';
        isDiscarded = Boolean((tab as any).discarded);
        isUnloaded = tab.status === 'unloaded';
      } catch {
        /* 忽略 tabs.get 异常 */
      }

      // 浏览器系统/内置页面(chrome://, edge://, chrome-extension://, about:, devtools:)
      const isRestrictedUrl = /^(chrome|edge|chrome-extension|devtools|about):/i.test(tabUrl) || !tabUrl;
      if (isRestrictedUrl) {
        if (call.name === 'getPageInfo') {
          return {
            ok: true,
            data: { url: tabUrl || 'about:blank', title: tabTitle || '系统页面', isSystemPage: true },
          };
        }
        if (call.name === 'readPage') {
          return {
            ok: true,
            data: {
              url: tabUrl,
              title: tabTitle,
              summary: `[此页面为浏览器系统页: ${tabTitle || tabUrl}，受安全限制无法直接操作 DOM]`,
              tree: { root: null, count: 0 },
            },
          };
        }
        if (call.name === 'getPagePerformance') {
          return {
            ok: true,
            data: {
              url: tabUrl,
              title: tabTitle,
              dnsMs: 0,
              tcpMs: 0,
              ttfbMs: 0,
              domReadyMs: 0,
              loadMs: 0,
              resourceCount: 0,
              transferSizeKb: 0,
              note: '系统页面无网络耗时',
            },
          };
        }
        return {
          ok: false,
          error: `当前为系统页面(${tabUrl || '内部页面'})，受浏览器安全策略限制无法操作 DOM`,
        };
      }

      // 如果后台标签页被浏览器自动休眠(discarded)或处于 unloaded 状态，静默在后台唤醒它
      if (isDiscarded || isUnloaded) {
        try {
          await browser.tabs.reload(tabId);
          // 等待标签页在后台静默完成渲染(最多等待 2.5 秒)
          for (let i = 0; i < 12; i++) {
            await new Promise((r) => setTimeout(r, 200));
            const t = await browser.tabs.get(tabId);
            if (t.status === 'complete' && !(t as any).discarded) break;
          }
        } catch {
          /* 忽略唤醒异常 */
        }
      }

      const noReceiver = (err: unknown) =>
        /Receiving end does not exist|Could not establish connection|Cannot access contents|tab is discarded|Frame with ID/i.test(
          (err as Error)?.message ?? '',
        );

      try {
        const res = await browser.tabs.sendMessage(tabId, { type: 'TOOL:CALL', call });
        return res?.result ?? { ok: false, error: '内容脚本未返回结果' };
      } catch (err) {
        if (noReceiver(err)) {
          // 对 getPagePerformance/getPageInfo/readPage/findElements/extractData 优先直接通过 func 注入原生提取
          if (call.name === 'getPagePerformance') {
            try {
              const execRes = await browser.scripting.executeScript({
                target: { tabId },
                func: () => {
                  try {
                    const nav = typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
                      ? (performance.getEntriesByType('navigation')?.[0] as PerformanceNavigationTiming | undefined)
                      : undefined;
                    const resources = typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
                      ? ((performance.getEntriesByType('resource') || []) as PerformanceResourceTiming[])
                      : [];
                    let dnsMs = 0, tcpMs = 0, ttfbMs = 0, fcpMs = 0, domReadyMs = 0, loadMs = 0, transferSizeKb = 0, decodedBodySizeKb = 0, protocol = '';
                    if (typeof performance !== 'undefined' && typeof performance.getEntriesByName === 'function') {
                      const fcpEntry = performance.getEntriesByName('first-contentful-paint')?.[0];
                      if (fcpEntry) fcpMs = Math.round(fcpEntry.startTime);
                    }
                    if (nav) {
                      dnsMs = Math.max(0, Math.round(nav.domainLookupEnd - nav.domainLookupStart));
                      tcpMs = Math.max(0, Math.round(nav.connectEnd - nav.connectStart));
                      ttfbMs = Math.max(0, Math.round(nav.responseStart - nav.requestStart));
                      domReadyMs = Math.max(0, Math.round(nav.domContentLoadedEventEnd - nav.startTime));
                      loadMs = Math.max(0, Math.round(nav.loadEventEnd - nav.startTime));
                      transferSizeKb = Math.round((nav.transferSize || 0) / 1024);
                      decodedBodySizeKb = Math.round((nav.decodedBodySize || 0) / 1024);
                      protocol = nav.nextHopProtocol || '';
                    } else if (typeof performance !== 'undefined' && (performance as any).timing) {
                      const t = (performance as any).timing;
                      dnsMs = Math.max(0, (t.domainLookupEnd || 0) - (t.domainLookupStart || 0));
                      tcpMs = Math.max(0, (t.connectEnd || 0) - (t.connectStart || 0));
                      ttfbMs = Math.max(0, (t.responseStart || 0) - (t.requestStart || 0));
                      domReadyMs = Math.max(0, (t.domContentLoadedEventEnd || 0) - (t.navigationStart || 0));
                      loadMs = Math.max(0, (t.loadEventEnd || 0) - (t.navigationStart || 0));
                    }

                    const getShortName = (url: string): string => {
                      try {
                        const u = new URL(url);
                        const p = u.pathname.split('/').filter(Boolean).pop() || u.pathname || u.hostname;
                        return p.length > 45 ? p.slice(0, 42) + '…' : p;
                      } catch {
                        return url.length > 45 ? url.slice(0, 42) + '…' : url;
                      }
                    };

                    const topSlowResources = [...resources]
                      .filter((r) => r && r.duration > 0 && r.name && /^https?:/i.test(r.name))
                      .sort((a, b) => b.duration - a.duration)
                      .slice(0, 3)
                      .map((r) => ({
                        name: getShortName(r.name),
                        url: r.name,
                        durationMs: Math.round(r.duration),
                        type: r.initiatorType || 'other',
                        sizeKb: Math.round((r.transferSize || r.decodedBodySize || 0) / 1024),
                      }));

                    const topHeavyResources = [...resources]
                      .filter((r) => r && (r.transferSize || r.decodedBodySize || 0) > 0 && r.name && /^https?:/i.test(r.name))
                      .sort((a, b) => (b.transferSize || b.decodedBodySize || 0) - (a.transferSize || a.decodedBodySize || 0))
                      .slice(0, 3)
                      .map((r) => ({
                        name: getShortName(r.name),
                        url: r.name,
                        sizeKb: Math.round((r.transferSize || r.decodedBodySize || 0) / 1024),
                        durationMs: Math.round(r.duration),
                        type: r.initiatorType || 'other',
                      }));

                    const resourceBreakdown = {
                      js: { count: 0, sizeKb: 0 },
                      css: { count: 0, sizeKb: 0 },
                      image: { count: 0, sizeKb: 0 },
                      api: { count: 0, sizeKb: 0 },
                      other: { count: 0, sizeKb: 0 },
                    };

                    for (const r of resources) {
                      if (!r) continue;
                      const sz = Math.round((r.transferSize || r.decodedBodySize || 0) / 1024);
                      const typ = (r.initiatorType || '').toLowerCase();
                      if (typ === 'script' || /\.js($|\?)/i.test(r.name)) {
                        resourceBreakdown.js.count++;
                        resourceBreakdown.js.sizeKb += sz;
                      } else if (typ === 'css' || typ === 'link' || /\.css($|\?)/i.test(r.name)) {
                        resourceBreakdown.css.count++;
                        resourceBreakdown.css.sizeKb += sz;
                      } else if (typ === 'img' || typ === 'image' || /\.(png|jpe?g|gif|webp|svg|ico)($|\?)/i.test(r.name)) {
                        resourceBreakdown.image.count++;
                        resourceBreakdown.image.sizeKb += sz;
                      } else if (typ === 'fetch' || typ === 'xmlhttprequest') {
                        resourceBreakdown.api.count++;
                        resourceBreakdown.api.sizeKb += sz;
                      } else {
                        resourceBreakdown.other.count++;
                        resourceBreakdown.other.sizeKb += sz;
                      }
                    }

                    // 1. 主线程长任务与卡顿诊断(Long Tasks > 50ms)
                    let longTaskCount = 0;
                    let totalLongTaskMs = 0;
                    let maxLongTaskMs = 0;
                    try {
                      if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
                        const longTasks = (performance.getEntriesByType('longtask') || []) as PerformanceEntry[];
                        longTaskCount = longTasks.length;
                        for (const t of longTasks) {
                          const d = Math.round(t.duration);
                          totalLongTaskMs += d;
                          if (d > maxLongTaskMs) maxLongTaskMs = d;
                        }
                      }
                    } catch {
                      /* 忽略 longtask 异常 */
                    }

                    // 2. 内存与 DOM 树健康度(DOM Nodes & JS Heap)
                    let domNodeCount = 0;
                    let maxDomDepth = 0;
                    let jsHeapUsedMb = 0;
                    let jsHeapTotalMb = 0;
                    try {
                      if (typeof document !== 'undefined') {
                        domNodeCount = document.getElementsByTagName('*').length;
                        const getDepth = (el: Element, current: number): number => {
                          if (current > 40 || !el.children) return current;
                          let max = current;
                          for (let i = 0; i < Math.min(el.children.length, 50); i++) {
                            const child = el.children[i];
                            if (child) {
                              const d = getDepth(child, current + 1);
                              if (d > max) max = d;
                            }
                          }
                          return max;
                        };
                        maxDomDepth = document.documentElement ? getDepth(document.documentElement, 1) : 0;
                      }
                    } catch {
                      maxDomDepth = 0;
                    }
                    try {
                      if (typeof performance !== 'undefined' && (performance as any).memory) {
                        const mem = (performance as any).memory;
                        jsHeapUsedMb = Math.round((mem.usedJSHeapSize || 0) / 1024 / 1024);
                        jsHeapTotalMb = Math.round((mem.totalJSHeapSize || 0) / 1024 / 1024);
                      }
                    } catch {
                      /* 忽略 memory 异常 */
                    }

                    // 3. 压缩漏配与缓存能效(Gzip/Brotli & Cache Hit Rate)
                    let cachedResourceCount = 0;
                    let cacheHitRatePct = 0;
                    const uncompressedAssets: Array<{ name: string; url: string; sizeKb: number; wastedKb: number; type: string }> = [];

                    for (const r of resources) {
                      if (!r) continue;
                      const isCached = r.transferSize === 0 || (r.transferSize < 50 && (r.decodedBodySize || 0) > 200);
                      if (isCached) {
                        cachedResourceCount++;
                      } else {
                        const tSize = r.transferSize || 0;
                        const dSize = r.decodedBodySize || 0;
                        const typ = (r.initiatorType || '').toLowerCase();
                        const isTextAsset =
                          typ === 'script' ||
                          typ === 'css' ||
                          typ === 'link' ||
                          typ === 'fetch' ||
                          typ === 'xmlhttprequest' ||
                          /\.(js|css|json|html|svg)($|\?)/i.test(r.name);

                        if (isTextAsset && dSize > 50 * 1024 && tSize >= dSize * 0.9) {
                          const sizeKb = Math.round(tSize / 1024);
                          uncompressedAssets.push({
                            name: getShortName(r.name),
                            url: r.name,
                            sizeKb,
                            wastedKb: Math.round(sizeKb * 0.65),
                            type: typ || 'script',
                          });
                        }
                      }
                    }
                    if (resources.length > 0) {
                      cacheHitRatePct = Math.round((cachedResourceCount / resources.length) * 100);
                    }
                    uncompressedAssets.sort((a, b) => b.sizeKb - a.sizeKb);
                    uncompressedAssets.splice(3);

                    // 4. 首屏关键渲染阻塞分析(Render-Blocking Resources in head)
                    let renderBlockingCount = 0;
                    const renderBlockingList: Array<{ name: string; url: string; type: string }> = [];
                    try {
                      if (typeof document !== 'undefined') {
                        const headScripts = document.querySelectorAll('head script[src]:not([async]):not([defer]):not([type="module"])');
                        headScripts.forEach((s) => {
                          const src = (s as HTMLScriptElement).src;
                          if (src && /^https?:/i.test(src)) {
                            renderBlockingCount++;
                            if (renderBlockingList.length < 3) {
                              renderBlockingList.push({ name: getShortName(src), url: src, type: 'script' });
                            }
                          }
                        });

                        const headStyles = document.querySelectorAll('head link[rel="stylesheet"]:not([media="print"])');
                        headStyles.forEach((l) => {
                          const href = (l as HTMLLinkElement).href;
                          if (href && /^https?:/i.test(href)) {
                            renderBlockingCount++;
                            if (renderBlockingList.length < 3) {
                              renderBlockingList.push({ name: getShortName(href), url: href, type: 'css' });
                            }
                          }
                        });
                      }
                    } catch {
                      /* 忽略 head 扫描异常 */
                    }

                    return {
                      url: typeof location !== 'undefined' ? location.href : '',
                      title: typeof document !== 'undefined' ? document.title : '',
                      dnsMs, tcpMs, ttfbMs, fcpMs, domReadyMs, loadMs,
                      resourceCount: resources.length,
                      transferSizeKb, decodedBodySizeKb, protocol,
                      topSlowResources, topHeavyResources, resourceBreakdown,
                      longTaskCount, totalLongTaskMs, maxLongTaskMs,
                      domNodeCount, maxDomDepth, jsHeapUsedMb, jsHeapTotalMb,
                      cachedResourceCount, cacheHitRatePct, uncompressedAssets,
                      renderBlockingCount, renderBlockingList,
                    };
                  } catch (e) {
                    return {
                      url: typeof location !== 'undefined' ? location.href : '',
                      title: typeof document !== 'undefined' ? document.title : '',
                      dnsMs: 0, tcpMs: 0, ttfbMs: 0, fcpMs: 0, domReadyMs: 0, loadMs: 0,
                      resourceCount: 0, transferSizeKb: 0, decodedBodySizeKb: 0, protocol: '',
                      note: `部分指标采集降级: ${(e as Error)?.message || ''}`,
                    };
                  }
                },
              });
              if (execRes?.[0]?.result) {
                return { ok: true, data: execRes[0].result };
              }
            } catch (err) {
              console.warn('[callToolInTab] getPagePerformance executeScript 降级:', err);
            }
          } else if (call.name === 'getPageInfo') {
            try {
              const execRes = await browser.scripting.executeScript({
                target: { tabId },
                func: () => ({
                  url: typeof location !== 'undefined' ? location.href : '',
                  title: typeof document !== 'undefined' ? document.title : '',
                  lang: typeof document !== 'undefined' ? document.documentElement?.lang || '' : '',
                }),
              });
              if (execRes?.[0]?.result) {
                return { ok: true, data: execRes[0].result };
              }
            } catch {
              /* 继续走下方完整 content script 注入 */
            }
          } else if (call.name === 'readPage') {
            try {
              const textLimit = Number(call.args?.textLimit) || 2000;
              const execRes = await browser.scripting.executeScript({
                target: { tabId },
                func: (limit) => {
                  const title = typeof document !== 'undefined' ? document.title : '';
                  const url = typeof location !== 'undefined' ? location.href : '';
                  const summary = (typeof document !== 'undefined' && document.body?.innerText ? document.body.innerText : '').slice(0, limit);
                  return {
                    url,
                    title,
                    summary,
                    tree: { root: null, count: 0 },
                  };
                },
                args: [textLimit],
              });
              if (execRes?.[0]?.result) {
                return { ok: true, data: execRes[0].result };
              }
            } catch {
              /* 继续走下方完整 content script 注入 */
            }
          } else if (call.name === 'findElements') {
            try {
              const role = call.args?.role ? String(call.args.role) : undefined;
              const text = call.args?.text ? String(call.args.text) : undefined;
              const keyword = call.args?.keyword ? String(call.args.keyword) : undefined;
              const execRes = await browser.scripting.executeScript({
                target: { tabId },
                func: (r, t, kw) => {
                  const els = Array.from(document.querySelectorAll('a, button, input, textarea, select, h1, h2, h3, p, [role]'));
                  const matched = els
                    .filter((el) => {
                      const txt = (el.textContent || '').trim();
                      if (kw && !txt.toLowerCase().includes(kw.toLowerCase())) return false;
                      if (t && !txt.includes(t)) return false;
                      if (r && el.getAttribute('role') !== r) return false;
                      return true;
                    })
                    .slice(0, 30)
                    .map((el) => ({
                      tag: el.tagName.toLowerCase(),
                      role: el.getAttribute('role') || '',
                      text: (el.textContent || '').trim().slice(0, 80),
                      selectable: true,
                    }));
                  return { count: matched.length, elements: matched };
                },
                args: [role, text, keyword],
              });
              if (execRes?.[0]?.result) {
                return { ok: true, data: execRes[0].result };
              }
            } catch {
              /* 继续走下方完整 content script 注入 */
            }
          } else if (call.name === 'extractData') {
            try {
              const execRes = await browser.scripting.executeScript({
                target: { tabId },
                func: () => {
                  const tables = Array.from(document.querySelectorAll('table'));
                  const rows: Array<Record<string, string>> = [];
                  for (const table of tables) {
                    const trs = Array.from(table.querySelectorAll('tr'));
                    const headers = Array.from(trs[0]?.querySelectorAll('th, td') || []).map((th) => (th.textContent || '').trim());
                    for (let i = 1; i < trs.length && rows.length < 50; i++) {
                      const tr = trs[i];
                      if (!tr) continue;
                      const tds = Array.from(tr.querySelectorAll('td'));
                      if (tds.length === 0) continue;
                      const item: Record<string, string> = {};
                      tds.forEach((td, idx) => {
                        const key = headers[idx] || `col_${idx + 1}`;
                        item[key] = (td.textContent || '').trim();
                      });
                      rows.push(item);
                    }
                  }
                  return {
                    count: rows.length,
                    data: rows,
                    format: 'table',
                  };
                },
              });
              if (execRes?.[0]?.result) {
                return { ok: true, data: execRes[0].result };
              }
            } catch {
              /* 继续走下方完整 content script 注入 */
            }
          } else if (call.name === 'getArticleOutline') {
            try {
              const selector = call.args?.selector ? String(call.args.selector) : '';
              const execRes = await browser.scripting.executeScript({
                target: { tabId },
                func: (sel) => {
                  let container: HTMLElement | null = sel ? document.querySelector<HTMLElement>(sel) : null;
                  if (!container) {
                    container = document.querySelector<HTMLElement>(
                      'article, [role="article"], .article-content, .markdown-body, .post-content, .entry-content, main, #content, .content, body',
                    ) || document.body;
                  }
                  const headingEls = Array.from(container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, p, blockquote'));
                  const outline: Array<{ anchorId: string; level: number; tag: string; title: string; snippet: string }> = [];
                  let idx = 1;
                  let totalWords = 0;
                  for (const el of headingEls) {
                    const tag = el.tagName.toLowerCase();
                    const txt = (el.textContent || '').trim();
                    if (!txt) continue;
                    totalWords += txt.length;
                    const isHeading = /^h[1-4]$/.test(tag);
                    const isImportantPara = tag === 'p' && txt.length > 50 && outline.length < 40;
                    if (isHeading || isImportantPara) {
                      let anchorId = el.getAttribute('data-agent-anchor');
                      if (!anchorId) {
                        anchorId = `anchor-${idx++}`;
                        el.setAttribute('data-agent-anchor', anchorId);
                      }
                      outline.push({
                        anchorId,
                        level: isHeading ? parseInt(tag.slice(1), 10) : 0,
                        tag,
                        title: isHeading ? txt : `${txt.slice(0, 36)}…`,
                        snippet: txt.slice(0, 120),
                      });
                    }
                  }
                  return {
                    title: document.title || '',
                    url: location.href,
                    totalSections: outline.length,
                    totalWords,
                    outline,
                  };
                },
                args: [selector],
              });
              if (execRes?.[0]?.result) {
                return { ok: true, data: execRes[0].result };
              }
            } catch {
              /* 继续走下方完整 content script 注入 */
            }
          } else if (call.name === 'highlightAndScrollTo') {
            try {
              const anchorId = String(call.args?.anchorId ?? '').trim();
              const selector = String(call.args?.selector ?? '').trim();
              const textSnippet = String(call.args?.textSnippet ?? '').trim();
              const execRes = await browser.scripting.executeScript({
                target: { tabId },
                func: (aid, sel, snippet) => {
                  let targetEl: HTMLElement | null = null;
                  if (aid) {
                    targetEl = document.querySelector<HTMLElement>(`[data-agent-anchor="${aid}"], #${aid}`);
                  }
                  if (!targetEl && sel) {
                    try { targetEl = document.querySelector<HTMLElement>(sel); } catch {}
                  }
                  if (!targetEl && snippet) {
                    const candidates = Array.from(document.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, li, blockquote, div'));
                    targetEl = candidates.find((c) => (c.textContent || '').includes(snippet)) || null;
                  }
                  if (!targetEl) return null;
                  targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
                  if (!document.getElementById('ai-agent-pulse-style')) {
                    const style = document.createElement('style');
                    style.id = 'ai-agent-pulse-style';
                    style.textContent = `
                      @keyframes aiAgentPulseGlow {
                        0% { outline: 3px solid #f59e0b; box-shadow: 0 0 16px rgba(245, 158, 11, 0.6); background-color: rgba(254, 240, 138, 0.45); }
                        50% { outline: 4px solid #d97706; box-shadow: 0 0 24px rgba(245, 158, 11, 0.85); background-color: rgba(254, 240, 138, 0.65); }
                        100% { outline: 2px solid transparent; box-shadow: none; background-color: transparent; }
                      }
                      .ai-agent-pulse-target {
                        animation: aiAgentPulseGlow 2.5s ease-out forwards !important;
                        border-radius: 4px !important;
                      }
                    `;
                    document.head.appendChild(style);
                  }
                  targetEl.classList.remove('ai-agent-pulse-target');
                  void targetEl.offsetWidth;
                  targetEl.classList.add('ai-agent-pulse-target');
                  setTimeout(() => { targetEl?.classList.remove('ai-agent-pulse-target'); }, 2600);
                  return { scrolled: true, anchorId: aid || 'matched' };
                },
                args: [anchorId, selector, textSnippet],
              });
              if (execRes?.[0]?.result) {
                return { ok: true, data: execRes[0].result };
              }
            } catch {
              /* 继续走下方完整 content script 注入 */
            }
          } else if (call.name === 'writeWechatDraft') {
            try {
              const title = String(call.args?.title ?? '').trim();
              const author = String(call.args?.author ?? '').trim();
              const digest = String(call.args?.digest ?? '').trim();
              const contentMarkdown = String(call.args?.contentMarkdown ?? '');
              const theme = String(call.args?.theme ?? 'tech-blue');

              let htmlContent = String(call.args?.contentHtml ?? '');
              if (!htmlContent && contentMarkdown) {
                htmlContent = markdownToWechatHtml(contentMarkdown, theme);
              }

              const execRes = await browser.scripting.executeScript({
                target: { tabId },
                func: (t, a, d, html, th) => {
                  const titleEl = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
                    '#title, input.js_title, [placeholder*="标题"], .title_input',
                  );
                  if (titleEl && t) {
                    titleEl.value = t.slice(0, 64);
                    titleEl.dispatchEvent(new Event('input', { bubbles: true }));
                    titleEl.dispatchEvent(new Event('change', { bubbles: true }));
                  }

                  const authorEl = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
                    '#author, input.js_author, [placeholder*="作者"]',
                  );
                  if (authorEl && a) {
                    authorEl.value = a.slice(0, 16);
                    authorEl.dispatchEvent(new Event('input', { bubbles: true }));
                    authorEl.dispatchEvent(new Event('change', { bubbles: true }));
                  }

                  const digestEl = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
                    '#js_description, textarea.js_description, #digest, [placeholder*="摘要"]',
                  );
                  if (digestEl && d) {
                    digestEl.value = d.slice(0, 120);
                    digestEl.dispatchEvent(new Event('input', { bubbles: true }));
                    digestEl.dispatchEvent(new Event('change', { bubbles: true }));
                  }

                  let editorBody: HTMLElement | null = null;
                  let editorDoc: Document = document;
                  const iframe = document.querySelector<HTMLIFrameElement>('iframe#ueditor_0, iframe.edui-editor-iframe');
                  if (iframe && iframe.contentDocument) {
                    editorDoc = iframe.contentDocument;
                    editorBody = editorDoc.querySelector<HTMLElement>('body.view, body');
                  }
                  if (!editorBody) {
                    editorBody = document.querySelector<HTMLElement>(
                      '#ueditor_0, .edui-body-container, [contenteditable="true"], .rich_media_content, #js_editor',
                    );
                  }

                  let injectedEditor = false;
                  if (editorBody && html) {
                    try {
                      editorBody.focus();
                      const sel = editorDoc.getSelection();
                      if (sel) {
                        const range = editorDoc.createRange();
                        range.selectNodeContents(editorBody);
                        sel.removeAllRanges();
                        sel.addRange(range);
                      }
                      injectedEditor = editorDoc.execCommand('insertHTML', false, html);
                    } catch {
                      injectedEditor = false;
                    }

                    if (!injectedEditor || !editorBody.innerHTML.trim()) {
                      editorBody.innerHTML = html;
                      const InputCtor = typeof InputEvent !== 'undefined' ? InputEvent : Event;
                      editorBody.dispatchEvent(new InputCtor('input', { bubbles: true }));
                      editorBody.dispatchEvent(new Event('change', { bubbles: true }));
                      injectedEditor = true;
                    }
                  }

                  return {
                    title: t || '未修改',
                    author: a || '未修改',
                    digest: d ? `${d.slice(0, 30)}…` : '未修改',
                    theme: th,
                    injectedFields: {
                      title: Boolean(titleEl),
                      author: Boolean(authorEl),
                      digest: Boolean(digestEl),
                      editorBody: Boolean(editorBody),
                    },
                    note: '🎉 已成功将精美排版内容写入微信公众平台草稿！',
                  };
                },
                args: [title, author, digest, htmlContent, theme],
              });

              if (execRes?.[0]?.result) {
                return { ok: true, data: execRes[0].result };
              }
            } catch {
              /* 继续走下方完整 content script 注入 */
            }
          }

          try {
            await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/content.js'] });
            await new Promise((r) => setTimeout(r, 80)); // 等待消息监听器注册就绪
            const res = await browser.tabs.sendMessage(tabId, { type: 'TOOL:CALL', call });
            return res?.result ?? { ok: false, error: '内容脚本未返回结果' };
          } catch {
            return { ok: false, error: '未能读取目标标签页数据(可能页面正在休眠或尚未加载完成)' };
          }
        }
        return { ok: false, error: `工具执行失败:${(err as Error)?.message}` };
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
        try {
          const tab = await browser.tabs.get(payload.tabId);
          currentOrigin = new URL(tab.url ?? 'about:blank').origin;
          currentTabInfo = `\n\n【当前激活标签页上下文 (Active Tab)】\n- 标签页 ID: ${payload.tabId}\n- 网页标题: "${tab.title ?? '未命名网页'}"\n- 网页 URL: ${tab.url ?? '未知'}\n⚠️ 强约束准则: 用户当前浏览器视窗正停留在上述网页！当用户提到“这篇文章/这个页面/当前网页/深度解读/总结/大纲”时，必须调用 getArticleOutline 或 readPage 实时读取该网页内容，严禁凭借历史对话残留中讨论过的旧文章直接回答，绝不可张冠李戴！`;
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
          { ...payload, currentTabInfo },
          {
            onEvent: sendAgentEvent,
            signal: () => ac?.signal ?? new AbortController().signal,
            getCurrentOrigin: () => currentOrigin,
            executeTool: async (call: ToolCall) => {
              // 1. listTabs 由 background 查询浏览器标签页
              if (call.name === 'listTabs') {
                try {
                  const currentWindow = call.args?.currentWindow !== false;
                  const queryInfo: Record<string, unknown> = currentWindow ? { currentWindow: true } : {};
                  const tabs = await browser.tabs.query(queryInfo);
                  const validTabs = tabs
                    .filter((t) => t.id != null && t.url && /^https?:\/\//i.test(t.url))
                    .map((t) => ({
                      tabId: t.id!,
                      title: t.title ?? '未命名标签',
                      url: t.url!,
                      active: t.active ?? false,
                    }));
                  return {
                    ok: true,
                    data: {
                      count: validTabs.length,
                      tabs: validTabs,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `获取标签页列表失败:${(err as Error).message}` };
                }
              }

              // 2. navigate 由 background 经 tabs.update 执行
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

              // 3. 其他 DOM 工具(readPage/extractData 等):支持通过 args.tabId 指定目标标签页
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

  // 监听网页划词即问与局部透镜消息
  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type === 'SIDEBAR:QUICK_ASK' && msg.prompt) {
      if (sender.tab?.windowId && (browser.sidePanel as any)?.open) {
        try {
          void (browser.sidePanel as any).open({ windowId: sender.tab.windowId });
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
});
