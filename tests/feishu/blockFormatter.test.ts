import { describe, expect, it } from 'vitest';
import { markdownToFeishuHtml, renderFeishuCallout } from '../../src/utils/feishu/blockFormatter';

describe('feishu/blockFormatter(飞书原生Block格式化引擎)', () => {
  it('renderFeishuCallout: 支持渲染多色高亮提示块', () => {
    const blueHtml = renderFeishuCallout('这是核心导读内容', 'blue', '💡 核心导读');
    expect(blueHtml).toContain('background-color: #eef2fe');
    expect(blueHtml).toContain('border-left: 4px solid #3370ff');
    expect(blueHtml).toContain('💡 核心导读');
    expect(blueHtml).toContain('这是核心导读内容');

    const greenHtml = renderFeishuCallout('达成一致决议', 'green', '📌 核心决议');
    expect(greenHtml).toContain('background-color: #eaf8f1');
    expect(greenHtml).toContain('border-left: 4px solid #00b42a');
  });

  it('markdownToFeishuHtml: 能够将 Callout 语法转化为飞书高亮块', () => {
    const md = `
> [!NOTE]
> 这是一个测试 Note 提示块

> [!SUCCESS]
> 会议核心共识已达成
`;
    const html = markdownToFeishuHtml(md);
    expect(html).toContain('background-color: #eef2fe');
    expect(html).toContain('这是一个测试 Note 提示块');
    expect(html).toContain('background-color: #eaf8f1');
    expect(html).toContain('会议核心共识已达成');
  });

  it('markdownToFeishuHtml: 能够将 Markdown 表格转化为带样式的飞书表格', () => {
    const md = `
| 模块 | 负责人 | 状态 |
| :--- | :--- | :--- |
| 登录 | @张三 | 已完成 |
| 支付 | @李四 | 进行中 |
`;
    const html = markdownToFeishuHtml(md);
    expect(html).toContain('<table');
    expect(html).toContain('<thead style="background-color: #f5f6f7;"');
    expect(html).toContain('登录');
    expect(html).toContain('@张三');
    expect(html).toContain('已完成');
  });

  it('markdownToFeishuHtml: 能够将 Markdown Todo 清单转化为飞书待办格式', () => {
    const md = `
- [ ] 补齐退款超时重试逻辑
- [x] 完善网关鉴权
`;
    const html = markdownToFeishuHtml(md);
    expect(html).toContain('☑️');
    expect(html).toContain('✅');
    expect(html).toContain('补齐退款超时重试逻辑');
  });

  it('markdownToFeishuHtml: 能够将代码块转化为 Mac 风格终端样式', () => {
    const md = `\`\`\`typescript
const greeting = "Hello Feishu";
\`\`\``;
    const html = markdownToFeishuHtml(md);
    expect(html).toContain('background: #1e293b');
    expect(html).toContain('#ef4444');
    expect(html).toContain('Hello Feishu');
  });
});
