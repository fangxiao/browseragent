import { describe, it, expect } from 'vitest';
import { markdownToWechatHtml } from '../../src/utils/wechat/styleInliner';
import { getWechatTheme, WECHAT_THEMES } from '../../src/utils/wechat/themes';

describe('WeChat Style Inliner', () => {
  it('支持获取预设主题调色板', () => {
    const blue = getWechatTheme('tech-blue');
    expect(blue.primary).toBe('#2563eb');
    expect(blue.name).toBe('科技商务蓝');

    const green = getWechatTheme('wechat-green');
    expect(green.primary).toBe('#07c160');

    // 默认 fallback
    const fallback = getWechatTheme('unknown-theme');
    expect(fallback.id).toBe('tech-blue');
  });

  it('将 Markdown 标题转为带左侧竖条/下划线的微信内联样式', () => {
    const md = '# 主标题\n## 二级分类\n### 三级小结';
    const html = markdownToWechatHtml(md, 'tech-blue');

    expect(html).toContain('主标题');
    expect(html).toContain('二级分类');
    expect(html).toContain('三级小结');
    // 包含内联样式属性
    expect(html).toContain('style="');
    expect(html).toContain('border-bottom: 3px solid #2563eb');
    expect(html).toContain('border-left: 5px solid #2563eb');
  });

  it('将代码块转为 Mac 终端红黄绿小圆点与深色背景', () => {
    const md = '```typescript\nconst greeting: string = "Hello WeChat";\nconsole.log(greeting);\n```';
    const html = markdownToWechatHtml(md, 'tech-blue');

    expect(html).toContain('#ff5f56'); // 红点
    expect(html).toContain('#ffbd2e'); // 黄点
    expect(html).toContain('#27c93f'); // 绿点
    expect(html).toContain('Hello WeChat');
    expect(html).toContain('TYPESCRIPT');
    expect(html).toContain('<pre style="');
  });

  it('将引用块转为浅底色+左边框卡片', () => {
    const md = '> 这是一段引言或核心金句\n> 第二行补充说明';
    const html = markdownToWechatHtml(md, 'tech-blue');

    expect(html).toContain('<blockquote style="');
    expect(html).toContain('border-left: 4px solid #2563eb');
    expect(html).toContain('这是一段引言或核心金句');
    expect(html).toContain('第二行补充说明');
  });

  it('将 Markdown 表格转为带内联边框与表头的 HTML 表格', () => {
    const md = '| 特性 | 说明 | 评分 |\n| :--- | :---: | ---: |\n| 速度 | 极快 | 99 |\n| 样式 | 精美 | 100 |';
    const html = markdownToWechatHtml(md, 'tech-blue');

    expect(html).toContain('<table style="');
    expect(html).toContain('<th style="');
    expect(html).toContain('<td style="');
    expect(html).toContain('特性');
    expect(html).toContain('极快');
    expect(html).toContain('100');
  });

  it('支持加粗、行内代码与链接样式内联', () => {
    const md = '这里有 **重点加粗** 内容，还有 `npm run build` 命令，以及 [访问官网](https://example.com)。';
    const html = markdownToWechatHtml(md, 'tech-blue');

    expect(html).toContain('<strong style="color: #2563eb; font-weight: 700;">重点加粗</strong>');
    expect(html).toContain('<code style="');
    expect(html).toContain('npm run build');
    expect(html).toContain('访问官网');
  });
});
