import { describe, expect, it } from 'vitest';
import {
  getTool,
  listToolNames,
  validateArgs,
  toLlmTools,
} from '../../src/utils/domTools/toolRegistry';

describe('toolRegistry(工具注册表)', () => {
  it('listToolNames:包含全部核心工具(含 writeWechatDraft, listTabs, getPagePerformance)', () => {
    const names = listToolNames();
    for (const n of ['getPageInfo', 'getPagePerformance', 'listTabs', 'readPage', 'findElements', 'clickElement', 'typeInto', 'scrollTo', 'waitFor', 'sleep', 'extractData', 'navigate', 'writeWechatDraft', 'evaluate']) {
      expect(names).toContain(n);
    }
  });

  it('getTool:writeWechatDraft 定义完整', () => {
    const t = getTool('writeWechatDraft');
    expect(t).toBeDefined();
    expect(t?.name).toBe('writeWechatDraft');
    expect(t?.description).toContain('微信');
  });

  it('getTool:getPagePerformance 定义完整', () => {
    const t = getTool('getPagePerformance');
    expect(t).toBeDefined();
    expect(t?.name).toBe('getPagePerformance');
    expect(t?.description).toContain('性能');
  });

  it('getTool:listTabs 定义完整', () => {
    const t = getTool('listTabs');
    expect(t).toBeDefined();
    expect(t?.name).toBe('listTabs');
    expect(t?.description).toContain('标签页');
  });

  it('getTool:未知工具返回 undefined', () => {
    expect(getTool('notATool')).toBeUndefined();
    expect(getTool('readPage')?.name).toBe('readPage');
  });

  it('validateArgs:必填校验', () => {
    const click = getTool('clickElement')!;
    expect(validateArgs(click, { selector: '#btn' })).toBe(true);
    expect(validateArgs(click, {})).toBe(false);
  });

  it('validateArgs:typeInto 需 selector+text', () => {
    const type = getTool('typeInto')!;
    expect(validateArgs(type, { selector: '#a', text: 'hi' })).toBe(true);
    expect(validateArgs(type, { selector: '#a' })).toBe(false);
    expect(validateArgs(type, { text: 'hi' })).toBe(false);
  });

  it('toLlmTools:导出 {name, description, input_schema} 供 function calling', () => {
    const tools = toLlmTools();
    expect(tools.length).toBe(listToolNames().length);
    for (const t of tools) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.input_schema).toBeTypeOf('object');
    }
  });

  it('toLlmTools(filter):仅导出子集内工具', () => {
    const tools = toLlmTools(['readPage', 'extractData']);
    expect(tools.map((t) => t.name).sort()).toEqual(['extractData', 'readPage']);
  });

  it('toLlmTools(filter):未知工具名被忽略,不抛错', () => {
    const tools = toLlmTools(['readPage', 'notATool']);
    expect(tools.map((t) => t.name)).toEqual(['readPage']);
  });
});

import { createDomExecutor } from '../../src/utils/domTools/executor';

describe('createDomExecutor', () => {
  it('支持 getPagePerformance 工具执行并返回全维度指标(FCP, 慢资源, 资源分布, 长任务, DOM树, 压缩漏配, 渲染阻塞)', async () => {
    const executor = createDomExecutor();
    const res = await executor.execute('getPagePerformance', {});
    expect(res.ok).toBe(true);
    expect(res.data).toHaveProperty('loadMs');
    expect(res.data).toHaveProperty('ttfbMs');
    expect(res.data).toHaveProperty('fcpMs');
    expect(res.data).toHaveProperty('topSlowResources');
    expect(res.data).toHaveProperty('topHeavyResources');
    expect(res.data).toHaveProperty('resourceBreakdown');
    expect(res.data).toHaveProperty('longTaskCount');
    expect(res.data).toHaveProperty('totalLongTaskMs');
    expect(res.data).toHaveProperty('domNodeCount');
    expect(res.data).toHaveProperty('maxDomDepth');
    expect(res.data).toHaveProperty('uncompressedAssets');
    expect(res.data).toHaveProperty('renderBlockingCount');
    expect(Array.isArray((res.data as any).topSlowResources)).toBe(true);
    expect(Array.isArray((res.data as any).topHeavyResources)).toBe(true);
    expect(Array.isArray((res.data as any).uncompressedAssets)).toBe(true);
  });

  it('支持 writeWechatDraft 工具执行并完成富文本转换与写入', async () => {
    const executor = createDomExecutor();
    const res = await executor.execute('writeWechatDraft', {
      title: '测试公众号文章标题',
      author: '方小',
      digest: '测试摘要',
      contentMarkdown: '# 标题\n正文内容\n```js\nconsole.log(1);\n```',
      theme: 'tech-blue',
    });
    expect(res.ok).toBe(true);
    expect(res.data).toHaveProperty('title', '测试公众号文章标题');
    expect(res.data).toHaveProperty('author', '方小');
    expect(res.data).toHaveProperty('theme', 'tech-blue');
    expect(res.data).toHaveProperty('injectedFields');
  });

  it('支持 getArticleOutline 工具执行并返回多级目录大纲树', async () => {
    const executor = createDomExecutor();
    const res = await executor.execute('getArticleOutline', {});
    expect(res.ok).toBe(true);
    expect(res.data).toHaveProperty('totalSections');
    expect(res.data).toHaveProperty('outline');
  });

  it('支持 highlightAndScrollTo 工具安全调用', async () => {
    const executor = createDomExecutor();
    const res = await executor.execute('highlightAndScrollTo', { anchorId: 'anchor-1' });
    expect(res.ok).toBe(true);
    expect(res.data).toHaveProperty('scrolled', true);
  });
});
