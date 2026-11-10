import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { actions } from '../../src/utils/domTools/actions';

const FALLBACK_SELECTOR = 'table tbody tr a, table tbody tr, ul.ant-list-items li, ul li a, ul li';

describe('actions.loopElements(循环遍历同构列表)', () => {
  function makeRowEl(label: string, visible = true) {
    const el: any = {
      tagName: 'TR',
      label,
      clicked: 0,
      dispatchTypes: [] as string[],
      getBoundingClientRect: () =>
        visible ? { width: 800, height: 40 } : { width: 0, height: 0 },
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn((ev: any) => {
        el.dispatchTypes.push(ev.type);
      }),
      click: vi.fn(() => {
        el.clicked++;
      }),
    };
    return el;
  }

  function stubEnv(qsa: (sel: string) => any[]) {
    vi.stubGlobal('document', {
      querySelectorAll: qsa,
      querySelector: () => null,
      body: { tagName: 'BODY', innerText: 'mock' },
    });
    vi.stubGlobal('window', {
      getComputedStyle: () => ({ display: 'block' }),
    });
    vi.stubGlobal('MouseEvent', class MouseEvent {
      type: string;
      constructor(type: string, _opts?: any) {
        this.type = type;
      }
    });
    // 立即回调,避免真实 delay 拖慢测试
    vi.stubGlobal('setTimeout', ((fn: () => void) => {
      fn();
      return 0;
    }) as any);
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('遍历全部可见列表项,逐条触发拟人点击并统计', async () => {
    const r1 = makeRowEl('第1条');
    const r2 = makeRowEl('第2条');
    const r3 = makeRowEl('第3条');
    stubEnv((sel) => (sel === 'table tbody tr' ? [r1, r2, r3] : []));

    const res = await actions.loopElements({
      selector: 'table tbody tr:nth-of-type(1)',
      itemSelector: 'table tbody tr',
      maxItems: 10,
      delayMs: 100,
    });

    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ totalFound: 3, processedCount: 3 });
    expect((res.data as any).message).toContain('3/3');
    expect(r1.clicked).toBe(1);
    expect(r2.clicked).toBe(1);
    expect(r3.clicked).toBe(1);
    expect(r1.dispatchTypes).toEqual(['mouseover', 'mousedown', 'mouseup']);
  });

  it('未提供 itemSelector 时,自动从 nth 选择器泛化为通用选择器', async () => {
    const r1 = makeRowEl('第1条');
    const r2 = makeRowEl('第2条');
    const qsa = vi.fn((sel: string) =>
      sel === 'table > tbody > tr > td > a' ? [r1, r2] : [],
    );
    stubEnv(qsa);

    const res = await actions.loopElements({
      selector: 'table > tbody > tr:nth-of-type(2) > td > a',
      maxItems: 5,
      delayMs: 100,
    });

    expect(res.ok).toBe(true);
    expect(qsa).toHaveBeenCalledWith('table > tbody > tr > td > a'); // 已去 nth
    expect(res.data).toMatchObject({ processedCount: 2 });
  });

  it('主选择器无命中时,降级到通用兜底选择器', async () => {
    const r1 = makeRowEl('第1条');
    const r2 = makeRowEl('第2条');
    stubEnv((sel) => (sel === FALLBACK_SELECTOR ? [r1, r2] : []));

    const res = await actions.loopElements({
      selector: '#nonexistent-list li',
      maxItems: 5,
      delayMs: 100,
    });

    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ totalFound: 2, processedCount: 2 });
  });

  it('过滤不可见(零尺寸)元素,只遍历可见项', async () => {
    const visible = makeRowEl('可见');
    const hidden = makeRowEl('隐藏', false);
    stubEnv((sel) => (sel === 'ul.list li' ? [visible, hidden] : []));

    const res = await actions.loopElements({
      itemSelector: 'ul.list li',
      maxItems: 5,
      delayMs: 100,
    });

    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ totalFound: 1, processedCount: 1 });
    expect(visible.clicked).toBe(1);
    expect(hidden.clicked).toBe(0);
  });

  it('支持 subSteps 子步骤序列: 对每条列表项按顺序执行点击与输入', async () => {
    const detailBtn1 = {
      tagName: 'A',
      clicked: 0,
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn(),
      click: vi.fn(function (this: any) {
        this.clicked++;
      }),
    };
    const detailBtn2 = {
      tagName: 'A',
      clicked: 0,
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn(),
      click: vi.fn(function (this: any) {
        this.clicked++;
      }),
    };

    const r1 = makeRowEl('第1行');
    r1.querySelector = vi.fn((sel: string) => (sel === 'td.action a' ? detailBtn1 : null));
    const r2 = makeRowEl('第2行');
    r2.querySelector = vi.fn((sel: string) => (sel === 'td.action a' ? detailBtn2 : null));

    stubEnv((sel) => (sel === 'table.ant-table-tbody tr' ? [r1, r2] : []));

    const res = await actions.loopElements({
      itemSelector: 'table.ant-table-tbody tr',
      subSteps: [
        { type: 'click', selector: 'td.action a', description: '点击进入详情' },
      ],
      maxItems: 5,
      delayMs: 100,
    });

    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ totalFound: 2, processedCount: 2 });
    expect(detailBtn1.clicked).toBe(1);
    expect(detailBtn2.clicked).toBe(1);
  });

  it('无有效选择器时返回错误而非执行', async () => {
    stubEnv(() => []);
    const res = await actions.loopElements({});
    expect(res.ok).toBe(false);
    expect((res as any).error).toContain('选择器');
  });
});
