// Agent 会话类型(ADR-0007/0008)。见 docs/design/agent.md §4.2、§7
import type { ToolCall, ToolResult } from '../domTools/types';
import type { ChatMessage } from './provider/types';

/** general = 通用助手(默认,AI 自主判断任务,见 agents/index.ts);其余为细分场景(UI 不再暴露) */
export type ScenarioId = 'general' | 'dataExtract' | 'formFill' | 'publish' | 'research';

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
  scenario: ScenarioId;
  /** 对话历史(不含 system;system 由 background 按场景生成) */
  messages: ChatMessage[];
  providerId?: string;
  /** 工具执行目标标签页(由 sidepanel 启动时携带) */
  tabId: number;
}
