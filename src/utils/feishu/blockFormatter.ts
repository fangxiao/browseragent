// 飞书云文档 (DocX / Lark) 原生 Block 与富文本格式化引擎
// 将 Markdown / 结构化内容转化为飞书富文本编辑器完美支持的原生 HTML 语义块(Callout, Todo, Table, CodeBlock)

export interface FeishuFormatOptions {
  theme?: 'blue' | 'green' | 'orange' | 'red';
}

/** 飞书高亮提示块 (Callout) 样式映射 */
const CALLOUT_STYLES = {
  blue: {
    bg: '#eef2fe',
    border: '#3370ff',
    icon: '💡',
    titleColor: '#1f2329',
  },
  green: {
    bg: '#eaf8f1',
    border: '#00b42a',
    icon: '📌',
    titleColor: '#1f2329',
  },
  orange: {
    bg: '#fef7e7',
    border: '#ff7d00',
    icon: '⚠️',
    titleColor: '#1f2329',
  },
  red: {
    bg: '#feecee',
    border: '#f53f3f',
    icon: '🚨',
    titleColor: '#1f2329',
  },
};

/**
 * 将 Markdown 转化为飞书 DocX 原生语义富文本 HTML
 */
export function markdownToFeishuHtml(markdown: string): string {
  if (!markdown) return '';

  let html = markdown;

  // 1. 处理飞书高亮块 (Callout) 语法:
  // 支持 > [!NOTE] / > [!TIP] / > [!IMPORTANT] / > [!WARNING] / > [!CAUTION] 以及 > 💡 / > 📌 / > ⚠️ / > 🚨
  html = html.replace(
    /(?:^|\n)>\s*\[!(NOTE|TIP|INFO)\]\s*([\s\S]*?)(?=\n\n|\n(?=[^>])|$)/gi,
    (_match, _type, content) => {
      const clean = content.replace(/^>\s?/gm, '').trim();
      return renderFeishuCallout(clean, 'blue', '💡 核心要点 / 导读');
    },
  );

  html = html.replace(
    /(?:^|\n)>\s*\[!(SUCCESS|DECISION|DONE)\]\s*([\s\S]*?)(?=\n\n|\n(?=[^>])|$)/gi,
    (_match, _type, content) => {
      const clean = content.replace(/^>\s?/gm, '').trim();
      return renderFeishuCallout(clean, 'green', '📌 核心决议 / 共识');
    },
  );

  html = html.replace(
    /(?:^|\n)>\s*\[!(WARNING|CAUTION|IMPORTANT)\]\s*([\s\S]*?)(?=\n\n|\n(?=[^>])|$)/gi,
    (_match, _type, content) => {
      const clean = content.replace(/^>\s?/gm, '').trim();
      return renderFeishuCallout(clean, 'orange', '⚠️ 注意事项 / 潜在风险');
    },
  );

  html = html.replace(
    /(?:^|\n)>\s*\[!(DANGER|CRITICAL|RISK)\]\s*([\s\S]*?)(?=\n\n|\n(?=[^>])|$)/gi,
    (_match, _type, content) => {
      const clean = content.replace(/^>\s?/gm, '').trim();
      return renderFeishuCallout(clean, 'red', '🚨 严重缺陷 / 逻辑死锁');
    },
  );

  // 2. 处理代码块 (Mac 终端风格)
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    const escaped = escapeHtml(code.trim());
    return `<div style="margin: 14px 0; border-radius: 8px; overflow: hidden; border: 1px solid #dee0e3; background: #1e293b;"><div style="background: #0f172a; padding: 6px 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #334155;"><div style="display: flex; gap: 6px;"><span style="width: 10px; height: 10px; border-radius: 50%; background: #ef4444; display: inline-block;"></span><span style="width: 10px; height: 10px; border-radius: 50%; background: #eab308; display: inline-block;"></span><span style="width: 10px; height: 10px; border-radius: 50%; background: #22c55e; display: inline-block;"></span></div><span style="color: #94a3b8; font-size: 11px; font-family: monospace;">${lang || 'code'}</span></div><pre style="margin: 0; padding: 12px 16px; color: #f8fafc; font-family: Menlo, Monaco, Consolas, 'Courier New', monospace; font-size: 13px; line-height: 1.6; overflow-x: auto;"><code>${escaped}</code></pre></div>`;
  });

  // 3. 处理表格 (Table Block)
  html = html.replace(
    /(?:^|\n)(\|.+?\|\n\|[-:\s|]+?\|\n(?:\|.+?\|\n?)+)/g,
    (tableText) => renderFeishuTable(tableText.trim()),
  );

  // 4. 处理待办事项 (Todo List)
  html = html.replace(
    /(?:^|\n)-\s*\[([ xX])\]\s*(.*?)(?=\n|$)/g,
    (_match, checked, text) => {
      const isDone = checked.toLowerCase() === 'x';
      const icon = isDone ? '✅' : '☑️';
      const textStyle = isDone
        ? 'color: #8f959e; text-decoration: line-through;'
        : 'color: #1f2329; font-weight: 500;';
      return `<div style="display: flex; align-items: flex-start; gap: 8px; margin: 6px 0; font-size: 14px;"><span style="user-select: none; font-size: 15px;">${icon}</span><span style="${textStyle}">${inlineFormat(text)}</span></div>`;
    },
  );

  // 5. 处理标题 (Headings)
  html = html.replace(/^# (.*?)$/gm, (_match, t) => {
    return `<h1 style="font-size: 22px; font-weight: 700; color: #1f2329; margin: 24px 0 12px 0; border-bottom: 2px solid #3370ff; padding-bottom: 8px; line-height: 1.4;">${inlineFormat(t)}</h1>`;
  });

  html = html.replace(/^## (.*?)$/gm, (_match, t) => {
    return `<h2 style="font-size: 18px; font-weight: 600; color: #1f2329; margin: 20px 0 10px 0; border-left: 4px solid #3370ff; padding-left: 10px; line-height: 1.4;">${inlineFormat(t)}</h2>`;
  });

  html = html.replace(/^### (.*?)$/gm, (_match, t) => {
    return `<h3 style="font-size: 15px; font-weight: 600; color: #3370ff; margin: 16px 0 8px 0; line-height: 1.4;">${inlineFormat(t)}</h3>`;
  });

  // 6. 普通段落与行内元素
  const lines = html.split('\n');
  const formattedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<div') || trimmed.startsWith('<h1') || trimmed.startsWith('<h2') || trimmed.startsWith('<h3') || trimmed.startsWith('<table') || trimmed.startsWith('<pre')) {
      return line;
    }
    return `<p style="font-size: 14px; line-height: 1.7; color: #1f2329; margin: 8px 0;">${inlineFormat(trimmed)}</p>`;
  });

  return formattedLines.join('\n');
}

/** 渲染飞书高亮提示框 */
export function renderFeishuCallout(
  content: string,
  type: 'blue' | 'green' | 'orange' | 'red' = 'blue',
  customTitle?: string,
): string {
  const style = CALLOUT_STYLES[type] || CALLOUT_STYLES.blue;
  const title = customTitle || `${style.icon} 提示说明`;

  return `
<div style="background-color: ${style.bg}; border-left: 4px solid ${style.border}; padding: 12px 16px; border-radius: 6px; margin: 14px 0; box-sizing: border-box;">
  <div style="font-size: 13.5px; font-weight: 600; color: ${style.titleColor}; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
    <span>${title}</span>
  </div>
  <div style="font-size: 13px; line-height: 1.6; color: #4e5969;">
    ${inlineFormat(content)}
  </div>
</div>`.trim();
}

/** 渲染飞书结构化表格 */
function renderFeishuTable(markdownTable: string): string {
  const rows = markdownTable
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r.startsWith('|') && r.endsWith('|'));

  if (rows.length < 2) return markdownTable;

  const headerCols = rows[0]!
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());

  // 检查第 2 行是否为分隔线
  const bodyRows = rows.slice(2);

  const theadHtml = `
  <thead style="background-color: #f5f6f7;">
    <tr>
      ${headerCols
        .map(
          (h) =>
            `<th style="border: 1px solid #dee0e3; padding: 9px 14px; font-size: 13px; font-weight: 600; color: #1f2329; text-align: left;">${inlineFormat(
              h,
            )}</th>`,
        )
        .join('')}
    </tr>
  </thead>`;

  const tbodyHtml = `
  <tbody>
    ${bodyRows
      .map((row, idx) => {
        const cols = row
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        const bg = idx % 2 === 1 ? 'background-color: #fafbfc;' : 'background-color: #ffffff;';
        return `
      <tr style="${bg}">
        ${cols
          .map(
            (c) =>
              `<td style="border: 1px solid #dee0e3; padding: 8px 14px; font-size: 13px; color: #1f2329; line-height: 1.5;">${inlineFormat(
                c,
              )}</td>`,
          )
          .join('')}
      </tr>`;
      })
      .join('')}
  </tbody>`;

  return `
<table style="border-collapse: collapse; width: 100%; margin: 14px 0; border: 1px solid #dee0e3; border-radius: 4px; overflow: hidden;">
  ${theadHtml}
  ${tbodyHtml}
</table>`.trim();
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color: #1f2329;">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background-color: #f2f3f5; color: #3370ff; padding: 2px 5px; border-radius: 3px; font-family: monospace; font-size: 12px;">$1</code>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color: #3370ff; text-decoration: none; border-bottom: 1px solid #3370ff;">$1</a>');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
