// 浏览器智能体插件规范 (Browser Agent Plugin Interface)
// 支撑飞书生态、微信生态、技术研发/测试生态、泛阅读生态的模块化解耦与动态装配

import type { ToolSpec, ToolResult } from '../utils/domTools/types';

export interface QuickAction {
  id: string;
  label: string;
  prompt: string;
  icon?: string;
  description?: string;
}

export interface BrowserAgentPlugin {
  /** 插件唯一英文标识符，例如 'feishu', 'wechat', 'devtool', 'reading' */
  id: string;
  /** 插件展示名称，例如 '飞书办公生态 Pro' */
  name: string;
  /** 插件简短描述 */
  description: string;
  /** 插件图标 (Emoji 或 SVG) */
  icon: string;
  /** 版本号 */
  version?: string;

  /**
   * 自动感知激活规则 (URL 正则 / 域名匹配)
   * 若不提供则视为全局通用插件 (全网激活)
   */
  matchUrl?: (url: string) => boolean;

  /**
   * 该插件提供的专属工具定义列表 (Tool Metadata)
   */
  tools?: Omit<ToolSpec, 'execute'>[];

  /**
   * 工具的具体执行实现 (Executors)
   */
  executors?: Record<
    string,
    (args: Record<string, unknown>, tabId?: number) => Promise<ToolResult>
  >;

  /**
   * 注入到大模型 System Prompt 中的专属领域指令与知识规则
   */
  systemPromptSnippet?: string;

  /**
   * 当前插件推荐的快捷动作指令列表 (可在侧边栏动态高亮)
   */
  quickActions?: QuickAction[];
}
