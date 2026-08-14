// 薄 loop 编排(纯逻辑,注入依赖可测)。见 docs/design/agent.md §7.2、ADR-0008
// 职责:消费 provider 事件流 → 判定工具调用 → 安全确认 → 执行 → 回填 → 继续,直到完成/超限。
import type { ToolCall, ToolResult } from '../domTools/types';
import type { ChatMessage, StreamEvent } from './provider/types';
import { isSensitiveToolCall } from '../domTools/safety';
import type { AgentEvent } from './agentTypes';

export interface AgentLoopDeps {
  /** 一轮 provider 流;返回该轮全部事件 */
  streamTurn: (messages: ChatMessage[]) => Promise<StreamEvent[]>;
  /** 执行工具(经 content) */
  executeTool: (call: ToolCall) => Promise<ToolResult>;
  /** 敏感操作确认;返回是否批准。confirmId 用于与 sidepanel 的 AGENT:CONFIRM 关联 */
  requestConfirm: (call: ToolCall, reason: string, confirmId: string) => Promise<boolean>;
  /** 推送给 sidepanel 的事件 */
  emit: (e: AgentEvent) => void;
  /** 当前页面 origin(navigate 跨域判定用,由 background 注入) */
  getCurrentOrigin?: () => string;
  /** 循环上限,默认 25 */
  maxSteps?: number;
}

export async function runAgentLoop(deps: AgentLoopDeps): Promise<void> {
  const maxSteps = deps.maxSteps ?? 25;
  const messages: ChatMessage[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const events = await deps.streamTurn(messages);
    let text = '';
    const calls: ToolCall[] = [];
    let done = false;

    for (const ev of events) {
      if (ev.type === 'text-delta') text += ev.text;
      else if (ev.type === 'tool-use') calls.push(ev.call);
      else if (ev.type === 'done') done = true;
      else if (ev.type === 'error') {
        deps.emit({ type: 'error', message: ev.message });
        return;
      }
    }

    if (calls.length > 0) {
      if (text) deps.emit({ type: 'agent-thinking', text });
      for (const call of calls) {
        deps.emit({ type: 'tool-use', call });
        const verdict = isSensitiveToolCall(call, { currentOrigin: deps.getCurrentOrigin?.() });
        let result: ToolResult;
        if (verdict.sensitive) {
          const confirmId = `cf_${step}_${call.id}`;
          deps.emit({ type: 'confirm-request', confirmId, summary: verdict.reason ?? call.name, tool: call });
          const approved = await deps.requestConfirm(call, verdict.reason ?? '', confirmId);
          deps.emit({ type: 'confirm-result', confirmId, approved });
          if (!approved) {
            result = { ok: false, error: '用户拒绝了该操作' };
          } else {
            result = await deps.executeTool(call);
          }
        } else {
          result = await deps.executeTool(call);
        }
        deps.emit({ type: 'tool-result', call, result });
        // 回填:assistant 工具调用 + tool 结果(OpenAI 风格,provider 适配层转换)
        messages.push({ role: 'assistant', content: text });
        messages.push({
          role: 'user',
          content: JSON.stringify({ tool_call: call, result }),
        });
      }
      continue; // 有工具调用,进入下一轮
    }

    // 无工具调用 → 最终输出
    if (done || text) {
      deps.emit({ type: 'agent-done', summary: text });
      return;
    }
  }

  deps.emit({ type: 'error', message: `达到最大步数(${maxSteps}),已停止` });
}
