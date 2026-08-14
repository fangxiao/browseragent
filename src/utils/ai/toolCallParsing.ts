// provider tool_use / tool_calls 解析归一化(纯逻辑,单测覆盖)。
// 流式解析需要跨事件累积,故为有状态累积器;ANTHROPIC 与 OpenAI 兼容格式分开实现。
// 见 docs/design/agent.md §7.3
import type { ToolCall } from '../domTools/types';

function safeParseArgs(input: string): Record<string, unknown> {
  if (!input.trim()) return {};
  try {
    const v = JSON.parse(input);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {}; // 非法 JSON 容错
  }
}

/** Anthropic:content_block_start(tool_use) → input_json_delta 累积 → content_block_stop 产出 */
export class AnthropicToolUseParser {
  private cur: { id: string; name: string; input: string } | null = null;
  private out: ToolCall[] = [];

  feed(json: Record<string, unknown>): void {
    if (json.type === 'content_block_start' && (json.content_block as any)?.type === 'tool_use') {
      const cb = json.content_block as { id: string; name: string };
      this.cur = { id: cb.id, name: cb.name, input: '' };
      return;
    }
    if (json.type === 'content_block_delta' && (json.delta as any)?.type === 'input_json_delta' && this.cur) {
      this.cur.input += (json.delta as { partial_json?: string }).partial_json ?? '';
      return;
    }
    if (json.type === 'content_block_stop' && this.cur) {
      const { id, name, input } = this.cur;
      this.cur = null;
      this.out.push({ id, name, args: safeParseArgs(input) });
    }
  }

  /** 取出已完成的所有 ToolCall(消费后清空) */
  take(): ToolCall[] {
    const r = this.out;
    this.out = [];
    return r;
  }
}

/** OpenAI 兼容:delta.tool_calls[].index 累积,finish_reason=tool_calls 时产出 */
export class OpenAIToolCallParser {
  private byIndex = new Map<number, { id: string; name: string; args: string }>();
  private out: ToolCall[] = [];
  private finished = false;

  feed(json: Record<string, unknown>): void {
    if (this.finished) return;
    const choice = (json as any)?.choices?.[0];
    if (!choice) return;
    const deltas = choice?.delta?.tool_calls;
    if (Array.isArray(deltas)) {
      for (const d of deltas) {
        const idx = d.index ?? 0;
        const acc = this.byIndex.get(idx) ?? { id: '', name: '', args: '' };
        if (d.id) acc.id = d.id;
        if (d.function?.name) acc.name = d.function.name;
        if (d.function?.arguments) acc.args += d.function.arguments;
        this.byIndex.set(idx, acc);
      }
    }
    if (choice.finish_reason === 'tool_calls') {
      this.finished = true;
      const indices = [...this.byIndex.keys()].sort((a, b) => a - b);
      for (const i of indices) {
        const c = this.byIndex.get(i)!;
        this.out.push({ id: c.id, name: c.name, args: safeParseArgs(c.args) });
      }
    }
  }

  take(): ToolCall[] {
    const r = this.out;
    this.out = [];
    return r;
  }
}

/** 统一入口:按 provider 选择解析器 */
export function createToolCallParser(kind: 'anthropic' | 'deepseek' | 'openai-compat') {
  return kind === 'anthropic' ? new AnthropicToolUseParser() : new OpenAIToolCallParser();
}
