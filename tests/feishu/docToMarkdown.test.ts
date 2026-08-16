import { describe, expect, it } from 'vitest';
import {
  inlineHtmlToMarkdown,
  blockToMarkdown,
  extractDocMarkdown,
  isNoiseElement,
  isChildOfAnotherBlock,
  cleanDocTitle,
} from '../../src/utils/feishu/docToMarkdown';

describe('docToMarkdown(飞书/网页长文档转标准 Markdown 引擎)', () => {
  it('inlineHtmlToMarkdown: 准确转换加粗、斜体、行内代码、链接与图片', () => {
    const mockContainer = {
      nodeType: 1,
      tagName: 'DIV',
      childNodes: [
        { nodeType: 3, textContent: '这是 ' },
        { nodeType: 1, tagName: 'STRONG', childNodes: [{ nodeType: 3, textContent: '加粗文字' }] },
        { nodeType: 3, textContent: ' 和 ' },
        { nodeType: 1, tagName: 'EM', childNodes: [{ nodeType: 3, textContent: '斜体' }] },
        { nodeType: 3, textContent: ' 以及 ' },
        { nodeType: 1, tagName: 'CODE', childNodes: [{ nodeType: 3, textContent: 'const a = 1;' }] },
        { nodeType: 3, textContent: ' 还有 ' },
        {
          nodeType: 1,
          tagName: 'A',
          getAttribute: (attr: string) => (attr === 'href' ? 'https://feishu.cn' : null),
          childNodes: [{ nodeType: 3, textContent: '飞书' }],
        },
      ],
    };

    const res = inlineHtmlToMarkdown(mockContainer as any);
    expect(res).toBe('这是 **加粗文字** 和 *斜体* 以及 `const a = 1;` 还有 [飞书](https://feishu.cn)');
  });

  it('blockToMarkdown: 正确将 H1~H3 转为 Markdown 标题', () => {
    const mockH1 = {
      tagName: 'H1',
      className: 'docx-heading-1',
      getAttribute: () => null,
      nodeType: 1,
      childNodes: [{ nodeType: 3, textContent: '产品需求文档 PRD' }],
    };

    const mockH2 = {
      tagName: 'H2',
      className: 'docx-heading-2',
      getAttribute: () => null,
      nodeType: 1,
      childNodes: [{ nodeType: 3, textContent: '1. 总体架构' }],
    };

    expect(blockToMarkdown(mockH1 as any)).toContain('# 产品需求文档 PRD');
    expect(blockToMarkdown(mockH2 as any)).toContain('## 1. 总体架构');
  });

  it('blockToMarkdown: 正确将 Callout 高亮块转为 GitHub 风格引用', () => {
    const mockCallout = {
      tagName: 'BLOCKQUOTE',
      className: 'docx-callout',
      getAttribute: () => 'callout',
      nodeType: 1,
      childNodes: [{ nodeType: 3, textContent: '注意：该接口将在下个版本废弃' }],
    };

    const res = blockToMarkdown(mockCallout as any);
    expect(res).toContain('> [!NOTE]');
    expect(res).toContain('> 注意：该接口将在下个版本废弃');
  });

  it('blockToMarkdown: 正确转换待办事项清单 Todo', () => {
    const mockTodo = {
      tagName: 'DIV',
      className: 'docx-todo',
      getAttribute: (attr: string) => (attr === 'data-checked' ? 'true' : 'todo'),
      querySelector: () => null,
      nodeType: 1,
      childNodes: [{ nodeType: 3, textContent: '完成前端性能优化' }],
    };

    const res = blockToMarkdown(mockTodo as any);
    expect(res).toBe('- [x] 完成前端性能优化');
  });

  it('blockToMarkdown: 正确转换表格 Table 为 Markdown 表格', () => {
    const mockTable = {
      tagName: 'TABLE',
      className: 'docx-table',
      getAttribute: () => null,
      nodeType: 1,
      querySelector: () => null,
      querySelectorAll: (sel: string) => {
        if (sel === 'tr') {
          return [
            {
              querySelectorAll: () => [
                { nodeType: 3, textContent: '功能模块' },
                { nodeType: 3, textContent: '负责人' },
                { nodeType: 3, textContent: '状态' },
              ],
            },
            {
              querySelectorAll: () => [
                { nodeType: 3, textContent: '虚拟滚动扫描' },
                { nodeType: 3, textContent: 'AI 助手' },
                { nodeType: 3, textContent: '已完成' },
              ],
            },
          ];
        }
        return [];
      },
    };

    const res = blockToMarkdown(mockTable as any);
    expect(res).toContain('| 功能模块 | 负责人 | 状态 |');
    expect(res).toContain('| --- | --- | --- |');
    expect(res).toContain('| 虚拟滚动扫描 | AI 助手 | 已完成 |');
  });

  it('blockToMarkdown: 正确提取飞书图片块并保留 URL 与描述', () => {
    const mockImageBlock = {
      tagName: 'DIV',
      className: 'docx-image-wrapper',
      getAttribute: () => 'image',
      nodeType: 1,
      querySelector: (sel: string) => {
        if (sel === 'img') {
          return {
            getAttribute: (attr: string) => {
              if (attr === 'src') return 'https://p3-feishu.byteimg.com/tos-cn-i-abc/architecture.png';
              if (attr === 'alt') return '系统架构拓扑图';
              return null;
            },
          };
        }
        if (sel === 'figcaption') {
          return { textContent: '系统架构拓扑图 (V2.0)' };
        }
        return null;
      },
    };

    const res = blockToMarkdown(mockImageBlock as any);
    expect(res).toContain('![系统架构拓扑图 (V2.0)](https://p3-feishu.byteimg.com/tos-cn-i-abc/architecture.png)');
  });

  it('isNoiseElement: 正确识别并过滤评论、批注、协同光标与工具栏', () => {
    const mockCommentEl = {
      className: 'docx-comment-container',
      matches: (sel: string) => sel.includes('comment'),
      closest: () => null,
      getAttribute: () => null,
    };

    const mockContentEl = {
      className: 'docx-paragraph',
      matches: () => false,
      closest: () => null,
      getAttribute: () => null,
    };

    expect(isNoiseElement(mockCommentEl as any)).toBe(true);
    expect(isNoiseElement(mockContentEl as any)).toBe(false);
  });

  it('isChildOfAnotherBlock: 正确识别表格内的单元格段落，避免重复打印', () => {
    const mockTable = {
      tagName: 'TABLE',
      className: 'docx-table',
      parentElement: null,
      getAttribute: () => 'table',
      hasAttribute: () => true,
    };

    const mockTd = {
      tagName: 'TD',
      className: '',
      parentElement: mockTable,
      getAttribute: () => null,
      hasAttribute: () => false,
    };

    const mockPInsideTd = {
      tagName: 'P',
      className: 'docx-paragraph',
      parentElement: mockTd,
      getAttribute: () => null,
      hasAttribute: () => false,
    };

    expect(isChildOfAnotherBlock(mockPInsideTd as any, null as any)).toBe(true);
  });

  it('cleanDocTitle: 智能去除飞书云文档/知识库等噪声后缀', () => {
    expect(cleanDocTitle('【PRD】机构类进件流程 - 飞书云文档')).toBe('【PRD】机构类进件流程');
    expect(cleanDocTitle('海尔消金业务方案 - 知识库')).toBe('海尔消金业务方案');
    expect(cleanDocTitle('飞书云文档')).toBe('');
  });

  it('blockToMarkdown: 有序列表彻底消除固有重复编号', () => {
    const mockOrderedList = {
      tagName: 'DIV',
      className: 'ordered-list',
      getAttribute: () => 'ordered',
      nodeType: 1,
      childNodes: [{ nodeType: 3, textContent: '1. 联登授权后进行二要素校验' }],
    };

    const res = blockToMarkdown(mockOrderedList as any);
    expect(res).toBe('1. 联登授权后进行二要素校验');
  });

  it('extractDocMarkdown: 在无 DOM 环境下安全返回', async () => {
    const originalDocument = (globalThis as any).document;
    const originalWindow = (globalThis as any).window;

    (globalThis as any).document = undefined;
    (globalThis as any).window = undefined;

    const res = await extractDocMarkdown();
    expect(res.wordCount).toBe(0);
    expect(res.markdown).toBe('');

    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
  });
});
