// 通用智能体提示词与工具配置单测。
import { describe, expect, it } from 'vitest';
import { buildAgentSystem, buildAgentTools } from '../../src/utils/ai/agents';
import { listToolNames, toLlmTools } from '../../src/utils/domTools/toolRegistry';

describe('agents(通用智能体配置)', () => {
  it('buildAgentSystem 返回非空完整的通用系统提示词', () => {
    const s = buildAgentSystem();
    expect(s.length).toBeGreaterThan(100);
    expect(s).toContain('通用 AI 浏览器操作助手');
    expect(s).toContain('readPage');
    expect(s).toContain('listTabs');
    expect(s).toContain('跨标签页');
    expect(s).toContain('findElements');
    expect(s).toContain('clickElement');
    expect(s).toContain('typeInto');
    expect(s).toContain('extractData');
    expect(s).toContain('Markdown');
    expect(s).toContain('懒加载');
  });

  it('buildAgentSystem 包含严格的安全规则与表单守则', () => {
    const s = buildAgentSystem();
    expect(s).toContain('敏感操作');
    expect(s).toContain('确认');
    expect(s).toContain('严禁虚构');
    expect(s).toContain('停留在提交按钮前');
  });

  it('buildAgentTools 返回合法工具子集且默认不含 evaluate', () => {
    const tools = buildAgentTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools).not.toContain('evaluate');
    expect(tools.length).toBe(listToolNames().length - 1);
    expect(tools.every((n) => listToolNames().includes(n))).toBe(true);
  });

  it('buildAgentTools 可直接传给 toLlmTools 格式化', () => {
    const tools = buildAgentTools();
    const llm = toLlmTools(tools);
    expect(llm.length).toBe(tools.length);
    expect(llm.every((t) => tools.includes(t.name))).toBe(true);
  });
});
