// AI RPA 习惯归纳引擎 (Skill & Habit Distillation Synthesizer)
// 将用户的单次操作示范 (One-shot Demonstration) 结合页面 DOM 结构提炼为可复用、带循环泛化能力的 RPA Skill
import type {
  CapturedAction,
  WorkflowStep,
  DistilledHabit,
  RecipeParameter,
  TestAssertion,
} from './types';
export type { DistilledHabit } from './types';
import type { AiSettings, ChatMessage } from '../ai/provider/types';
import { getClient } from '../ai/provider';
import { getSettings } from '../storage';

import { buildWorkflowSteps } from './recorder';

const NTH_REGEX = /:(nth-of-type|nth-child)\(\d+\)/g;

/** 清理选择器中的 nth 索引，泛化为列表项通用选择器 */
export function generalizeSelector(sel: string): string {
  if (!sel) return '';
  return sel.replace(NTH_REGEX, '').replace(/\s*>\s*>\s*/g, ' > ').trim();
}

/** 启发式快速归纳 (用于离线/无模型时的秒级兜底) */
export function distillHabitHeuristic(
  actions: CapturedAction[],
  steps: WorkflowStep[],
  startUrl = '',
): DistilledHabit {
  const isLoopInducted = steps.some((s) => s.isLoop);

  // 1. 检查是否存在同构列表项/表格行的操作特征
  // 严格区分：顶部导航/菜单/标签页 (pre-actions) vs 真正的数据列表行 (candidate row action)
  const isNavAction = (act: CapturedAction) =>
    /nav|header|aside|sidebar|menu|breadcrumb|\btabs?\b|\.tab/i.test(act.selector) ||
    /^(首页|工作台|返回|菜单|系统设置|导航|切换)$/i.test(act.targetText?.trim() || '');

  const isDataRowAction = (act: CapturedAction) => {
    if (isNavAction(act)) return false;
    const hasNth = /:(nth-of-type|nth-child)\(\d+\)/.test(act.selector);
    const isTableOrList =
      /table|tbody|tr|td|\.ant-table|\.el-table|data-row|grid-cell|\.list-item|\.card-item/i.test(act.selector) ||
      /table|tbody|tr|td/i.test(act.tag);
    return hasNth || isTableOrList;
  };

  let candidateRowAction: CapturedAction | null = null;
  let candidateRowIndex = -1;

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i]!;
    if (isDataRowAction(act)) {
      candidateRowAction = act;
      candidateRowIndex = i;
      break;
    }
  }

  const isBatch =
    isLoopInducted ||
    (candidateRowAction !== null && actions.length > candidateRowIndex + 1) ||
    (candidateRowAction !== null && actions.length === 1);

  // 提取动态参数 (如用户输入了"同意"、"通过"等)
  const parameters: RecipeParameter[] = [];
  const typeAction = actions.find((a) => a.type === 'type' && a.value && a.value.trim().length > 0);
  if (typeAction && typeAction.value) {
    const key = /审批|意见|理由|备注|comment|reason/i.test(typeAction.targetText || '')
      ? 'approvalComment'
      : 'inputValue';
    const label = typeAction.targetText || '输入内容';
    parameters.push({
      key,
      label,
      defaultValue: typeAction.value,
      description: `针对单项操作时填入的${label}`,
    });
  }

  // 构造断言清单
  const assertions: TestAssertion[] = [];
  if (isBatch) {
    assertions.push({
      id: `as_distill_loop_${Date.now()}`,
      type: 'element_visible',
      target: 'table, .ant-table, .ant-list, ul.list, .el-table',
      description: '成功定位并展示目标记录列表/表格',
    });
  }

  const textKeywords = steps
    .map((s) => s.targetText?.trim())
    .filter((t): t is string => Boolean(t && t.length >= 2 && !/^(svg|button|div|span|input|click)$/i.test(t)));
  Array.from(new Set(textKeywords)).slice(0, 3).forEach((kw, idx) => {
    assertions.push({
      id: `as_distill_${Date.now()}_${idx}`,
      type: 'text_contains',
      target: kw,
      description: `页面成功渲染并包含「${kw}」`,
    });
  });

  // 如果识别为批量处理习惯
  if (isBatch && candidateRowAction && candidateRowIndex >= 0) {
    const rawSel = candidateRowAction.selector;
    const genSelector = generalizeSelector(rawSel) || 'table tbody tr';
    const listName = candidateRowAction.targetText ? `${candidateRowAction.targetText}所在列表` : '数据列表';

    // 1. 保留列表项之前的页面导航/菜单点击前置步骤 (Pre-steps)
    const preActions = actions.slice(0, candidateRowIndex);
    const preSteps = preActions.length > 0 ? buildWorkflowSteps(preActions) : [];

    // 2. 提炼单项子步骤序列 (Sub-steps)
    const subActions = actions.slice(candidateRowIndex);
    const subSteps: WorkflowStep[] = subActions.map((act, i) => {
      let desc = '';
      let val = act.value;
      if (act.type === 'click') {
        desc = act.targetText ? `点击「${act.targetText}」` : `点击操作元素`;
      } else if (act.type === 'type') {
        desc = act.targetText ? `输入「{{${parameters[0]?.key || 'value'}}}」` : `输入内容`;
        val = `{{${parameters[0]?.key || 'value'}}}`;
      } else if (act.type === 'pressEnter') {
        desc = `按下回车确认`;
      }
      return {
        id: `sub_${i + 1}`,
        type: act.type as any,
        description: desc || '执行单项操作',
        selector: act.selector,
        targetText: act.targetText,
        value: val,
        humanLike: true,
      };
    });

    const isApproval = /审批|italent|beisen|oa|workflow|待办/i.test(startUrl + ' ' + (candidateRowAction.targetText || ''));
    const defaultName = isApproval ? '全量待办记录自动批量审批 Skill' : `「${listName}」全量循环处理 Skill`;
    const summary = isApproval
      ? '针对当前审批列表中的每一条待办记录，自动点击进入并完成审批流转，直到处理完全部记录。'
      : `针对当前页面「${listName}」中的全部项目，自动遍历并执行拟人操作。`;

    const loopStep: WorkflowStep = {
      id: `step_loop_${preSteps.length + 1}`,
      type: 'loop',
      description: `🔁 自动批量循环遍历「${listName}」并执行单项流转`,
      isLoop: true,
      loopItemSelector: genSelector,
      subSteps: subSteps.length > 0 ? subSteps : undefined,
      maxLoopCount: 50,
      onItemError: 'skip',
      loopSummary: summary,
    };

    const finalSteps = [...preSteps, loopStep];

    return {
      name: defaultName,
      description: summary,
      isBatchPattern: true,
      loopTarget: {
        name: listName,
        selector: genSelector,
      },
      steps: finalSteps,
      subSteps,
      parameters,
      acceptanceCriteria: `自动循环遍历当前列表的全部记录，逐一完成操作流转，保证无遗漏`,
      assertions,
      reasoning: `启发式分析：检测到您在前置导航后对列表中记录进行了示范操作，已自动泛化为全列表批量循环执行。`,
    };
  }

  // 线性单次流程
  let defaultName = '智能业务自动化流程';
  if (/italent|beisen|北森/i.test(startUrl)) {
    defaultName = '北森协同业务流程';
  } else if (/baidu|百度/i.test(startUrl)) {
    defaultName = '百度搜索与内容定位流程';
  } else if (/oa|审批/i.test(startUrl)) {
    defaultName = 'OA 协同流程自动化';
  }

  return {
    name: defaultName,
    description: `包含 ${steps.length} 步操作的线性自动化流程`,
    isBatchPattern: false,
    steps,
    parameters,
    acceptanceCriteria: `完成 ${steps.map((s) => s.description).join(' -> ')}`,
    assertions,
    reasoning: `启发式分析：操作属于标准的单次线性流程。`,
  };
}

const DISTILL_SYSTEM_PROMPT = `你是一个资深 AI RPA 与浏览器自动化习惯归纳专家。
用户刚刚在浏览器网页上进行了一次真实操作演示(录制序列)。
你的任务是深度分析用户的真实意图，将其归纳总结为一个高效、稳定、可复用的自动化 RPA Skill。

特别关注【单次示范 -> 批量循环泛化 (One-shot to Loop Generalization)】：
1. 如果用户是在对一个列表、表格或卡片中的【单条记录】进行操作(例如：点击第1条审批单 -> 查看详情 -> 点击同意 -> 提交)，你需要敏锐地识别出这是用户的一种"业务习惯"！
2. 泛化为批量模式(isBatchPattern: true)：
   - 提取列表项通用选择器 loopItemSelector (去除 :nth-child / :nth-of-type 等单项特异性选择器，如泛化为 "table tbody tr" 或 ".ant-table-row")
   - 将针对单项执行的一连串动作打包为 subSteps (子动作序列)
   - 提取动态参数(如用户输入的审批文字转化为 {{approvalComment}})
   - 输出人类可读的习惯意图描述 loopSummary
3. 如果操作并非列表项操作(如单纯的登录、单页面查询或单次点击)，则保持线性流程 (isBatchPattern: false)。

必须输出严格合法的 JSON，格式如下：
{
  "name": "北森待办全量批量审批 Skill",
  "description": "针对待办列表中的每一条记录，自动点击同意并完成流转",
  "isBatchPattern": true,
  "loopTarget": {
    "name": "待办审批列表表格行",
    "selector": "table tbody tr"
  },
  "subSteps": [
    { "type": "click", "description": "点击进入审批详情", "selector": "td a" },
    { "type": "type", "description": "输入审批意见", "selector": "textarea", "value": "{{approvalComment}}" },
    { "type": "click", "description": "点击「同意」按钮", "selector": "button.btn-agree" }
  ],
  "parameters": [
    { "key": "approvalComment", "label": "审批意见", "defaultValue": "同意", "description": "批量审批时的默认批复意见" }
  ],
  "acceptanceCriteria": "完成全量列表项遍历与批量审批",
  "reasoning": "检测到用户示范了对表格第 1 行的审批操作，因此归纳为针对整表的批量循环习惯。"
}`;

/** 使用 LLM 大模型智能归纳 RPA 习惯 (带自动容错与启发式兜底) */
export async function distillHabitWithLLM(
  actions: CapturedAction[],
  steps: WorkflowStep[],
  startUrl = '',
  settingsOverride?: AiSettings | null,
): Promise<DistilledHabit> {
  const fallback = distillHabitHeuristic(actions, steps, startUrl);
  if (actions.length === 0) return fallback;

  try {
    const settings = settingsOverride || (await getSettings());
    const activeProvider = settings.providers?.find((p) => p.id === settings.activeProviderId);

    if (!activeProvider || !activeProvider.apiKey) {
      return fallback;
    }

    const client = getClient(activeProvider.kind);
    const userPrompt = JSON.stringify({
      pageUrl: startUrl || actions[0]?.url,
      pageTitle: actions[0]?.title,
      totalActions: actions.length,
      recordedActions: actions.map((a) => ({
        type: a.type,
        tag: a.tag,
        selector: a.selector,
        targetText: a.targetText,
        placeholder: a.placeholder,
        value: a.value,
      })),
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: DISTILL_SYSTEM_PROMPT },
      { role: 'user', content: `请分析以下录制序列并归纳 RPA Skill:\n${userPrompt}` },
    ];

    let fullText = '';
    const stream = client.stream(
      { model: activeProvider.model, messages },
      { baseUrl: activeProvider.baseUrl, apiKey: activeProvider.apiKey },
    );

    for await (const event of stream) {
      if (event.type === 'text-delta') {
        fullText += event.text;
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }

    // 提取并解析 JSON
    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallback;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed || typeof parsed !== 'object') {
      return fallback;
    }

    const isBatch = Boolean(parsed.isBatchPattern);
    const name = (parsed.name || fallback.name).trim();
    const description = (parsed.description || fallback.description).trim();
    const loopSelector = parsed.loopTarget?.selector || fallback.loopTarget?.selector || 'table tbody tr';

    const subSteps: WorkflowStep[] = Array.isArray(parsed.subSteps) && parsed.subSteps.length > 0
      ? parsed.subSteps.map((s: any, idx: number) => ({
          id: `sub_${idx + 1}`,
          type: s.type || 'click',
          description: s.description || `子步骤 ${idx + 1}`,
          selector: s.selector,
          targetText: s.targetText,
          value: s.value,
          humanLike: true,
        }))
      : fallback.subSteps || [];

    const parameters: RecipeParameter[] = Array.isArray(parsed.parameters) && parsed.parameters.length > 0
      ? parsed.parameters.map((p: any) => ({
          key: p.key || 'param',
          label: p.label || '参数',
          defaultValue: p.defaultValue || '',
          description: p.description,
        }))
      : fallback.parameters || [];

    let finalSteps: WorkflowStep[] = steps;
    if (isBatch) {
      const preSteps = fallback.steps.filter((s) => !s.isLoop);
      finalSteps = [
        ...preSteps,
        {
          id: `step_loop_llm_${preSteps.length + 1}`,
          type: 'loop',
          description: `🔁 自动批量循环遍历「${parsed.loopTarget?.name || '列表项'}」并执行操作`,
          isLoop: true,
          loopItemSelector: loopSelector,
          subSteps: subSteps.length > 0 ? subSteps : undefined,
          maxLoopCount: 50,
          onItemError: 'skip',
          loopSummary: description,
        },
      ];
    }

    return {
      name,
      description,
      isBatchPattern: isBatch,
      loopTarget: isBatch
        ? {
            name: parsed.loopTarget?.name || '数据列表项',
            selector: loopSelector,
          }
        : undefined,
      steps: finalSteps,
      subSteps,
      parameters,
      acceptanceCriteria: parsed.acceptanceCriteria || fallback.acceptanceCriteria,
      assertions: fallback.assertions,
      reasoning: parsed.reasoning || '由 AI 习惯归纳引擎深度提炼生成。',
    };
  } catch {
    // 任何模型超时或网络异常，均平滑降级到启发式规则
    return fallback;
  }
}
