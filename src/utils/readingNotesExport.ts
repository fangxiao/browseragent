// 深度阅读研报与 Obsidian / Notion Markdown 导出引擎

export interface ReadingNoteData {
  title: string;
  url?: string;
  totalWords?: number;
  date?: string;
  outline?: Array<{
    anchorId: string;
    level: number;
    title: string;
    snippet: string;
    tag?: string;
  }>;
  textSummary?: string;
}

/** 生成标准 YAML FrontMatter 与结构化研报 Markdown */
export function generateReadingNoteMarkdown(data: ReadingNoteData): string {
  const title = (data.title || '网页阅读笔记').trim();
  const url = (data.url || '').trim();
  const words = data.totalWords || 0;
  const dateStr = data.date || new Date().toISOString().slice(0, 10);
  const headings = (data.outline || []).filter((o) => o.level > 0);

  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    url ? `source_url: "${url}"` : null,
    `read_date: "${dateStr}"`,
    `word_count: ${words}`,
    'tags:',
    '  - web-reading',
    '  - ai-study-notes',
    '  - browser-agent',
    '---',
    '',
  ]
    .filter((x): x is string => x !== null)
    .join('\n');

  const metaHeader = [
    `# 📖 深度阅读研报：${title}`,
    '',
    `> 🔗 **原文出处**: ${url ? `[${title}](${url})` : '当前网页'}  `,
    `> 📅 **阅读时间**: ${dateStr} · 📊 **全文体量**: 约 ${words.toLocaleString()} 字`,
    '',
  ].join('\n');

  let summarySection = '';
  if (data.textSummary) {
    summarySection = [
      '## 📌 核心主旨与导读要点',
      '',
      data.textSummary.trim(),
      '',
    ].join('\n');
  }

  let outlineSection = '';
  if (headings.length > 0) {
    const list = headings
      .map((h) => {
        const indent = '  '.repeat(Math.max(0, h.level - 1));
        const icon = h.level === 1 ? '📌' : h.level === 2 ? '🔹' : '▪';
        return `${indent}- ${icon} **${h.title}**\n${indent}  > ${h.snippet.slice(0, 80)}…`;
      })
      .join('\n\n');

    outlineSection = [
      '## 🧠 结构化章节脉络与导读树',
      '',
      list,
      '',
    ].join('\n');
  }

  const footer = [
    '---',
    '*本笔记由 AI 浏览器智能体（Browser Agent）自动精读与结构化导出*',
  ].join('\n');

  return [frontmatter, metaHeader, summarySection, outlineSection, footer].filter(Boolean).join('\n');
}

/** 触发浏览器端文件下载 (.md) */
export function downloadMarkdownFile(filename: string, content: string): boolean {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
  try {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.md') ? filename : `${filename}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
