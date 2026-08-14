import { describe, expect, it } from 'vitest';
import { blocksToMarkdown } from '../src/utils/pageExtract/editor/markdown';
import type { Block } from '../src/utils/pageExtract/types';

describe('blocksToMarkdown', () => {
  it('渲染标题(1-6 级)', () => {
    const blocks: Block[] = [
      { type: 'heading', text: '需求背景', level: 2 },
      { type: 'heading', text: '目标', level: 3 },
    ];
    expect(blocksToMarkdown(blocks)).toBe('## 需求背景\n### 目标');
  });

  it('渲染有序/无序列表与缩进', () => {
    const blocks: Block[] = [
      { type: 'listItem', text: '任务 A', ordered: false, level: 0 },
      { type: 'listItem', text: '子任务', ordered: false, level: 1 },
      { type: 'listItem', text: '步骤 B', ordered: true, level: 0 },
    ];
    expect(blocksToMarkdown(blocks)).toBe('- 任务 A\n  - 子任务\n1. 步骤 B');
  });

  it('渲染 todo 勾选状态', () => {
    const blocks: Block[] = [
      { type: 'todo', text: '已完成', checked: true },
      { type: 'todo', text: '未完成', checked: false },
    ];
    expect(blocksToMarkdown(blocks)).toBe('- [x] 已完成\n- [ ] 未完成');
  });

  it('渲染表格(含表头分隔行与管道转义)', () => {
    const blocks: Block[] = [
      { type: 'table', text: '', cells: [['字段', '说明'], ['id', '主键']] },
    ];
    expect(blocksToMarkdown(blocks)).toBe(
      '| 字段 | 说明 |\n| --- | --- |\n| id | 主键 |',
    );
  });

  it('渲染引用/代码/分隔线/图片', () => {
    const blocks: Block[] = [
      { type: 'quote', text: '第一行\n第二行' },
      { type: 'code', text: 'const a = 1;' },
      { type: 'divider', text: '' },
      { type: 'image', text: '架构图', src: 'https://x/a.png' },
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain('> 第一行\n> 第二行');
    expect(md).toContain('```\nconst a = 1;\n```');
    expect(md).toContain('---');
    expect(md).toContain('![架构图](https://x/a.png)');
  });
});
