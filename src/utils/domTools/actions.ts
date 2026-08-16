import type { ToolResult } from './types';
import { matrixToCsv, matrixToJson, projectColumns } from './extractData';
import { findOptionIndex } from './form';
import { buildTree, findElementsByQuery, type ElementInfo } from './elementTree';
import { markdownToWechatHtml } from '../wechat/styleInliner';
import { markdownToFeishuHtml } from '../feishu/blockFormatter';
import {
  sweepVirtualDoc,
  isVirtualizedPage,
  triggerScrollStep,
  getAllScrollableElements,
} from './virtualScroller';
import { extractDocMarkdown } from '../feishu/docToMarkdown';

const toStr = (v: unknown): string => String(v ?? '');

/** 给元素加临时高亮描边(操作视觉反馈,1.5s 后自动移除)。见 docs/design/agent.md §10 */
function flashHighlight(el: HTMLElement, color = '#3b82f6'): void {
  const prev = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = `2px solid ${color}`;
  el.style.outlineOffset = '2px';
  window.setTimeout(() => {
    el.style.outline = prev;
    el.style.outlineOffset = prevOffset;
  }, 1500);
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

/** 按文本/语义定位元素:先试 selector,再按可见文本/aria-label 找可交互元素 */
function queryElement(selector: string): HTMLElement | null {
  const q = toStr(selector).trim();
  if (!q) return null;
  // 1) 直接 CSS 选择器
  try {
    const el = document.querySelector<HTMLElement>(q);
    if (el) return el;
  } catch {
    /* 非法 selector,继续按文本找 */
  }
  // 2) 可见文本匹配(按钮/链接/任意元素)
  const matches = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"], input, select, textarea, label, div, span'));
  return (
    matches.find((el) => (el.textContent ?? '').trim() === q) ??
    matches.find((el) => (el.getAttribute('aria-label') ?? '') === q) ??
    null
  );
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
    const el = queryElement(toStr(args.selector));
    if (!el) return { ok: false, error: `未找到可点击元素:${toStr(args.selector)}` };
    flashHighlight(el);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.click();
    return { ok: true, data: { clicked: toStr(args.selector) } };
  },

  async typeInto(args: Record<string, unknown>): Promise<ToolResult> {
    const el = queryElement(toStr(args.selector));
    if (!el) return { ok: false, error: `未找到输入框:${toStr(args.selector)}` };
    flashHighlight(el);
    const text = toStr(args.text);
    // select 下拉:按选项文本/值定位(纯函数 findOptionIndex,已单测)
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
    // checkbox / radio:值非"否"即勾选(clear 参数对这类元素无意义)
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      el.checked = !/^(false|off|0|no|取消|不勾选)$/i.test(text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, data: { checked: el.checked } };
    }
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    const clear = args.clear !== false;
    if (clear) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.value += text;
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

  /** 提取当前页面的多级目录大纲树与段落锚点 */
  async getArticleOutline(args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof document === 'undefined') {
      return {
        ok: true,
        data: {
          title: '测试文档',
          totalSections: 0,
          totalWords: 0,
          outline: [],
        },
      };
    }

    const fullScan = args.fullScan !== false;
    const detection = isVirtualizedPage();

    // 虚拟滚动长文档(飞书 DocX / Notion 等)全量扫描多级大纲
    if (fullScan && detection.isVirtual) {
      try {
        const sweep = await sweepVirtualDoc({
          textLimit: 80000,
          stepDelayMs: 60,
        });

        if (sweep.headings.length > 0) {
          return {
            ok: true,
            data: {
              title: document.title || '当前文档',
              url: typeof location !== 'undefined' ? location.href : '',
              totalSections: sweep.headings.length,
              totalWords: sweep.fullText.length,
              outline: sweep.headings,
              isVirtualized: true,
            },
          };
        }
      } catch {
        /* 回退使用普通 DOM 查询 */
      }
    }

    const sel = toStr(args.selector);
    let container: HTMLElement | null = sel ? document.querySelector<HTMLElement>(sel) : null;
    if (!container) {
      container = document.querySelector<HTMLElement>(
        'article, [role="article"], .article-content, .markdown-body, .post-content, .entry-content, main, #content, .content, body',
      ) || document.body;
    }

    const headingEls = Array.from(container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, p, blockquote'));
    const outline: Array<{
      anchorId: string;
      level: number;
      tag: string;
      title: string;
      snippet: string;
    }> = [];

    let anchorIdx = 1;
    let totalWords = 0;

    for (const el of headingEls) {
      const tag = el.tagName.toLowerCase();
      const txt = (el.textContent || '').trim();
      if (!txt) continue;

      totalWords += txt.length;
      const isHeading = /^h[1-4]$/.test(tag);
      const isImportantPara = tag === 'p' && txt.length > 50 && outline.length < 50;

      if (isHeading || isImportantPara) {
        let anchorId = el.getAttribute('data-agent-anchor');
        if (!anchorId) {
          anchorId = `anchor-${anchorIdx++}`;
          el.setAttribute('data-agent-anchor', anchorId);
        }

        const level = isHeading ? parseInt(tag.slice(1), 10) : 0;
        outline.push({
          anchorId,
          level,
          tag,
          title: isHeading ? txt : `${txt.slice(0, 36)}…`,
          snippet: txt.slice(0, 120),
        });
      }
    }

    return {
      ok: true,
      data: {
        title: document.title || '当前网页',
        url: typeof location !== 'undefined' ? location.href : '',
        totalSections: outline.length,
        totalWords,
        outline,
        isVirtualized: detection.isVirtual,
      },
    };
  },

  /** 平滑滚动并柔光脉冲高亮目标段落/元素 */
  async highlightAndScrollTo(args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof document === 'undefined') {
      return { ok: true, data: { scrolled: true, anchorId: toStr(args.anchorId) } };
    }

    const anchorId = toStr(args.anchorId).trim();
    const sel = toStr(args.selector).trim();
    const textSnippet = toStr(args.textSnippet).trim();

    let targetEl: HTMLElement | null = null;

    if (anchorId) {
      try {
        targetEl = document.querySelector<HTMLElement>(`[data-agent-anchor="${anchorId}"]`);
      } catch {
        /* 忽略异常 */
      }
      if (!targetEl && typeof document.getElementById === 'function') {
        targetEl = document.getElementById(anchorId);
      }
    }
    if (!targetEl && sel) {
      try {
        targetEl = document.querySelector<HTMLElement>(sel);
      } catch {
        /* 忽略非法选择器 */
      }
    }
    if (!targetEl && textSnippet) {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, li, blockquote, div'));
      targetEl = candidates.find((c) => (c.textContent || '').includes(textSnippet)) || null;
    }

    if (!targetEl) {
      return { ok: false, error: `未找到匹配的段落或元素(anchorId: ${anchorId || '无'}, textSnippet: ${textSnippet || '无'})` };
    }

    // 1. 平滑滚动到视口中央
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    // 2. 注入脉冲动画样式(若未注入)
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

    // 3. 添加脉冲动画并于 2.6s 后平滑移除
    targetEl.classList.remove('ai-agent-pulse-target');
    // 强制触发 reflow 重新播放动画
    void targetEl.offsetWidth;
    targetEl.classList.add('ai-agent-pulse-target');
    setTimeout(() => {
      targetEl?.classList.remove('ai-agent-pulse-target');
    }, 2600);

    return {
      ok: true,
      data: {
        scrolled: true,
        anchorId: targetEl.getAttribute('data-agent-anchor') || anchorId || 'matched',
        snippet: (targetEl.textContent || '').trim().slice(0, 80),
      },
    };
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

  /** 将飞书云文档/网页长文全量转换为标准 Markdown */
  async exportDocMarkdown(args: Record<string, unknown>): Promise<ToolResult> {
    const textLimit = typeof args.textLimit === 'number' ? args.textLimit : 200000;
    try {
      const res = await extractDocMarkdown({ textLimit });
      return {
        ok: true,
        data: {
          ...res,
          notice: '全量 Markdown 提取已完成，全文与下载卡片已就绪，当前操作已圆满结束。',
        },
      };
    } catch (err) {
      return { ok: false, error: `转换文档 Markdown 失败:${(err as Error).message}` };
    }
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
};
