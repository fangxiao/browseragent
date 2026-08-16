// 智能体插件注册中心与动态装配管理器 (Plugin Registry)
// 统一管理所有垂直插件生态，提供基于当前页面 URL 的上下文感知与动态 Prompt/Tool 装配

import type { BrowserAgentPlugin, QuickAction } from './types';
import type { ToolSpec } from '../utils/domTools/types';
import { FeishuPlugin } from './feishu';
import { WechatPlugin } from './wechat';
import { DevToolPlugin } from './devtool';
import { ReadingPlugin } from './reading';

export class PluginRegistry {
  private plugins = new Map<string, BrowserAgentPlugin>();

  constructor(initialPlugins: BrowserAgentPlugin[] = []) {
    for (const plugin of initialPlugins) {
      this.register(plugin);
    }
  }

  /** 注册插件 */
  register(plugin: BrowserAgentPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  /** 注销插件 */
  unregister(id: string): boolean {
    return this.plugins.delete(id);
  }

  /** 获取单个插件 */
  get(id: string): BrowserAgentPlugin | undefined {
    return this.plugins.get(id);
  }

  /** 获取所有已注册插件列表 */
  getAll(): BrowserAgentPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 根据当前页面 URL 智能计算出所有被激活的插件列表
   */
  getActivePlugins(currentUrl?: string): BrowserAgentPlugin[] {
    const active: BrowserAgentPlugin[] = [];
    const url = currentUrl || '';

    for (const plugin of this.plugins.values()) {
      if (!plugin.matchUrl || plugin.matchUrl(url)) {
        active.push(plugin);
      }
    }
    return active;
  }

  /**
   * 获取所有插件提供的聚合工具定义列表
   */
  getCombinedTools(currentUrl?: string): Omit<ToolSpec, 'execute'>[] {
    const tools: Omit<ToolSpec, 'execute'>[] = [];
    const seenNames = new Set<string>();

    // 优先加载当前匹配的活跃插件的工具，再加载全局插件工具
    const activePlugins = this.getActivePlugins(currentUrl);

    for (const plugin of activePlugins) {
      if (plugin.tools) {
        for (const tool of plugin.tools) {
          if (!seenNames.has(tool.name)) {
            seenNames.add(tool.name);
            tools.push(tool);
          }
        }
      }
    }

    return tools;
  }

  /**
   * 动态构建包含当前场景专属知识与规则的 System Prompt
   */
  buildDynamicSystemPrompt(currentUrl?: string): string {
    const activePlugins = this.getActivePlugins(currentUrl);
    const snippets = activePlugins
      .map((p) => p.systemPromptSnippet?.trim())
      .filter(Boolean) as string[];

    if (snippets.length === 0) {
      return '';
    }

    return snippets.join('\n\n');
  }

  /**
   * 获取当前上下文下的推荐快捷指令动作
   */
  getQuickActions(currentUrl?: string): QuickAction[] {
    const activePlugins = this.getActivePlugins(currentUrl);
    const actions: QuickAction[] = [];
    for (const plugin of activePlugins) {
      if (plugin.quickActions) {
        actions.push(...plugin.quickActions);
      }
    }
    return actions;
  }
}

/** 全局默认单例 Plugin Registry (默认内置 4 大生态插件) */
export const defaultPluginRegistry = new PluginRegistry([
  FeishuPlugin,
  WechatPlugin,
  DevToolPlugin,
  ReadingPlugin,
]);
