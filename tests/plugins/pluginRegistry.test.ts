import { describe, expect, it } from 'vitest';
import { defaultPluginRegistry, PluginRegistry } from '../../src/plugins/registry';
import { WechatPlugin } from '../../src/plugins/wechat';
import { DevToolPlugin } from '../../src/plugins/devtool';
import { BrowserManagerPlugin } from '../../src/plugins/browser';
import { buildAgentSystem, buildAgentTools } from '../../src/utils/ai/agents';

describe('Plugin System (浏览器智能体插件架构)', () => {
  it('defaultPluginRegistry: 成功注册 3 大内置生态插件', () => {
    const plugins = defaultPluginRegistry.getAll();
    expect(plugins.length).toBe(3);
    expect(defaultPluginRegistry.get('wechat')).toBeDefined();
    expect(defaultPluginRegistry.get('devtool')).toBeDefined();
    expect(defaultPluginRegistry.get('browser-manager')).toBeDefined();
  });

  it('BrowserManagerPlugin: 包含标签页/工作区/书签/历史/下载管理等系统级工具与快捷动作', () => {
    const p = defaultPluginRegistry.get('browser-manager');
    expect(p).toBeDefined();
    expect(p?.tools?.length).toBe(21);
    const toolNames = p?.tools?.map((t) => t.name) ?? [];
    expect(toolNames).toContain('listTabs');
    expect(toolNames).toContain('groupTabs');
    expect(toolNames).toContain('closeTabs');
    expect(toolNames).toContain('activateTab');
    expect(toolNames).toContain('discardTabs');
    expect(toolNames).toContain('saveWorkspace');
    expect(toolNames).toContain('listWorkspaces');
    expect(toolNames).toContain('restoreWorkspace');
    expect(toolNames).toContain('deleteWorkspace');
    expect(toolNames).toContain('getRecentlyClosedTabs');
    expect(toolNames).toContain('restoreClosedTab');
    expect(toolNames).toContain('clearBrowsingData');
    expect(toolNames).toContain('moveTabsToNewWindow');
    expect(toolNames).toContain('setTabZoom');
    expect(toolNames).toContain('searchDownloads');
    expect(toolNames).toContain('getBookmarksTree');
    expect(toolNames).toContain('searchBookmarks');
    expect(toolNames).toContain('createBookmark');
    expect(toolNames).toContain('moveBookmark');
    expect(toolNames).toContain('removeBookmark');
    expect(toolNames).toContain('searchHistory');
    expect(p?.quickActions?.length).toBeGreaterThanOrEqual(4);
  });

  it('getActivePlugins: 针对微信公众平台 URL 智能激活 WechatPlugin + 全局插件', () => {
    const active = defaultPluginRegistry.getActivePlugins('https://mp.weixin.qq.com/cgi-bin/appmsg');
    const ids = active.map((p) => p.id);

    expect(ids).toContain('wechat');
    expect(ids).toContain('devtool');
    expect(ids).toContain('browser-manager');
  });

  it('buildDynamicSystemPrompt: 根据当前 URL 动态裁剪与注入专属提示词', () => {
    const wechatPrompt = defaultPluginRegistry.buildDynamicSystemPrompt('https://mp.weixin.qq.com/appmsg');
    expect(wechatPrompt).toContain('微信公众号创作与草稿写入专属能力');

    const otherPrompt = defaultPluginRegistry.buildDynamicSystemPrompt('https://example.com');
    expect(otherPrompt).not.toContain('微信公众号创作与草稿写入专属能力');
  });

  it('buildAgentSystem & buildAgentTools: 智能体系统提示词与工具列表动态组合', () => {
    const wechatSys = buildAgentSystem('https://mp.weixin.qq.com/appmsg');
    expect(wechatSys).toContain('【核心基础能力】');
    expect(wechatSys).toContain('微信公众号创作与草稿写入专属能力');

    const tools = buildAgentTools('https://mp.weixin.qq.com/appmsg');
    expect(tools).toContain('writeWechatDraft');
    expect(tools).toContain('readPage');
    expect(tools).toContain('getPagePerformance');
    expect(tools).not.toContain('evaluate');
  });

  it('PluginRegistry: 支持动态注册与注销第三方插件', () => {
    const registry = new PluginRegistry();
    expect(registry.getAll().length).toBe(0);

    registry.register({
      id: 'custom-crm',
      name: '内部 CRM 助手',
      description: '自定义 CRM 系统自动化',
      icon: '🏢',
      matchUrl: (url) => url.includes('crm.internal.com'),
      quickActions: [
        { id: 'query-customer', label: '查询客户画像', prompt: '查询该客户画像与历史跟进记录' },
      ],
    });

    expect(registry.get('custom-crm')).toBeDefined();
    expect(registry.getActivePlugins('https://crm.internal.com/user/1').length).toBe(1);
    expect(registry.getActivePlugins('https://other.com').length).toBe(0);

    const actions = registry.getQuickActions('https://crm.internal.com/user/1');
    expect(actions.length).toBe(1);
    expect(actions[0]?.label).toBe('查询客户画像');

    registry.unregister('custom-crm');
    expect(registry.get('custom-crm')).toBeUndefined();
  });
});
