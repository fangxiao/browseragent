// Agent 大脑抽象(ADR-0008):薄 loop 是默认实现,成熟 agent 可平滑替换。
// 见 docs/design/agent.md §7.1
import type { ToolCall, ToolResult } from '../domTools/types';
import type { ChatMessage, StreamEvent } from './provider/types';
import { runAgentLoop } from './agentLoop';
import type { AgentEvent, AgentRunPayload } from './agentTypes';
import { buildAgentSystem, buildScenarioTools } from './agents';
import { toLlmTools } from '../domTools/toolRegistry';

export interface AgentHooks {
  onEvent(e: AgentEvent): void;
  /** 执行工具(经 content;navigate 由 background 处理) */
  executeTool(call: ToolCall): Promise<ToolResult>;
  /** 敏感操作确认;返回是否批准 */
  requestConfirm(call: ToolCall, reason: string, confirmId: string): Promise<boolean>;
  /** 当前页面 origin(navigate 跨域判定,background 注入) */
  getCurrentOrigin?(): string;
  /** 提供流信号(停止用) */
  signal(): AbortSignal;
}

export interface AgentDriver {
  run(req: AgentRunPayload, hooks: AgentHooks): Promise<void>;
}

/**
 * 薄 loop 默认实现:多 provider function calling。
 * 依赖注入:streamProvider 由调用方(background)按 provider 配置构建。
 */
export function createThinLoopDriver(deps: {
  streamProvider: (
    opts: { messages: ChatMessage[]; tools: ReturnType<typeof toLlmTools>; signal: AbortSignal },
  ) => AsyncIterable<StreamEvent>;
}): AgentDriver {
  return {
    async run(req, hooks) {
      const system = buildAgentSystem(req.scenario);
      const initial: ChatMessage[] = [{ role: 'system', content: system }, ...req.messages];
      // 场景工具子集(设计 §9):只暴露该场景允许的工具
      const tools = toLlmTools(buildScenarioTools(req.scenario));
      await runAgentLoop({
        streamTurn: async (messages) => {
          // 每轮带 system + 历史 + 回填的工具结果
          const all: ChatMessage[] = [...initial, ...messages];
          const out: StreamEvent[] = [];
          for await (const ev of deps.streamProvider({ messages: all, tools, signal: hooks.signal() })) {
            out.push(ev);
          }
          return out;
        },
        executeTool: hooks.executeTool,
        requestConfirm: hooks.requestConfirm,
        getCurrentOrigin: hooks.getCurrentOrigin,
        emit: hooks.onEvent,
      });
    },
  };
}
