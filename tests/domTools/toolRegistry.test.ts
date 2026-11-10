import { describe, expect, it } from 'vitest';
import {
  getTool,
  listToolNames,
  validateArgs,
  toLlmTools,
} from '../../src/utils/domTools/toolRegistry';

describe('toolRegistry(工具注册表)', () => {
  it('listToolNames:包含全部核心工具(含 writeWechatDraft, listTabs, groupTabs, closeTabs, getBookmarksTree 等)', () => {
    const names = listToolNames();
    for (const n of [
      'getPageInfo',
      'getPagePerformance',
      'listTabs',
      'groupTabs',
      'closeTabs',
      'activateTab',
      'getBookmarksTree',
      'searchBookmarks',
      'createBookmark',
      'moveBookmark',
      'removeBookmark',
      'searchHistory',
      'readPage',
      'findElements',
      'clickElement',
      'typeInto',
      'scrollTo',
      'waitFor',
      'sleep',
      'extractData',
      'navigate',
      'writeWechatDraft',
      'discardTabs',
      'saveWorkspace',
      'listWorkspaces',
      'restoreWorkspace',
      'deleteWorkspace',
      'getRecentlyClosedTabs',
      'restoreClosedTab',
      'clearBrowsingData',
      'moveTabsToNewWindow',
      'setTabZoom',
      'searchDownloads',
      'hoverElement',
      'startWorkflowRecording',
      'stopWorkflowRecording',
      'saveWorkflowRecipe',
      'listWorkflowRecipes',
      'runWorkflowRecipe',
      'deleteWorkflowRecipe',
      'exportWorkflowRecipes',
      'importWorkflowRecipes',
      'captureMarkedScreen',
      'clickMark',
      'clickCoordinate',
      'startNetworkRecording',
      'stopNetworkRecording',
      'mockNetworkResponse',
      'emulateDevice',
      'evaluate',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('getTool:groupTabs & closeTabs 定义完整', () => {
    const group = getTool('groupTabs');
    expect(group).toBeDefined();
    expect(group?.required).toContain('tabIds');
    expect(group?.required).toContain('title');

    const close = getTool('closeTabs');
    expect(close).toBeDefined();
    expect(close?.sensitive).toBe(true);
  });

  it('getTool:workspace & system tools 定义完整', () => {
    const saveWs = getTool('saveWorkspace');
    expect(saveWs).toBeDefined();
    expect(saveWs?.required).toContain('name');

    const delWs = getTool('deleteWorkspace');
    expect(delWs?.sensitive).toBe(true);

    const clearData = getTool('clearBrowsingData');
    expect(clearData?.sensitive).toBe(true);

    const discard = getTool('discardTabs');
    expect(discard).toBeDefined();

    const zoom = getTool('setTabZoom');
    expect(zoom?.required).toContain('zoomFactor');
  });

  it('getTool:bookmarks & history 工具定义完整', () => {
    const tree = getTool('getBookmarksTree');
    expect(tree).toBeDefined();

    const searchBm = getTool('searchBookmarks');
    expect(searchBm?.required).toContain('query');

    const rmBm = getTool('removeBookmark');
    expect(rmBm?.sensitive).toBe(true);

    const hist = getTool('searchHistory');
    expect(hist).toBeDefined();
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

  it('支持 hideElement, removeElement, highlightElement, modifyElementStyle 定向操作 DOM', async () => {
    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;

    const adEl = {
      tagName: 'DIV',
      isConnected: true,
      style: { display: 'block', outline: '', outlineOffset: '', boxShadow: '', zIndex: '', backgroundColor: '' },
      innerText: '烦人的广告横幅',
      textContent: '烦人的广告横幅',
      getAttribute: () => null,
      scrollIntoView: () => {},
      remove: () => {},
      getBoundingClientRect: () => ({ width: 200, height: 50 }),
      getClientRects: () => [{ width: 200, height: 50 }],
      parentElement: { tagName: 'BODY' },
    };
    const popupEl = {
      tagName: 'DIV',
      isConnected: true,
      style: { display: 'block', outline: '', outlineOffset: '', boxShadow: '', zIndex: '', backgroundColor: '' },
      innerText: '弹窗遮罩',
      textContent: '弹窗遮罩',
      getAttribute: () => null,
      scrollIntoView: () => {},
      getBoundingClientRect: () => ({ width: 300, height: 200 }),
      getClientRects: () => [{ width: 300, height: 200 }],
      parentElement: { tagName: 'BODY' },
      removed: false,
      remove() {
        this.removed = true;
      },
    };
    const cardEl = {
      tagName: 'DIV',
      isConnected: true,
      style: { display: 'block', outline: '', outlineOffset: '', boxShadow: '', zIndex: '', backgroundColor: '' },
      innerText: '重点内容卡片',
      textContent: '重点内容卡片',
      getAttribute: () => null,
      scrollIntoView: () => {},
      remove: () => {},
      getBoundingClientRect: () => ({ width: 400, height: 300 }),
      getClientRects: () => [{ width: 400, height: 300 }],
      parentElement: { tagName: 'BODY' },
    };

    (globalThis as any).window = {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      setTimeout: (fn: Function) => fn(),
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => {
        if (sel === '#ad-banner') return adEl;
        if (sel === '#popup-modal') return popupEl;
        if (sel === '#content-card') return cardEl;
        return null;
      },
      querySelectorAll: (sel: string) => {
        if (sel === '#ad-banner') return [adEl];
        if (sel === '#popup-modal') return [popupEl];
        if (sel === '#content-card') return [cardEl];
        return [];
      },
      body: { tagName: 'BODY', innerText: 'mock' },
    };

    const executor = createDomExecutor();

    // 1. 隐藏元素 hideElement
    const hideRes = await executor.execute('hideElement', { selector: '#ad-banner' });
    expect(hideRes.ok).toBe(true);
    expect(adEl.style.display).toBe('none');

    // 2. 删除元素 removeElement
    const removeRes = await executor.execute('removeElement', { selector: '#popup-modal' });
    expect(removeRes.ok).toBe(true);
    expect(popupEl.removed).toBe(true);

    // 3. 高亮元素 highlightElement
    const hlRes = await executor.execute('highlightElement', { selector: '#content-card', color: '#ff0000', persistent: true });
    expect(hlRes.ok).toBe(true);
    expect(cardEl.style.outline).toContain('#ff0000');

    // 4. 修改样式 modifyElementStyle
    const styleRes = await executor.execute('modifyElementStyle', {
      selector: '#content-card',
      styles: { zIndex: '9999', backgroundColor: 'rgb(240, 240, 240)' },
    });
    expect(styleRes.ok).toBe(true);
    expect(cardEl.style.zIndex).toBe('9999');
    expect(cardEl.style.backgroundColor).toBe('rgb(240, 240, 240)');

    (globalThis as any).document = origDoc;
    (globalThis as any).window = origWin;
  });
});
