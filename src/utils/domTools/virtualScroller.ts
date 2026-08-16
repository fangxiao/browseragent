// 虚拟滚动与飞书长文档全量高速扫描与无痕复位引擎 (Virtual Doc Fast-Sweep & Stitching)
// 解决飞书 (DocX / Lark)、Notion、语雀等由于 DOM 虚拟列表 (Virtual Scrolling) 导致的离屏内容无法读取问题

export interface VirtualDocSweepResult {
  fullText: string;
  headings: Array<{
    tag: string;
    level: number;
    title: string;
    snippet: string;
    anchorId: string;
  }>;
  totalBlocks: number;
  scannedScreens: number;
  isVirtualized: boolean;
}

export interface VirtualDetectionResult {
  isVirtual: boolean;
  isFeishu: boolean;
  isNotion: boolean;
  containers: HTMLElement[];
}

/** 检测当前页面是否为飞书/Notion等虚拟滚动页面并搜集所有相关滚动容器 */
export function isVirtualizedPage(): VirtualDetectionResult {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { isVirtual: false, isFeishu: false, isNotion: false, containers: [] };
  }

  const hostname = typeof location !== 'undefined' ? location.hostname : '';
  const isFeishu =
    hostname.includes('feishu.cn') ||
    hostname.includes('larksuite.com') ||
    Boolean(document.querySelector('.docx-page-container, .suite-docx-editor, .bear-web-editor'));
  const isNotion = hostname.includes('notion.so') || Boolean(document.querySelector('.notion-page-content'));

  const containers = getAllScrollableElements();

  const isVirtual =
    isFeishu ||
    isNotion ||
    containers.length > 0 ||
    Boolean(document.body && document.body.scrollHeight > window.innerHeight * 1.5);

  return {
    isVirtual,
    isFeishu,
    isNotion,
    containers,
  };
}

/** 查找页面中所有潜在的滚动容器 */
export function getAllScrollableElements(): HTMLElement[] {
  if (typeof document === 'undefined') return [];

  const found: HTMLElement[] = [];
  const knownSelectors = [
    '.docx-page-container',
    '.suite-docx-editor',
    '.bear-web-editor-content',
    '.bear-web-editor',
    '.notion-scroller',
    '.notion-page-content',
    '.doc-page',
    '.wiki-content',
    '[data-slate-editor]',
    '[role="main"]',
    '#content',
    'main',
    'article',
  ];

  for (const sel of knownSelectors) {
    const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
    for (const el of els) {
      if (!found.includes(el)) found.push(el);
    }
  }

  // 遍历寻找拥有独立可滚动属性的 DOM 容器
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('div, main, section, article'));
  for (const el of candidates) {
    if (el.scrollHeight > el.clientHeight + 150 && el.clientHeight > 200) {
      if (!found.includes(el)) {
        found.push(el);
      }
    }
  }

  return found;
}

/** 从飞书 / Notion 等原生目录树/导航栏中直接提取 100% 完整大纲 */
export function extractFromNativeCatalog(): Array<{
  tag: string;
  level: number;
  title: string;
  snippet: string;
  anchorId: string;
}> {
  if (typeof document === 'undefined') return [];

  const catalogItems = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.docx-catalog-item, .catalog-item, .doc-catalog-item, .navigation-item, .tree-node, [class*="catalog" i] [class*="item" i], [data-testid*="catalog" i], [class*="outline" i] [class*="item" i]',
    ),
  );

  const headings: Array<{
    tag: string;
    level: number;
    title: string;
    snippet: string;
    anchorId: string;
  }> = [];

  let idx = 1;
  for (const item of catalogItems) {
    const title = (item.textContent || '').trim();
    if (!title || title.length > 120) continue;

    let level = 1;
    try {
      const style = window.getComputedStyle(item);
      const paddingLeft = parseInt(style.paddingLeft || '0', 10);
      if (paddingLeft >= 28 || item.className.includes('level-3') || item.className.includes('h3')) level = 3;
      else if (paddingLeft >= 14 || item.className.includes('level-2') || item.className.includes('h2')) level = 2;
    } catch {
      level = 1;
    }

    headings.push({
      tag: `h${level}`,
      level,
      title,
      snippet: title,
      anchorId: item.getAttribute('data-agent-anchor') || `catalog-anchor-${idx++}`,
    });
  }

  return headings;
}

/**
 * 驱动滚动条与视图步进，派发真实事件触发飞书/Notion的虚拟列表加载
 */
export function triggerScrollStep(containers: HTMLElement[], stepPx = 650): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  // 1. 尝试找到当前 DOM 中最底部的 block 并执行 scrollIntoView (最强物理触发)
  const allBlocks = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.docx-block, [data-block-id], .doc-block, h1, h2, h3, h4, p, table, pre, li, [data-slate-editor] > *',
    ),
  );

  if (allBlocks.length > 0) {
    const lastBlock = allBlocks[allBlocks.length - 1];
    try {
      lastBlock?.scrollIntoView({ block: 'end', behavior: 'instant' as ScrollBehavior });
    } catch {
      // 忽略不支持 instant 的旧环境
    }
  }

  // 2. 依次滚动所有可滚动的容器并触发 wheel 与 scroll 事件
  for (const c of containers) {
    c.scrollTop += stepPx;
    try {
      c.dispatchEvent(new Event('scroll', { bubbles: true }));
      c.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: stepPx,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    } catch {
      /* ignore */
    }
  }

  // 3. 全局 window / body 滚动兜底
  try {
    window.scrollBy({ top: stepPx, behavior: 'instant' as ScrollBehavior });
  } catch {
    window.scrollBy(0, stepPx);
  }
  if (document.documentElement) document.documentElement.scrollTop += stepPx;
  if (document.body) document.body.scrollTop += stepPx;

  try {
    window.dispatchEvent(new Event('scroll'));
    document.dispatchEvent(new Event('scroll'));
  } catch {
    /* ignore */
  }
}

/**
 * 静默高速步进巡检与 Block 保序缝合 (彻底解决飞书文档离屏不渲染)
 */
export async function sweepVirtualDoc(options: {
  maxSteps?: number;
  stepDelayMs?: number;
  textLimit?: number;
} = {}): Promise<VirtualDocSweepResult> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return {
      fullText: '',
      headings: [],
      totalBlocks: 0,
      scannedScreens: 0,
      isVirtualized: false,
    };
  }

  const detection = isVirtualizedPage();
  const containers = detection.containers;

  // 记录所有滚动容器与 window 的初始位置
  const initialScrollTops = containers.map((c) => c.scrollTop);
  const initialWindowY = window.scrollY || (document.documentElement ? document.documentElement.scrollTop : 0);

  // 优先提取飞书自带的目录树 (如果有)
  const nativeHeadings = extractFromNativeCatalog();

  const textLimit = options.textLimit ?? 80000;
  const stepDelayMs = options.stepDelayMs ?? 70; // 给飞书 React 虚拟渲染和网络分块留足反应时间
  const maxSteps = options.maxSteps ?? 60; // 默认最多扫描 60 屏 (相当于 40~60 页 A4 长文档)

  const seenBlocks = new Set<string>();
  const orderedBlocks: Array<{
    id: string;
    tag: string;
    level: number;
    text: string;
    anchorId?: string;
  }> = [];

  let anchorIdx = 1;

  // 采样当前页面中已挂载渲染的 Block 节点
  const collectCurrentView = () => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(
        'h1, h2, h3, h4, h5, h6, p, blockquote, table, pre, [data-block-id], .doc-block, .docx-block',
      ),
    );

    for (const el of elements) {
      const tag = el.tagName.toLowerCase();
      const txt = (el.textContent || '').trim();
      if (!txt) continue;

      // 提取 block 唯一特征 (优先使用飞书原生 data-block-id)
      const blockId =
        el.getAttribute('data-block-id') ||
        el.getAttribute('data-agent-anchor') ||
        `${tag}:${txt.slice(0, 36)}:${txt.length}`;

      if (seenBlocks.has(blockId)) continue;
      seenBlocks.add(blockId);

      const isHeading = /^h[1-4]$/.test(tag);
      const isImportantPara = tag === 'p' && txt.length > 50 && orderedBlocks.length < 80;
      const level = isHeading ? parseInt(tag.slice(1), 10) : 0;

      let anchorId: string | undefined;
      if (isHeading || isImportantPara) {
        anchorId = el.getAttribute('data-agent-anchor') || `anchor-${anchorIdx++}`;
        el.setAttribute('data-agent-anchor', anchorId);
      }

      orderedBlocks.push({
        id: blockId,
        tag,
        level,
        text: txt,
        anchorId,
      });
    }
  };

  let stepCount = 0;
  let idleCount = 0; // 连续无新内容的步数

  try {
    // 1. 首屏先采样一次
    collectCurrentView();

    let prevBlockCount = orderedBlocks.length;

    // 2. 循环向下步进滚动，真实操作滚动条触发飞书虚拟列表
    while (stepCount < maxSteps) {
      triggerScrollStep(containers, 600);

      // 等待飞书触发滚动回调并完成新 Block 的 DOM 挂载
      await new Promise((r) => setTimeout(r, stepDelayMs));

      collectCurrentView();
      stepCount++;

      const newBlocksFound = orderedBlocks.length - prevBlockCount;
      prevBlockCount = orderedBlocks.length;

      if (newBlocksFound === 0) {
        idleCount++;
        // 连续 4 步没有任何新 Block 出现，说明已真正触达文档末尾
        if (idleCount >= 4) break;
      } else {
        idleCount = 0;
      }

      const currentLength = orderedBlocks.reduce((acc, b) => acc + b.text.length, 0);
      if (currentLength >= textLimit) break;
    }
  } finally {
    // 3. 瞬间无痕复位至用户原始浏览位置 (无感还原)
    containers.forEach((c, idx) => {
      c.scrollTop = initialScrollTops[idx] ?? 0;
    });
    try {
      window.scrollTo({ top: initialWindowY, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, initialWindowY);
    }

    // 尝试把首个 block 滚回视野顶部
    const firstBlock = document.querySelector<HTMLElement>(
      '.docx-block, [data-block-id], .doc-block, h1, p',
    );
    if (initialWindowY === 0 && firstBlock) {
      try {
        firstBlock.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
      } catch {
        /* ignore */
      }
    }
  }

  // 4. 拼接大纲 (优先结合飞书原生目录树与 DOM 扫描结果)
  const scannedHeadings = orderedBlocks
    .filter((b) => b.level > 0 || b.anchorId)
    .map((b) => ({
      tag: b.tag,
      level: b.level,
      title: b.level > 0 ? b.text : `${b.text.slice(0, 36)}…`,
      snippet: b.text.slice(0, 120),
      anchorId: b.anchorId || 'anchor-1',
    }));

  // 如果飞书原生目录树更完整，优先采用原生目录
  const headings = nativeHeadings.length > scannedHeadings.length ? nativeHeadings : scannedHeadings;

  const fullText = orderedBlocks
    .map((b) => {
      if (b.level > 0) {
        return `${'#'.repeat(b.level)} ${b.text}`;
      }
      return b.text;
    })
    .join('\n\n')
    .slice(0, textLimit);

  return {
    fullText,
    headings,
    totalBlocks: orderedBlocks.length,
    scannedScreens: stepCount,
    isVirtualized: detection.isVirtual,
  };
}
