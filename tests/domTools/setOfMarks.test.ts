import { describe, expect, it, afterEach } from 'vitest';
import {
  injectSetOfMarksOverlay,
  removeSetOfMarksOverlay,
  clickAtCoordinate,
  getCachedMarks,
} from '../../src/utils/domTools/setOfMarks';

describe('setOfMarks(视觉多模态 Grounding)', () => {
  const originalDocument = (globalThis as any).document;
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
  });

  it('在非 DOM 环境下安全调用不抛出异常', () => {
    (globalThis as any).document = undefined;
    (globalThis as any).window = undefined;
    expect(() => {
      injectSetOfMarksOverlay();
      removeSetOfMarksOverlay();
      clickAtCoordinate(100, 100);
    }).not.toThrow();
  });

  it('能够为可视交互元素生成数字编号并挂载到 overlay 容器', () => {
    const createdElements: any[] = [];
    const elementsById: Record<string, any> = {};

    const mockBody: any = {
      appendChild: (el: any) => {
        createdElements.push(el);
        if (el.id) elementsById[el.id] = el;
      },
    };

    const mockBtn: any = {
      tagName: 'BUTTON',
      innerText: '立即购买',
      getAttribute: () => null,
      getBoundingClientRect: () => ({
        left: 100,
        top: 200,
        width: 80,
        height: 35,
        right: 180,
        bottom: 235,
      }),
    };

    const mockInput: any = {
      tagName: 'INPUT',
      placeholder: '请输入手机号',
      getAttribute: (k: string) => (k === 'id' ? 'phone-input' : null),
      id: 'phone-input',
      getBoundingClientRect: () => ({
        left: 100,
        top: 100,
        width: 200,
        height: 40,
        right: 300,
        bottom: 140,
      }),
    };

    (globalThis as any).window = {
      innerWidth: 1200,
      innerHeight: 800,
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    };

    (globalThis as any).document = {
      body: mockBody,
      documentElement: { clientWidth: 1200, clientHeight: 800 },
      getElementById: (id: string) => elementsById[id] || null,
      querySelectorAll: () => [mockBtn, mockInput],
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
          remove: () => {
            if (el.id) delete elementsById[el.id];
          },
        };
        return el;
      },
    };

    const marks = injectSetOfMarksOverlay({ maxMarks: 20 });
    expect(marks.length).toBe(2);
    expect(marks[0]!.id).toBe(1);
    expect(marks[0]!.text).toBe('立即购买');
    expect(marks[0]!.center.x).toBe(140);
    expect(marks[0]!.center.y).toBe(218);

    expect(marks[1]!.id).toBe(2);
    expect(marks[1]!.selector).toBe('#phone-input');

    const overlay = elementsById['__browseragent_som_overlay__'];
    expect(overlay).toBeDefined();

    const cached = getCachedMarks();
    expect(cached.length).toBe(2);

    removeSetOfMarksOverlay();
    expect(elementsById['__browseragent_som_overlay__']).toBeUndefined();
  });

  it('clickAtCoordinate: 在目标坐标处派发全套鼠标事件流', () => {
    const dispatchedEvents: string[] = [];
    const mockTarget: any = {
      tagName: 'BUTTON',
      innerText: '确认支付',
      focus: () => {},
      dispatchEvent: (e: any) => {
        dispatchedEvents.push(e.type);
        return true;
      },
    };

    (globalThis as any).PointerEvent = class {
      constructor(public type: string, public options: any) {}
    };
    (globalThis as any).MouseEvent = class {
      constructor(public type: string, public options: any) {}
    };

    (globalThis as any).document = {
      elementFromPoint: (x: number, y: number) => (x === 150 && y === 250 ? mockTarget : null),
    };

    const res = clickAtCoordinate(150, 250);
    expect(res.ok).toBe(true);
    expect(res.targetTag).toBe('button');
    expect(res.targetText).toBe('确认支付');
    expect(dispatchedEvents).toContain('pointerdown');
    expect(dispatchedEvents).toContain('mousedown');
    expect(dispatchedEvents).toContain('pointerup');
    expect(dispatchedEvents).toContain('mouseup');
    expect(dispatchedEvents).toContain('click');
  });
});
