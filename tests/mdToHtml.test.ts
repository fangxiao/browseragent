import { describe, expect, it } from 'vitest';
import { mdToHtml } from '../src/utils/mdToHtml';

describe('mdToHtml', () => {
  it('渲染标题', () => {
    expect(mdToHtml('## 背景')).toBe('<h2>背景</h2>');
  });

  it('渲染无序/有序列表', () => {
    expect(mdToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(mdToHtml('1. x\n2. y')).toBe('<ol><li>x</li><li>y</li></ol>');
  });

  it('渲染代码块与引用', () => {
    expect(mdToHtml('```\nconst a = 1;\n```')).toBe('<pre><code>const a = 1;</code></pre>');
    expect(mdToHtml('> 结论')).toBe('<blockquote><p>结论</p></blockquote>');
  });

  it('渲染表格', () => {
    expect(mdToHtml('| 字段 | 说明 |\n| --- | --- |\n| id | 主键 |')).toContain(
      '<table><tr><td>字段</td><td>说明</td></tr><tr><td>id</td><td>主键</td></tr></table>',
    );
  });

  it('行内粗体/代码/链接与转义', () => {
    const html = mdToHtml('这是 **重点** 和 `code` 与 [链接](https://x.com)');
    expect(html).toContain('<strong>重点</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<a href="https://x.com">链接</a>');
    expect(mdToHtml('<script>')).toContain('&lt;script&gt;');
  });

  it('渲染可交互的 DOM 溯源引用微型徽章 [1](cite:anchor-1)', () => {
    const html = mdToHtml('核心结论是吞吐量提升了 300% [📍 1](cite:anchor-3)。另外延迟降低了 50% [cite:anchor-5]。');
    expect(html).toContain('data-anchor="anchor-3"');
    expect(html).toContain('data-anchor="anchor-5"');
    expect(html).toContain('cite-anchor-badge');
    expect(html).toContain('📍 1');
  });

  it('支持将大模型输出的 <br> 或 <br/> 标签正常转为换行', () => {
    const html = mdToHtml('第一项<br>第二项<br/>第三项');
    expect(html).not.toContain('&lt;br&gt;');
    expect(html).toBe('<p>第一项<br />第二项<br />第三项</p>');
  });
});
