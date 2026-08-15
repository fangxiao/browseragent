// 微信公众号专属 Markdown -> 全内联 CSS 样式富文本转换引擎
// 微信后台过滤外部 <style> 标签，必须所有样式全部写入各标签 style="..." 属性中。
import { getWechatTheme, type WechatTheme } from './themes';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** 转化行内元素:加粗、斜体、行内代码、链接、图片 */
function inlineFormat(text: string, theme: WechatTheme): string {
  let res = escapeHtml(text);

  // 1. 行内代码 `code`
  res = res.replace(/`([^`]+)`/g, (_m, code) => {
    return `<code style="background-color: ${theme.secondary}; color: ${theme.primary}; padding: 2px 6px; margin: 0 2px; border-radius: 4px; font-size: 13px; font-family: Consolas, Monaco, 'Courier New', monospace;">${code}</code>`;
  });

  // 2. 粗体 **bold** 或 __bold__
  res = res.replace(/(\*\*|__)(.*?)\1/g, (_m, _wrapper, content) => {
    return `<strong style="color: ${theme.primary}; font-weight: 700;">${content}</strong>`;
  });

  // 3. 斜体 *italic* 或 _italic_
  res = res.replace(/(\*|_)(.*?)\1/g, (_m, _wrapper, content) => {
    return `<em style="font-style: italic; color: #64748b;">${content}</em>`;
  });

  // 4. 图片 ![alt](url)
  res = res.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
    return `<section style="text-align: center; margin: 20px 0;"><img src="${url}" alt="${alt}" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); display: inline-block;" />${alt ? `<p style="font-size: 12px; color: #94a3b8; margin-top: 6px; text-align: center;">${alt}</p>` : ''}</section>`;
  });

  // 5. 链接 [text](url) (微信会过滤外链,格式化为带下划线的高亮提示)
  res = res.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, linkText, url) => {
    return `<span style="color: ${theme.primary}; text-decoration: underline; word-break: break-all;" title="${url}">${linkText}</span>`;
  });

  return res;
}

/** 将 Markdown 源码完整编译为包含 Mac 代码块与丰富样式的微信专用富文本 HTML */
export function markdownToWechatHtml(markdown: string, themeId = 'tech-blue'): string {
  const theme = getWechatTheme(themeId);
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  const out: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  let inTable = false;
  let tableRows: string[][] = [];

  let inUl = false;
  let inOl = false;
  let inBlockquote = false;
  let blockquoteLines: string[] = [];

  const flushCodeBlock = () => {
    if (!inCodeBlock) return;
    const rawCode = codeLines.join('\n');
    const escaped = escapeHtml(rawCode);

    // Mac 风格代码块: 🔴 🟡 🟢 小圆点 + 深色容器
    out.push(`
      <section style="margin: 20px 0; border-radius: 8px; overflow: hidden; background-color: ${theme.codeBg}; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background-color: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.08);">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #ff5f56;"></span>
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #ffbd2e;"></span>
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #27c93f;"></span>
          </div>
          <span style="font-size: 11px; color: #94a3b8; font-family: monospace; text-transform: uppercase;">${(codeLang || 'CODE').toUpperCase()}</span>
        </div>
        <pre style="margin: 0; padding: 14px 16px; overflow-x: auto; font-family: Consolas, Monaco, 'Courier New', monospace; font-size: 13px; line-height: 1.6; color: #f8fafc; tab-size: 2; white-space: pre;"><code style="font-family: inherit;">${escaped}</code></pre>
      </section>
    `);

    inCodeBlock = false;
    codeLang = '';
    codeLines = [];
  };

  const flushTable = () => {
    if (!inTable || tableRows.length === 0) return;
    const header = tableRows[0] || [];
    const rows = tableRows.slice(1);

    let html = `<section style="margin: 20px 0; overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.6; border: 1px solid ${theme.borderColor}; border-radius: 6px;">`;
    if (header.length > 0) {
      html += `<thead><tr style="background-color: ${theme.secondary}; color: ${theme.primary}; font-weight: 700; border-bottom: 2px solid ${theme.borderColor};">`;
      header.forEach((th) => {
        html += `<th style="padding: 10px 12px; text-align: left; border: 1px solid ${theme.borderColor};">${inlineFormat(th, theme)}</th>`;
      });
      html += `</tr></thead>`;
    }
    if (rows.length > 0) {
      html += `<tbody>`;
      rows.forEach((row, rIdx) => {
        const bg = rIdx % 2 === 1 ? theme.bgLight : '#ffffff';
        html += `<tr style="background-color: ${bg};">`;
        row.forEach((td) => {
          html += `<td style="padding: 8px 12px; color: ${theme.textColor}; border: 1px solid ${theme.borderColor};">${inlineFormat(td, theme)}</td>`;
        });
        html += `</tr>`;
      });
      html += `</tbody>`;
    }
    html += `</table></section>`;
    out.push(html);

    inTable = false;
    tableRows = [];
  };

  const flushBlockquote = () => {
    if (!inBlockquote || blockquoteLines.length === 0) return;
    const innerHtml = blockquoteLines.map((l) => inlineFormat(l, theme)).join('<br />');
    out.push(`
      <blockquote style="margin: 18px 0; padding: 12px 16px; background-color: ${theme.bgLight}; border-left: 4px solid ${theme.primary}; border-radius: 0 6px 6px 0; color: #475569; font-size: 14px; line-height: 1.7;">
        ${innerHtml}
      </blockquote>
    `);
    inBlockquote = false;
    blockquoteLines = [];
  };

  const flushLists = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      out.push('</ol>');
      inOl = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // 1. 代码块起始 / 结束 (```)
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        flushCodeBlock();
      } else {
        flushTable();
        flushBlockquote();
        flushLists();
        inCodeBlock = true;
        codeLang = line.trim().replace(/^```/, '').trim();
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // 2. 表格行 (| a | b |)
    if (/^\s*\|.*\|\s*$/.test(line)) {
      // 过滤对齐分隔行 | --- | :---: |
      if (/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(line)) {
        continue;
      }
      flushBlockquote();
      flushLists();
      inTable = true;
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // 3. 引用块 (> ...)
    if (line.trim().startsWith('>')) {
      flushLists();
      inBlockquote = true;
      blockquoteLines.push(line.trim().replace(/^>\s?/, ''));
      continue;
    } else if (inBlockquote) {
      flushBlockquote();
    }

    // 4. 无序列表 (- 或 * )
    if (/^\s*[-*]\s+/.test(line)) {
      flushLists();
      if (!inUl) {
        out.push('<ul style="margin: 14px 0; padding-left: 22px; list-style-type: disc; color: #334155;">');
        inUl = true;
      }
      const itemContent = line.replace(/^\s*[-*]\s+/, '');
      out.push(`<li style="margin-bottom: 6px; font-size: 15px; line-height: 1.75; color: ${theme.textColor};">${inlineFormat(itemContent, theme)}</li>`);
      continue;
    } else if (inUl && !/^\s*[-*]\s+/.test(line)) {
      out.push('</ul>');
      inUl = false;
    }

    // 5. 有序列表 (1. 2. 3.)
    if (/^\s*\d+\.\s+/.test(line)) {
      flushLists();
      if (!inOl) {
        out.push('<ol style="margin: 14px 0; padding-left: 22px; color: #334155;">');
        inOl = true;
      }
      const itemContent = line.replace(/^\s*\d+\.\s+/, '');
      out.push(`<li style="margin-bottom: 6px; font-size: 15px; line-height: 1.75; color: ${theme.textColor};">${inlineFormat(itemContent, theme)}</li>`);
      continue;
    } else if (inOl && !/^\s*\d+\.\s+/.test(line)) {
      out.push('</ol>');
      inOl = false;
    }

    // 6. 分割线 (--- 或 ***)
    if (/^\s*([-*_]){3,}\s*$/.test(line)) {
      out.push(`<hr style="border: none; border-top: 1px dashed ${theme.borderColor}; margin: 28px 0;" />`);
      continue;
    }

    // 7. 标题 (H1, H2, H3, H4)
    if (line.startsWith('#')) {
      const match = line.match(/^(#{1,4})\s+(.+)$/);
      if (match) {
        const level = match[1]!.length;
        const titleText = inlineFormat(match[2]!.trim(), theme);

        if (level === 1) {
          out.push(`
            <section style="margin: 32px 0 16px 0; text-align: center;">
              <h1 style="display: inline-block; font-size: 22px; font-weight: 800; color: #0f172a; border-bottom: 3px solid ${theme.primary}; padding-bottom: 8px; margin: 0; letter-spacing: 0.5px;">
                ${titleText}
              </h1>
            </section>
          `);
        } else if (level === 2) {
          out.push(`
            <section style="margin: 28px 0 14px 0; display: flex; align-items: center;">
              <h2 style="font-size: 18px; font-weight: 700; color: #0f172a; margin: 0; padding-left: 10px; border-left: 5px solid ${theme.primary}; line-height: 1.4; letter-spacing: 0.4px;">
                ${titleText}
              </h2>
            </section>
          `);
        } else if (level === 3) {
          out.push(`
            <h3 style="font-size: 16px; font-weight: 600; color: ${theme.primary}; margin: 22px 0 10px 0; display: flex; align-items: center; gap: 6px;">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: ${theme.primary};"></span>
              <span>${titleText}</span>
            </h3>
          `);
        } else {
          out.push(`
            <h4 style="font-size: 15px; font-weight: 600; color: #334155; margin: 16px 0 8px 0;">
              ${titleText}
            </h4>
          `);
        }
        continue;
      }
    }

    // 8. 普通段落
    const trimmed = line.trim();
    if (trimmed) {
      out.push(`
        <p style="font-size: 15px; line-height: 1.8; color: ${theme.textColor}; margin: 14px 0; letter-spacing: 0.5px; text-align: justify; word-break: break-word;">
          ${inlineFormat(trimmed, theme)}
        </p>
      `);
    }
  }

  // 循环结束时清空缓存的未闭合结构
  flushCodeBlock();
  flushTable();
  flushBlockquote();
  flushLists();

  // 外层包裹器(微信阅读标准宽度与字号重置)
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 15px; color: ${theme.textColor}; line-height: 1.8; letter-spacing: 0.5px; padding: 0 4px;">
      ${out.join('\n')}
    </div>
  `.trim();
}
