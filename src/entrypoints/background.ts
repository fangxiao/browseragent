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
import {
  saveWorkflowRecipe,
  listWorkflowRecipes,
  getWorkflowRecipe,
  deleteWorkflowRecipe,
} from '@/utils/workflow/storage';

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
            executeTool: async (call: ToolCall) => {
              // 1. listTabs 由 background 查询浏览器标签页
              if (call.name === 'listTabs') {
                try {
                  const currentWindow = call.args?.currentWindow !== false;
                  const queryInfo: Record<string, unknown> = currentWindow ? { currentWindow: true } : {};
                  const tabs = await browser.tabs.query(queryInfo);
                  const groupsMap = new Map<number, { title: string; color: string }>();
                  const chromeGlobal = (globalThis as any).chrome;
                  if (typeof chromeGlobal?.tabGroups?.query === 'function') {
                    try {
                      const groups = await chromeGlobal.tabGroups.query(queryInfo);
                      for (const g of groups) {
                        if (g.id != null) groupsMap.set(g.id, { title: g.title || '', color: g.color || 'blue' });
                      }
                    } catch {
                      /* 忽略 tabGroups 查询异常 */
                    }
                  }
                  const validTabs = tabs
                    .filter((t) => t.id != null && t.url && /^https?:\/\//i.test(t.url))
                    .map((t) => {
                      const gid = (t as any).groupId;
                      const gInfo = gid != null && gid > -1 ? groupsMap.get(gid) : undefined;
                      return {
                        tabId: t.id!,
                        title: t.title ?? '未命名标签',
                        url: t.url!,
                        active: t.active ?? false,
                        pinned: t.pinned ?? false,
                        groupId: gid != null && gid > -1 ? gid : undefined,
                        groupTitle: gInfo?.title || undefined,
                        groupColor: gInfo?.color || undefined,
                      };
                    });
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

              // 2. groupTabs 标签页自动分组
              if (call.name === 'groupTabs') {
                try {
                  const tabIds = (call.args?.tabIds as number[]) || [];
                  const title = String(call.args?.title ?? '').trim();
                  const color = (call.args?.color as any) || 'blue';
                  const collapsed = Boolean(call.args?.collapsed);
                  if (tabIds.length === 0) {
                    return { ok: false, error: '未指定要分组的标签页 tabIds' };
                  }
                  let groupId: number | undefined;
                  const chromeGlobal = (globalThis as any).chrome;
                  if (typeof chromeGlobal?.tabs?.group === 'function') {
                    groupId = await chromeGlobal.tabs.group({ tabIds });
                    if (groupId != null && typeof chromeGlobal?.tabGroups?.update === 'function') {
                      await chromeGlobal.tabGroups.update(groupId, {
                        title,
                        color,
                        collapsed,
                      });
                    }
                  } else if (typeof (browser.tabs as any)?.group === 'function') {
                    groupId = await (browser.tabs as any).group({ tabIds });
                  }
                  return {
                    ok: true,
                    data: {
                      groupId,
                      title,
                      color,
                      tabCount: tabIds.length,
                      note: `🎉 已成功将 ${tabIds.length} 个标签页归入「${title}」分组！`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `标签页分组失败: ${(err as Error).message}` };
                }
              }

              // 3. closeTabs 批量关闭标签页
              if (call.name === 'closeTabs') {
                try {
                  const rawTabIds = (call.args?.tabIds as number[]) || [];
                  const tabIds = rawTabIds.map((id) => Number(id)).filter((id) => !isNaN(id) && id > 0);
                  if (tabIds.length === 0) {
                    return { ok: false, error: '未指定要关闭的标签页 tabIds' };
                  }
                  let closedCount = 0;
                  const closedTabIds: number[] = [];
                  for (const tid of tabIds) {
                    try {
                      await browser.tabs.remove(tid);
                      closedCount++;
                      closedTabIds.push(tid);
                    } catch {
                      // 忽略已关闭或不存在的标签页
                    }
                  }
                  return {
                    ok: true,
                    data: {
                      closedCount,
                      closedTabIds,
                      note: `🗑️ 已成功关闭 ${closedCount} 个标签页，释放系统内存`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `关闭标签页失败: ${(err as Error).message}` };
                }
              }

              // 4. activateTab 聚焦激活标签页
              if (call.name === 'activateTab') {
                try {
                  const tabId = Number(call.args?.tabId);
                  if (!tabId) return { ok: false, error: '未指定目标 tabId' };
                  const tab = await browser.tabs.get(tabId);
                  await browser.tabs.update(tabId, { active: true });
                  if (tab.windowId != null) {
                    await browser.windows.update(tab.windowId, { focused: true });
                  }
                  return {
                    ok: true,
                    data: { tabId, title: tab.title, url: tab.url, note: `🎯 已切换至标签页: ${tab.title}` },
                  };
                } catch (err) {
                  return { ok: false, error: `切换标签页失败: ${(err as Error).message}` };
                }
              }

              // 5. getBookmarksTree 读取书签树
              if (call.name === 'getBookmarksTree') {
                try {
                  const parentId = call.args?.parentId ? String(call.args.parentId) : undefined;
                  const maxDepth = Number(call.args?.maxDepth) || 4;
                  let rawTree: any[] = [];
                  if (parentId) {
                    rawTree = await browser.bookmarks.getSubTree(parentId);
                  } else {
                    rawTree = await browser.bookmarks.getTree();
                  }
                  const simplifyNode = (node: any, depth: number): any => {
                    if (!node) return null;
                    const isFolder = !node.url && (Array.isArray(node.children) || node.childrenCount != null);
                    const res: any = {
                      id: node.id,
                      title: node.title || (isFolder ? '未命名文件夹' : '未命名书签'),
                    };
                    if (node.url) res.url = node.url;
                    if (node.dateAdded) res.dateAdded = new Date(node.dateAdded).toISOString().split('T')[0];
                    if (isFolder && depth < maxDepth && Array.isArray(node.children)) {
                      res.children = node.children
                        .map((c: any) => simplifyNode(c, depth + 1))
                        .filter(Boolean);
                    } else if (isFolder && Array.isArray(node.children)) {
                      res.itemCount = node.children.length;
                    }
                    return res;
                  };
                  const tree = rawTree.map((r) => simplifyNode(r, 1)).filter(Boolean);
                  return {
                    ok: true,
                    data: {
                      tree,
                      note: '获取书签树成功',
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `获取书签树失败: ${(err as Error).message}` };
                }
              }

              // 6. searchBookmarks 关键词搜索书签
              if (call.name === 'searchBookmarks') {
                try {
                  const query = String(call.args?.query ?? '').trim();
                  if (!query) return { ok: false, error: '未指定搜索关键词 query' };
                  const items = await browser.bookmarks.search(query);
                  const results = items.slice(0, 30).map((b) => ({
                    id: b.id,
                    title: b.title,
                    url: b.url,
                    isFolder: !b.url,
                    parentId: b.parentId,
                  }));
                  return {
                    ok: true,
                    data: {
                      totalCount: items.length,
                      results,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `搜索书签失败: ${(err as Error).message}` };
                }
              }

              // 7. createBookmark 创建书签/文件夹
              if (call.name === 'createBookmark') {
                try {
                  const title = String(call.args?.title ?? '').trim();
                  const url = call.args?.url ? String(call.args.url).trim() : undefined;
                  const parentId = call.args?.parentId ? String(call.args.parentId).trim() : undefined;
                  const index = call.args?.index != null ? Number(call.args.index) : undefined;
                  if (!title) return { ok: false, error: '未指定书签标题 title' };
                  const created = await browser.bookmarks.create({
                    title,
                    url,
                    parentId,
                    index,
                  });
                  return {
                    ok: true,
                    data: {
                      id: created.id,
                      title: created.title,
                      url: created.url,
                      parentId: created.parentId,
                      isFolder: !created.url,
                      note: created.url ? `🔖 已成功创建书签: ${title}` : `📁 已成功创建书签文件夹: ${title}`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `创建书签失败: ${(err as Error).message}` };
                }
              }

              // 8. moveBookmark 移动/重命名书签
              if (call.name === 'moveBookmark') {
                try {
                  const id = String(call.args?.id ?? '').trim();
                  const parentId = call.args?.parentId ? String(call.args.parentId).trim() : undefined;
                  const index = call.args?.index != null ? Number(call.args.index) : undefined;
                  const title = call.args?.title ? String(call.args.title).trim() : undefined;
                  if (!id) return { ok: false, error: '未指定书签 id' };
                  if (parentId != null || index != null) {
                    await browser.bookmarks.move(id, { parentId, index });
                  }
                  if (title) {
                    await browser.bookmarks.update(id, { title });
                  }
                  return {
                    ok: true,
                    data: { id, parentId, title, note: `✨ 已成功更新/移动书签 ID: ${id}` },
                  };
                } catch (err) {
                  return { ok: false, error: `移动/修改书签失败: ${(err as Error).message}` };
                }
              }

              // 9. removeBookmark 删除书签/文件夹
              if (call.name === 'removeBookmark') {
                try {
                  const id = String(call.args?.id ?? '').trim();
                  const isFolder = Boolean(call.args?.isFolder);
                  if (!id) return { ok: false, error: '未指定要删除的书签 id' };
                  if (isFolder && typeof browser.bookmarks.removeTree === 'function') {
                    await browser.bookmarks.removeTree(id);
                  } else {
                    await browser.bookmarks.remove(id);
                  }
                  return {
                    ok: true,
                    data: { id, isFolder, note: `🗑️ 已成功删除书签${isFolder ? '文件夹' : ''} (ID: ${id})` },
                  };
                } catch (err) {
                  return { ok: false, error: `删除书签失败: ${(err as Error).message}` };
                }
              }

              // 10. searchHistory 模糊检索历史记录
              if (call.name === 'searchHistory') {
                try {
                  const text = call.args?.text ? String(call.args.text).trim() : '';
                  const startTime = call.args?.startTime != null ? Number(call.args.startTime) : Date.now() - 7 * 86400 * 1000;
                  const endTime = call.args?.endTime != null ? Number(call.args.endTime) : undefined;
                  const maxResults = Math.min(Number(call.args?.maxResults) || 25, 100);
                  const items = await browser.history.search({
                    text,
                    startTime,
                    endTime,
                    maxResults,
                  });
                  const historyList = items.map((h) => ({
                    id: h.id,
                    title: h.title || '未命名网页',
                    url: h.url || '',
                    visitCount: h.visitCount || 1,
                    lastVisitTime: h.lastVisitTime ? new Date(h.lastVisitTime).toLocaleString('zh-CN') : '',
                  }));
                  return {
                    ok: true,
                    data: {
                      count: historyList.length,
                      history: historyList,
                      query: text || '最近全部',
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `检索历史记录失败: ${(err as Error).message}` };
                }
              }

              // 11. discardTabs 休眠闲置标签页释放内存
              if (call.name === 'discardTabs') {
                try {
                  let targetTabIds = (call.args?.tabIds as number[]) || [];
                  if (targetTabIds.length === 0) {
                    const allTabs = await browser.tabs.query({ currentWindow: true, active: false });
                    targetTabIds = allTabs.map((t) => t.id!).filter(Boolean);
                  }
                  const discardedList: Array<{ id: number; title: string; url: string }> = [];
                  const chromeGlobal = (globalThis as any).chrome;
                  for (const tid of targetTabIds) {
                    try {
                      const tab = await browser.tabs.get(tid);
                      if (typeof chromeGlobal?.tabs?.discard === 'function') {
                        await chromeGlobal.tabs.discard(tid);
                      } else if (typeof (browser.tabs as any)?.discard === 'function') {
                        await (browser.tabs as any).discard(tid);
                      }
                      discardedList.push({ id: tid, title: tab.title || '标签页', url: tab.url || '' });
                    } catch {
                      /* 忽略单个 tab 休眠失败 */
                    }
                  }
                  return {
                    ok: true,
                    data: {
                      discardedCount: discardedList.length,
                      discardedTabs: discardedList,
                      note: `💤 已成功休眠 ${discardedList.length} 个闲置标签页，释放系统内存`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `休眠标签页失败: ${(err as Error).message}` };
                }
              }

              // 12. saveWorkspace 保存项目工作区快照
              if (call.name === 'saveWorkspace') {
                try {
                  const name = String(call.args?.name ?? '').trim();
                  if (!name) return { ok: false, error: '请提供工作区名称' };
                  const targetTabIds = (call.args?.tabIds as number[]) || [];
                  const closeAfterSave = Boolean(call.args?.closeAfterSave);

                  const allWindowTabs = await browser.tabs.query({ currentWindow: true });
                  const selectedTabs = targetTabIds.length > 0
                    ? allWindowTabs.filter((t) => targetTabIds.includes(t.id!))
                    : allWindowTabs.filter((t) => t.url && !t.url.startsWith('chrome-extension://'));

                  const chromeGlobal = (globalThis as any).chrome;
                  const groupMap = new Map<number, { title?: string; color?: string }>();
                  if (typeof chromeGlobal?.tabGroups?.get === 'function') {
                    for (const t of selectedTabs) {
                      const gid = (t as any).groupId;
                      if (gid != null && gid > -1 && !groupMap.has(gid)) {
                        try {
                          const gInfo = await chromeGlobal.tabGroups.get(gid);
                          if (gInfo) groupMap.set(gid, { title: gInfo.title, color: gInfo.color });
                        } catch {
                          /* ignore */
                        }
                      }
                    }
                  }

                  const snapshotTabs = selectedTabs.map((t) => {
                    const gid = (t as any).groupId;
                    const gInfo = gid != null && gid > -1 ? groupMap.get(gid) : undefined;
                    return {
                      title: t.title || '未命名标签',
                      url: t.url!,
                      pinned: t.pinned ?? false,
                      groupTitle: gInfo?.title,
                      groupColor: gInfo?.color,
                    };
                  });

                  const WORKSPACE_KEY = 'workspaces_store';
                  const storageRes = (await browser.storage.local.get(WORKSPACE_KEY)) as { [WORKSPACE_KEY]?: Record<string, any> };
                  const store = storageRes[WORKSPACE_KEY] || {};

                  const wsId = `ws_${Date.now()}`;
                  store[wsId] = {
                    id: wsId,
                    name,
                    createdAt: Date.now(),
                    tabs: snapshotTabs,
                  };

                  await browser.storage.local.set({ [WORKSPACE_KEY]: store });

                  if (closeAfterSave && selectedTabs.length > 0) {
                    const toClose = selectedTabs.map((t) => t.id!).filter(Boolean);
                    await browser.tabs.remove(toClose);
                  }

                  return {
                    ok: true,
                    data: {
                      workspaceId: wsId,
                      name,
                      tabCount: snapshotTabs.length,
                      closedAfterSave: closeAfterSave,
                      note: `💾 已成功将 ${snapshotTabs.length} 个标签页保存为工作区快照「${name}」！`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `保存工作区失败: ${(err as Error).message}` };
                }
              }

              // 13. listWorkspaces 获取已保存工作区快照
              if (call.name === 'listWorkspaces') {
                try {
                  const WORKSPACE_KEY = 'workspaces_store';
                  const storageRes = (await browser.storage.local.get(WORKSPACE_KEY)) as { [WORKSPACE_KEY]?: Record<string, any> };
                  const store = storageRes[WORKSPACE_KEY] || {};
                  const list = Object.values(store).map((ws: any) => ({
                    id: ws.id,
                    name: ws.name,
                    createdAt: new Date(ws.createdAt).toLocaleString('zh-CN'),
                    tabCount: Array.isArray(ws.tabs) ? ws.tabs.length : 0,
                    tabsPreview: Array.isArray(ws.tabs)
                      ? ws.tabs.slice(0, 5).map((t: any) => `[${t.title}](${t.url})`).join('、') + (ws.tabs.length > 5 ? '…' : '')
                      : '',
                  }));
                  return {
                    ok: true,
                    data: {
                      count: list.length,
                      workspaces: list,
                      note: `已获取 ${list.length} 个项目工作区快照`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `获取工作区列表失败: ${(err as Error).message}` };
                }
              }

              // 14. restoreWorkspace 还原工作区快照
              if (call.name === 'restoreWorkspace') {
                try {
                  const nameOrId = String(call.args?.nameOrId ?? '').trim().toLowerCase();
                  const inNewWindow = Boolean(call.args?.inNewWindow);
                  if (!nameOrId) return { ok: false, error: '请指定要还原的工作区名称或 ID' };

                  const WORKSPACE_KEY = 'workspaces_store';
                  const storageRes = (await browser.storage.local.get(WORKSPACE_KEY)) as { [WORKSPACE_KEY]?: Record<string, any> };
                  const store = storageRes[WORKSPACE_KEY] || {};
                  const targetWs = Object.values(store).find(
                    (ws: any) => ws.id === nameOrId || String(ws.name).toLowerCase().includes(nameOrId),
                  ) as any;

                  if (!targetWs || !Array.isArray(targetWs.tabs) || targetWs.tabs.length === 0) {
                    return { ok: false, error: `未找到名为「${nameOrId}」的工作区快照或该工作区无可用网页` };
                  }

                  let windowId: number | undefined;
                  const createdTabIds: number[] = [];
                  const groupMap = new Map<string, number[]>(); // groupTitle -> tabIds

                  for (let i = 0; i < targetWs.tabs.length; i++) {
                    const item = targetWs.tabs[i];
                    if (inNewWindow && i === 0) {
                      const win = await browser.windows.create({ url: item.url });
                      windowId = win?.id;
                      if (win?.tabs?.[0]?.id) createdTabIds.push(win.tabs[0].id);
                    } else {
                      const tab = await browser.tabs.create({
                        url: item.url,
                        windowId,
                        pinned: Boolean(item.pinned),
                        active: i === 0,
                      });
                      if (tab.id) createdTabIds.push(tab.id);
                    }

                    if (item.groupTitle && createdTabIds.length > 0) {
                      const lastId = createdTabIds[createdTabIds.length - 1]!;
                      const arr = groupMap.get(item.groupTitle) || [];
                      arr.push(lastId);
                      groupMap.set(item.groupTitle, arr);
                    }
                  }

                  // 还原标签组
                  const chromeGlobal = (globalThis as any).chrome;
                  if (typeof chromeGlobal?.tabs?.group === 'function') {
                    for (const [gTitle, tIds] of groupMap.entries()) {
                      try {
                        const gid = await chromeGlobal.tabs.group({ tabIds: tIds });
                        if (gid != null && typeof chromeGlobal?.tabGroups?.update === 'function') {
                          const refItem = targetWs.tabs.find((t: any) => t.groupTitle === gTitle);
                          await chromeGlobal.tabGroups.update(gid, {
                            title: gTitle,
                            color: refItem?.groupColor || 'blue',
                          });
                        }
                      } catch {
                        /* 忽略分组失败 */
                      }
                    }
                  }

                  return {
                    ok: true,
                    data: {
                      name: targetWs.name,
                      restoredCount: targetWs.tabs.length,
                      inNewWindow,
                      note: `🎉 已成功恢复工作区「${targetWs.name}」中的 ${targetWs.tabs.length} 个网页！`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `还原工作区失败: ${(err as Error).message}` };
                }
              }

              // 15. deleteWorkspace 删除工作区快照
              if (call.name === 'deleteWorkspace') {
                try {
                  const nameOrId = String(call.args?.nameOrId ?? '').trim().toLowerCase();
                  if (!nameOrId) return { ok: false, error: '请指定要删除的工作区名称或 ID' };
                  const WORKSPACE_KEY = 'workspaces_store';
                  const storageRes = (await browser.storage.local.get(WORKSPACE_KEY)) as { [WORKSPACE_KEY]?: Record<string, any> };
                  const store = storageRes[WORKSPACE_KEY] || {};
                  const targetKey = Object.keys(store).find(
                    (k) => k === nameOrId || String(store[k]?.name).toLowerCase() === nameOrId,
                  );
                  if (!targetKey) {
                    return { ok: false, error: `未找到要删除的工作区「${nameOrId}」` };
                  }
                  const wsName = store[targetKey]?.name || nameOrId;
                  delete store[targetKey];
                  await browser.storage.local.set({ [WORKSPACE_KEY]: store });
                  return {
                    ok: true,
                    data: { name: wsName, note: `🗑️ 已成功删除工作区「${wsName}」` },
                  };
                } catch (err) {
                  return { ok: false, error: `删除工作区失败: ${(err as Error).message}` };
                }
              }

              // 16. getRecentlyClosedTabs 获取最近关闭的标签页
              if (call.name === 'getRecentlyClosedTabs') {
                try {
                  const maxResults = Math.min(Number(call.args?.maxResults) || 15, 25);
                  let sessionsList: any[] = [];
                  const chromeGlobal = (globalThis as any).chrome;
                  if (typeof chromeGlobal?.sessions?.getRecentlyClosed === 'function') {
                    sessionsList = await chromeGlobal.sessions.getRecentlyClosed({ maxResults });
                  } else if (typeof (browser as any)?.sessions?.getRecentlyClosed === 'function') {
                    sessionsList = await (browser as any).sessions.getRecentlyClosed({ maxResults });
                  }
                  const closedTabs: any[] = [];
                  for (const s of sessionsList) {
                    if (s.tab) {
                      closedTabs.push({
                        sessionId: s.tab.sessionId,
                        title: s.tab.title || '未命名网页',
                        url: s.tab.url || '',
                        lastModified: s.lastModified ? new Date(s.lastModified * 1000).toLocaleTimeString('zh-CN') : '',
                      });
                    } else if (s.window && Array.isArray(s.window.tabs)) {
                      for (const wt of s.window.tabs) {
                        closedTabs.push({
                          sessionId: wt.sessionId,
                          title: wt.title || '未命名网页',
                          url: wt.url || '',
                          windowId: s.window.sessionId,
                          lastModified: s.lastModified ? new Date(s.lastModified * 1000).toLocaleTimeString('zh-CN') : '',
                        });
                      }
                    }
                  }
                  return {
                    ok: true,
                    data: {
                      count: closedTabs.length,
                      closedTabs,
                      note: `已找到 ${closedTabs.length} 个最近关闭的网页`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `获取最近关闭网页失败: ${(err as Error).message}` };
                }
              }

              // 17. restoreClosedTab 重新秒级唤醒打开误关网页
              if (call.name === 'restoreClosedTab') {
                try {
                  const sessionId = call.args?.sessionId ? String(call.args.sessionId) : undefined;
                  const chromeGlobal = (globalThis as any).chrome;
                  let restoredSession: any;
                  if (typeof chromeGlobal?.sessions?.restore === 'function') {
                    restoredSession = await chromeGlobal.sessions.restore(sessionId);
                  } else if (typeof (browser as any)?.sessions?.restore === 'function') {
                    restoredSession = await (browser as any).sessions.restore(sessionId);
                  }
                  const title = restoredSession?.tab?.title || '目标网页';
                  return {
                    ok: true,
                    data: {
                      title,
                      note: `🔄 已成功找回并重新打开网页: ${title}`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `恢复网页失败: ${(err as Error).message}` };
                }
              }

              // 18. clearBrowsingData 精细化定向清理缓存/Cookie
              if (call.name === 'clearBrowsingData') {
                try {
                  const origins = Array.isArray(call.args?.origins) ? (call.args.origins as string[]) : undefined;
                  const dataTypes = Array.isArray(call.args?.dataTypes) ? (call.args.dataTypes as string[]) : ['cache', 'cookies'];
                  const since = Number(call.args?.timeSince) || 0;

                  const dataRemoval: Record<string, boolean> = {};
                  for (const t of dataTypes) {
                    if (t === 'cache') dataRemoval.cache = true;
                    if (t === 'cookies') dataRemoval.cookies = true;
                    if (t === 'localStorage') dataRemoval.localStorage = true;
                    if (t === 'history') dataRemoval.history = true;
                  }
                  if (Object.keys(dataRemoval).length === 0) {
                    dataRemoval.cache = true;
                    dataRemoval.cookies = true;
                  }

                  const chromeGlobal = (globalThis as any).chrome;
                  if (origins && origins.length > 0) {
                    if (typeof chromeGlobal?.browsingData?.remove === 'function') {
                      await chromeGlobal.browsingData.remove({ origins, since }, dataRemoval);
                    } else if (typeof (browser as any)?.browsingData?.remove === 'function') {
                      await (browser as any).browsingData.remove({ origins, since }, dataRemoval);
                    }
                  } else {
                    if (typeof chromeGlobal?.browsingData?.remove === 'function') {
                      await chromeGlobal.browsingData.remove({ since }, dataRemoval);
                    } else if (typeof (browser as any)?.browsingData?.remove === 'function') {
                      await (browser as any).browsingData.remove({ since }, dataRemoval);
                    }
                  }

                  return {
                    ok: true,
                    data: {
                      clearedTypes: Object.keys(dataRemoval),
                      origins: origins || ['全局'],
                      note: `🧹 已成功清理 ${origins ? origins.join(', ') : '全局'} 的 ${Object.keys(dataRemoval).join('/')} 数据`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `清理浏览数据失败: ${(err as Error).message}` };
                }
              }

              // 19. moveTabsToNewWindow 移动标签页至新窗口
              if (call.name === 'moveTabsToNewWindow') {
                try {
                  const tabIds = (call.args?.tabIds as number[]) || [];
                  const focused = call.args?.focused !== false;
                  if (tabIds.length === 0) return { ok: false, error: '未指定要移出的 tabIds' };
                  const [first, ...rest] = tabIds;
                  const win = await browser.windows.create({ tabId: first, focused });
                  const winId = win?.id;
                  if (rest.length > 0 && winId != null) {
                    await browser.tabs.move(rest, { windowId: winId, index: -1 });
                  }
                  return {
                    ok: true,
                    data: {
                      movedCount: tabIds.length,
                      windowId: winId,
                      note: `🪟 已将 ${tabIds.length} 个标签页分离至新窗口`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `移动标签页至新窗口失败: ${(err as Error).message}` };
                }
              }

              // 20. setTabZoom 设置页面缩放比例
              if (call.name === 'setTabZoom') {
                try {
                  const targetTabId = Number(call.args?.tabId) || payload.tabId;
                  const zoomFactor = Number(call.args?.zoomFactor) || 1.0;
                  await browser.tabs.setZoom(targetTabId, zoomFactor);
                  return {
                    ok: true,
                    data: {
                      tabId: targetTabId,
                      zoomFactor,
                      percentage: `${Math.round(zoomFactor * 100)}%`,
                      note: `🔍 已将页面缩放调整为 ${Math.round(zoomFactor * 100)}%`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `设置缩放失败: ${(err as Error).message}` };
                }
              }

              // 21. searchDownloads 检索下载历史
              if (call.name === 'searchDownloads') {
                try {
                  const query = call.args?.query ? String(call.args.query).trim() : undefined;
                  const mime = call.args?.mimeType ? String(call.args.mimeType).trim() : undefined;
                  const limit = Math.min(Number(call.args?.limit) || 20, 50);

                  const chromeGlobal = (globalThis as any).chrome;
                  let rawItems: any[] = [];
                  if (typeof chromeGlobal?.downloads?.search === 'function') {
                    rawItems = await chromeGlobal.downloads.search({ query: query ? [query] : undefined, mime, limit });
                  } else if (typeof (browser as any)?.downloads?.search === 'function') {
                    rawItems = await (browser as any).downloads.search({ query: query ? [query] : undefined, mime, limit });
                  }

                  const downloadList = rawItems.map((item) => ({
                    id: item.id,
                    filename: item.filename ? item.filename.split('/').pop() : '未命名文件',
                    fullPath: item.filename || '',
                    url: item.url || '',
                    fileSize: item.fileSize ? `${(item.fileSize / 1024 / 1024).toFixed(2)} MB` : '未知大小',
                    state: item.state || 'complete',
                    endTime: item.endTime ? new Date(item.endTime).toLocaleString('zh-CN') : '',
                  }));

                  return {
                    ok: true,
                    data: {
                      count: downloadList.length,
                      downloads: downloadList,
                      query: query || '全部文件',
                      note: `已检索到 ${downloadList.length} 条下载记录`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `检索下载记录失败: ${(err as Error).message}` };
                }
              }

              // 22. startWorkflowRecording 开启流程录制
              if (call.name === 'startWorkflowRecording') {
                try {
                  const targetTabId = Number(call.args?.tabId) || payload.tabId;
                  const res = await browser.tabs.sendMessage(targetTabId, { type: 'WORKFLOW:START_RECORDING' });
                  return {
                    ok: true,
                    data: { status: 'recording', tabId: targetTabId, note: res?.message || '🔴 已开启网页流程录制' },
                  };
                } catch (err) {
                  return { ok: false, error: `开启录制失败: ${(err as Error).message}` };
                }
              }

              // 23. stopWorkflowRecording 结束流程录制
              if (call.name === 'stopWorkflowRecording') {
                try {
                  const targetTabId = Number(call.args?.tabId) || payload.tabId;
                  const res = await browser.tabs.sendMessage(targetTabId, { type: 'WORKFLOW:STOP_RECORDING' });
                  return {
                    ok: true,
                    data: {
                      steps: res?.steps || [],
                      count: res?.steps?.length || 0,
                      actionCount: res?.actionCount || 0,
                      note: `已成功结束录制，提炼生成 ${res?.steps?.length || 0} 个步骤`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `结束录制失败: ${(err as Error).message}` };
                }
              }

              // 24. saveWorkflowRecipe 保存工作流配方
              if (call.name === 'saveWorkflowRecipe') {
                try {
                  const name = String(call.args?.name ?? '').trim();
                  const steps = (call.args?.steps as any[]) || [];
                  const description = call.args?.description ? String(call.args.description) : undefined;
                  const urlPattern = call.args?.urlPattern ? String(call.args.urlPattern) : undefined;
                  if (!name || steps.length === 0) {
                    return { ok: false, error: '工作流名称与步骤列表不能为空' };
                  }
                  const saved = await saveWorkflowRecipe(name, steps, { description, urlPattern });
                  return {
                    ok: true,
                    data: {
                      recipe: saved,
                      note: `💾 已成功保存工作流「${name}」(${steps.length} 个步骤)`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `保存工作流失败: ${(err as Error).message}` };
                }
              }

              // 25. listWorkflowRecipes 获取工作流列表
              if (call.name === 'listWorkflowRecipes') {
                try {
                  const recipes = await listWorkflowRecipes();
                  return {
                    ok: true,
                    data: {
                      count: recipes.length,
                      recipes: recipes.map((r) => ({
                        id: r.id,
                        name: r.name,
                        description: r.description,
                        stepCount: r.steps.length,
                        stepsPreview: r.steps.map((s) => s.description).join(' ➔ '),
                        updatedAt: new Date(r.updatedAt).toLocaleString('zh-CN'),
                      })),
                      note: `已获取 ${recipes.length} 个自动化工作流`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `获取工作流列表失败: ${(err as Error).message}` };
                }
              }

              // 26. runWorkflowRecipe 回放执行工作流配方
              if (call.name === 'runWorkflowRecipe') {
                try {
                  const nameOrId = String(call.args?.nameOrId ?? '').trim();
                  const targetTabId = Number(call.args?.tabId) || payload.tabId;
                  const recipe = await getWorkflowRecipe(nameOrId);
                  if (!recipe || recipe.steps.length === 0) {
                    return { ok: false, error: `未找到工作流「${nameOrId}」或该工作流无步骤` };
                  }

                  let targetStartUrl = recipe.startUrl || recipe.urlPattern || recipe.steps[0]?.url;
                  if (!targetStartUrl && /百度|baidu/i.test(recipe.name)) {
                    targetStartUrl = 'https://www.baidu.com';
                  }

                  if (targetStartUrl) {
                    try {
                      const currentTab = await browser.tabs.get(targetTabId);
                      const currentUrl = currentTab?.url || '';
                      const originPrefix = targetStartUrl ? targetStartUrl.split('?')[0] : '';
                      if (
                        /^(chrome|edge|about|chrome-extension):/i.test(currentUrl) ||
                        (originPrefix && !currentUrl.startsWith(originPrefix))
                      ) {
                        await browser.tabs.update(targetTabId, { url: targetStartUrl });
                        await new Promise((r) => setTimeout(r, 1500));
                      }
                    } catch {
                      /* ignore */
                    }
                  }

                  const executionLog: string[] = [];
                  let stepIdx = 0;
                  for (const step of recipe.steps) {
                    stepIdx++;
                    if (!step) continue;
                    executionLog.push(`步骤 ${stepIdx}/${recipe.steps.length}: ${step.description}`);

                    let currentTabId = targetTabId;
                    try {
                      const [currentActive] = await browser.tabs.query({ active: true, currentWindow: true });
                      if (currentActive?.id) {
                        currentTabId = currentActive.id;
                      }
                      if (step.url) {
                        const allTabs = await browser.tabs.query({ currentWindow: true });
                        const prefix = step.url.split('?')[0] || '';
                        const matchTab = allTabs.find((t) => t.url && prefix && t.url.startsWith(prefix));
                        if (matchTab && matchTab.id && matchTab.id !== currentTabId) {
                          currentTabId = matchTab.id;
                          await browser.tabs.update(matchTab.id, { active: true });
                        }
                      }
                    } catch {
                      /* ignore */
                    }

                    if (step.type === 'click') {
                      await callToolInTab(currentTabId, {
                        id: `wf_${Date.now()}_${stepIdx}`,
                        name: 'clickElement',
                        args: { selector: step.selector, targetText: step.targetText },
                      });
                    } else if (step.type === 'type') {
                      await callToolInTab(currentTabId, {
                        id: `wf_${Date.now()}_${stepIdx}`,
                        name: 'typeInto',
                        args: {
                          selector: step.selector,
                          targetText: step.targetText,
                          text: step.value || '',
                          humanLike: true,
                        },
                      });
                    } else if (step.type === 'pressEnter') {
                      await callToolInTab(currentTabId, {
                        id: `wf_${Date.now()}_${stepIdx}`,
                        name: 'pressEnter',
                        args: { selector: step.selector, targetText: step.targetText },
                      });
                    } else if (step.type === 'hover') {
                      await callToolInTab(currentTabId, {
                        id: `wf_${Date.now()}_${stepIdx}`,
                        name: 'hoverElement',
                        args: { selector: step.selector, targetText: step.targetText },
                      });
                    } else if (step.type === 'wait') {
                      await new Promise((r) => setTimeout(r, step.waitMs || 1000));
                    }
                    // 拟人步骤间隔 300ms
                    await new Promise((r) => setTimeout(r, 300));
                  }

                  return {
                    ok: true,
                    data: {
                      name: recipe.name,
                      stepCount: recipe.steps.length,
                      logs: executionLog,
                      note: `🎉 自动化工作流「${recipe.name}」已顺利执行完毕！`,
                    },
                  };
                } catch (err) {
                  return { ok: false, error: `执行工作流失败: ${(err as Error).message}` };
                }
              }

              // 27. deleteWorkflowRecipe 删除工作流
              if (call.name === 'deleteWorkflowRecipe') {
                try {
                  const nameOrId = String(call.args?.nameOrId ?? '').trim();
                  const ok = await deleteWorkflowRecipe(nameOrId);
                  if (!ok) return { ok: false, error: `未找到要删除的工作流「${nameOrId}」` };
                  return {
                    ok: true,
                    data: { name: nameOrId, note: `🗑️ 已删除工作流「${nameOrId}」` },
                  };
                } catch (err) {
                  return { ok: false, error: `删除工作流失败: ${(err as Error).message}` };
                }
              }

              // 11. navigate 由 background 经 tabs.update 执行
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

              // 12. 其他 DOM 工具(readPage/extractData 等):支持通过 args.tabId 指定目标标签页
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
});
