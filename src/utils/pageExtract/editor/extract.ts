// 通用文档 DOM → Block[] 提取器(防御式)。
// 设计要点:
//  1. 优先使用语义标签与 role 属性(对前端结构变更的鲁棒性优于私有 class 名)
//  2. 排除 UI 区域(工具栏/评论/浮层),避免把界面文字当正文
//  3. 输出 extractionRate 诊断,便于 DOM 结构变更预警(需求 NFR-6)
//  注意:前端可能调整 DOM,实机验证时请打开 console 查看 [ai-agent] 诊断。
import type { Block, BlockType } from '../types';
import { blocksToMarkdown } from './markdown';

const BLOCK_SELECTOR = [
  'h1, h2, h3, h4, h5, h6',
  'p',
  'ul, ol',
  'table',
  'blockquote',
  'pre',
  'hr',
  'img',
].join(', ');

/** 可稳定排除的 UI 区域(role/aria;class 名会变,仅作兜底) */
function isOffLimits(el: Element): boolean {
  return Boolean(
    el.closest(
      '[role="dialog"], [role="menu"], [role="toolbar"], [role="complementary"], ' +
        '[role="banner"], [aria-hidden="true"], [data-testid="comment"], ' +
        '[class*="comment" i], [class*="sidePanel" i], [class*="toolbar" i]',
    ),
  );
}

function isVisible(el: Element): boolean {
  if (!(el as HTMLElement).offsetParent && el.tagName !== 'BODY') {
    // offsetParent 为 null 时不一定是隐藏(如 fixed 定位),再检查几何
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
  }
  return true;
}

/** 提取 root 候选:优先语义/稳定标记,兜底 body */
function findDocRoot(doc: Document): HTMLElement {
  const candidates = [
    '[role="main"]',
    '[data-testid*="doc" i]',
    '[data-testid*="editor" i]',
    '[class*="doc-content" i]',
    '[class*="editor-container" i]',
  ];
  for (const sel of candidates) {
    const nodes = Array.from(doc.querySelectorAll<HTMLElement>(sel));
    for (const n of nodes) {
      const text = n.innerText ?? '';
      if (text.trim().length > 100) return n;
    }
  }
  return doc.body;
}

function cleanText(s: string | null | undefined): string {
  return (s ?? '').replace(/​/g, '').replace(/[ \t]+/g, ' ').trim();
}

/** 计算 li 的嵌套列表深度(作为缩进级别) */
function listDepth(li: Element): number {
  let depth = 0;
  let cur = li.parentElement;
  while (cur) {
    if (/^[uo]l$/i.test(cur.tagName)) depth++;
    cur = cur.parentElement;
  }
  return Math.max(depth - 1, 0);
}

/** 是否为 todo(勾选框) */
function isTodo(li: Element): boolean {
  return Boolean(
    li.querySelector('input[type="checkbox"], [role="checkbox"], [class*="checkbox" i]'),
  );
}

function collectListItems(root: Element): Block[] {
  const blocks: Block[] = [];
  root.querySelectorAll('li').forEach((li) => {
    if (isOffLimits(li) || !isVisible(li)) return;
    const text = cleanText(li.textContent);
    if (!text) return;
    const ordered = Boolean(li.closest('ol'));
    if (isTodo(li)) {
      const box = li.querySelector('input[type="checkbox"], [role="checkbox"]');
      const checked = box
        ? (box as HTMLInputElement).checked ||
          box.getAttribute('aria-checked') === 'true'
        : false;
      blocks.push({ type: 'todo', text, checked, level: listDepth(li) });
    } else {
      blocks.push({ type: 'listItem', text, ordered, level: listDepth(li) });
    }
  });
  return blocks;
}

function collectTable(root: Element): Block[] {
  const blocks: Block[] = [];
  root.querySelectorAll('table').forEach((tbl) => {
    if (isOffLimits(tbl) || !isVisible(tbl)) return;
    const cells: string[][] = [];
    tbl.querySelectorAll('tr').forEach((tr) => {
      const row: string[] = [];
      tr.querySelectorAll('th, td').forEach((cell) => {
        row.push(cleanText(cell.textContent));
      });
      if (row.some((c) => c)) cells.push(row);
    });
    if (cells.length > 0) blocks.push({ type: 'table', text: '', cells });
  });
  return blocks;
}

/** 降级:role=grid 的 div 表格(部分渲染可能不用 <table>) */
function collectGrid(root: Element): Block[] {
  const blocks: Block[] = [];
  root.querySelectorAll('[role="grid"]').forEach((grid) => {
    if (isOffLimits(grid) || !isVisible(grid)) return;
    if (grid.closest('table')) return; // 已被 <table> 覆盖
    const cells: string[][] = [];
    grid.querySelectorAll('[role="row"]').forEach((row) => {
      const r: string[] = [];
      row
        .querySelectorAll('[role="gridcell"], [role="columnheader"], [role="rowheader"]')
        .forEach((c) => r.push(cleanText(c.textContent)));
      if (r.some((c) => c)) cells.push(r);
    });
    if (cells.length > 0) blocks.push({ type: 'table', text: '', cells });
  });
  return blocks;
}

/** 文本流兜底提取:不依赖标准标签,按文本节点 + 样式启发式分类(适配自研 div 渲染) */
function extractTextBlocks(doc: Document, root: Element): Block[] {
  const blocks: Block[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let prevKey = '';
  let node: Node | null = walker.nextNode();
  while (node) {
    const text = cleanText((node as Text).data);
    const el = (node as Text).parentElement;
    if (!text || !el) {
      node = walker.nextNode();
      continue;
    }
    if (isOffLimits(el)) {
      node = walker.nextNode();
      continue;
    }
    // 跳过已由标准标签策略覆盖的文本节点(避免重复)
    if (el.closest('p, h1,h2,h3,h4,h5,h6, li, blockquote, pre, table, td, th')) {
      node = walker.nextNode();
      continue;
    }
    // 样式启发式分类
    let type: BlockType = 'paragraph';
    let level: number | undefined;
    let ordered: boolean | undefined;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      type = 'heading';
      level = Number(tag[1]);
    } else if (el.closest('ul, ol')) {
      type = 'listItem';
      ordered = Boolean(el.closest('ol'));
      level = listDepth(el.closest('li') ?? el);
    } else {
      const style = doc.defaultView?.getComputedStyle(el);
      const fs = parseFloat(style?.fontSize ?? '0');
      const weight = parseInt(style?.fontWeight ?? '400', 10);
      if (fs >= 28) {
        type = 'heading';
        level = 1;
      } else if (fs >= 24) {
        type = 'heading';
        level = 2;
      } else if (fs >= 20) {
        type = 'heading';
        level = 3;
      } else if (weight >= 600) {
        type = 'heading';
        level = 4;
      } else if (el.closest('[role="note"], [class*="callout" i], [class*="note" i]')) {
        type = 'callout';
      }
    }
    const key = `${type}|${text}|${level ?? ''}|${ordered ?? ''}`;
    if (key !== prevKey) {
      prevKey = key;
      blocks.push({ type, text, level, ordered });
    }
    node = walker.nextNode();
  }
  return blocks;
}

export function extractBlocks(doc: Document): { blocks: Block[]; warnings: string[]; visibleCount: number } {
  const warnings: string[] = [];
  const root = findDocRoot(doc);

  // DOM 结构诊断:定位到的容器与正文抽样(真机调试提取器用,可删除)
  console.log('[ai-agent] doc-root', {
    tag: root.tagName,
    cls: String((root as HTMLElement).className).slice(0, 160),
    childTags: Array.from(root.children)
      .slice(0, 12)
      .map((el) => `${el.tagName}.${String((el as HTMLElement).className).slice(0, 30)}`),
    textPreview: root.innerText?.slice(0, 150) ?? '',
  });

  const blocks: Block[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let visibleCount = 0;

  const seen = new Set<Element>();
  const push = (b: Block, el: Element) => {
    if (seen.has(el)) return;
    seen.add(el);
    // 去重:与上一条完全相同则跳过(React 重渲染产物)
    const last = blocks[blocks.length - 1];
    if (last && last.type === b.type && last.text === b.text) return;
    blocks.push(b);
  };

  let node: Node | null = walker.nextNode();
  while (node) {
    const el = node as Element;
    if (el.tagName === 'LI') {
      node = walker.nextNode();
      continue; // 列表项由 collectListItems 统一处理,避免重复
    }
    if (isOffLimits(el)) {
      node = walker.nextNode();
      continue;
    }
    if (!isVisible(el)) {
      node = walker.nextNode();
      continue;
    }

    const tag = el.tagName.toLowerCase();
    // 统计可见块数量(诊断用):只有直接包含文本的叶子级块才计
    if (/^(p|h[1-6]|li|blockquote|pre|td|th)$/.test(tag)) {
      const text = cleanText(el.textContent);
      if (text) visibleCount++;
    }

    if (/^h[1-6]$/.test(tag)) {
      const text = cleanText(el.textContent);
      if (text) push({ type: 'heading', text, level: Number(tag[1]) }, el);
    } else if (tag === 'p') {
      const text = cleanText(el.textContent);
      if (text) {
        const isCallout = Boolean(el.closest('[role="note"], [class*="callout" i], [class*="note" i]'));
        push({ type: isCallout ? 'callout' : 'paragraph', text }, el);
      }
    } else if (tag === 'blockquote') {
      const text = cleanText(el.textContent);
      if (text) push({ type: 'quote', text }, el);
    } else if (tag === 'pre') {
      const text = cleanText(el.textContent);
      if (text) push({ type: 'code', text }, el);
    } else if (tag === 'hr') {
      push({ type: 'divider', text: '' }, el);
    } else if (tag === 'img') {
      const src = (el as HTMLImageElement).src || '';
      const alt = cleanText((el as HTMLImageElement).alt);
      push({ type: 'image', text: alt, src }, el);
    }

    node = walker.nextNode();
  }

  const listBlocks = collectListItems(root);
  const tableBlocks = [...collectTable(root), ...collectGrid(root)];

  // 按 DOM 顺序合并:简单策略——paragraph/heading 顺序保留,列表与表格追加
  // (真实文档中列表/表格与段落交错;实机验证后如需精确排序可在此增强)
  let merged = mergeByDomOrder(root, blocks, listBlocks, tableBlocks);

  // 标签策略提取不足 → 文本流兜底(适配自研 div 渲染)
  const totalLen = merged.reduce((n, b) => n + b.text.length, 0);
  const rootLen = (root.innerText ?? '').trim().length;
  if (rootLen > 50 && totalLen < rootLen * 0.4) {
    const fallback = extractTextBlocks(doc, root);
    const fbLen = fallback.reduce((n, b) => n + b.text.length, 0);
    if (fbLen > totalLen) {
      merged = fallback;
      warnings.push('正文使用非标准标签渲染,已启用文本流兜底提取');
    }
  }

  if (root === doc.body) {
    warnings.push('未定位到文档主容器,已回退到 body 提取(可能包含界面文字)');
  }
  if (tableBlocks.length === 0 && root.querySelectorAll('table').length > 0) {
    warnings.push('检测到表格但未能解析(可能为 canvas/虚拟化渲染)');
  }
  return { blocks: merged, warnings, visibleCount };
}

/** 尽力按 DOM 顺序合并段落/标题与列表、表格 */
function mergeByDomOrder(root: Element, main: Block[], lists: Block[], tables: Block[]): Block[] {
  const extra: Array<{ block: Block; anchor: Element | null }> = [];
  const addBlocksByAnchor = (items: Block[], anchors: NodeListOf<Element>) => {
    items.forEach((b, i) => {
      extra.push({ block: b, anchor: anchors[i] ?? null });
    });
  };
  addBlocksByAnchor(lists, root.querySelectorAll('li'));
  addBlocksByAnchor(tables, root.querySelectorAll('table, [role="grid"]'));

  const byIndex = (el: Element | null): number => {
    if (!el) return -1;
    // 比较元素在文档中的位置
    let n = 0;
    let cur: Node | null = el;
    while (cur && cur !== root) {
      n += cur.nodeType === Node.ELEMENT_NODE ? 1 : 0;
      cur = cur.previousSibling;
    }
    // 简单起见用树序索引:count 前面的元素
    return Array.from(root.querySelectorAll('*')).indexOf(el);
  };

  const withPos = extra.map((e) => ({ ...e, pos: byIndex(e.anchor) }));
  withPos.sort((a, b) => a.pos - b.pos);
  const result: Block[] = [];
  for (const item of withPos) {
    if (item.pos < 0) continue;
    result.push(item.block);
  }
  // 主块(段落/标题)保留原顺序,追加在前
  return [...main, ...result];
}

export async function extractDocContent(
  doc: Document,
  url: string,
): Promise<import('../types').DocContent> {
  const { blocks, warnings, visibleCount } = extractBlocks(doc);
  const title = cleanText(doc.title.split('-')[0]) || '未命名文档';
  const textLength = blocks.reduce((n, b) => n + b.text.length, 0);
  const extractionRate = visibleCount > 0 ? Math.min(blocks.length / visibleCount, 1) : 0;
  return {
    title,
    docId: (url.match(/\/(?:docs|docx|wiki)\/([A-Za-z0-9]+)/) ?? [])[1] ?? '',
    url,
    blocks,
    markdown: blocksToMarkdown(blocks),
    blockCount: blocks.length,
    textLength,
    extractionRate,
    warnings,
  };
}
