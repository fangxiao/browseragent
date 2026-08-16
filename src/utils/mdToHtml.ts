// 极简 Markdown → HTML(供写回富文本用;覆盖常用块,不支持超复杂语法)
// 约束:纯函数,便于单测。行内支持 **加粗**、*斜体*、`代码`、[text](url)。

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  let out = escapeHtml(s);
  // 支持将已转义的 &lt;br&gt; 转化为真正的 HTML <br />
  out = out.replace(/&lt;br\s*\/?&gt;/gi, '<br />');
  // 溯源引用链接: [1](cite:anchor-1) 或 [📍 1](cite:anchor-1) 或 [cite:anchor-1] 或 [§2.1](anchor:anchor-1)
  out = out.replace(/\[([^\]]+)\]\((?:cite|anchor):([a-zA-Z0-9_-]+)\)/g, (_m, label, anchor) => {
    const cleanLabel = label.replace(/^[📍#\s]+/, '').trim();
    return `<button type="button" class="cite-anchor-badge inline-flex items-center gap-0.5 mx-1 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded cursor-pointer transition-colors" data-anchor="${anchor}" title="点击在网页中定位并高亮此段落">📍 ${cleanLabel || anchor}</button>`;
  });
  out = out.replace(/\[cite:([a-zA-Z0-9_-]+)\]/g, (_m, anchor) => {
    return `<button type="button" class="cite-anchor-badge inline-flex items-center gap-0.5 mx-1 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded cursor-pointer transition-colors" data-anchor="${anchor}" title="点击在网页中定位并高亮此段落">📍 ${anchor}</button>`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}

function tableToHtml(lines: string[]): string {
  const rows: string[] = [];
  for (const line of lines) {
    if (/^\s*\|?\s*[-:| ]+\s*\|?\s*$/.test(line) && line.includes('-')) continue; // 分隔行
    const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    rows.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
  }
  return `<table>${rows.join('')}</table>`;
}

/** 将 Markdown 文本转为 HTML(块级)。 */
export function mdToHtml(md: string): string {
  // 预处理：将独立的 <br> 标签换行，避免大模型输出未分行的单行带 <br> 文本
  const normalizedMd = (md || '').replace(/<br\s*\/?>/gi, '\n');
  const lines = normalizedMd.split('\n');
  const out: string[] = [];
  let i = 0;
  const listStack: Array<'ul' | 'ol'> = [];
  const closeList = () => {
    while (listStack.length) out.push(`</${listStack.pop()}>`);
  };
  const pushList = (tag: 'ul' | 'ol') => {
    if (listStack[listStack.length - 1] !== tag) {
      if (listStack.length && listStack[listStack.length - 1] === (tag === 'ul' ? 'ol' : 'ul')) {
        out.push(`</${listStack.pop()}>`);
      }
      out.push(`<${tag}>`);
      listStack.push(tag);
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // 代码块
    if (/^```/.test(line)) {
      closeList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        buf.push(lines[i]!);
        i++;
      }
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      i++;
      continue;
    }
    // 表格
    if (line.includes('|') && (lines[i + 1] ?? '').includes('|')) {
      closeList();
      const tbl: string[] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|')) {
        tbl.push(lines[i]!);
        i++;
      }
      out.push(tableToHtml(tbl));
      continue;
    }
    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`);
      i++;
      continue;
    }
    // 引用
    if (/^>\s?/.test(line)) {
      closeList();
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        q.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${q.map((x) => `<p>${inline(x)}</p>`).join('')}</blockquote>`);
      continue;
    }
    // 无序列表
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      pushList('ul');
      out.push(`<li>${inline(ul[1]!)}</li>`);
      i++;
      continue;
    }
    // 有序列表
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      pushList('ol');
      out.push(`<li>${inline(ol[1]!)}</li>`);
      i++;
      continue;
    }
    // 分隔线
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      closeList();
      out.push('<hr>');
      i++;
      continue;
    }
    // 空行 → 段落分隔
    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }
    // 普通段落(合并连续文本行)
    closeList();
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+\.\s|\s*\|)/.test(lines[i]!)
    ) {
      buf.push(lines[i]!);
      i++;
    }
    out.push(`<p>${inline(buf.join('<br>'))}</p>`);
  }
  closeList();
  return out.join('');
}
