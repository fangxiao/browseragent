// content ↔ background ↔ sidepanel 消息协议。见 docs/design/design.md §3.3、docs/design/agent.md §5
import type { AiSettings } from './ai/provider/types';
import type { AiRunPayload, StreamEvent } from './ai/provider/types';
import type { DocContent } from './pageExtract/types';
import type { ToolCall, ToolResult } from './domTools/types';
import type { AgentEvent, AgentRunPayload } from './ai/agentTypes';

/** content ↔ sidepanel 提取请求 */
export type ExtractRequest = { type: 'EXTRACT:REQUEST' };
export type ExtractResponse =
  | { type: 'EXTRACT:RESULT'; doc: DocContent }
  | { type: 'EXTRACT:ERROR'; message: string };

/** 写回请求(富文本插入,ADR-0004 更新) */
export type WritebackRequest =
  | { type: 'WRITEBACK:APPEND'; html: string }
  | { type: 'WRITEBACK:CURSOR'; html: string };
export type WritebackResponse = { type: 'WRITEBACK:RESULT'; ok: boolean; message: string };

/** v2 通用 DOM 工具执行(background → content,ADR-0007) */
export type ToolRequest = { type: 'TOOL:CALL'; call: ToolCall };
export type ToolResponse = { type: 'TOOL:RESULT'; callId: string; result: ToolResult };

export type BgRequest =
  | { type: 'SETTINGS:GET' }
  | { type: 'SETTINGS:SAVE'; settings: AiSettings }
  | { type: 'OPEN_SIDEPANEL' };

export type BgResponse =
  | { type: 'SETTINGS:RESULT'; settings: AiSettings }
  | { type: 'OK' }
  | { type: 'ERROR'; message: string };

/** 经 Port 流式推送(M1 对话流) */
export interface PortStreamMessage {
  type: 'AI:EVENT';
  event: StreamEvent;
}

export interface PortStartMessage {
  type: 'AI:START';
  payload: AiRunPayload;
}

/** Agent 会话端口消息(sidepanel ↔ background,ADR-0007) */
export type AgentPortMessage =
  | { type: 'AGENT:START'; payload: AgentRunPayload }
  | { type: 'AGENT:EVENT'; event: AgentEvent }
  | { type: 'AGENT:CONFIRM'; confirmId: string; approved: boolean }
  | { type: 'AGENT:STOP' };

export const STREAM_PORT_NAME = 'ai-stream';
export const AGENT_PORT_NAME = 'agent-stream';
