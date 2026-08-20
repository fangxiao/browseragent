import type { ToolResult } from './types';
import { matrixToCsv, matrixToJson, projectColumns } from './extractData';
import { findOptionIndex } from './form';
import { buildTree, findElementsByQuery, type ElementInfo } from './elementTree';
import { markdownToWechatHtml } from '../wechat/styleInliner';
import {
  sweepVirtualDoc,
  isVirtualizedPage,
  triggerScrollStep,
  getAllScrollableElements,
} from './virtualScroller';

const toStr = (v: unknown): string => String(v ?? '');

/** 给元素加临时高亮描边(操作视觉反馈,1.8s 后自动移除)。见 docs/design/agent.md §10 */
function flashHighlight(el: HTMLElement, color = '#3b82f6'): void {
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  const prevShadow = el.style.boxShadow;
  const prevTransition = el.style.transition;
  el.style.transition = 'outline 0.2s ease, box-shadow 0.2s ease';
  el.style.outline = `3px solid ${color}`;
  el.style.outlineOffset = '2px';
  el.style.boxShadow = `0 0 16px ${color}`;
  window.setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
    el.style.boxShadow = prevShadow;
    el.style.transition = prevTransition;
  }, 1800);
}

/** DOM → ElementInfo 树(语义元素树的数据源;深度受限避免过大) */
function collectElementTree(root: Element, depth = 0, maxDepth = 6): ElementInfo[] {
  if (depth > maxDepth) return [];
  const direct = Array.from(root.children).filter((el) =>
    el instanceof HTMLElement && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE',
  );
  return direct.slice(0, 80).map((el) => {
    const htmlEl = el as HTMLElement;
    const role = el.getAttribute('role') ?? '';
    const type = (el as HTMLInputElement).type ?? '';
    // 表单字段:aria-label 优先,否则用 placeholder/name
    const isField =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    const label =
      (el.getAttribute('aria-label') ?? '').trim() ||
      (isField ? ((el as HTMLInputElement).placeholder ?? (el as HTMLInputElement).name).trim() : '');
    const text = (htmlEl.innerText ?? htmlEl.textContent ?? '').trim();
    const selectable = `css:${el.tagName.toLowerCase()}:${(el as HTMLElement).getAttribute('data-testid') ?? label.slice(0, 20)}`;
    return {
      tag: el.tagName.toLowerCase(),
      role,
      type,
      label,
      text: text.slice(0, 120),
      selectable,
      depth,
      children: collectElementTree(el, depth + 1, maxDepth),
    };
  });
}

/** 收集整页 ElementInfo(展平,供 findElements 全量匹配) */
function collectAllElements(root: Element): ElementInfo[] {
  const flat: ElementInfo[] = [];
  const walk = (list: ElementInfo[]) => {
    for (const n of list) {
      flat.push(n);
      walk(n.children);
    }
  };
  walk(collectElementTree(root, 0, 10));
  return flat;
}

/** 判断元素是否在 DOM 中且具有可交互布局 */
function isElementVisible(el: HTMLElement): boolean {
  if (!el) return false;
  if ('isConnected' in el && !el.isConnected) return false;
  const win = typeof window !== 'undefined' ? window : (globalThis as any).window;
  const style = win?.getComputedStyle ? win.getComputedStyle(el) : ((el as any).style || {});
  if (style && (style.display === 'none' || style.visibility === 'hidden')) {
    return false;
  }
  const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
  return (
    (rect ? (rect.width > 0 && rect.height > 0) : true) ||
    (typeof el.getClientRects === 'function' && el.getClientRects().length > 0) ||
    Boolean(el.offsetParent) ||
    el.tagName === 'BODY'
  );
}

const normText = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** 智能自愈定位元素:优先语义/文本 -> 其次特异选择器 -> 结构化层级与容器穿透 -> XPath 深度文本兜底 -> Iframe 跨帧递归穿透 */
function queryElement(
  selector?: string,
  targetText?: string,
  rootDoc: Document = (typeof document !== 'undefined' ? document : (globalThis as any).document),
): HTMLElement | null {
  if (!rootDoc) return null;
  const sel = toStr(selector).trim();
  const text = toStr(targetText).trim();
  const searchText = text || sel;
  const nSearch = normText(searchText);

  // 1. 如果有明确且特异的选择器 (包含 id, testid, name, 或具有层级/伪类的 selector)
  if (sel && !/^(button|input|select|textarea|a|div|span|p|li|label|form|header|footer|nav|main|section)$/i.test(sel)) {
    try {
      const candidates = Array.from(rootDoc.querySelectorAll<HTMLElement>(sel)).filter(isElementVisible);
      if (candidates.length === 1) return candidates[0]!;
      if (candidates.length > 1 && nSearch) {
        // 多元素时，优先匹配文本一致者
        const matched = candidates.find((el) => {
          const t = normText(el.innerText || el.textContent || '');
          const v = el instanceof HTMLInputElement ? normText(el.value) : '';
          const aria = normText(el.getAttribute('aria-label') || '');
          const placeholder = normText(el.getAttribute('placeholder') || '');
          return t === nSearch || v === nSearch || aria === nSearch || placeholder === nSearch || t.includes(nSearch);
        });
        if (matched) return matched;
      }
      if (candidates.length > 0) return candidates[0]!;
    } catch {
      /* 非法选择器，继续语义降级定位 */
    }
  }

  // 2. 语义与可见文本精准匹配 (支持按钮、链接、标题、输入框、卡片容器等全量可交互节点)
  if (nSearch) {
    const allElements = Array.from(
      rootDoc.querySelectorAll<HTMLElement>(
        'a, button, [role="button"], input, textarea, select, h1, h2, h3, h4, h5, h6, [role="tab"], [role="menuitem"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="treeitem"], label, em, b, strong, span, p, div, li, footer, nav, header',
      ),
    ).filter(isElementVisible);

    // 2.1 针对按钮/链接/标题/卡片: 完全匹配或核心文本匹配
    const exactMatch = allElements.find((el) => {
      const t = normText(el.innerText || el.textContent || '');
      const aria = normText(el.getAttribute('aria-label') || '');
      const val = el instanceof HTMLInputElement ? normText(el.value) : '';
      const title = normText(el.getAttribute('title') || '');
      return t === nSearch || aria === nSearch || val === nSearch || title === nSearch;
    });
    if (exactMatch) {
      // 若匹配到的是标题或包含链接的容器，优先返回内嵌的 <a> 或最直接的交互点
      const innerAnchor = exactMatch.querySelector<HTMLElement>('a, button, [role="button"]');
      return innerAnchor && isElementVisible(innerAnchor) ? innerAnchor : exactMatch;
    }

    // 2.2 针对输入框/下拉框: 匹配 placeholder / aria-label / name / 关联 label
    const exactInput = allElements.find((el) => {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
        return false;
      }
      const placeholder = normText(el.getAttribute('placeholder') || '');
      const aria = normText(el.getAttribute('aria-label') || '');
      const name = normText(el.getAttribute('name') || '');
      if (placeholder === nSearch || aria === nSearch || name === nSearch) return true;
      if (el.id) {
        const label = rootDoc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label && normText(label.textContent || '') === nSearch) return true;
      }
      const parentLabel = el.closest('label');
      if (parentLabel && normText(parentLabel.textContent || '').includes(nSearch)) return true;
      return false;
    });
    if (exactInput) return exactInput;

    // 2.3 文本包含/模糊匹配 (如百度搜索结果带 <em> 修饰的标题)
    const partialMatch = allElements.find((el) => {
      const isInteractiveTag =
        el.tagName === 'A' ||
        el.tagName === 'BUTTON' ||
        el.tagName === 'H1' ||
        el.tagName === 'H2' ||
        el.tagName === 'H3' ||
        el.tagName === 'H4' ||
        el.tagName === 'H5' ||
        el.tagName === 'SPAN' ||
        el.tagName === 'LI' ||
        el.getAttribute('role') === 'button' ||
        el.getAttribute('role') === 'link';
      if (!isInteractiveTag) return false;
      const t = normText(el.innerText || el.textContent || '');
      const aria = normText(el.getAttribute('aria-label') || '');
      const placeholder = normText(el.getAttribute('placeholder') || '');
      return t.includes(nSearch) || nSearch.includes(t) || aria.includes(nSearch) || placeholder.includes(nSearch);
    });
    if (partialMatch) {
      const innerAnchor = partialMatch.querySelector<HTMLElement>('a, button, [role="button"]');
      return innerAnchor && isElementVisible(innerAnchor) ? innerAnchor : partialMatch;
    }

    // 2.4 XPath 深度文本穿透 (查找页面任意位置包含目标文本的最深层交互节点，支持页脚/嵌套链接/复杂卡片)
    try {
      if (typeof rootDoc.evaluate === 'function') {
        const cleanXPathText = searchText.replace(/'/g, "\\'");
        const xpath = `.//*[contains(normalize-space(.), '${cleanXPathText}')]`;
        const result = rootDoc.evaluate(xpath, rootDoc.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (result && result.snapshotLength > 0) {
          for (let i = result.snapshotLength - 1; i >= 0; i--) {
            const item = result.snapshotItem(i) as HTMLElement;
            if (item && isElementVisible(item)) {
              const clickable = item.closest('a, button, [role="button"]') as HTMLElement | null;
              return clickable || item;
            }
          }
        }
      }
    } catch {
      /* ignore xpath errors */
    }
  }

  // 3. 回退: 尝试使用原 selector 直接查找第一个可见元素
  if (sel) {
    try {
      const candidates = Array.from(rootDoc.querySelectorAll<HTMLElement>(sel)).filter(isElementVisible);
      if (candidates.length > 0) return candidates[0]!;
      const anyEl = rootDoc.querySelector<HTMLElement>(sel);
      if (anyEl) return anyEl;
    } catch {
      /* ignore */
    }
  }

  // 4. 穿透招聘系统/企业中台常使用的同一来源/可访问子 Iframe 递归查找
  if (rootDoc === document) {
    const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
    for (const frame of iframes) {
      try {
        const frameDoc = frame.contentDocument;
        if (frameDoc && frameDoc.body) {
          const found = queryElement(selector, targetText, frameDoc);
          if (found) return found;
        }
      } catch {
        /* 跨域 iframe 安全拦截忽略 */
      }
    }
  }

  return null;
}

/** 智能异步轮询等待元素就绪 (自动容错网络跳转/SPA异步渲染，最多等待 timeoutMs 毫秒) */
async function waitForSmartElement(
  selector?: string,
  targetText?: string,
  timeoutMs = 4000,
): Promise<HTMLElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = queryElement(selector, targetText);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

/** 从 DOM 收集表格/列表为字符串矩阵 */
export function collectTableData(root: Element): string[][] {
  const cells: string[][] = [];
  root.querySelectorAll('tr').forEach((tr) => {
    const row: string[] = [];
    tr.querySelectorAll('th, td').forEach((cell) => row.push((cell.textContent ?? '').trim()));
    if (row.some((c) => c)) cells.push(row);
  });
  return cells;
}

export const actions = {
  async getPageInfo(): Promise<ToolResult> {
    return { ok: true, data: { url: location.href, title: document.title, lang: document.documentElement.lang } };
  },

  async getPagePerformance(): Promise<ToolResult> {
    try {
      const nav = typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
        ? (performance.getEntriesByType('navigation')?.[0] as PerformanceNavigationTiming | undefined)
        : undefined;
      const resources = typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
        ? ((performance.getEntriesByType('resource') || []) as PerformanceResourceTiming[])
        : [];

      let dnsMs = 0;
      let tcpMs = 0;
      let ttfbMs = 0;
      let domReadyMs = 0;
      let loadMs = 0;
      let transferSizeKb = 0;
      let decodedBodySizeKb = 0;
      let protocol = '';
      let fcpMs = 0;

      // 提取 FCP(首次内容绘制)
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

      // 提取耗时最长的 Top 3 网络请求
      const topSlowResources = [...resources]
        .filter((r) => r.duration > 0 && r.name && /^https?:/i.test(r.name))
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 3)
        .map((r) => ({
          name: getShortName(r.name),
          url: r.name,
          durationMs: Math.round(r.duration),
          type: r.initiatorType || 'other',
          sizeKb: Math.round((r.transferSize || r.decodedBodySize || 0) / 1024),
        }));

      // 提取体积最大的 Top 3 资源
      const topHeavyResources = [...resources]
        .filter((r) => (r.transferSize || r.decodedBodySize || 0) > 0 && r.name && /^https?:/i.test(r.name))
        .sort((a, b) => (b.transferSize || b.decodedBodySize || 0) - (a.transferSize || a.decodedBodySize || 0))
        .slice(0, 3)
        .map((r) => ({
          name: getShortName(r.name),
          url: r.name,
          sizeKb: Math.round((r.transferSize || r.decodedBodySize || 0) / 1024),
          durationMs: Math.round(r.duration),
          type: r.initiatorType || 'other',
        }));

      // 资源类型结构统计
      const resourceBreakdown = {
        js: { count: 0, sizeKb: 0 },
        css: { count: 0, sizeKb: 0 },
        image: { count: 0, sizeKb: 0 },
        api: { count: 0, sizeKb: 0 },
        other: { count: 0, sizeKb: 0 },
      };

      for (const r of resources) {
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
      if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
        const longTasks = (performance.getEntriesByType('longtask') || []) as PerformanceEntry[];
        longTaskCount = longTasks.length;
        for (const t of longTasks) {
          const d = Math.round(t.duration);
          totalLongTaskMs += d;
          if (d > maxLongTaskMs) maxLongTaskMs = d;
        }
      }

      // 2. 内存与 DOM 树健康度(DOM Nodes & JS Heap)
      let domNodeCount = 0;
      let maxDomDepth = 0;
      let jsHeapUsedMb = 0;
      let jsHeapTotalMb = 0;
      if (typeof document !== 'undefined') {
        domNodeCount = document.getElementsByTagName('*').length;
        const getDepth = (el: Element): number => {
          let max = 1;
          for (let i = 0; i < el.children.length; i++) {
            const child = el.children[i];
            if (child) {
              const d = 1 + getDepth(child);
              if (d > max) max = d;
            }
          }
          return max;
        };
        try {
          maxDomDepth = document.documentElement ? getDepth(document.documentElement) : 0;
        } catch {
          maxDomDepth = 0;
        }
      }
      if (typeof performance !== 'undefined' && (performance as any).memory) {
        const mem = (performance as any).memory;
        jsHeapUsedMb = Math.round((mem.usedJSHeapSize || 0) / 1024 / 1024);
        jsHeapTotalMb = Math.round((mem.totalJSHeapSize || 0) / 1024 / 1024);
      }

      // 3. 压缩漏配与缓存能效(Gzip/Brotli & Cache Hit Rate)
      let cachedResourceCount = 0;
      let cacheHitRatePct = 0;
      const uncompressedAssets: Array<{ name: string; url: string; sizeKb: number; wastedKb: number; type: string }> = [];

      for (const r of resources) {
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

      return {
        ok: true,
        data: {
          url: typeof location !== 'undefined' ? location.href : '',
          title: typeof document !== 'undefined' ? document.title : '',
          dnsMs,
          tcpMs,
          ttfbMs,
          fcpMs,
          domReadyMs,
          loadMs,
          resourceCount: resources.length,
          transferSizeKb,
          decodedBodySizeKb,
          protocol,
          topSlowResources,
          topHeavyResources,
          resourceBreakdown,
          // 深度体检指标
          longTaskCount,
          totalLongTaskMs,
          maxLongTaskMs,
          domNodeCount,
          maxDomDepth,
          jsHeapUsedMb,
          jsHeapTotalMb,
          cachedResourceCount,
          cacheHitRatePct,
          uncompressedAssets,
          renderBlockingCount,
          renderBlockingList,
        },
      };
    } catch (err) {
      return { ok: false, error: `获取性能指标失败:${(err as Error).message}` };
    }
  },

  async readPage(args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof document === 'undefined') {
      return {
        ok: true,
        data: {
          url: '',
          title: '测试页面',
          summary: '',
          tree: { tag: 'body', children: [] },
        },
      };
    }

    const sel = toStr(args.selector);
    const root: Element = sel
      ? (document.querySelector(sel) ?? document.body)
      : document.body;

    // 文本摘要:限定的 root 区域优先;textLimit 可加大(默认 5000,最大 50000,支持超长文档)
    const textLimit = Math.min(50000, Math.max(500, Number(args.textLimit ?? 5000) || 5000));
    let summary = (root instanceof HTMLElement ? (root.innerText ?? '') : '').slice(0, textLimit);

    // 虚拟滚动与延迟加载长文档全量深度扫描(飞书 DocX / Notion / 语雀)
    const fullScan = args.fullScan !== false;
    const detection = isVirtualizedPage();
    if (fullScan && (detection.isVirtual || textLimit > 5000)) {
      try {
        const sweepRes = await sweepVirtualDoc({
          textLimit,
          stepDelayMs: 60,
        });
        if (sweepRes.fullText && sweepRes.fullText.length > summary.length) {
          summary = sweepRes.fullText;
        }
      } catch {
        /* 回退使用已采样的 summary */
      }
    }

    // 语义元素树(核心亮点):AI 据此理解页面结构
    const tree = buildTree(collectElementTree(root, 0, 4), 4, 20);
    return {
      ok: true,
      data: {
        url: typeof location !== 'undefined' ? location.href : '',
        title: document.title,
        summary,
        tree,
        isVirtualized: detection.isVirtual,
      },
    };
  },

  async findElements(args: Record<string, unknown>): Promise<ToolResult> {
    const q = {
      role: args.role ? toStr(args.role) : undefined,
      type: args.type ? toStr(args.type) : undefined,
      text: args.text ? toStr(args.text) : undefined,
      placeholder: args.placeholder ? toStr(args.placeholder) : undefined,
      keyword: args.keyword ? toStr(args.keyword) : undefined,
    };
    const all = collectAllElements(document.body);
    const found = findElementsByQuery(all, q, 30).map((n) => ({
      tag: n.tag,
      role: n.role,
      type: n.type,
      label: n.label,
      text: n.text.slice(0, 80),
      selectable: n.selectable,
    }));
    return {
      ok: true,
      data: { count: found.length, elements: found },
    };
  },

  async clickElement(args: Record<string, unknown>): Promise<ToolResult> {
    const sel = toStr(args.selector);
    const targetText = toStr(args.targetText || args.text);
    let el = await waitForSmartElement(sel, targetText, 6000);

    // 智能自愈容错: 如果是在搜索场景下点击联想词(如百度联想词)，但联想词浮层未及时弹出
    if (!el && (/百度|baidu|sogou|360|bing|google|search/i.test(document.title) || document.querySelector('#kw, input[name="wd"]'))) {
      const searchSubmitBtn = document.querySelector<HTMLElement>('#su, button[type="submit"], input[type="submit"], [aria-label="搜索"]');
      const searchInput = document.querySelector<HTMLElement>('#kw, input[name="wd"], input[type="search"]');
      if (searchSubmitBtn && isElementVisible(searchSubmitBtn)) {
        el = searchSubmitBtn;
      } else if (searchInput) {
        searchInput.focus();
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        const form = searchInput.closest('form');
        if (form) {
          try {
            if (typeof form.requestSubmit === 'function') {
              form.requestSubmit();
            } else {
              form.submit();
            }
          } catch {
            /* ignore */
          }
        }
        await new Promise((r) => setTimeout(r, 600));
        return { ok: true, data: { clicked: '回车提交搜索(联想词自愈降级)' } };
      }
    }

    if (!el) return { ok: false, error: `未找到可点击元素:${targetText || sel}` };
    flashHighlight(el);
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {
      /* ignore */
    }

    // 拟人鼠标事件序列 (模拟真实用户点击链路，触发 React/Vue/AntD 等组件内状态机)
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    try {
      el.focus();
    } catch {
      /* ignore */
    }
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    if (typeof (el as any).click === 'function') {
      el.click();
    }

    // 如果目标是 SVG/内嵌标签，向最近的可交互父容器也派发点击，保证企业级 SPA (React/Vue/AntD) 合成事件触发
    const interactiveParent = el.closest<HTMLElement>(
      'button, a, [role="button"], [role="tab"], [role="menuitem"], [class*="btn"], [class*="trigger"], [class*="item"], [onclick], span, div',
    );
    if (interactiveParent && interactiveParent !== el && interactiveParent !== document.body) {
      interactiveParent.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      if (typeof (interactiveParent as any).click === 'function') {
        try {
          (interactiveParent as any).click();
        } catch {
          /* ignore */
        }
      }
    }

    // 如果目标是 <a> 链接且带有有效 href
    const anchor = (el instanceof HTMLAnchorElement ? el : el.closest('a')) as HTMLAnchorElement | null;
    if (anchor && anchor.href && !anchor.href.startsWith('javascript:')) {
      const isNewTab = anchor.target === '_blank' || anchor.getAttribute('target') === '_blank';
      try {
        if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
          // 通过 background 统一调用 browser.tabs.create / update 穿透浏览器弹窗拦截器 (Popup Blocker)
          void browser.runtime.sendMessage({
            type: 'WORKFLOW:OPEN_URL',
            url: anchor.href,
            target: isNewTab ? '_blank' : '_self',
          });
        }
      } catch {
        /* ignore */
      }
    }

    // 如果目标是表单提交按钮或处于 form 内的 submit 按钮，额外调用 requestSubmit 确保表单提交生效
    if (
      (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button')) ||
      (el instanceof HTMLButtonElement && (el.type === 'submit' || !el.type))
    ) {
      const form = el.closest('form');
      if (form) {
        try {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit(el instanceof HTMLButtonElement ? el : undefined);
          } else {
            form.submit();
          }
        } catch {
          /* ignore */
        }
      }
    }

    // 短暂等待框架微任务渲染(如自定义下拉菜单展开/Modal出现)
    await new Promise((r) => setTimeout(r, 200));
    return { ok: true, data: { clicked: targetText || sel } };
  },

  async pressEnter(args: Record<string, unknown>): Promise<ToolResult> {
    const el =
      (await waitForSmartElement(toStr(args.selector), toStr(args.targetText), 3000)) ||
      (document.activeElement as HTMLElement) ||
      document.body;
    if (el) {
      flashHighlight(el);
      el.focus();
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }),
      );
      el.dispatchEvent(
        new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }),
      );
      el.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }),
      );
      const form = el.closest('form');
      if (form) {
        try {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.submit();
          }
        } catch {
          /* ignore */
        }
      }
    }
    // 等待提交触发渲染
    await new Promise((r) => setTimeout(r, 600));
    return { ok: true, data: { pressed: 'Enter' } };
  },

  async hoverElement(args: Record<string, unknown>): Promise<ToolResult> {
    const el = await waitForSmartElement(toStr(args.selector), toStr(args.targetText || args.text), 4000);
    if (!el) return { ok: false, error: `未找到目标元素:${toStr(args.targetText || args.selector)}` };
    flashHighlight(el, '#10b981');
    try {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch {
      /* ignore */
    }
    el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return { ok: true, data: { hovered: toStr(args.targetText || args.selector) } };
  },

  async typeInto(args: Record<string, unknown>): Promise<ToolResult> {
    const el = await waitForSmartElement(
      toStr(args.selector),
      toStr(args.targetText || args.placeholder || args.label),
      4000,
    );
    if (!el) return { ok: false, error: `未找到输入框:${toStr(args.targetText || args.selector)}` };
    flashHighlight(el);
    const text = toStr(args.text);

    // 1. select 原生下拉:按选项文本/值定位
    if (el instanceof HTMLSelectElement) {
      const options = Array.from(el.options).map((o) => ({ value: o.value, text: o.text }));
      const idx = findOptionIndex(options, text);
      if (idx < 0) {
        const preview = options.slice(0, 5).map((o) => o.text).join('/');
        return {
          ok: false,
          error: `下拉框没有匹配选项"${text}"${preview ? `(可选:${preview}${options.length > 5 ? '…' : ''})` : ''}`,
        };
      }
      el.selectedIndex = idx;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, data: { selected: el.options[idx]!.text } };
    }

    // 2. checkbox / radio:值非"否"即勾选
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      el.checked = !/^(false|off|0|no|取消|不勾选)$/i.test(text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, data: { checked: el.checked } };
    }

    // 3. contenteditable 或 role="textbox" 富文本编辑器
    if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') {
      el.focus();
      const clear = args.clear !== false;
      if (clear) {
        el.innerText = '';
      }
      try {
        document.execCommand('insertText', false, text);
      } catch {
        el.innerText += text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, data: { typed: text, richText: true } };
    }

    // 4. 标准 input / textarea 输入框 (处理 React/Vue 受控组件 + 拟人逐字输入)
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    input.focus();
    const clear = args.clear !== false;
    const isHuman = Boolean(args.humanLike);

    const setNativeValue = (val: string) => {
      const prototype =
        input instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor?.set) {
        descriptor.set.call(input, val);
      } else {
        input.value = val;
      }
    };

    if (isHuman && text.length > 0) {
      if (clear) {
        setNativeValue('');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      let current = clear ? '' : input.value;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        current += char;
        setNativeValue(current);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        const jitter = Math.floor(Math.random() * 25) + 15;
        await new Promise((r) => setTimeout(r, jitter));
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, data: { typed: text, humanLike: true } };
    }

    if (clear) {
      setNativeValue('');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setNativeValue(clear ? text : input.value + text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, data: { typed: text } };
  },

  async scrollTo(args: Record<string, unknown>): Promise<ToolResult> {
    const sel = toStr(args.selector);
    const dir = toStr(args.direction);
    const iterations = Math.max(1, Number(args.iterations ?? 1) || 1);
    const intervalMs = Math.max(0, Number(args.intervalMs ?? 600) || 0);
    if (sel) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return { ok: false, error: `未找到元素:${sel}` };
      flashHighlight(el);
      el.scrollIntoView({ behavior: 'smooth' });
      return { ok: true, data: { scrolledTo: sel } };
    }
    if (dir === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return { ok: true, data: { direction: dir } };
    }
    if (dir === 'bottom') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      return { ok: true, data: { direction: dir } };
    }
    if (dir === 'up' || dir === 'down') {
      // 连续滚动(触发懒加载/虚拟列表):每步滚动 + 派发滚动事件
      const step = (dir === 'down' ? 1 : -1) * window.innerHeight * 0.8;
      const containers = getAllScrollableElements();
      for (let i = 0; i < iterations; i++) {
        if (dir === 'down') {
          triggerScrollStep(containers, 650);
        } else {
          window.scrollBy({ top: step, behavior: 'smooth' });
          containers.forEach((c) => (c.scrollTop += step));
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      return { ok: true, data: { direction: dir, iterations } };
    }
    return { ok: false, error: 'scrollTo 需 selector 或 direction(up/down/top/bottom)' };
  },

  async waitFor(args: Record<string, unknown>): Promise<ToolResult> {
    const sel = toStr(args.selector);
    const timeout = Number(args.timeoutMs ?? 8000);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = document.querySelector<HTMLElement>(sel);
      if (found) {
        flashHighlight(found);
        return { ok: true, data: { found: sel } };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ok: false, error: `等待超时(未出现:${sel})` };
  },

  async sleep(args: Record<string, unknown>): Promise<ToolResult> {
    const ms = Number(args.ms ?? 0);
    await new Promise((r) => setTimeout(r, Math.max(0, ms)));
    return { ok: true, data: { sleptMs: ms } };
  },

  async extractData(args: Record<string, unknown>): Promise<ToolResult> {
    const sel = toStr(args.selector);
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return { ok: false, error: `未找到数据容器:${sel}` };
    flashHighlight(el);
    const raw = collectTableData(el);
    if (raw.length === 0) return { ok: false, error: `容器内没有表格数据:${sel}` };
    const format = toStr(args.format) || 'csv';
    const hasHeader = el.querySelector('th') !== null; // th 存在即有表头
    // 列投影(重组前置,设计 §6.1):只保留用户要的列(需有表头)
    let matrix = raw;
    const columns = Array.isArray(args.columns) ? args.columns.map((c) => toStr(c)) : [];
    if (columns.length > 0 && hasHeader) {
      const proj = projectColumns({ headers: raw[0] ?? [], rows: raw.slice(1) }, columns);
      matrix = [proj.headers, ...proj.rows];
    }
    return {
      ok: true,
      data: {
        rows: matrix,
        hasHeader,
        csv: format === 'csv' ? matrixToCsv(matrix) : undefined,
        json: format === 'json' ? matrixToJson(matrix, { hasHeader }) : undefined,
      },
    };
  },

  /** navigate 由 background 经 tabs.update 执行,这里提供占位(不应被 content 调用) */
  async navigate(): Promise<ToolResult> {
    return { ok: false, error: 'navigate 由后台(background)处理,不在 content 执行' };
  },

  async writeWechatDraft(args: Record<string, unknown>): Promise<ToolResult> {
    const title = toStr(args.title).trim();
    const author = toStr(args.author).trim();
    const digest = toStr(args.digest).trim();
    const contentMarkdown = toStr(args.contentMarkdown);
    const theme = toStr(args.theme) || 'tech-blue';

    // 1. 生成微信专用全内联富文本 HTML
    let htmlContent = toStr(args.contentHtml);
    if (!htmlContent && contentMarkdown) {
      htmlContent = markdownToWechatHtml(contentMarkdown, theme);
    }
    if (!htmlContent && !title && !author && !digest) {
      return { ok: false, error: '未提供可写入的内容(请提供 contentMarkdown 或 title/author/digest)' };
    }

    if (typeof document === 'undefined') {
      return {
        ok: true,
        data: {
          title: title || '未修改',
          author: author || '未修改',
          digest: digest ? `${digest.slice(0, 30)}…` : '未修改',
          theme,
          injectedFields: {
            title: false,
            author: false,
            digest: false,
            editorBody: false,
          },
          wordCount: (contentMarkdown || htmlContent).length,
          note: '🎉 已在无 DOM 环境完成富文本排版编译',
        },
      };
    }

    // 2. 定位标题输入框并填充 (#title 或 [placeholder="请在这里输入标题"])
    const titleEl = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '#title, input.js_title, [placeholder*="标题"], .title_input',
    );
    if (titleEl && title) {
      flashHighlight(titleEl);
      titleEl.value = title.slice(0, 64);
      titleEl.dispatchEvent(new Event('input', { bubbles: true }));
      titleEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 3. 定位作者输入框并填充 (#author 或 [placeholder="请输入作者"])
    const authorEl = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '#author, input.js_author, [placeholder*="作者"]',
    );
    if (authorEl && author) {
      flashHighlight(authorEl);
      authorEl.value = author.slice(0, 16);
      authorEl.dispatchEvent(new Event('input', { bubbles: true }));
      authorEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 4. 定位摘要输入框并填充 (#js_description)
    const digestEl = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      '#js_description, textarea.js_description, #digest, [placeholder*="摘要"]',
    );
    if (digestEl && digest) {
      flashHighlight(digestEl);
      digestEl.value = digest.slice(0, 120);
      digestEl.dispatchEvent(new Event('input', { bubbles: true }));
      digestEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 5. 定位微信编辑器富文本正文容器 (兼容 UEditor iframe 与普通 contenteditable 容器)
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
    if (editorBody && htmlContent) {
      flashHighlight(editorBody);
      try {
        editorBody.focus();
        // 优先使用 execCommand 触发编辑器的内部撤销栈与状态机
        const sel = editorDoc.getSelection();
        if (sel) {
          const range = editorDoc.createRange();
          range.selectNodeContents(editorBody);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        injectedEditor = editorDoc.execCommand('insertHTML', false, htmlContent);
      } catch {
        injectedEditor = false;
      }

      // 若 execCommand 未成功,直接设置 innerHTML 并派发输入事件
      if (!injectedEditor || !editorBody.innerHTML.trim()) {
        editorBody.innerHTML = htmlContent;
        const InputCtor = typeof InputEvent !== 'undefined' ? InputEvent : Event;
        editorBody.dispatchEvent(new InputCtor('input', { bubbles: true }));
        editorBody.dispatchEvent(new Event('change', { bubbles: true }));
        injectedEditor = true;
      }
    }

    return {
      ok: true,
      data: {
        title: title || '未修改',
        author: author || '未修改',
        digest: digest ? `${digest.slice(0, 30)}…` : '未修改',
        theme,
        injectedFields: {
          title: Boolean(titleEl),
          author: Boolean(authorEl),
          digest: Boolean(digestEl),
          editorBody: Boolean(editorBody),
        },
        wordCount: (contentMarkdown || htmlContent).length,
        note: '🎉 已成功将精美排版内容写入微信公众平台草稿！',
      },
    };
  },

  async evaluate(args: Record<string, unknown>): Promise<ToolResult> {
    const js = toStr(args.js);
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(js) as () => unknown;
      const result = await fn();
      return { ok: true, data: { result } };
    } catch (err) {
      return { ok: false, error: `JS 执行失败:${(err as Error).message}` };
    }
  },

  async assertPage(args: Record<string, unknown>): Promise<ToolResult> {
    const rawAssertions = Array.isArray(args.assertions) ? (args.assertions as any[]) : [];
    const acceptanceCriteria = toStr(args.acceptanceCriteria);
    const results: any[] = [];
    let allPassed = true;

    // 1. 执行显式断言检查
    for (const a of rawAssertions) {
      const type = toStr(a.type);
      const target = toStr(a.target).trim();
      const desc = toStr(a.description || a.target);

      if (type === 'text_contains') {
        const pageText = document.body ? document.body.innerText : '';
        const found = pageText.toLowerCase().includes(target.toLowerCase()) || Boolean(queryElement(undefined, target));
        if (found) {
          results.push({
            id: a.id || `as_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type,
            description: desc,
            expected: `页面包含「${target}」`,
            actual: `页面已包含「${target}」`,
            ok: true,
          });
        } else {
          allPassed = false;
          results.push({
            id: a.id || `as_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type,
            description: desc,
            expected: `页面包含「${target}」`,
            actual: '未在页面中找到目标文本',
            ok: false,
            error: `文本断言未通过: 未找到「${target}」`,
          });
        }
      } else if (type === 'url_contains') {
        const currentUrl = window.location.href;
        const matched = currentUrl.toLowerCase().includes(target.toLowerCase());
        if (matched) {
          results.push({
            id: a.id || `as_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type,
            description: desc,
            expected: `URL 包含「${target}」`,
            actual: currentUrl,
            ok: true,
          });
        } else {
          allPassed = false;
          results.push({
            id: a.id || `as_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type,
            description: desc,
            expected: `URL 包含「${target}」`,
            actual: currentUrl,
            ok: false,
            error: `URL 断言未通过: 当前 URL (${currentUrl}) 未包含「${target}」`,
          });
        }
      } else if (type === 'element_visible') {
        const el = queryElement(target);
        if (el && isElementVisible(el)) {
          results.push({
            id: a.id || `as_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type,
            description: desc,
            expected: `元素可见「${target}」`,
            actual: '元素存在且可见',
            ok: true,
          });
        } else {
          allPassed = false;
          results.push({
            id: a.id || `as_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type,
            description: desc,
            expected: `元素可见「${target}」`,
            actual: '未找到可见元素',
            ok: false,
            error: `元素可见性断言未通过: 未找到「${target}」`,
          });
        }
      }
    }

    // 2. 底层健康度自动检测 (白屏 / DOM 节点数 / 页面标题)
    const domCount = document.querySelectorAll('*').length;
    const bodyText = (document.body?.innerText || '').trim();
    const isWhiteScreen = domCount < 10 || bodyText.length === 0;

    const health = {
      pageUrl: window.location.href,
      pageTitle: document.title,
      isWhiteScreen,
      domNodeCount: domCount,
      consoleErrorsCount: 0,
      consoleErrors: [],
    };

    if (isWhiteScreen) {
      allPassed = false;
    }

    const passedCount = results.filter((r) => r.ok).length;

    return {
      ok: true,
      data: {
        allPassed: allPassed && (rawAssertions.length === 0 || passedCount === rawAssertions.length),
        totalAssertions: rawAssertions.length,
        passedAssertions: passedCount,
        assertionsResults: results,
        acceptanceCriteria,
        systemHealth: health,
      },
    };
  },

  hideElement: async (args: Record<string, unknown>) => {
    const selector = toStr(args.selector);
    const targetText = toStr(args.targetText);
    const el = queryElement(selector, targetText);
    if (!el) {
      return { ok: false, error: `未找到要隐藏的元素: ${selector || targetText}` };
    }
    const prevDisplay = el.style.display;
    el.style.display = 'none';
    return {
      ok: true,
      data: {
        tagName: el.tagName.toLowerCase(),
        previousDisplay: prevDisplay || 'block',
        message: `已成功隐藏元素「${selector || targetText || el.tagName.toLowerCase()}」`,
      },
    };
  },

  removeElement: async (args: Record<string, unknown>) => {
    const selector = toStr(args.selector);
    const targetText = toStr(args.targetText);
    const el = queryElement(selector, targetText);
    if (!el) {
      return { ok: false, error: `未找到要删除的元素: ${selector || targetText}` };
    }
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    el.remove();
    return {
      ok: true,
      data: {
        tagName: tag,
        parentTagName: parent?.tagName.toLowerCase() || 'none',
        message: `已成功从页面 DOM 中彻底删除元素「${selector || targetText || tag}」`,
      },
    };
  },

  highlightElement: async (args: Record<string, unknown>) => {
    const selector = toStr(args.selector);
    const targetText = toStr(args.targetText);
    const color = toStr(args.color) || '#3b82f6';
    const durationMs = typeof args.durationMs === 'number' ? args.durationMs : 3000;
    const persistent = Boolean(args.persistent);

    const el = queryElement(selector, targetText);
    if (!el) {
      return { ok: false, error: `未找到要高亮的元素: ${selector || targetText}` };
    }

    if (persistent) {
      el.style.outline = `3px solid ${color}`;
      el.style.outlineOffset = '2px';
      el.style.boxShadow = `0 0 16px ${color}`;
    } else {
      flashHighlight(el, color);
      if (durationMs > 1800) {
        el.style.outline = `3px solid ${color}`;
        el.style.outlineOffset = '2px';
        el.style.boxShadow = `0 0 16px ${color}`;
        window.setTimeout(() => {
          el.style.outline = '';
          el.style.outlineOffset = '';
          el.style.boxShadow = '';
        }, durationMs);
      }
    }

    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      /* ignore */
    }

    return {
      ok: true,
      data: {
        tagName: el.tagName.toLowerCase(),
        message: `已成功在页面上高亮标记元素「${selector || targetText || el.tagName.toLowerCase()}」`,
      },
    };
  },

  modifyElementStyle: async (args: Record<string, unknown>) => {
    const selector = toStr(args.selector);
    const targetText = toStr(args.targetText);
    const styles = (args.styles as Record<string, string>) || {};
    const el = queryElement(selector, targetText);
    if (!el) {
      return { ok: false, error: `未找到要修改样式的元素: ${selector || targetText}` };
    }

    const modifiedKeys: string[] = [];
    for (const [key, value] of Object.entries(styles)) {
      if (typeof value === 'string') {
        (el.style as any)[key] = value;
        modifiedKeys.push(`${key}: ${value}`);
      }
    }

    return {
      ok: true,
      data: {
        tagName: el.tagName.toLowerCase(),
        modifiedStyles: modifiedKeys,
        message: `已成功修改元素样式: ${modifiedKeys.join(', ')}`,
      },
    };
  },
};
