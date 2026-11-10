// 向标签页执行一次 TOOL:CALL;系统页优雅降级,休眠标签页静默自动唤醒,无接收端时主动注入 func/content script
import type { ToolCall, ToolResult } from '@/utils/domTools/types';
import { markdownToWechatHtml } from '@/utils/wechat/styleInliner';

export async function callToolInTab(tabId: number, call: ToolCall): Promise<ToolResult> {
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
                      let max = current;
                      for (let i = 0; i < el.children.length; i++) {
                        const child = el.children[i];
                        if (child) {
                          const d = getDepth(child, current + 1);
                          if (d > max) max = d;
                        }
                      }
                      return max;
                    };
                    if (document.documentElement) {
                      maxDomDepth = getDepth(document.documentElement, 1);
                    }
                  }
                  if (typeof performance !== 'undefined' && (performance as any).memory) {
                    const mem = (performance as any).memory;
                    jsHeapUsedMb = Math.round((mem.usedJSHeapSize || 0) / 1024 / 1024);
                    jsHeapTotalMb = Math.round((mem.totalJSHeapSize || 0) / 1024 / 1024);
                  }
                } catch {
                  /* 忽略 DOM/内存诊断异常 */
                }

                // 3. 阻塞渲染资源 (Render Blocking Resources)
                const renderBlockingResources: Array<{ name: string; url: string; sizeKb: number; durationMs: number }> = [];
                try {
                  if (typeof document !== 'undefined') {
                    const headLinks = Array.from(document.querySelectorAll('head link[rel="stylesheet"]:not([media="print"]):not([disabled])'));
                    const headScripts = Array.from(document.querySelectorAll('head script[src]:not([async]):not([defer]):not([type="module"])'));
                    const blockingUrls = new Set([
                      ...headLinks.map((l) => (l as HTMLLinkElement).href),
                      ...headScripts.map((s) => (s as HTMLScriptElement).src),
                    ]);

                    for (const r of resources) {
                      if (r && r.name && blockingUrls.has(r.name)) {
                        renderBlockingResources.push({
                          name: getShortName(r.name),
                          url: r.name,
                          sizeKb: Math.round((r.transferSize || r.decodedBodySize || 0) / 1024),
                          durationMs: Math.round(r.duration),
                        });
                        if (renderBlockingResources.length >= 5) break;
                      }
                    }
                  }
                } catch {
                  /* 忽略阻塞资源异常 */
                }

                return {
                  url: typeof location !== 'undefined' ? location.href : '',
                  title: typeof document !== 'undefined' ? document.title : '',
                  protocol,
                  fcpMs,
                  dnsMs,
                  tcpMs,
                  ttfbMs,
                  domReadyMs,
                  loadMs,
                  transferSizeKb,
                  decodedBodySizeKb,
                  resourceCount: resources.length,
                  topSlowResources,
                  topHeavyResources,
                  resourceBreakdown,
                  longTaskCount,
                  totalLongTaskMs,
                  maxLongTaskMs,
                  domNodeCount,
                  maxDomDepth,
                  jsHeapUsedMb,
                  jsHeapTotalMb,
                  renderBlockingResources,
                };
              } catch (e) {
                return { error: (e as Error).message };
              }
            },
          });
          if (execRes?.[0]?.result) {
            return { ok: true, data: execRes[0].result };
          }
        } catch {
          /* 继续走下方完整 content script 注入 */
        }
      } else if (call.name === 'getPageInfo') {
        try {
          const execRes = await browser.scripting.executeScript({
            target: { tabId },
            func: () => ({
              url: typeof location !== 'undefined' ? location.href : '',
              title: typeof document !== 'undefined' ? document.title : '',
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
          const textLimit = Number(call.args?.textLimit) || 8000;
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

          let htmlContent = String(call.args?.htmlContent ?? call.args?.contentHtml ?? '');
          if (!htmlContent && contentMarkdown) {
            htmlContent = markdownToWechatHtml(contentMarkdown, theme);
          }

          const execRes = await browser.scripting.executeScript({
            target: { tabId },
            func: async (t, a, d, html, th) => {
              const titleEl = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
                '#title, input.js_title, [placeholder*="标题"], .title_input',
              );

              const authorEl = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
                '#author, input.js_author, [placeholder*="作者"]',
              );

              const digestEl = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
                '#js_description, textarea.js_description, #digest, [placeholder*="摘要"]',
              );

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

              // 严格校验编辑页 DOM (若未定位到标题输入框或正文编辑器容器，必须返回 ok: false)
              if (!titleEl || !editorBody) {
                return {
                  ok: false,
                  error: '未检测到微信图文编辑框，请确保当前浏览器停留在【新建图文】草稿编辑页面',
                };
              }

              if (titleEl && t) {
                titleEl.value = t.slice(0, 64);
                titleEl.dispatchEvent(new Event('input', { bubbles: true }));
                titleEl.dispatchEvent(new Event('change', { bubbles: true }));
              }

              if (authorEl && a) {
                authorEl.value = a.slice(0, 16);
                authorEl.dispatchEvent(new Event('input', { bubbles: true }));
                authorEl.dispatchEvent(new Event('change', { bubbles: true }));
              }

              if (digestEl && d) {
                digestEl.value = d.slice(0, 120);
                digestEl.dispatchEvent(new Event('input', { bubbles: true }));
                digestEl.dispatchEvent(new Event('change', { bubbles: true }));
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

              // 严禁在 injectedFields.editorBody === false 时返回 ok: true
              if (html && !injectedEditor) {
                return {
                  ok: false,
                  error: '未检测到微信图文编辑框，请确保当前浏览器停留在【新建图文】草稿编辑页面',
                };
              }

              // 自动触发「保存为草稿」
              let saveTriggered = false;
              try {
                const saveBtn =
                  document.querySelector<HTMLElement>(
                    '#js_send button.btn_primary, #js_submit, button.js_save, button[data-testid="save_draft"], #js_save, button.js_save_draft',
                  ) ||
                  Array.from(document.querySelectorAll<HTMLElement>('button, a.btn')).find((b) =>
                    (b.innerText || b.textContent || '').includes('保存'),
                  );

                if (saveBtn) {
                  saveBtn.click();
                  saveTriggered = true;
                }
              } catch {
                /* ignore */
              }

              await new Promise((r) => setTimeout(r, 600));

              return {
                ok: true,
                data: {
                  title: t || '未修改',
                  author: a || '未修改',
                  digest: d ? `${d.slice(0, 30)}…` : '未修改',
                  theme: th,
                  injectedFields: {
                    title: Boolean(titleEl),
                    author: Boolean(authorEl),
                    digest: Boolean(digestEl),
                    editorBody: Boolean(editorBody && (injectedEditor || !html)),
                  },
                  savedDraft: saveTriggered,
                  note: saveTriggered
                    ? '🎉 已成功将精美排版内容写入微信公众平台并已自动保存草稿！'
                    : '🎉 已成功将精美排版内容写入微信公众平台草稿！',
                },
              };
            },
            args: [title, author, digest, htmlContent, theme],
          });

          if (execRes?.[0]?.result) {
            const rawRes = execRes[0].result as any;
            if (rawRes.ok === false) {
              return { ok: false, error: rawRes.error || '未检测到微信图文编辑框，请确保当前浏览器停留在【新建图文】草稿编辑页面' };
            }
            return { ok: true, data: rawRes.data || rawRes };
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
}
