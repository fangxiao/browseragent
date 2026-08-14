import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../src/utils/ai/tokens';

describe('estimateTokens', () => {
  it('空串为 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('中文约 1 token/字', () => {
    const zh = '需求文档评审周报';
    expect(estimateTokens(zh)).toBe(zh.length);
  });

  it('英文约 1 token/4 字符', () => {
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('中英混合正确相加', () => {
    // 4 个中文 + ' doc '(5 字符 → ceil(5/4)=2)
    expect(estimateTokens('需求 doc 评审')).toBe(4 + 2);
  });
});
