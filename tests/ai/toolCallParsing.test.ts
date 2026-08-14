import { describe, expect, it } from 'vitest';
import { AnthropicToolUseParser, OpenAIToolCallParser } from '../../src/utils/ai/toolCallParsing';

describe('toolCallParsing(provider tool_use 归一化)', () => {
  it('Anthropic:累积 content_block_start/delta/stop 产出 ToolCall', () => {
    const p = new AnthropicToolUseParser();
    p.feed({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tu_1', name: 'readPage', input: {} },
    });
    p.feed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"sel' } });
    p.feed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'ector":"#x"}' } });
    p.feed({ type: 'content_block_stop', index: 0 });

    const calls = p.take();
    expect(calls).toEqual([{ id: 'tu_1', name: 'readPage', args: { selector: '#x' } }]);
  });

  it('Anthropic:多工具调用逐一产出', () => {
    const p = new AnthropicToolUseParser();
    for (const [id, name] of [['a', 'clickElement'], ['b', 'typeInto']] as const) {
      p.feed({ type: 'content_block_start', content_block: { type: 'tool_use', id, name, input: {} } });
      p.feed({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } });
      p.feed({ type: 'content_block_stop' });
    }
    expect(p.take().map((c) => c.name)).toEqual(['clickElement', 'typeInto']);
  });

  it('Anthropic:非法 JSON args 容错为空对象', () => {
    const p = new AnthropicToolUseParser();
    p.feed({ type: 'content_block_start', content_block: { type: 'tool_use', id: 'x', name: 'evaluate', input: {} } });
    p.feed({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'not json' } });
    p.feed({ type: 'content_block_stop' });
    expect(p.take()[0]!.args).toEqual({});
  });

  it('OpenAI:按 index 累积 tool_calls delta 片段', () => {
    const p = new OpenAIToolCallParser();
    p.feed({
      choices: [
        { delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'clickElement', arguments: '' } }] } },
      ],
    });
    p.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"sel' } }] } }] });
    p.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ector":"#btn"}' } }] } }] });
    p.feed({ choices: [{ finish_reason: 'tool_calls' }] });

    const calls = p.take();
    expect(calls).toEqual([{ id: 'call_1', name: 'clickElement', args: { selector: '#btn' } }]);
  });

  it('OpenAI:finish 之前 take 为空(未收尾不产出)', () => {
    const p = new OpenAIToolCallParser();
    p.feed({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'sleep', arguments: '{"ms":1}' } }] } }] });
    expect(p.take()).toEqual([]);
    p.feed({ choices: [{ finish_reason: 'tool_calls' }] });
    expect(p.take().length).toBe(1);
  });
});
