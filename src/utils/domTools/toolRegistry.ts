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
    '获取当前浏览器窗口中打开的所有可用标签页列表(含 tabId/标题/URL)。用于标签页全局整理去重、多标签页管理看板展示、多标签页横向对比。当用户提出“整理标签页/整理网页/查看当前标签/清理标签”时，只需调用此工具获取列表即可，无需调用 groupTabs。',
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
    'pressEnter',
    '在指定元素或当前焦点元素上按下回车键(Enter),用于表单提交或触发搜索。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '可选,目标元素定位或选择器' },
        targetText: { type: 'string', description: '可选,目标元素语义文案' },
      },
    },
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
    'groupTabs',
    '【严格限制：仅当用户明确提出“分组/建立标签组/创建分组”时才可调用】将多个标签页聚合为一个具有语义色彩和名称的标签组(Tab Group)。【严禁】在用户提出“整理标签页/整理网页/去重/清理标签”等指令时擅自调用此工具。',
    {
      type: 'object',
      properties: {
        tabIds: {
          type: 'array',
          items: { type: 'number' },
          description: '要加入该分组的标签页 ID 列表',
        },
        title: {
          type: 'string',
          description: '标签组标题(建议附带 Emoji, 如 💻 开发调试、📖 研报阅读、🛒 电商比价)',
        },
        color: {
          type: 'string',
          enum: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'],
          description: '可选, 标签组颜色, 默认 blue',
        },
        collapsed: {
          type: 'boolean',
          description: '可选, 分组后是否默认折叠以节省视口空间, 默认 false',
        },
      },
    },
    ['tabIds', 'title'],
  ),
  define(
    'closeTabs',
    '批量关闭指定的标签页。用于清理重复打开的相同网页、关闭已处理完毕的闲置标签、释放浏览器内存。批量关闭多个标签页时系统会自动触发安全确认。',
    {
      type: 'object',
      properties: {
        tabIds: {
          type: 'array',
          items: { type: 'number' },
          description: '要关闭的标签页 ID 列表',
        },
        reason: {
          type: 'string',
          description: '可选, 关闭原因说明(如 清理重复项、关闭闲置任务页)',
        },
      },
    },
    ['tabIds'],
    true,
  ),
  define(
    'activateTab',
    '切换并聚焦到指定的标签页(将其置于前台激活状态并聚焦浏览器窗口)。',
    {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '要激活的目标标签页 ID' },
      },
    },
    ['tabId'],
  ),
  define(
    'getBookmarksTree',
    '获取浏览器的书签树状层级结构(包含文件夹名称、书签标题、URL 与 ID)。用于书签库健康度体检、分类重构分析与重复书签排查。',
    {
      type: 'object',
      properties: {
        parentId: { type: 'string', description: '可选, 指定根目录或文件夹 ID, 默认读取全部书签' },
        maxDepth: { type: 'number', description: '可选, 最大递归深度, 默认 4' },
      },
    },
  ),
  define(
    'searchBookmarks',
    '在整个书签库中按关键词检索书签(匹配标题或 URL)。',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词或短语' },
      },
    },
    ['query'],
  ),
  define(
    'createBookmark',
    '在指定位置创建新书签或新书签文件夹。',
    {
      type: 'object',
      properties: {
        title: { type: 'string', description: '书签或文件夹的名称' },
        url: { type: 'string', description: '网页网址(创建文件夹时不要传此字段)' },
        parentId: { type: 'string', description: '可选, 父文件夹 ID(不传则放入默认书签栏)' },
        index: { type: 'number', description: '可选, 在文件夹中的插入位置' },
      },
    },
    ['title'],
  ),
  define(
    'moveBookmark',
    '移动书签至新的目标文件夹，或对书签/文件夹进行重命名。用于书签库重新分类与结构重组。',
    {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要操作的书签或文件夹 ID' },
        parentId: { type: 'string', description: '可选, 目标文件夹 ID' },
        index: { type: 'number', description: '可选, 在目标文件夹中的排序位置' },
        title: { type: 'string', description: '可选, 重命名新标题' },
      },
    },
    ['id'],
  ),
  define(
    'removeBookmark',
    '删除指定的书签或书签文件夹。操作前系统会弹出安全确认。',
    {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要删除的书签或文件夹 ID' },
        isFolder: { type: 'boolean', description: '是否是文件夹(文件夹会连同子项一同清理)' },
      },
    },
    ['id'],
    true,
  ),
  define(
    'searchHistory',
    '按关键词与时间范围模糊检索浏览器的历史访问记录。用于根据用户的模糊记忆、时间点或主题快速找回之前看过的网页。',
    {
      type: 'object',
      properties: {
        text: { type: 'string', description: '可选, 搜索关键词(匹配标题或 URL)' },
        startTime: { type: 'number', description: '可选, 起始时间戳(毫秒数, 如 7 天前)' },
        endTime: { type: 'number', description: '可选, 结束时间戳(毫秒数)' },
        maxResults: { type: 'number', description: '可选, 最大返回条数, 默认 25, 最大 100' },
      },
    },
  ),
  define(
    'discardTabs',
    '休眠/挂起指定的标签页以释放浏览器内存(保留标签页标题与位置，点击时秒级唤醒)。若不传 tabIds，则默认休眠当前窗口所有非激活的闲置标签页。',
    {
      type: 'object',
      properties: {
        tabIds: {
          type: 'array',
          items: { type: 'number' },
          description: '可选，要休眠挂起的标签页 ID 列表',
        },
      },
    },
  ),
  define(
    'saveWorkspace',
    '将当前窗口的全部或指定标签页保存为一个命名的工作区会话快照(Workspace Snapshot)，便于未来一键还原恢复。',
    {
      type: 'object',
      properties: {
        name: { type: 'string', description: '工作区名称(如「Q3技术调研」「电商比价」「日常办公」)' },
        tabIds: {
          type: 'array',
          items: { type: 'number' },
          description: '可选，要保存的标签页 ID 列表(不传则保存当前窗口全部可用标签页)',
        },
        closeAfterSave: {
          type: 'boolean',
          description: '可选，保存工作区后是否自动关闭这些标签页以清爽视口，默认 false',
        },
      },
      required: ['name'],
    },
    ['name'],
  ),
  define(
    'listWorkspaces',
    '获取所有已保存的项目工作区会话快照列表(含名称、创建时间与包含的网页数量)。',
    {
      type: 'object',
      properties: {},
    },
  ),
  define(
    'restoreWorkspace',
    '一键恢复并打开之前保存的指定工作区快照中的所有标签页(支持自动恢复标签组)。',
    {
      type: 'object',
      properties: {
        nameOrId: { type: 'string', description: '目标工作区的名称或 ID' },
        inNewWindow: { type: 'boolean', description: '可选，是否在新窗口中打开恢复，默认 false' },
      },
      required: ['nameOrId'],
    },
    ['nameOrId'],
  ),
  define(
    'deleteWorkspace',
    '删除指定的项目工作区快照。',
    {
      type: 'object',
      properties: {
        nameOrId: { type: 'string', description: '要删除的工作区名称或 ID' },
      },
      required: ['nameOrId'],
    },
    ['nameOrId'],
    true,
  ),
  define(
    'getRecentlyClosedTabs',
    '获取浏览器最近意外关闭或误关的标签页列表(含标题、URL、关闭时间与 sessionId)。',
    {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: '可选，最大返回条数，默认 15' },
      },
    },
  ),
  define(
    'restoreClosedTab',
    '秒级召回/重新打开最近误关的网页(若指定 sessionId 则恢复该网页，不传则恢复最近关闭的第 1 个网页)。',
    {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '可选，目标已关闭标签页的 sessionId' },
      },
    },
  ),
  define(
    'clearBrowsingData',
    '精细化定向清理浏览器的缓存、Cookie 或本地存储。支持指定特定站点域名(如仅清理当前测试站点，不影响其他网站登录状态)。操作前系统会自动确认。',
    {
      type: 'object',
      properties: {
        origins: {
          type: 'array',
          items: { type: 'string' },
          description: '可选，指定要清理的站点源列表(如 ["https://localhost:3000"])，不传则清理全部',
        },
        dataTypes: {
          type: 'array',
          items: { type: 'string', enum: ['cache', 'cookies', 'localStorage', 'history'] },
          description: '可选，要清理的数据类型列表，默认 ["cache", "cookies"]',
        },
        timeSince: {
          type: 'number',
          description: '可选，清理多久之前的数据(毫秒时间戳)，默认 0 即清理全部',
        },
      },
    },
    [],
    true,
  ),
  define(
    'moveTabsToNewWindow',
    '将指定的多个标签页移至一个全新的独立浏览器窗口中(实现工作与娱乐多窗口分流)。',
    {
      type: 'object',
      properties: {
        tabIds: {
          type: 'array',
          items: { type: 'number' },
          description: '要移出的标签页 ID 列表',
        },
        focused: {
          type: 'boolean',
          description: '可选，新窗口是否置顶聚焦，默认 true',
        },
      },
      required: ['tabIds'],
    },
    ['tabIds'],
  ),
  define(
    'setTabZoom',
    '设置当前或指定标签页的页面缩放比例(如 1.1 为 110% 放大，0.9 为 90% 缩小，1.0 为恢复默认)。',
    {
      type: 'object',
      properties: {
        zoomFactor: {
          type: 'number',
          description: '缩放倍率(如 1.0, 1.1, 1.25, 1.5, 0.9, 0.8)',
        },
        tabId: {
          type: 'number',
          description: '可选，目标标签页 ID(不传则为当前页)',
        },
      },
      required: ['zoomFactor'],
    },
    ['zoomFactor'],
  ),
  define(
    'searchDownloads',
    '检索浏览器的文件下载历史记录(按文件名、URL 或 MIME 类型)，定位已下载的文件。',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: '可选，搜索关键词(匹配文件名或来源 URL)' },
        mimeType: { type: 'string', description: '可选，文件类型过滤(如 application/pdf, image/png)' },
        limit: { type: 'number', description: '可选，最大返回条数，默认 20' },
      },
    },
  ),
  define(
    'hoverElement',
    '模拟鼠标悬浮在指定元素上方(用于触发悬浮菜单、Tooltip、下拉展示等)。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '目标元素 CSS 选择器或文本内容' },
      },
      required: ['selector'],
    },
    ['selector'],
  ),
  define(
    'startWorkflowRecording',
    '在当前或指定网页上开启自动化流程录制(实时捕获用户的点击、输入等拟人操作)。',
    {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '可选，目标标签页 ID' },
      },
    },
  ),
  define(
    'stopWorkflowRecording',
    '结束当前网页的流程录制，并返回提炼后的结构化工作流步骤列表。',
    {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '可选，目标标签页 ID' },
      },
    },
  ),
  define(
    'saveWorkflowRecipe',
    '保存一个命名的自动化工作流配方(Workflow Recipe)，便于未来随时一键重复回放。',
    {
      type: 'object',
      properties: {
        name: { type: 'string', description: '工作流名称(如「每日打卡」「OA审批流转」)' },
        steps: { type: 'array', items: { type: 'object' }, description: '工作流步骤清单' },
        description: { type: 'string', description: '可选，工作流描述说明' },
        urlPattern: { type: 'string', description: '可选，适用网页 URL 正则或域名' },
      },
      required: ['name', 'steps'],
    },
    ['name', 'steps'],
  ),
  define(
    'listWorkflowRecipes',
    '获取所有已保存的自动化工作流配方列表(含步骤数、适用网站与创建时间)。',
    {
      type: 'object',
      properties: {},
    },
  ),
  define(
    'runWorkflowRecipe',
    '在当前或指定网页上一键回放执行指定的自动化工作流配方(包含自愈定位与拟人操作流转，支持动态变量入参)。',
    {
      type: 'object',
      properties: {
        nameOrId: { type: 'string', description: '要执行的工作流名称或 ID' },
        tabId: { type: 'number', description: '可选，目标标签页 ID' },
        variables: { type: 'object', description: '可选，动态参数变量键值对(替换步骤中的 {{key}} 占位符)' },
      },
      required: ['nameOrId'],
    },
    ['nameOrId'],
  ),
  define(
    'deleteWorkflowRecipe',
    '删除指定的自动化工作流配方。',
    {
      type: 'object',
      properties: {
        nameOrId: { type: 'string', description: '要删除的工作流名称或 ID' },
      },
      required: ['nameOrId'],
    },
    ['nameOrId'],
    true,
  ),
  define(
    'captureMarkedScreen',
    '【视觉多模态 Grounding】对当前网页打上 Set-of-Marks 数字编号标记并截取视口图像，返回带编号的截图与元素索引清单。用于 Canvas/富图表/复杂组件定位。',
    {
      type: 'object',
      properties: {
        maxMarks: { type: 'number', description: '可选，最大标记数量，默认 40' },
        tabId: { type: 'number', description: '可选，目标标签页 ID' },
      },
    },
  ),
  define(
    'clickMark',
    '【视觉多模态 Grounding】根据视觉标记数字编号点击对应元素(结合 captureMarkedScreen 识别出的编号直接指挥点击)。',
    {
      type: 'object',
      properties: {
        markId: { type: 'number', description: '要点击的视觉标记数字编号(如 1, 2, 5...)' },
      },
      required: ['markId'],
    },
    ['markId'],
  ),
  define(
    'clickCoordinate',
    '【高保真坐标交互】在页面指定屏幕客户端坐标 (x, y) 触发精确点击流(支持 Canvas 图表、地图、无 DOM 选择器的富交互元素)。',
    {
      type: 'object',
      properties: {
        x: { type: 'number', description: '点击目标横坐标 clientX' },
        y: { type: 'number', description: '点击目标纵坐标 clientY' },
      },
      required: ['x', 'y'],
    },
    ['x', 'y'],
  ),
  define(
    'startNetworkRecording',
    '【CDP 深度网络截获】通过 Chrome DevTools Protocol 开启底层网络请求截获与 API 抓取。',
    {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '可选，目标标签页 ID' },
        filterUrls: { type: 'array', items: { type: 'string' }, description: '可选，需过滤包含的 URL 关键词' },
        maxRequests: { type: 'number', description: '可选，最大记录请求数，默认 100' },
      },
    },
  ),
  define(
    'stopNetworkRecording',
    '【CDP 深度网络截获】结束 CDP 网络截获并提取核心 API 接口列表及响应体数据。',
    {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '可选，目标标签页 ID' },
        fetchBodies: { type: 'boolean', description: '可选，是否提取 API 响应体内容，默认 true' },
      },
    },
  ),
  define(
    'mockNetworkResponse',
    '【CDP 接口 Mock】通过 Chrome DevTools Protocol 拦截指定 URL 请求并返回 Mock 模拟响应数据。',
    {
      type: 'object',
      properties: {
        urlPattern: { type: 'string', description: '要拦截的 URL 匹配通配模式(如 */api/user/*)' },
        responseJson: { type: 'object', description: '要返回的 JSON 数据对象' },
        responseBody: { type: 'string', description: '自定义文本响应体(若指定则优先于 responseJson)' },
        statusCode: { type: 'number', description: 'HTTP 状态码，默认 200' },
        contentType: { type: 'string', description: '响应 Content-Type，默认 application/json; charset=utf-8' },
        tabId: { type: 'number', description: '可选，目标标签页 ID' },
      },
      required: ['urlPattern'],
    },
    ['urlPattern'],
    true,
  ),
  define(
    'emulateDevice',
    '【CDP 设备模拟】通过 Chrome DevTools Protocol 切换视口分辨率与 User-Agent(模拟手机/平板环境)。',
    {
      type: 'object',
      properties: {
        width: { type: 'number', description: '视口宽度(如 iPhone 14 为 390)' },
        height: { type: 'number', description: '视口高度(如 iPhone 14 为 844)' },
        deviceScaleFactor: { type: 'number', description: '像素比缩放因子，默认 2' },
        mobile: { type: 'boolean', description: '是否为移动端模式，默认 true' },
        userAgent: { type: 'string', description: '可选，自定义 User-Agent 字符串' },
        tabId: { type: 'number', description: '可选，目标标签页 ID' },
      },
      required: ['width', 'height'],
    },
    ['width', 'height'],
  ),
  define(
    'exportWorkflowRecipes',
    '导出已保存的自动化工作流配方为标准 JSON 格式字符串(支持指定 recipeIds 过滤)。',
    {
      type: 'object',
      properties: {
        recipeIds: { type: 'array', items: { type: 'string' }, description: '可选，要导出的工作流 ID 列表(留空则导出全部)' },
      },
    },
  ),
  define(
    'importWorkflowRecipes',
    '从 JSON 字符串批量导入自动化工作流配方。',
    {
      type: 'object',
      properties: {
        json: { type: 'string', description: '符合规范的工作流配方 JSON 字符串' },
      },
      required: ['json'],
    },
    ['json'],
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
  define(
    'assertPage',
    '对当前页面执行自动化测试断言(文本断言、URL断言、元素可见性断言及白屏健康检查)。用于自动化测试用例验收。',
    {
      type: 'object',
      properties: {
        assertions: {
          type: 'array',
          description: '断言规则列表',
        },
        acceptanceCriteria: { type: 'string', description: '自然语言测试验收标准' },
      },
    },
  ),
  define(
    'hideElement',
    '隐藏当前页面上指定的元素(将其 CSS 设置为 display: none)。用于隐藏烦人的广告横幅、遮挡弹窗、遮罩层或侧边浮动栏。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '目标元素 CSS 选择器或定位标识' },
        targetText: { type: 'string', description: '可选，目标元素的文本内容或包含文字' },
      },
    },
  ),
  define(
    'removeElement',
    '从当前页面的 DOM 树中彻底删除指定的元素。用于移除顽固遮罩、侵入式弹窗或不需要的页面节点。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '目标元素 CSS 选择器或定位标识' },
        targetText: { type: 'string', description: '可选，目标元素的文本内容或包含文字' },
      },
    },
  ),
  define(
    'highlightElement',
    '在页面上高亮标记并平滑定位聚焦指定的元素(为其添加醒目的边框与阴影效果)。用于指引用户关注特定区域或定位查找到的内容。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '目标元素 CSS 选择器或定位标识' },
        targetText: { type: 'string', description: '可选，目标元素的文本内容' },
        color: { type: 'string', description: '可选，高亮颜色(如 #3b82f6 或 red)，默认 #3b82f6' },
        durationMs: { type: 'number', description: '可选，高亮持续时间(毫秒)，默认 3000' },
        persistent: { type: 'boolean', description: '可选，是否持久保持高亮，默认 false' },
      },
    },
  ),
  define(
    'modifyElementStyle',
    '动态修改当前页面指定元素的 CSS 样式属性(如 width, height, backgroundColor, zIndex, opacity 等)。用于页面临时定制、排版微调与去遮挡。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '目标元素 CSS 选择器或定位标识' },
        targetText: { type: 'string', description: '可选，目标元素的文本内容' },
        styles: {
          type: 'object',
          description: '要修改的 CSS 样式键值对(如 {"zIndex": "999", "backgroundColor": "#fff"})',
        },
      },
      required: ['styles'],
    },
    ['styles'],
  ),
  define(
    'loopElements',
    '批量循环遍历当前页面上的同构列表项或表格行(自动查找当前可见的所有记录并逐一执行点击/查看或子步骤流转操作)。用于批量审批、批量浏览、长表格逐项检查等循环业务场景。',
    {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '列表项或包含行的 CSS 选择器' },
        itemSelector: { type: 'string', description: '可选，列表项的具体条目选择器(如 table tbody tr 或 ul.list li)' },
        subSteps: {
          type: 'array',
          description: '可选，针对每一项需要重复执行的子动作序列(如点击详情、输入审批意见、点击提交)',
          items: { type: 'object' },
        },
        maxItems: { type: 'number', description: '可选，最大遍历条数，默认 30' },
        delayMs: { type: 'number', description: '可选，每条记录处理间隔时间(毫秒)，默认 500' },
        onItemError: { type: 'string', description: '可选，单项处理失败策略 (skip 跳过继续下一条 / stop 中断)' },
      },
    },
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
