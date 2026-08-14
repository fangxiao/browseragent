// E3 场景配置单测(设计 §9、§11):每场景 system 非空 / 工具子集 ⊆ 注册表 / 元数据完整。
import { describe, expect, it } from 'vitest';
import {
  buildAgentSystem,
  buildScenarioTools,
  getScenarioMeta,
  getScenarioLabel,
  assertScenarioToolsValid,
} from '../../src/utils/ai/agents';
import { listToolNames, toLlmTools } from '../../src/utils/domTools/toolRegistry';
import type { ScenarioId } from '../../src/utils/ai/agentTypes';

const SCENARIOS: ScenarioId[] = ['dataExtract', 'formFill', 'publish', 'research'];

describe('agents(场景配置)', () => {
  it('覆盖全部 4 个场景', () => {
    expect(SCENARIOS.every((s) => getScenarioMeta().some((m) => m.id === s))).toBe(true);
  });

  it('每场景 system 非空', () => {
    for (const s of SCENARIOS) {
      expect(buildAgentSystem(s).length).toBeGreaterThan(50);
    }
  });

  it('每场景工具子集 ⊆ 注册表', () => {
    const { invalid } = assertScenarioToolsValid();
    expect(invalid).toEqual([]);
  });

  it('每场景工具子集非空且可被 toLlmTools 过滤', () => {
    for (const s of SCENARIOS) {
      const tools = buildScenarioTools(s);
      expect(tools.length).toBeGreaterThan(0);
      const llm = toLlmTools(tools).map((t) => t.name);
      expect(llm.every((n) => tools.includes(n))).toBe(true);
      expect(tools.every((n) => listToolNames().includes(n))).toBe(true);
    }
  });

  it('每场景有 label / description(onDone 组装用)', () => {
    for (const m of getScenarioMeta()) {
      expect(m.label).toBeTruthy();
      expect(m.description).toBeTruthy();
    }
  });

  it('未知场景回退到 dataExtract', () => {
    expect(buildAgentSystem('bogus' as ScenarioId)).toBe(buildAgentSystem('dataExtract'));
    expect(buildScenarioTools('bogus' as ScenarioId)).toEqual(buildScenarioTools('dataExtract'));
  });

  it('buildAgentSystem 拼接完成约定(onDone 进入 system)', () => {
    for (const s of SCENARIOS) {
      expect(buildAgentSystem(s)).toContain('【完成约定】');
    }
  });

  it('formFill:提示词强调停在提交前等确认', () => {
    const s = buildAgentSystem('formFill');
    expect(s).toContain('提交');
    expect(s).toContain('确认');
    expect(s).toContain('typeInto');
  });

  it('dataExtract:提示词强调 Markdown 表格输出(供导出)', () => {
    const s = buildAgentSystem('dataExtract');
    expect(s).toContain('Markdown');
    expect(s).toContain('CSV');
  });

  it('publish:提示词强调每平台发布前确认 + 跨站导航确认', () => {
    const s = buildAgentSystem('publish');
    expect(s).toContain('确认');
    expect(s).toContain('navigate');
    expect(s).toContain('登录');
  });

  it('research:提示词强调多页汇总 + 对比表格(重组)', () => {
    const s = buildAgentSystem('research');
    expect(s).toContain('Markdown');
    expect(s).toContain('对比');
    expect(s).toContain('引用');
  });

  it('general:通用助手 system 含全部能力介绍 + 问好引导,全工具集(UI 默认场景)', () => {
    const s = buildAgentSystem('general');
    expect(s).toContain('数据提取');
    expect(s).toContain('表单填写');
    expect(s).toContain('多平台发布');
    expect(s).toContain('网页研究');
    expect(s).toContain('问好');
    expect(buildScenarioTools('general').length).toBe(listToolNames().length - 1); // 不含 evaluate
    expect(getScenarioLabel('general')).toBe('通用助手');
    expect(getScenarioLabel('dataExtract')).toBe('数据提取');
  });

  it('general:evaluate 默认不暴露,且提示优先在当前页面', () => {
    const tools = buildScenarioTools('general');
    expect(tools).not.toContain('evaluate');
    expect(tools.length).toBe(listToolNames().length - 1);
    expect(buildAgentSystem('general')).toContain('优先在当前页面');
  });

  it('general:提示懒加载滚动加载策略', () => {
    expect(buildAgentSystem('general')).toContain('懒加载');
    expect(buildAgentSystem('general')).toContain('scrollTo');
    expect(buildAgentSystem('general')).toContain('textLimit');
  });

  it('general:要求用通俗的话与用户沟通(不甩技术词)', () => {
    const s = buildAgentSystem('general');
    expect(s).toContain('与用户沟通');
    expect(s).toContain('通俗');
    expect(s).toContain('需要你先登录');
  });
});
