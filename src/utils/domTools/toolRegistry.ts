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
    'getPagePerformance',
    '获取页面的真实加载性能与网络耗时深度指标(毫秒级:DNS解析/TCP建连/TTFB首字节/FCP首次绘制/DOM就绪/完全加载/总资源数/体积、以及 Top 3 慢请求和 Top 3 大文件具体清单)。用于性能诊断、测速对比、SEO分析。支持 tabId 指定目标标签页。',
    {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '可选,指定要获取性能指标的目标标签页 ID(不传则读取当前标签页)' },
      },
    },
  ),
  define(
    'listTabs',
    '获取当前浏览器窗口中打开的所有可用标签页列表(含 tabId/标题/URL)。用于多标签页横向对比、多网页跨页协同。',
    {
      type: 'object',
      properties: {
        currentWindow: { type: 'boolean', description: '可选,是否仅当前窗口,默认 true' },
      },
    },
  ),
  define(
    'readPage',
    '读取当前页面可交互元素与文本摘要,用于观察页面。可传 selector 限定范围、textLimit 加大文本长度、tabId 指定非当前标签页。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '可选,限定读取范围(如 main、#list)' },
        textLimit: { type: 'number', description: '可选,文本摘要最大字符数,默认 5000,最大 50000' },
        fullScan: { type: 'boolean', description: '可选,是否自动对飞书/Notion/超长虚拟滚动页面执行静默高速全量扫描,默认 true' },
        tabId: { type: 'number', description: '可选,指定要读取的目标标签页 ID(不传则读取当前激活标签页)' },
      },
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
    '滚动到指定元素或按方向滚动页面。可连续向下滚动多次,用于触发懒加载内容。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '可选,滚动到该元素' },
        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: '可选,方向滚动' },
        iterations: { type: 'number', description: '可选,连续滚动次数(触发懒加载),默认 1' },
        intervalMs: { type: 'number', description: '可选,每次滚动间隔毫秒,默认 600' },
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
        tabId: { type: 'number', description: '可选,指定要提取的目标标签页 ID(不传则提取当前激活标签页)' },
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
    'getArticleOutline',
    '智能提取长文/技术文档/文章页面的多级目录大纲树(H1~H4)、章节要点与段落锚点(anchorId)。用于长文速读、沉浸式阅读伴侣和精准论据溯源。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '可选,限定正文容器选择器(如 article, main, .markdown-body)' },
        fullScan: { type: 'boolean', description: '可选,是否自动对飞书/Notion等虚拟滚动长文档进行全量静默遍历大纲,默认 true' },
        tabId: { type: 'number', description: '可选,指定目标标签页 ID(不传则读取当前标签页)' },
      },
    },
  ),
  define(
    'highlightAndScrollTo',
    '平滑滚动到网页中指定的段落或元素位置,并施加 2.5 秒柔和脉冲光晕高亮。用于长文论据精准溯源、段落定位、视觉引导。',
    {
      type: 'object',
      properties: {
        anchorId: { type: 'string', description: '可选,段落锚点 ID(由 getArticleOutline 返回,如 anchor-3)' },
        selector: { type: 'string', description: '可选,CSS 选择器定位目标元素' },
        textSnippet: { type: 'string', description: '可选,要匹配并高亮的原文关键词或特征语句' },
        tabId: { type: 'number', description: '可选,指定目标标签页 ID(不传则操作当前激活标签页)' },
      },
    },
  ),
  define(
    'writeWechatDraft',
    '将内容经过微信专属精美排版(支持科技蓝/微信绿/极简黑/典雅紫等主题,含Mac终端代码块、双色标题、优雅引用框)后,自动写入微信公众平台(mp.weixin.qq.com)的图文草稿箱(填入标题、作者、120字摘要与富文本正文)。',
    {
      type: 'object',
      properties: {
        title: { type: 'string', description: '可选,微信公众号图文标题(最大64字)' },
        author: { type: 'string', description: '可选,文章作者(最大16字)' },
        digest: { type: 'string', description: '可选,文章摘要引言(最大120字)' },
        contentMarkdown: { type: 'string', description: '文章正文 Markdown 源码(自动执行微信内联美化排版)' },
        contentHtml: { type: 'string', description: '可选,已排版好的 HTML 富文本' },
        theme: {
          type: 'string',
          enum: ['tech-blue', 'wechat-green', 'minimal-black', 'elegant-purple', 'warm-amber'],
          description: '可选,排版主题,默认 tech-blue(科技商务蓝)',
        },
        tabId: { type: 'number', description: '可选,目标微信公众平台标签页 ID(不传则写入当前页面)' },
      },
    },
  ),
  define(
    'exportDocMarkdown',
    '将飞书云文档 (feishu.cn/larksuite.com) 或当前网页长文全量转换为标准 Markdown 文本，并完整保留 H1~H6 标题、Callout 高亮块、表格 Table、待办清单 Todo、代码块 Code 与格式。支持一键复制与下载 .md。',
    {
      type: 'object',
      properties: {
        textLimit: { type: 'number', description: '可选,最大转换字符上限,默认 100,000 字' },
        tabId: { type: 'number', description: '可选,指定目标标签页 ID(不传则转换当前激活标签页)' },
      },
    },
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
