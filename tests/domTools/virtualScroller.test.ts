import { describe, expect, it, afterEach } from 'vitest';
import {
  isVirtualizedPage,
  getAllScrollableElements,
  extractFromNativeCatalog,
  sweepVirtualDoc,
} from '../../src/utils/domTools/virtualScroller';

describe('virtualScroller(飞书/Notion等虚拟滚动长文档全量扫描引擎)', () => {
  const originalDocument = (globalThis as any).document;
  const originalWindow = (globalThis as any).window;
  const originalLocation = (globalThis as any).location;

  afterEach(() => {
    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
    (globalThis as any).location = originalLocation;
  });

  it('isVirtualizedPage: 在无 DOM 环境下安全返回', () => {
    (globalThis as any).document = undefined;
    (globalThis as any).window = undefined;
    const res = isVirtualizedPage();
    expect(res.isVirtual).toBe(false);
    expect(res.isFeishu).toBe(false);
  });

  it('isVirtualizedPage: 正确识别飞书文档域名与容器', () => {
    (globalThis as any).window = globalThis;
    (globalThis as any).location = { hostname: 'mycompany.feishu.cn' };
    (globalThis as any).document = {
      querySelector: (sel: string) => {
        if (sel.includes('.docx-page-container')) {
          return { scrollHeight: 5000, clientHeight: 800 };
        }
        return null;
      },
      querySelectorAll: (sel: string) => {
        if (sel.includes('.docx-page-container')) {
          return [{ scrollHeight: 5000, clientHeight: 800 }];
        }
        return [];
      },
      body: { scrollHeight: 5000 },
      documentElement: { scrollHeight: 5000 },
    };

    const res = isVirtualizedPage();
    expect(res.isVirtual).toBe(true);
    expect(res.isFeishu).toBe(true);
    expect(res.containers.length).toBeGreaterThan(0);
  });

  it('extractFromNativeCatalog: 支持从飞书目录栏直接提取大纲', () => {
    const mockCatalog = [
      { textContent: '第1章 背景', className: 'docx-catalog-item level-1', getAttribute: () => null },
      { textContent: '1.1 现状分析', className: 'docx-catalog-item level-2', getAttribute: () => null },
    ];

    (globalThis as any).window = {
      getComputedStyle: () => ({ paddingLeft: '0px' }),
    };

    (globalThis as any).document = {
      querySelectorAll: (sel: string) => (sel.includes('catalog-item') ? mockCatalog : []),
    };

    const catalogHeadings = extractFromNativeCatalog();
    expect(catalogHeadings.length).toBe(2);
    expect(catalogHeadings[0]?.title).toBe('第1章 背景');
    expect(catalogHeadings[1]?.title).toBe('1.1 现状分析');
  });

  it('sweepVirtualDoc: 在模拟环境中能保序拼接与无痕复位', async () => {
    const initialTop = 150;
    let currentScrollTop = initialTop;

    const mockBlocks = [
      { tagName: 'H1', textContent: '第1章 引言', getAttribute: () => 'b-1', setAttribute: () => {} },
      { tagName: 'P', textContent: '飞书文档长文本测试段落内容...', getAttribute: () => 'b-2', setAttribute: () => {} },
      { tagName: 'H2', textContent: '1.1 架构设计', getAttribute: () => 'b-3', setAttribute: () => {} },
    ];

    const mockContainer = {
      get scrollTop() {
        return currentScrollTop;
      },
      set scrollTop(v: number) {
        currentScrollTop = v;
      },
      scrollHeight: 2400,
      clientHeight: 800,
      dispatchEvent: () => {},
      scrollIntoView: () => {},
    };

    (globalThis as any).window = {
      get innerHeight() {
        return 800;
      },
      scrollY: 0,
      scrollTo: () => {},
      scrollBy: () => {},
      dispatchEvent: () => {},
      getComputedStyle: () => ({ paddingLeft: '0px' }),
    };

    (globalThis as any).location = { hostname: 'feishu.cn' };
    (globalThis as any).document = {
      querySelector: () => mockContainer,
      querySelectorAll: (sel: string) => {
        if (sel.includes('docx-page-container')) return [mockContainer];
        if (sel.includes('catalog')) return [];
        return mockBlocks;
      },
      body: { scrollHeight: 2400 },
      documentElement: { scrollHeight: 2400 },
      dispatchEvent: () => {},
    };

    const result = await sweepVirtualDoc({
      maxSteps: 3,
      stepDelayMs: 5,
    });

    expect(result.headings.length).toBe(2);
    expect(result.headings[0]?.title).toBe('第1章 引言');
    expect(result.headings[1]?.title).toBe('1.1 架构设计');
    expect(result.fullText).toContain('飞书文档长文本测试段落内容');

    // 校验无痕复位：最后滚动条位置被还原回初始位置
    expect(currentScrollTop).toBe(initialTop);
  });
});
