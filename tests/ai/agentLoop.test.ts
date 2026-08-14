import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../../src/utils/ai/agentLoop';
import type { StreamEvent } from '../../src/utils/ai/provider/types';
import type { ToolCall } from '../../src/utils/domTools/types';
import type { AgentEvent } from '../../src/utils/ai/agentTypes';

/** fake provider:按回合产出事件序列 */
type TurnProducer = () => StreamEvent[];

async function run(
  turns: TurnProducer[],
  opts: {
    onTool?: (call: ToolCall) => { result: { ok: boolean; data?: unknown; error?: string } } | null;
    requestConfirm?: (call: ToolCall) => boolean;
    maxSteps?: number;
  } = {},
) {
  const events: AgentEvent[] = [];
  let step = 0;
  await runAgentLoop({
    maxSteps: opts.maxSteps ?? 10,
    streamTurn: async () => {
      const t = turns[Math.min(step, turns.length - 1)]!;
      step++;
      return t();
    },
    executeTool: async (call) => {
      const r = opts.onTool?.(call) ?? { result: { ok: true, data: { done: call.name } } };
      return r.result;
    },
    requestConfirm: opts.requestConfirm ? async (c) => opts.requestConfirm!(c) : async () => true,
    emit: (e) => events.push(e),
  });
  return { events, steps: step };
}

const toolUse = (name: string, args: Record<string, unknown> = {}): StreamEvent => ({
  type: 'tool-use',
  call: { id: `c_${name}`, name, args },
});

describe('agentLoop(薄 loop 编排)', () => {
  it('单回合完成:thinking → tool-use → tool-result → done', async () => {
    const { events } = await run([
      () => [
        { type: 'text-delta', text: '我看一下页面' },
        toolUse('readPage'),
      ],
      () => [{ type: 'text-delta', text: '完成,提取如下' }, { type: 'done' }],
    ]);
    const kinds = events.map((e) => e.type);
    expect(kinds).toContain('agent-thinking');
    expect(kinds).toContain('tool-use');
    expect(kinds).toContain('tool-result');
    expect(events.at(-1)!.type).toBe('agent-done');
  });

  it('工具结果回填后继续循环,直至 done', async () => {
    let calls = 0;
    const { events } = await run(
      [
        () => [toolUse('clickElement', { selector: '#next' })],
        () => [toolUse('extractData', { selector: 'table' })],
        () => [{ type: 'text-delta', text: '结果如下' }, { type: 'done' }],
      ],
      { onTool: () => { calls++; return { result: { ok: true, data: { n: calls } } }; } },
    );
    expect(calls).toBe(2);
    expect(events.filter((e) => e.type === 'tool-result').length).toBe(2);
    expect(events.at(-1)!.type).toBe('agent-done');
  });

  it('敏感操作:执行前先 confirm-request,批准后执行', async () => {
    let executed = false;
    const { events } = await run([
      () => [toolUse('clickElement', { selector: '提交' })],
      () => [{ type: 'text-delta', text: '已提交' }, { type: 'done' }],
    ], {
      onTool: () => { executed = true; return { result: { ok: true, data: {} } }; },
    });
    expect(events.some((e) => e.type === 'confirm-request')).toBe(true);
    expect(executed).toBe(true);
  });

  it('用户拒绝敏感操作:结果回填失败,不再执行', async () => {
    let executed = false;
    const { events } = await run([
      () => [toolUse('clickElement', { selector: '删除' })],
      () => [{ type: 'text-delta', text: '已删除' }, { type: 'done' }],
    ], {
      requestConfirm: () => false, // 用户拒绝
      onTool: () => { executed = true; return { result: { ok: true, data: {} } }; },
    });
    expect(executed).toBe(false);
    const denied = events.find((e) => e.type === 'tool-result');
    expect(denied && denied.type === 'tool-result' && denied.result.ok).toBe(false);
  });

  it('达到 maxSteps 停止,不发 done', async () => {
    const { events, steps } = await run(
      [() => [toolUse('readPage')]],
      { maxSteps: 3 },
    );
    expect(steps).toBeLessThanOrEqual(3);
    expect(events.at(-1)!.type).toBe('error'); // 超限报错结束
  });

  it('工具执行失败:error 回填给 LLM,循环继续', async () => {
    let calls = 0;
    const { events } = await run(
      [
        () => [toolUse('clickElement')],
        () => [{ type: 'text-delta', text: '换个方式' }, { type: 'done' }],
      ],
      {
        onTool: () => { calls++; return { result: { ok: false, error: '未找到元素' } }; },
      },
    );
    expect(calls).toBe(1);
    const failed = events.find((e) => e.type === 'tool-result');
    expect(failed && failed.type === 'tool-result' && failed.result.ok).toBe(false);
    expect(events.at(-1)!.type).toBe('agent-done');
  });
});
