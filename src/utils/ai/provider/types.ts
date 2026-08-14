// AI provider 抽象层类型。见 docs/design/design.md §3.2、ADR-0003
import type { DocTypeId } from '../docType';
import type { ToolCall, ToolSchema } from '../../domTools/types';

export type ProviderKind = 'anthropic' | 'deepseek' | 'openai-compat';

/** AI 能力 ID(对应需求 T1-T6) */
export type CapabilityId =
  | 'review' // T1 需求评审
  | 'complete' // T2 周报/月报补全
  | 'actionItems' // T3 会议纪要待办提炼(M2)
  | 'riskReview' // T4 技术方案风险评审(M2)
  | 'structure' // T5 复盘结构补全(M2)
  | 'polish' // T6 润色
  | 'translate' // T6 翻译
  | 'summary' // T6 摘要
  | 'outline'; // T6 大纲

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiSettings {
  providers: ProviderConfig[];
  activeProviderId: string;
  /** 单文档发送上限(字符),超出提示用户 */
  maxDocChars: number;
  confirmOnSend: boolean;
  rememberSession: boolean;
  /** 本会话已确认信任(隐私 FR-5.1) */
  trustedSession: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamRequest {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  /** function calling 工具(Agent 会话;ADR-0007/0008) */
  tools?: ToolSchema[];
}

/** 统一流事件(ADR-0003);tool-use 供 Agent 会话(ADR-0007) */
export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-use'; call: ToolCall }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ProviderClient {
  readonly kind: ProviderKind;
  stream(req: StreamRequest, opts: { baseUrl: string; apiKey: string }): AsyncIterable<StreamEvent>;
}

/** background 收到的 AI 运行请求(经 port)。对话式:完整历史消息,首轮 user 已含文档与指令 */
export interface AiRunPayload {
  capability: CapabilityId;
  /** 对话历史(不含 system;system 由 background 按 capability 生成) */
  messages: ChatMessage[];
  providerId?: string;
}
