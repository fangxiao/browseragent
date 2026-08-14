// E5 表单填充纯函数单测(select 选项定位)。见 docs/design/agent.md §6(场景 S2)。
import { describe, expect, it } from 'vitest';
import { findOptionIndex } from '../../src/utils/domTools/form';

const opts = [
  { value: 'cn', text: '中国' },
  { value: 'us', text: '美国' },
  { value: 'jp', text: '日本' },
];

describe('findOptionIndex(下拉选项定位)', () => {
  it('value 精确匹配优先', () => {
    expect(findOptionIndex(opts, 'us')).toBe(1);
  });

  it('text 精确匹配', () => {
    expect(findOptionIndex(opts, '日本')).toBe(2);
  });

  it('text 包含容错', () => {
    expect(findOptionIndex(opts, '中国🇨🇳')).toBe(0); // 目标含选项文本
    expect(findOptionIndex(opts, '日')).toBe(2); // 选项文本含目标
  });

  it('找不到 → -1', () => {
    expect(findOptionIndex(opts, '法国')).toBe(-1);
  });

  it('空目标 / 空选项 → -1', () => {
    expect(findOptionIndex(opts, '')).toBe(-1);
    expect(findOptionIndex([], 'x')).toBe(-1);
  });
});
