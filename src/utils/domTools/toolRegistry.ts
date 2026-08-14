// 工具注册表:工具名 → 定义(description + inputSchema + required + sensitive)。
// 纯元数据层,不依赖 DOM;content 侧由 actions.ts 提供 execute 实现。
// 见 docs/design/agent.md §4.1、§6
import type { ToolSpec } from './types';

const define = (
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  required: string[] = [],
  sensitive = false,
): Omit<ToolSpec, 'execute'> => ({ name, description, inputSchema, required, sensitive });

/** 工具注册表(元数据)。evaluate 敏感、默认禁用,由 options 开关控制是否开放 */
const TOOLS: Omit<ToolSpec, 'execute'>[] = [
  define(
    'getPageInfo',
    '获取当前页面基本信息(url/title/lang)。',
    {
      type: 'object',
      properties: {},
    },
  ),
  define(
    'readPage',
    '读取当前页面可交互元素与文本摘要,用于观察页面。可传 selector 限定范围。',
    {
      type: 'object',
      properties: { selector: { type: 'string', description: '可选,限定读取范围(如 main、#list)' } },
    },
  ),
  define(
    'findElements',
    '按语义条件精确查找页面元素(role/type/text/placeholder/keyword),返回定位器。核心挖掘工具。',
    {
      type: 'object',
      properties: {
        role: { type: 'string', description: '角色,如 button/link/textbox/checkbox' },
        type: { type: 'string', description: 'input 类型,如 text/email/password/submit' },
        text: { type: 'string', description: '可见文本/可访问名包含' },
        placeholder: { type: 'string', description: '输入框 placeholder 包含' },
        keyword: { type: 'string', description: '任意字段关键词' },
      },
    },
  ),
  define(
    'clickElement',
    '点击页面上的元素。selector 用语义定位(role/aria-label/可见文本),失败会回填错误供调整。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '目标元素定位(如 按钮文本、[role=button] 等)' },
        description: { type: 'string', description: '点击目的描述(供用户确认/日志)' },
      },
    },
    ['selector'],
  ),
  define(
    'typeInto',
    '向输入框输入文本。可先清空。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '输入框定位' },
        text: { type: 'string', description: '要输入的内容' },
        clear: { type: 'boolean', description: '是否先清空已有内容,默认 true' },
      },
    },
    ['selector', 'text'],
  ),
  define(
    'scrollTo',
    '滚动到指定元素或按方向滚动页面。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '可选,滚动到该元素' },
        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: '可选,方向滚动' },
      },
    },
  ),
  define(
    'waitFor',
    '等待页面出现指定元素(轮询,用于异步渲染)。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '要等待的元素' },
        timeoutMs: { type: 'number', description: '超时毫秒,默认 8000' },
      },
    },
    ['selector'],
  ),
  define(
    'sleep',
    '等待指定毫秒数(页面加载/异步渲染间隔)。',
    {
      type: 'object',
      properties: { ms: { type: 'number', description: '等待毫秒' } },
    },
    ['ms'],
  ),
  define(
    'extractData',
    '提取页面表格/列表数据,返回结构化行(可转 CSV/JSON)。可指定只取某几列(重组前置)。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '数据容器(如 table、#list、[role=table])' },
        format: { type: 'string', enum: ['csv', 'json'], description: '返回格式,默认 csv' },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: '可选,只保留这些列(按表头列名,需有表头)',
        },
      },
    },
    ['selector'],
  ),
  define(
    'navigate',
    '导航到指定 URL(会离开当前页面)。跨域导航需用户确认。',
    {
      type: 'object',
      properties: {
        url: { type: 'string', description: '目标地址' },
        currentOrigin: { type: 'string', description: '当前页面 origin(background 注入,用于跨域判定)' },
      },
    },
    ['url'],
  ),
  define(
    'evaluate',
    '在页面执行任意 JS 并返回结果。高风险,默认禁用,需在设置中开启。',
    {
      type: 'object',
      properties: { js: { type: 'string', description: '要执行的 JS 代码' } },
    },
    ['js'],
    true,
  ),
];

export function getTool(name: string): Omit<ToolSpec, 'execute'> | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function listToolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

/** 校验参数是否满足必填 */
export function validateArgs(spec: Omit<ToolSpec, 'execute'>, args: Record<string, unknown>): boolean {
  return (spec.required ?? []).every((k) => args[k] !== undefined && args[k] !== '');
}

/** 供 LLM function calling 的 schema 列表。可选 filter 限定工具子集(场景约束,ADR-0008) */
export function toLlmTools(
  filter?: string[],
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  const allowed = filter ? new Set(filter) : null;
  return TOOLS.filter((t) => !allowed || allowed.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}
