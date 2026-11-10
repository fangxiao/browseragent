import { describe, it, expect, afterEach } from 'vitest';
import { highlightActionElement, flashHighlight } from '../../src/utils/domTools/visualOverlay';

describe('visualOverlay(动作高亮与气泡遮罩)', () => {
  const originalDocument = (globalThis as any).document;
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
  });

  it('在无 DOM 环境下安全调用不抛出异常', () => {
    (globalThis as any).document = undefined;
    (globalThis as any).window = undefined;
    expect(() => {
      highlightActionElement(null as any);
      flashHighlight(null as any);
    }).not.toThrow();
  });

  it('在 DOM 环境下能够正确创建 overlay 容器与动作提示气泡', () => {
    const createdElements: any[] = [];
    const elementsById: Record<string, any> = {};

    const mockBody: any = {
      appendChild: (el: any) => {
        createdElements.push(el);
        if (el.id) elementsById[el.id] = el;
      },
    };

    (globalThis as any).window = {
      scrollX: 0,
      scrollY: 0,
      setTimeout: (fn: Function) => setTimeout(fn, 10),
    };

    (globalThis as any).document = {
      body: mockBody,
      getElementById: (id: string) => elementsById[id] || null,
      createElement: (tag: string) => {
        const el: any = {
          tagName: tag.toUpperCase(),
          style: {},
          childNodes: [],
          children: [],
          appendChild: (child: any) => {
            el.childNodes.push(child);
            el.children.push(child);
          },
          remove: () => {},
        };
        return el;
      },
    };

    const mockEl: any = {
      getBoundingClientRect: () => ({
        left: 50,
        top: 100,
        width: 120,
        height: 40,
        right: 170,
        bottom: 140,
      }),
      scrollIntoView: () => {},
    };

    highlightActionElement(mockEl, { actionType: 'click', label: '点击提交' });

    const container = elementsById['__browseragent_action_overlay__'];
    expect(container).toBeDefined();
    expect(container.style.position).toBe('fixed');
    expect(container.style.zIndex).toBe('2147483647');
    expect(container.childNodes.length).toBeGreaterThan(0);
    const box = container.childNodes[0];
    expect(box.childNodes[0].innerHTML).toContain('点击提交');
    expect(box.childNodes[0].innerHTML).toContain('🎯');
  });

  it('flashHighlight 能够正常触发', () => {
    const createdElements: any[] = [];
    const elementsById: Record<string, any> = {};

    (globalThis as any).window = {
      scrollX: 0,
      scrollY: 0,
      setTimeout: (fn: Function) => setTimeout(fn, 10),
    };

    (globalThis as any).document = {
      body: {
        appendChild: (el: any) => {
          createdElements.push(el);
          if (el.id) elementsById[el.id] = el;
        },
      },
      getElementById: (id: string) => elementsById[id] || null,
      createElement: () => ({
        style: {},
        childNodes: [],
        children: [],
        appendChild: () => {},
        remove: () => {},
      }),
    };

    const mockEl: any = {
      getBoundingClientRect: () => ({
        left: 10,
        top: 20,
        width: 200,
        height: 30,
      }),
    };

    expect(() => {
      flashHighlight(mockEl, '#10b981');
    }).not.toThrow();
  });
});
