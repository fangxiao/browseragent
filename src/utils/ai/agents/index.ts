// 场景配置:场景 = system 提示词 + 工具子集 + 完成约定(ADR-0008,见 docs/design/agent.md §9)。
// 纯配置层,不依赖 DOM;工具子集 ⊆ 注册表(listToolNames),由 driver 组装进 LLM。
import type { ScenarioId } from '../agentTypes';
import { listToolNames } from '../../domTools/toolRegistry';

export interface ScenarioConfig {
  /** 场景 system 提示词(背景 loop 发送) */
  system: string;
  /** 允许使用的工具子集(⊆ 注册表) */
  tools: string[];
  /** 完成约定:告诉 AI 何时算完成、如何收尾 */
  onDone: string;
  /** UI 展示名 */
  label: string;
  /** UI 展示说明 */
  description: string;
}

const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  dataExtract: {
    label: '数据提取',
    description: '从当前网页挖出数据并整理成表格/对比',
    tools: ['readPage', 'findElements', 'extractData', 'waitFor', 'getPageInfo', 'sleep'],
    system:
      '你是网页数据提取助手。用户给出目标,你通过工具(优先 readPage/findElements 观察定位,extractData 抽取)' +
      '从当前页面挖出目标数据,并按用户意图重组(表格化/对比/只留指定列,extractData 可传 columns 只取指定列)。' +
      '先观察再操作,避免盲目点击;只读操作,不改动页面状态。',
    onDone:
      '完成时输出重组后的最终结果,【用 Markdown 表格展示】(侧边栏会自动识别并提供 CSV 下载/复制)。' +
      '若数据行数很少,也可直接用文字/列表呈现。若数据不存在或无法提取,如实说明原因。',
  },
  formFill: {
    label: '表单填写',
    description: '自动填写网页表单,提交前等你确认',
    tools: ['readPage', 'findElements', 'typeInto', 'clickElement', 'scrollTo', 'waitFor', 'sleep'],
    system:
      '你是表单填写助手。用户给出目标,你逐字段填写表单。' +
      '先 readPage/findElements 找出表单的全部字段(input/textarea/select/checkbox/radio,注意 label/placeholder 语义),' +
      '再逐个 typeInto 填写:文本/数字直接输入;下拉框传要选的选项文本或值;复选框传 true/false;单选可 clickElement 点选。' +
      '填完一项核一项,字段缺失或可选时跳过并记录;不要臆造用户未给出的内容(如邮箱/密码)。',
    onDone:
      '全部字段填完后【停止在提交按钮前】,不要点击提交类按钮——那会触发用户确认,由用户决定。' +
      '向用户汇报:已填字段清单 + 未填/需用户确认的字段 + 下一步(如"所有字段已填好,点击提交请确认")。',
  },
  publish: {
    label: '多平台发布',
    description: '把内容发布到指定平台,每步发布前确认',
    tools: ['readPage', 'findElements', 'typeInto', 'clickElement', 'navigate', 'waitFor', 'sleep'],
    system:
      '你是多平台发布助手。用户给出内容与目标平台,你逐步操作每个平台的发布流程' +
      '(navigate 到平台 → readPage 确认登录态与发布入口 → 填内容 → 停在发布按钮前)。' +
      '注意:导航离开当前站点(navigate 跨域)会触发用户确认;每个平台的发布动作也会触发确认,请勿绕过。' +
      '未登录时如实说明需要用户先登录,不要尝试绕过后台。',
    onDone:
      '每个平台发布前必须停下来等待用户确认;发布完成后汇报"已发布到:平台1/平台2"。' +
      '若需要登录或页面异常,如实说明并停下,不要继续下一步。',
  },
  research: {
    label: '网页研究',
    description: '读取多个页面资料,汇总成结构化总结',
    tools: ['readPage', 'findElements', 'getPageInfo', 'navigate', 'waitFor', 'sleep'],
    system:
      '你是网页研究助手。用户给出研究目标,你读取相关页面资料(readPage/getPageInfo/navigate 跳转),' +
      '从多页汇总信息。只读操作,不做任何修改页面的动作。' +
      '注意:导航离开当前站点(navigate 跨域)会触发用户确认,合理规划访问顺序减少跨站跳转。',
    onDone:
      '完成时输出结构化 Markdown 总结:要点 / 对比 / 结论,引用来源页标题与 URL。' +
      '涉及多页同维度数据(价格/规格/评分)时,用 Markdown 表格对比(侧边栏可导出 CSV)。' +
      '若某页打不开或无相关内容,跳过并说明。',
  },
};

/** system 主体 + 完成约定(设计 §9:onDone 一并发给 AI,约束收尾行为) */
export function buildAgentSystem(scenario: ScenarioId): string {
  const c = SCENARIOS[scenario] ?? SCENARIOS.dataExtract;
  return `${c.system}\n\n【完成约定】${c.onDone}`;
}

export function buildScenarioTools(scenario: ScenarioId): string[] {
  return SCENARIOS[scenario]?.tools ?? SCENARIOS.dataExtract.tools;
}

/** 全部场景的 UI 元数据(侧边栏场景选择用) */
export function getScenarioMeta(): Array<{ id: ScenarioId } & Omit<ScenarioConfig, 'system' | 'tools' | 'onDone'>> {
  return (Object.keys(SCENARIOS) as ScenarioId[]).map((id) => ({
    id,
    label: SCENARIOS[id].label,
    description: SCENARIOS[id].description,
  }));
}

/** 校验:所有场景的工具子集都必须在注册表中(E3 单测用) */
export function assertScenarioToolsValid(): { invalid: Array<{ scenario: ScenarioId; tool: string }> } {
  const registered = new Set(listToolNames());
  const invalid: Array<{ scenario: ScenarioId; tool: string }> = [];
  for (const id of Object.keys(SCENARIOS) as ScenarioId[]) {
    for (const tool of SCENARIOS[id].tools) {
      if (!registered.has(tool)) invalid.push({ scenario: id, tool });
    }
  }
  return { invalid };
}
