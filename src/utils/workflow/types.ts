// 流程自动化与工作流类型定义
export interface CapturedAction {
  type: 'click' | 'type' | 'change' | 'hover' | 'scroll' | 'navigate' | 'pressEnter';
  timestamp: number;
  selector: string;
  targetText?: string;
  tag: string;
  role?: string;
  placeholder?: string;
  ariaLabel?: string;
  value?: string;
  url: string;
  title: string;
}

export interface WorkflowStep {
  id: string;
  type: 'click' | 'type' | 'wait' | 'hover' | 'scroll' | 'navigate' | 'pressEnter' | 'loop';
  description: string; // 步骤语义说明: 如 "点击「打卡签到」按钮" 或 "循环遍历「已审批」列表所有记录"
  selector?: string;
  targetText?: string;
  value?: string;
  url?: string; // 步骤执行时的页面 URL
  waitMs?: number;
  humanLike?: boolean;
  // 智能同构列表循环遍历与复合习惯 (Loop & Composite Habit)
  isLoop?: boolean;
  loopItemSelector?: string; // 循环匹配的通用列表项选择器，如 "table tbody tr" 或 "ul.list > li"
  loopActionType?: 'click' | 'view' | 'substeps';
  subSteps?: WorkflowStep[]; // 针对列表每一项需要重复执行的子动作序列 (如: 打开详情 -> 输入审批意见 -> 点击提交)
  maxLoopCount?: number; // 批量最大项数 (默认 30，0 或 undefined 表示处理全部可见项)
  onItemError?: 'skip' | 'stop'; // 单项执行失败策略: 'skip' 跳过并继续下一项 (默认), 'stop' 中断
  loopSummary?: string; // 人类可读的循环意图总结 (如: "针对列表中每一项审批单，自动点击同意并提交")
}

export interface DistilledHabit {
  name: string; // 归纳出的 Skill 名称，如 "北森审批单全量批量审批 Skill"
  description: string; // 习惯意图描述
  isBatchPattern: boolean; // 是否为批量循环习惯
  loopTarget?: {
    name: string; // 循环目标语义名，如 "待审批表格行"
    selector: string; // 通用选择器，如 "table tbody tr"
    itemCountEstimated?: number;
  };
  steps: WorkflowStep[]; // 生成的规范化步骤列表
  subSteps?: WorkflowStep[]; // 循环体内部执行动作
  parameters?: RecipeParameter[]; // 动态提取的变量参数 (如 {{approvalComment}})
  acceptanceCriteria?: string; // 验收标准
  assertions?: TestAssertion[]; // 自动化断言
  reasoning?: string; // AI 推导理由
}

export interface TestAssertion {
  id: string;
  type: 'text_contains' | 'url_contains' | 'element_visible' | 'no_console_error';
  target: string; // 期望包含的文本 / URL 关键字 / CSS 选择器
  description?: string; // 断言描述: 如 "验证页面出现「校招职位」"
}

export interface TestStepResult {
  stepIndex: number;
  description: string;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface AssertionResult {
  id: string;
  type: TestAssertion['type'];
  description: string;
  expected: string;
  actual: string;
  ok: boolean;
  error?: string;
}

export interface TestRunReport {
  id: string;
  recipeId: string;
  recipeName: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  startTime: number;
  durationMs: number;
  totalSteps: number;
  passedSteps: number;
  totalAssertions: number;
  passedAssertions: number;
  stepsResults: TestStepResult[];
  assertionsResults: AssertionResult[];
  systemHealth: {
    pageUrl: string;
    pageTitle: string;
    consoleErrorsCount: number;
    consoleErrors: string[];
    isWhiteScreen: boolean;
  };
  summary: string;
}

export type WorkflowMode = 'rpa' | 'qa'; // 'rpa': 业务代办工作流 (参数化拟人操作), 'qa': 自动化测试用例 (验收与断言)

export interface RecipeParameter {
  key: string; // 变量标识, 如 "keyword"
  label: string; // 显示名称, 如 "搜索词"
  defaultValue: string; // 默认值, 如 "海尔消费金融"
  description?: string;
}

export interface WorkflowRecipe {
  id: string;
  name: string; // 工作流名称: 如 "海尔招聘流程测试"
  description?: string;
  mode?: WorkflowMode; // 用途模式: 'rpa' 业务代办 vs 'qa' 自动化测试
  startUrl?: string; // 流程起始网页 URL (如 https://www.baidu.com)
  urlPattern?: string; // 适用的 URL 正则或关键字
  createdAt: number;
  updatedAt: number;
  steps: WorkflowStep[];
  // 业务代办动态入参配置 (Stage 3)
  parameters?: RecipeParameter[];
  // 自动化测试扩展能力
  assertions?: TestAssertion[]; // 测试断言/检查点列表
  acceptanceCriteria?: string; // 人工输入的自然语言测试验收标准
  lastTestReport?: TestRunReport; // 最近一次测试执行报告快照
}

export interface TestSuiteRunReport {
  id: string;
  suiteName: string;
  startTime: number;
  durationMs: number;
  totalRecipes: number;
  passedRecipes: number;
  failedRecipes: number;
  recipeReports: TestRunReport[];
  summary: string;
}

export interface TestSkillTemplate {
  id: string;
  name: string; // 如 "企业官网与招聘验收 Skill"
  description?: string;
  targetUrl?: string; // 关联的目标页面 URL (如 https://job.haiercash.com)
  acceptanceCriteria: string;
  assertions: TestAssertion[];
  createdAt: number;
  updatedAt?: number;
  isPreset?: boolean;
}

export interface RecordingSession {
  isRecording: boolean;
  tabId?: number;
  startUrl?: string; // 录制启动时的初始页面 URL
  startTime: number;
  actions: CapturedAction[];
}
