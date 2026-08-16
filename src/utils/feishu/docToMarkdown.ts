// 飞书云文档与网页长文原生 Block -> 高保真纯净 Markdown 转换引擎 (V2.0)
// 彻底解决:
// 1. 表格/Callout 内部子节点被重复遍历多次导致的表格行与内容多重重复
// 2. 评论/画板浮层/协同光标等无关 DOM 噪点注入
// 3. 有序列表编号重复 (如 "1. 1. 标题")
// 4. 空表格占位行冗余
// 5. "飞书云文档" 等假标题误注入

import { isVirtualizedPage, triggerScrollStep } from '../domTools/virtualScroller';

export interface DocMarkdownResult {
  title: string;
  url: string;
  markdown: string;
  wordCount: number;
  blockCount: number;
  headingsCount: number;
}

/** 过滤飞书侧边栏、评论批注、画板浮层、协同光标、目录树与工具栏等无关 DOM 噪点 */
export function isNoiseElement(el: HTMLElement): boolean {
  if (!el || typeof el.getAttribute !== 'function') return false;

  if (
    el.getAttribute('aria-hidden') === 'true' ||
    el.style?.display === 'none' ||
    el.style?.visibility === 'hidden'
  ) {
    return true;
  }

  const noiseSelectors = [
    '.docx-comment',
    '.bear-comment',
    '[class*="comment" i]',
    '.docx-reaction',
    '[class*="reaction" i]',
    '.docx-catalog',
    '.doc-catalog',
    '[class*="catalog" i]',
    '.docx-toolbar',
    '.bear-toolbar',
    '[class*="toolbar" i]',
    '.docx-cursor',
    '.docx-collaborator',
    '.docx-header-wrapper',
    '.docx-footer-wrapper',
    '[aria-modal="true"]',
    '[role="tooltip"]',
    '[role="dialog"]',
    '.sketch-comment',
    '.drawio-comment',
    '.docx-quick-menu',
    '.docx-floating-bar',
    '.suite-comment',
    '.feed-box',
  ];

  for (const sel of noiseSelectors) {
    try {
      if (el.matches(sel) || Boolean(el.closest(sel))) {
        return true;
      }
    } catch {
      /* ignore invalid selector */
    }
  }

  return false;
}

/** 清除零宽空格、零宽连字与各类不可见控制字符 */
export function cleanZeroWidthSpaces(str: string): string {
  if (!str) return '';
  return str.replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u2060\u2062\u00A0]/g, (match) => (match === '\u00A0' ? ' ' : ''));
}

/**
 * 判断当前元素是否属于某一个更高阶 Block 容器的内部子孙节点 (例如表格内的 td/p、Callout 内部段落)
 * 若是内部子节点，则必须跳过顶级循环，由其父级容器一次性统一结构化解析，绝不重复打印！
 */
export function isChildOfAnotherBlock(el: HTMLElement, root: HTMLElement): boolean {
  let parent = el.parentElement;
  while (parent && parent !== root) {
    const tag = parent.tagName ? parent.tagName.toLowerCase() : '';
    const cls = parent.className || '';
    const bType = parent.getAttribute ? parent.getAttribute('data-block-type') || '' : '';

    if (
      tag === 'table' ||
      tag === 'pre' ||
      tag === 'blockquote' ||
      tag === 'figure' ||
      cls.includes('docx-table') ||
      cls.includes('table-block') ||
      cls.includes('callout') ||
      cls.includes('image-wrapper') ||
      cls.includes('code-block') ||
      bType === 'table' ||
      bType === 'callout' ||
      bType === 'code' ||
      bType === 'image'
    ) {
      return true;
    }
    parent = parent.parentElement;
  }
  return false;
}

/** 将行内 HTML (含 strong, em, code, a, img) 转化为标准行内 Markdown */
export function inlineHtmlToMarkdown(node: Node): string {
  // nodeType === 3 为 TEXT_NODE
  if (node.nodeType === 3) {
    return cleanZeroWidthSpaces(node.textContent || '');
  }

  // nodeType !== 1 (非 ELEMENT_NODE)
  if (node.nodeType !== 1) {
    return '';
  }

  const el = node as HTMLElement;
  if (isNoiseElement(el)) {
    return '';
  }

  const tag = el.tagName.toLowerCase();

  // 递归处理子节点
  const childrenText = Array.from(el.childNodes)
    .map((child) => inlineHtmlToMarkdown(child))
    .join('');

  if (!childrenText.trim() && tag !== 'img' && tag !== 'br') {
    return '';
  }

  switch (tag) {
    case 'strong':
    case 'b':
      return `**${childrenText.trim()}**`;
    case 'em':
    case 'i':
      return `*${childrenText.trim()}*`;
    case 'code':
      return `\`${childrenText.trim()}\``;
    case 'del':
    case 's':
    case 'strike':
      return `~~${childrenText.trim()}~~`;
    case 'a': {
      const href = el.getAttribute('href') || '';
      return href ? `[${childrenText.trim() || href}](${href})` : childrenText;
    }
    case 'img': {
      let src =
        el.getAttribute('src') ||
        el.getAttribute('data-src') ||
        el.getAttribute('data-origin-src') ||
        el.getAttribute('data-preview-src') ||
        el.getAttribute('data-url') ||
        (el as HTMLImageElement).currentSrc ||
        '';
      if (src.startsWith('/') && typeof window !== 'undefined') {
        src = `${window.location.origin}${src}`;
      }
      const alt = el.getAttribute('alt') || el.getAttribute('data-alt') || '图片';
      return src ? `\n![${alt}](${src})\n` : '';
    }
    case 'br':
      return '\n';
    default:
      return childrenText;
  }
}

/** 辅助方法：表格格式化 */
function formatHtmlTableToMarkdown(tableEl: HTMLElement): string {
  const trElements = Array.from(tableEl.querySelectorAll('tr'));
  if (trElements.length === 0) return '';
  const mdRows: string[] = [];
  let expectedCols = 0;
  for (let rIdx = 0; rIdx < trElements.length; rIdx++) {
    const tr = trElements[rIdx]!;
    const cellElements = Array.from(tr.querySelectorAll('th, td'));
    const cells = cellElements.map((c) =>
      inlineHtmlToMarkdown(c)
        .replace(/\n+/g, ' ')
        .replace(/\|/g, '\\|')
        .trim(),
    );
    const hasValidText = cells.some((c) => c.length > 0 && c !== '-');
    if (!hasValidText) continue;
    if (mdRows.length === 0) {
      expectedCols = cells.length;
      mdRows.push(`| ${cells.join(' | ')} |`);
      mdRows.push(`| ${cells.map(() => '---').join(' | ')} |`);
    } else {
      while (cells.length < expectedCols) cells.push('');
      mdRows.push(`| ${cells.slice(0, expectedCols).join(' | ')} |`);
    }
  }
  return mdRows.length <= 1 ? '' : mdRows.join('\n');
}

/** 将单个飞书/DOM 顶层 Block 元素转化为标准高保真 Markdown 片段 */
export function blockToMarkdown(el: HTMLElement): string {
  if (isNoiseElement(el)) {
    return '';
  }

  const tag = el.tagName.toLowerCase();
  const className = el.className || '';
  const blockType = el.getAttribute('data-block-type') || '';

  // 1. 标题 (H1 ~ H6)
  if (tag === 'h1' || className.includes('heading-1') || blockType === 'heading1') {
    const txt = inlineHtmlToMarkdown(el).trim();
    return txt ? `\n# ${txt}\n` : '';
  }
  if (tag === 'h2' || className.includes('heading-2') || blockType === 'heading2') {
    const txt = inlineHtmlToMarkdown(el).trim();
    return txt ? `\n## ${txt}\n` : '';
  }
  if (tag === 'h3' || className.includes('heading-3') || blockType === 'heading3') {
    const txt = inlineHtmlToMarkdown(el).trim();
    return txt ? `\n### ${txt}\n` : '';
  }
  if (tag === 'h4' || className.includes('heading-4') || blockType === 'heading4') {
    const txt = inlineHtmlToMarkdown(el).trim();
    return txt ? `\n#### ${txt}\n` : '';
  }
  if (tag === 'h5' || className.includes('heading-5') || blockType === 'heading5') {
    const txt = inlineHtmlToMarkdown(el).trim();
    return txt ? `\n##### ${txt}\n` : '';
  }
  if (tag === 'h6' || className.includes('heading-6') || blockType === 'heading6') {
    const txt = inlineHtmlToMarkdown(el).trim();
    return txt ? `\n###### ${txt}\n` : '';
  }

  // 2. 表格 (Table)
  if (tag === 'table' || className.includes('docx-table') || blockType === 'table') {
    const tableEl = (tag === 'table' ? el : (typeof el.querySelector === 'function' ? el.querySelector('table') : null)) || el;
    const tableMd = formatHtmlTableToMarkdown(tableEl);
    return tableMd ? `\n${tableMd}\n` : '';
  }

  // 3. 引用块 / Callout 高亮块
  if (
    tag === 'blockquote' ||
    className.includes('callout') ||
    className.includes('quote') ||
    blockType === 'callout' ||
    blockType === 'quote'
  ) {
    const raw = inlineHtmlToMarkdown(el).trim();
    if (!raw) return '';
    const lines = raw.split('\n').filter((l) => l.trim().length > 0).map((l) => `> ${l}`).join('\n');
    return `\n> [!NOTE]\n${lines}\n`;
  }

  // 4. 代码块 (Code block)
  if (tag === 'pre' || className.includes('code-block') || blockType === 'code') {
    const codeEl = (typeof el.querySelector === 'function' ? el.querySelector('code') : null) || el;
    const lang = (codeEl.getAttribute && codeEl.getAttribute('data-lang')) || codeEl.className?.match(/lang-(\w+)/)?.[1] || '';
    const code = codeEl.textContent || '';
    return `\n\`\`\`${lang}\n${code.trim()}\n\`\`\`\n`;
  }

  // 5. 待办事项清单 (Todo / Checkbox)
  if (className.includes('todo') || blockType === 'todo' || (typeof el.querySelector === 'function' && el.querySelector('input[type="checkbox"]'))) {
    const isChecked =
      (el.getAttribute && el.getAttribute('data-checked') === 'true') ||
      className.includes('checked') ||
      Boolean(typeof el.querySelector === 'function' && el.querySelector('input[type="checkbox"]:checked'));
    let text = inlineHtmlToMarkdown(el).replace(/^[☑️☐\s-]+/, '').trim();
    text = text.replace(/^(?:(?:\d+\.)+|\d+、|\(\d+\)|[①-⑩]|[-*•])\s*/, '').trim();
    return `- [${isChecked ? 'x' : ' '}] ${text}`;
  }

  // 6. 有序列表与无序列表
  if (tag === 'li' || className.includes('bullet-list') || blockType === 'bullet') {
    let text = inlineHtmlToMarkdown(el).trim();
    text = text.replace(/^[-*•]\s*/, '').trim();
    return text ? `- ${text}` : '';
  }
  if (className.includes('ordered-list') || blockType === 'ordered') {
    let text = inlineHtmlToMarkdown(el).trim();
    text = text.replace(/^(?:(?:\d+\.)+|\d+、|\(\d+\)|[①-⑩])\s*/, '').trim();
    return text ? `1. ${text}` : '';
  }

  // 7. 附件 / 云文件卡片 (File Block / Attachment / Drive file)
  if (
    blockType === 'file' ||
    blockType === 'drive_file' ||
    blockType === 'attachment' ||
    className.includes('file-block') ||
    className.includes('docx-file') ||
    className.includes('attachment')
  ) {
    const fileLinkEl = (typeof el.querySelector === 'function' ? el.querySelector('a[href]') : null) as HTMLAnchorElement | null;
    let fileHref = fileLinkEl?.getAttribute('href') || (tag === 'a' ? (el as HTMLAnchorElement).href : '') || '';
    if (fileHref && fileHref.startsWith('/') && typeof window !== 'undefined') {
      fileHref = `${window.location.origin}${fileHref}`;
    }
    const fileNameEl = typeof el.querySelector === 'function' ? el.querySelector('.file-name, .docx-file-name, [data-file-name], .title') : null;
    const fileSizeEl = typeof el.querySelector === 'function' ? el.querySelector('.file-size, .docx-file-size, .size') : null;
    const fileName = fileNameEl?.textContent?.trim() || fileLinkEl?.textContent?.trim() || el.textContent?.trim() || '附件文件';
    const fileSize = fileSizeEl?.textContent?.trim() || '';
    const label = fileSize ? `${fileName} (${fileSize})` : fileName;

    if (fileHref) {
      return `\n📎 **附件**：[${label}](${fileHref})\n`;
    } else {
      return `\n📎 **附件**：${label}\n`;
    }
  }

  // 8. 图片块 (Image Block / Figure / Canvas)
  if (
    tag === 'img' ||
    tag === 'figure' ||
    className.includes('image') ||
    blockType === 'image' ||
    blockType === 'diagram' ||
    (typeof el.querySelector === 'function' && el.querySelector('img, svg, canvas'))
  ) {
    const imgEl = (tag === 'img' ? el : (typeof el.querySelector === 'function' ? el.querySelector('img') : null)) as HTMLImageElement | null;
    if (imgEl) {
      let src =
        (imgEl.getAttribute &&
          (imgEl.getAttribute('src') ||
            imgEl.getAttribute('data-src') ||
            imgEl.getAttribute('data-origin-src') ||
            imgEl.getAttribute('data-preview-src') ||
            imgEl.getAttribute('data-url'))) ||
        imgEl.currentSrc ||
        '';
      if (src.startsWith('/') && typeof window !== 'undefined') {
        src = `${window.location.origin}${src}`;
      }
      const caption =
        (typeof el.querySelector === 'function' && el.querySelector('figcaption')?.textContent?.trim()) ||
        (imgEl.getAttribute && imgEl.getAttribute('alt')) ||
        '图片';
      if (src) {
        return `\n![${caption}](${src})\n`;
      }
    }
  }

  // 8. 分割线
  if (tag === 'hr' || className.includes('divider') || blockType === 'divider') {
    return '\n---\n';
  }

  // 9. 普通段落
  const paraText = inlineHtmlToMarkdown(el).trim();
  return paraText ? `\n${paraText}\n` : '';
}

/** 清理飞书文档标题后缀 (去除 " - 飞书云文档", " - 知识库" 等) */
export function cleanDocTitle(rawTitle: string): string {
  let title = (rawTitle || '').trim();
  title = title
    .replace(/\s*[-_—|]\s*(?:飞书云文档|飞书|Lark|知识库|Wiki|Feishu)\s*$/i, '')
    .replace(/^(?:飞书云文档|飞书|Lark)\s*[-_—|]\s*/i, '')
    .trim();
  if (title === '飞书云文档' || title === '飞书' || title === 'Lark') {
    return '';
  }
  return title;
}

/** 辅助方法：自动展开所有处于折叠状态的块(折叠标题、Toggle 列表等)以提取隐藏内容 */
function autoUnfoldCollapsedBlocks(root: HTMLElement): void {
  try {
    const foldedArrows = Array.from(
      root.querySelectorAll<HTMLElement>(
        '.docx-toggle-arrow, [data-block-type="toggle"] .toggle-icon, .suite-toggle-list-collapse, [aria-expanded="false"]',
      ),
    );
    for (const arrow of foldedArrows) {
      // 仅点击未展开的折叠项
      const isExpanded = arrow.getAttribute('aria-expanded') === 'true' || arrow.className.includes('expanded');
      if (!isExpanded && typeof arrow.click === 'function') {
        arrow.click();
      }
    }
  } catch {
    // 忽略异常，继续后续流程
  }
}

/**
 * 飞书/在线长文档全量高保真无噪点扫描并导出为纯净 Markdown
 */
export async function extractDocMarkdown(options: {
  maxSteps?: number;
  stepDelayMs?: number;
  textLimit?: number;
} = {}): Promise<DocMarkdownResult> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return {
      title: '空文档',
      url: '',
      markdown: '',
      wordCount: 0,
      blockCount: 0,
      headingsCount: 0,
    };
  }

  const detection = isVirtualizedPage();
  const containers = detection.containers;
  const initialScrollTops = containers.map((c) => c.scrollTop);
  const initialWindowY = window.scrollY || (document.documentElement ? document.documentElement.scrollTop : 0);

  // 获取真实正文容器 (锁定编辑器根节点,避免遍历侧边栏/浮窗)
  const editorRoot: HTMLElement =
    document.querySelector<HTMLElement>(
      '.docx-page-container, .bear-web-editor-content, div[data-slate-editor="true"], .suite-docx-editor, .doc-page, .wiki-content, article, main',
    ) || document.body;

  // 尝试自动展开折叠区域
  autoUnfoldCollapsedBlocks(editorRoot);

  const rawDocTitle =
    document.querySelector<HTMLElement>('.docx-title, .doc-title, .wiki-title, h1')?.textContent?.trim() ||
    document.title ||
    '';
  const docTitle = cleanDocTitle(rawDocTitle);

  const maxSteps = options.maxSteps ?? 120;
  const stepDelayMs = options.stepDelayMs ?? 60;
  const textLimit = options.textLimit ?? 200000;

  const seenBlockIds = new Set<string>();
  const collectedMdBlocks: Array<{ id: string; md: string; isHeading: boolean }> = [];

  const sampleCurrentView = () => {
    // 仅针对编辑器内部候选块进行采样
    const candidateElements = Array.from(
      editorRoot.querySelectorAll<HTMLElement>(
        '[data-block-id], .docx-block, .doc-block, table, pre, blockquote, h1, h2, h3, h4, h5, h6, p, div[data-block-type]',
      ),
    );

    for (const el of candidateElements) {
      // 1. 过滤噪声元素 (评论、批注、浮层)
      if (isNoiseElement(el)) continue;

      // 2. 关键: 如果是某个上层已处理 Block 的子节点(如表格里的 td/p, Callout 里的 p), 必须跳过！
      if (isChildOfAnotherBlock(el, editorRoot)) continue;

      const txt = cleanZeroWidthSpaces(el.textContent || '').trim();
      const tagLower = el.tagName.toLowerCase();
      const bType = el.getAttribute('data-block-type') || '';
      const isMediaOrStructure =
        tagLower === 'hr' ||
        tagLower === 'img' ||
        tagLower === 'figure' ||
        bType === 'image' ||
        bType === 'file' ||
        bType === 'attachment' ||
        bType === 'drive_file' ||
        bType === 'diagram' ||
        el.className.includes('image') ||
        el.className.includes('file') ||
        (typeof el.querySelector === 'function' && el.querySelector('img, svg, canvas, a[href]') !== null);

      if (!txt && !isMediaOrStructure) {
        continue;
      }

      // 生成稳定的 Block 标识特征
      const blockId =
        el.getAttribute('data-block-id') ||
        el.getAttribute('data-agent-anchor') ||
        `${el.tagName}:${txt.slice(0, 36)}:${txt.length}:${(el.querySelector('img') as HTMLImageElement)?.src?.slice(-24) || ''}`;

      if (seenBlockIds.has(blockId)) continue;
      seenBlockIds.add(blockId);

      // 仅当当前元素属于表格或引用块等复合容器时，才将其子孙 data-block-id 标记为 seen，普通 section 容器绝不误伤子元素
      if (tagLower === 'table' || bType === 'table' || tagLower === 'blockquote' || bType === 'callout') {
        const childBlockIds = Array.from(el.querySelectorAll<HTMLElement>('[data-block-id]'));
        for (const child of childBlockIds) {
          const cId = child.getAttribute('data-block-id');
          if (cId) seenBlockIds.add(cId);
        }
      }

      const md = blockToMarkdown(el).trim();
      if (md) {
        collectedMdBlocks.push({
          id: blockId,
          md,
          isHeading: /^#{1,6}\s/.test(md),
        });
      }
    }
  };

  try {
    // 1. 先将所有滚动容器与窗口无痕复位到顶部 (scrollTop = 0)，保证从第 1 章开始完整扫描
    containers.forEach((c) => {
      c.scrollTop = 0;
      try {
        c.dispatchEvent(new Event('scroll', { bubbles: true }));
      } catch {}
    });
    try {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }

    // 等待 120ms 让虚拟列表将第 1 章顶部 DOM 挂载进来
    await new Promise((r) => setTimeout(r, 120));

    // 2. 首屏精准采样
    sampleCurrentView();

    let prevCount = collectedMdBlocks.length;
    let step = 0;
    let idleCount = 0;

    // 2. 虚拟步进平滑扫描飞书虚拟列表
    while (step < maxSteps) {
      triggerScrollStep(containers, 650);
      await new Promise((r) => setTimeout(r, stepDelayMs));

      sampleCurrentView();
      step++;

      const newFound = collectedMdBlocks.length - prevCount;
      prevCount = collectedMdBlocks.length;

      if (newFound === 0) {
        idleCount++;
        if (idleCount >= 6) break;
      } else {
        idleCount = 0;
      }

      const totalChars = collectedMdBlocks.reduce((acc, b) => acc + b.md.length, 0);
      if (totalChars >= textLimit) break;
    }
  } finally {
    // 3. 无痕无感复位至初始阅读位置
    containers.forEach((c, idx) => {
      c.scrollTop = initialScrollTops[idx] ?? 0;
    });
    try {
      window.scrollTo({ top: initialWindowY, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, initialWindowY);
    }
  }

  // 4. 清洗与拼接最终 Markdown
  const markdownLines: string[] = [];

  // 判断首个 Block 是否已经是主标题，若不是才把 cleanDocTitle 置顶
  const hasFirstHeadingTitle =
    collectedMdBlocks.length > 0 &&
    collectedMdBlocks[0]!.isHeading &&
    collectedMdBlocks[0]!.md.startsWith('# ');

  if (docTitle && !hasFirstHeadingTitle) {
    markdownLines.push(`# ${docTitle}\n`);
  }

  for (const block of collectedMdBlocks) {
    markdownLines.push(block.md);
  }

  const finalMarkdown = markdownLines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  const headingsCount = collectedMdBlocks.filter((b) => b.isHeading).length;

  return {
    title: docTitle || (collectedMdBlocks[0]?.isHeading ? collectedMdBlocks[0].md.replace(/^#+\s*/, '') : '飞书文档'),
    url: typeof location !== 'undefined' ? location.href : '',
    markdown: finalMarkdown,
    wordCount: finalMarkdown.length,
    blockCount: collectedMdBlocks.length,
    headingsCount,
  };
}
