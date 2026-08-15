import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { actions } from '../../src/utils/domTools/actions';

describe('readingOutline(长文大纲与段落精准溯源)', () => {
  const originalDocument = globalThis.document;

  afterEach(() => {
    (globalThis as any).document = originalDocument;
  });

  it('getArticleOutline: 在无 DOM 环境下安全返回默认结构', async () => {
    (globalThis as any).document = undefined;
    const res = await actions.getArticleOutline({});
    expect(res.ok).toBe(true);
    expect(res.data).toHaveProperty('totalSections', 0);
    expect(res.data).toHaveProperty('outline');
  });

  it('getArticleOutline: 能够扫描 DOM 标题与段落并生成 anchorId', async () => {
    const mockElements = [
      {
        tagName: 'H1',
        textContent: 'AI 智能体的前沿发展',
        attrs: {} as Record<string, string>,
        getAttribute(k: string) { return this.attrs[k] || null; },
        setAttribute(k: string, v: string) { this.attrs[k] = v; },
      },
      {
        tagName: 'H2',
        textContent: '1. 核心架构原理',
        attrs: {} as Record<string, string>,
        getAttribute(k: string) { return this.attrs[k] || null; },
        setAttribute(k: string, v: string) { this.attrs[k] = v; },
      },
      {
        tagName: 'P',
        textContent: '这是包含重要论据与详细分析的长段落，字符长度超过五十个字以便被文章智能大纲系统识别为重点导读摘要段落。',
        attrs: {} as Record<string, string>,
        getAttribute(k: string) { return this.attrs[k] || null; },
        setAttribute(k: string, v: string) { this.attrs[k] = v; },
      },
      {
        tagName: 'H2',
        textContent: '2. 生产落地实践',
        attrs: {} as Record<string, string>,
        getAttribute(k: string) { return this.attrs[k] || null; },
        setAttribute(k: string, v: string) { this.attrs[k] = v; },
      },
    ];

    (globalThis as any).document = {
      title: 'AI 前沿研报',
      querySelector: () => ({
        querySelectorAll: () => mockElements,
      }),
      body: {
        querySelectorAll: () => mockElements,
      },
    };

    const res = await actions.getArticleOutline({});
    expect(res.ok).toBe(true);
    const outline = (res.data as any).outline;
    expect(outline.length).toBe(4);

    expect(outline[0].title).toBe('AI 智能体的前沿发展');
    expect(outline[0].level).toBe(1);
    expect(outline[0].anchorId).toBe('anchor-1');

    expect(outline[1].title).toBe('1. 核心架构原理');
    expect(outline[1].level).toBe(2);
    expect(outline[1].anchorId).toBe('anchor-2');

    expect(outline[3].title).toBe('2. 生产落地实践');
    expect(outline[3].level).toBe(2);
    expect(outline[3].anchorId).toBe('anchor-4');

    expect(mockElements[0]!.attrs['data-agent-anchor']).toBe('anchor-1');
  });

  it('highlightAndScrollTo: 能够按 anchorId 驱动元素平滑滚动与高亮', async () => {
    let scrolled = false;
    let classNameAdded = '';

    const mockTarget = {
      textContent: '关键数据分析结果',
      getAttribute(k: string) { return k === 'data-agent-anchor' ? 'anchor-1' : null; },
      scrollIntoView: () => { scrolled = true; },
      classList: {
        remove: () => {},
        add: (cls: string) => { classNameAdded = cls; },
      },
      offsetWidth: 100,
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => (sel.includes('anchor-1') ? mockTarget : null),
      querySelectorAll: () => [mockTarget],
      getElementById: (id: string) => (id === 'ai-agent-pulse-style' ? {} : null),
      head: { appendChild: () => {} },
      createElement: () => ({ id: '', textContent: '' }),
    };

    const res = await actions.highlightAndScrollTo({ anchorId: 'anchor-1' });
    expect(res.ok).toBe(true);
    expect(res.data).toHaveProperty('scrolled', true);
    expect(scrolled).toBe(true);
    expect(classNameAdded).toBe('ai-agent-pulse-target');
  });
});
