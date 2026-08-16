import { describe, expect, it } from 'vitest';
import { defaultPluginRegistry, PluginRegistry } from '../../src/plugins/registry';
import { FeishuPlugin } from '../../src/plugins/feishu';
import { WechatPlugin } from '../../src/plugins/wechat';
import { DevToolPlugin } from '../../src/plugins/devtool';
import { ReadingPlugin } from '../../src/plugins/reading';
import { buildAgentSystem, buildAgentTools } from '../../src/utils/ai/agents';

describe('Plugin System (浏览器智能体插件架构)', () => {
  it('defaultPluginRegistry: 成功注册 4 大内置生态插件', () => {
    const plugins = defaultPluginRegistry.getAll();
    expect(plugins.length).toBe(4);
    expect(defaultPluginRegistry.get('feishu')).toBeDefined();
    expect(defaultPluginRegistry.get('wechat')).toBeDefined();
    expect(defaultPluginRegistry.get('devtool')).toBeDefined();
    expect(defaultPluginRegistry.get('reading')).toBeDefined();
  });

  it('getActivePlugins: 针对飞书 URL 智能精准激活 FeishuPlugin + 全局插件', () => {
    const active = defaultPluginRegistry.getActivePlugins('https://haiercash.feishu.cn/docx/abc123456');
    const ids = active.map((p) => p.id);

    expect(ids).toContain('feishu');
    expect(ids).toContain('devtool');
    expect(ids).toContain('reading');
    expect(ids).not.toContain('wechat'); // 微信插件不应在飞书页面激活
  });

  it('getActivePlugins: 针对微信公众平台 URL 智能激活 WechatPlugin + 全局插件', () => {
    const active = defaultPluginRegistry.getActivePlugins('https://mp.weixin.qq.com/cgi-bin/appmsg');
    const ids = active.map((p) => p.id);

    expect(ids).toContain('wechat');
    expect(ids).toContain('devtool');
    expect(ids).toContain('reading');
    expect(ids).not.toContain('feishu'); // 飞书插件不应在微信后台激活
  });

  it('buildDynamicSystemPrompt: 根据当前 URL 动态裁剪与注入专属提示词', () => {
    const feishuPrompt = defaultPluginRegistry.buildDynamicSystemPrompt('https://company.feishu.cn/wiki/doc');
    expect(feishuPrompt).toContain('飞书办公与文档生态专属能力');
    expect(feishuPrompt).not.toContain('微信公众号创作与草稿写入专属能力');

    const wechatPrompt = defaultPluginRegistry.buildDynamicSystemPrompt('https://mp.weixin.qq.com/appmsg');
    expect(wechatPrompt).toContain('微信公众号创作与草稿写入专属能力');
    expect(wechatPrompt).not.toContain('飞书办公与文档生态专属能力');
  });

  it('buildAgentSystem & buildAgentTools: 智能体系统提示词与工具列表动态组合', () => {
    const feishuSys = buildAgentSystem('https://feishu.cn/docx/test');
    expect(feishuSys).toContain('【核心基础能力】');
    expect(feishuSys).toContain('飞书办公与文档生态专属能力');

    const tools = buildAgentTools('https://feishu.cn/docx/test');
    expect(tools).toContain('exportDocMarkdown');
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
