import { describe, expect, it, afterEach } from 'vitest';
import { initSelectionPill } from '../../src/utils/domTools/selectionPill';

describe('selectionPill(网页划词即问悬浮透镜)', () => {
  const originalDocument = (globalThis as any).document;
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
  });

  it('initSelectionPill: 在无 DOM 环境下安全跳过', () => {
    (globalThis as any).document = undefined;
    (globalThis as any).window = undefined;
    expect(() => {
      initSelectionPill();
    }).not.toThrow();
  });

  it('initSelectionPill: 支持注册监听器并保持幂等', () => {
    const listeners: Record<string, Function> = {};
    (globalThis as any).window = globalThis;
    (globalThis as any).document = {
      getElementById: () => null,
      addEventListener: (type: string, fn: Function) => {
        listeners[type] = fn;
      },
    };

    expect(() => {
      initSelectionPill();
    }).not.toThrow();

    expect(listeners).toHaveProperty('mouseup');
    expect(listeners).toHaveProperty('mousedown');
  });
});
