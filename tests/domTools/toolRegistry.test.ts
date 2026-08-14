import { describe, expect, it } from 'vitest';
import {
  getTool,
  listToolNames,
  validateArgs,
  toLlmTools,
} from '../../src/utils/domTools/toolRegistry';

describe('toolRegistry(工具注册表)', () => {
  it('listToolNames:包含 v2 全部工具', () => {
    const names = listToolNames();
    for (const n of ['getPageInfo', 'readPage', 'findElements', 'clickElement', 'typeInto', 'scrollTo', 'waitFor', 'sleep', 'extractData', 'navigate', 'evaluate']) {
      expect(names).toContain(n);
    }
  });

  it('getTool:未知工具返回 undefined', () => {
    expect(getTool('notATool')).toBeUndefined();
    expect(getTool('readPage')?.name).toBe('readPage');
  });

  it('validateArgs:必填校验', () => {
    const click = getTool('clickElement')!;
    expect(validateArgs(click, { selector: '#btn' })).toBe(true);
    expect(validateArgs(click, {})).toBe(false);
  });

  it('validateArgs:typeInto 需 selector+text', () => {
    const type = getTool('typeInto')!;
    expect(validateArgs(type, { selector: '#a', text: 'hi' })).toBe(true);
    expect(validateArgs(type, { selector: '#a' })).toBe(false);
    expect(validateArgs(type, { text: 'hi' })).toBe(false);
  });

  it('toLlmTools:导出 {name, description, input_schema} 供 function calling', () => {
    const tools = toLlmTools();
    expect(tools.length).toBe(listToolNames().length);
    for (const t of tools) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.input_schema).toBeTypeOf('object');
    }
  });

  it('toLlmTools(filter):仅导出子集内工具', () => {
    const tools = toLlmTools(['readPage', 'extractData']);
    expect(tools.map((t) => t.name).sort()).toEqual(['extractData', 'readPage']);
  });

  it('toLlmTools(filter):未知工具名被忽略,不抛错', () => {
    const tools = toLlmTools(['readPage', 'notATool']);
    expect(tools.map((t) => t.name)).toEqual(['readPage']);
  });
});
