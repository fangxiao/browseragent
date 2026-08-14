// 工具 DOM 执行实现(content 上下文)。薄壳:纯逻辑已在 extractData/safety/elementTree 单测覆盖。
// 见 docs/design/agent.md §6
import type { ToolResult } from './types';
import { matrixToCsv, matrixToJson, projectColumns } from './extractData';
import { findOptionIndex } from './form';
import { buildTree, findElementsByQuery, type ElementInfo } from './elementTree';

const toStr = (v: unknown): string => String(v ?? '');

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

  async readPage(args: Record<string, unknown>): Promise<ToolResult> {
    const sel = toStr(args.selector);
    const root: Element = sel
      ? (document.querySelector(sel) ?? document.body)
      : document.body;
    // 语义元素树(核心亮点):AI 据此理解页面结构
    const tree = buildTree(collectElementTree(root, 0, 4), 4, 20);
    return {
      ok: true,
      data: {
        url: location.href,
        title: document.title,
        summary: (document.body?.innerText ?? '').slice(0, 2000),
        tree,
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
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.click();
    return { ok: true, data: { clicked: toStr(args.selector) } };
  },

  async typeInto(args: Record<string, unknown>): Promise<ToolResult> {
    const el = queryElement(toStr(args.selector));
    if (!el) return { ok: false, error: `未找到输入框:${toStr(args.selector)}` };
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
    if (sel) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return { ok: false, error: `未找到元素:${sel}` };
      el.scrollIntoView({ behavior: 'smooth' });
      return { ok: true, data: { scrolledTo: sel } };
    }
    switch (dir) {
      case 'top':
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'bottom':
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        break;
      case 'up':
        window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
        break;
      case 'down':
        window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
        break;
      default:
        return { ok: false, error: 'scrollTo 需 selector 或 direction' };
    }
    return { ok: true, data: { direction: dir } };
  },

  async waitFor(args: Record<string, unknown>): Promise<ToolResult> {
    const sel = toStr(args.selector);
    const timeout = Number(args.timeoutMs ?? 8000);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (document.querySelector(sel)) return { ok: true, data: { found: sel } };
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
