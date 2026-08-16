// Agent 会话类型(ADR-0007/0008)。见 docs/design/agent.md §4.2、§7
import type { ToolCall, ToolResult } from '../domTools/types';
import type { ChatMessage } from './provider/types';

/** background → sidepanel 的 Agent 事件流 */
export type AgentEvent =
  | { type: 'agent-thinking'; text: string } // AI 推理文本(增量)
  | { type: 'tool-use'; call: ToolCall } // 即将执行某工具(展示)
  | { type: 'tool-result'; call: ToolCall; result: ToolResult } // 工具结果
  | { type: 'confirm-request'; confirmId: string; summary: string; tool: ToolCall } // 需用户确认
  | { type: 'confirm-result'; confirmId: string; approved: boolean }
  | { type: 'agent-done'; summary: string }
  | { type: 'text-delta'; text: string } // 复用文本增量(最终输出)
  | { type: 'done' }
  | { type: 'error'; message: string };

/** sidepanel → background 的 Agent 运行请求 */
export interface AgentRunPayload {
  /** 对话历史(不含 system;system 由 background 生成) */
  messages: ChatMessage[];
  providerId?: string;
  /** 工具执行目标标签页(由 sidepanel 启动时携带) */
  tabId: number;
  /** 当前激活标签页的实时标题与 URL 上下文 */
  currentTabInfo?: string;
  /** 当前激活标签页的完整 URL (用于插件精准匹配与动态提示词装配) */
  currentTabUrl?: string;
}
