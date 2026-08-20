// 浏览器原生系统管家插件 (Browser Native Management Plugin)
// 包含: 标签页智能分类分组与关闭、闲置/重复 Tab 清理、书签树语义重构与去重、自然语言历史记录溯源

import type { BrowserAgentPlugin } from '../types';

export const BrowserManagerPlugin: BrowserAgentPlugin = {
  id: 'browser-manager',
  name: '浏览器系统管家',
  description: '智能标签页整理与自动分组、闲置与重复Tab清理、书签语义重构与去重、自然语言历史记录溯源',
  icon: '🗂️',
  version: '1.0.0',

  matchUrl: () => true, // 全局可用，不依赖特定网页

  tools: [
    {
      name: 'listTabs',
      description:
        '获取浏览器当前打开的所有可用标签页列表(含 tabId、标题、URL、是否当前激活、是否固定、所属标签组与分组名)。用于标签页全局概览、整理去重看板展示、多标签页对比。当用户要求整理标签页、查看网页或清理标签时，仅需调用此工具即可，无需调用 groupTabs。',
      inputSchema: {
        type: 'object',
        properties: {
          currentWindow: { type: 'boolean', description: '可选, 是否仅获取当前窗口的标签页, 默认 true' },
        },
      },
    },
    {
      name: 'groupTabs',
      description:
        '【严格限制：仅当用户明确提出“分组/建立标签组/创建分组”时才可调用】将多个标签页聚合为一个具有语义色彩和名称的标签组(Tab Group)。【严禁】在用户提出“整理标签页/整理网页/去重/清理标签”等指令时擅自调用此工具。',
      inputSchema: {
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
        required: ['tabIds', 'title'],
      },
    },
    {
      name: 'closeTabs',
      description:
        '批量关闭指定的标签页。用于清理重复打开的相同网页、关闭已处理完毕的闲置标签、释放浏览器内存。批量关闭多个标签页时系统会自动触发安全确认。',
      inputSchema: {
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
        required: ['tabIds'],
      },
      sensitive: true,
    },
    {
      name: 'activateTab',
      description: '切换并聚焦到指定的标签页(将其置于前台激活状态并聚焦浏览器窗口)。',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: '要激活的目标标签页 ID' },
        },
        required: ['tabId'],
      },
    },
    {
      name: 'getBookmarksTree',
      description:
        '获取浏览器的书签树状层级结构(包含文件夹名称、书签标题、URL 与 ID)。用于书签库健康度体检、分类重构分析与重复书签排查。',
      inputSchema: {
        type: 'object',
        properties: {
          parentId: { type: 'string', description: '可选, 指定根目录或文件夹 ID, 默认读取全部书签' },
          maxDepth: { type: 'number', description: '可选, 最大递归深度, 默认 4' },
        },
      },
    },
    {
      name: 'searchBookmarks',
      description: '在整个书签库中按关键词检索书签(匹配标题或 URL)。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或短语' },
        },
        required: ['query'],
      },
    },
    {
      name: 'createBookmark',
      description: '在指定位置创建新书签或新书签文件夹。',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '书签或文件夹的名称' },
          url: { type: 'string', description: '网页网址(创建文件夹时不要传此字段)' },
          parentId: { type: 'string', description: '可选, 父文件夹 ID(不传则放入默认书签栏)' },
          index: { type: 'number', description: '可选, 在文件夹中的插入位置' },
        },
        required: ['title'],
      },
    },
    {
      name: 'moveBookmark',
      description: '移动书签至新的目标文件夹，或对书签/文件夹进行重命名。用于书签库重新分类与结构重组。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要操作的书签或文件夹 ID' },
          parentId: { type: 'string', description: '可选, 目标文件夹 ID' },
          index: { type: 'number', description: '可选, 在目标文件夹中的排序位置' },
          title: { type: 'string', description: '可选, 重命名新标题' },
        },
        required: ['id'],
      },
    },
    {
      name: 'removeBookmark',
      description: '删除指定的书签或书签文件夹。操作前系统会弹出安全确认。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要删除的书签或文件夹 ID' },
          isFolder: { type: 'boolean', description: '是否是文件夹(文件夹会连同子项一同清理)' },
        },
        required: ['id'],
      },
      sensitive: true,
    },
    {
      name: 'searchHistory',
      description:
        '按关键词与时间范围模糊检索浏览器的历史访问记录。用于根据用户的模糊记忆、时间点或主题快速找回之前看过的网页。',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '可选, 搜索关键词(匹配标题或 URL)' },
          startTime: { type: 'number', description: '可选, 起始时间戳(毫秒数, 如 7 天前)' },
          endTime: { type: 'number', description: '可选, 结束时间戳(毫秒数)' },
          maxResults: { type: 'number', description: '可选, 最大返回条数, 默认 25, 最大 100' },
        },
      },
    },
    {
      name: 'discardTabs',
      description:
        '休眠/挂起指定的标签页以释放浏览器内存(保留标签页标题与位置，点击时秒级唤醒重新激活)。若不传 tabIds，则默认休眠当前窗口所有非激活的闲置标签页。',
      inputSchema: {
        type: 'object',
        properties: {
          tabIds: {
            type: 'array',
            items: { type: 'number' },
            description: '可选，要休眠挂起的标签页 ID 列表(不传则休眠当前窗口全部非激活闲置标签)',
          },
        },
      },
    },
    {
      name: 'saveWorkspace',
      description:
        '将当前窗口的全部或指定标签页保存为一个命名的工作区会话快照(Workspace Snapshot)，便于未来一键还原恢复。',
      inputSchema: {
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
    },
    {
      name: 'listWorkspaces',
      description: '获取所有已保存的项目工作区会话快照列表(含名称、创建时间与包含的网页数量)。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'restoreWorkspace',
      description: '一键恢复并打开之前保存的指定工作区快照中的所有标签页(支持自动恢复标签组)。',
      inputSchema: {
        type: 'object',
        properties: {
          nameOrId: { type: 'string', description: '目标工作区的名称或 ID' },
          inNewWindow: { type: 'boolean', description: '可选，是否在新窗口中打开恢复，默认 false' },
        },
        required: ['nameOrId'],
      },
    },
    {
      name: 'deleteWorkspace',
      description: '删除指定的项目工作区快照。',
      inputSchema: {
        type: 'object',
        properties: {
          nameOrId: { type: 'string', description: '要删除的工作区名称或 ID' },
        },
        required: ['nameOrId'],
      },
      sensitive: true,
    },
    {
      name: 'getRecentlyClosedTabs',
      description: '获取浏览器最近意外关闭或误关的标签页列表(含标题、URL、关闭时间与 sessionId)。',
      inputSchema: {
        type: 'object',
        properties: {
          maxResults: { type: 'number', description: '可选，最大返回条数，默认 15' },
        },
      },
    },
    {
      name: 'restoreClosedTab',
      description: '秒级召回/重新打开最近误关的网页(若指定 sessionId 则恢复该网页，不传则恢复最近关闭的第 1 个网页)。',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: '可选，目标已关闭标签页的 sessionId' },
        },
      },
    },
    {
      name: 'clearBrowsingData',
      description:
        '精细化定向清理浏览器的缓存、Cookie 或本地存储。支持指定特定站点域名(如仅清理当前测试站点，不影响其他网站登录状态)。操作前系统会自动确认。',
      inputSchema: {
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
      sensitive: true,
    },
    {
      name: 'moveTabsToNewWindow',
      description: '将指定的多个标签页移至一个全新的独立浏览器窗口中(实现工作与娱乐多窗口分流)。',
      inputSchema: {
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
    },
    {
      name: 'setTabZoom',
      description: '设置当前或指定标签页的页面缩放比例(如 1.1 为 110% 放大，0.9 为 90% 缩小，1.0 为恢复默认)。',
      inputSchema: {
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
    },
    {
      name: 'searchDownloads',
      description: '检索浏览器的文件下载历史记录(按文件名、URL 或 MIME 类型)，定位已下载的文件。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '可选，搜索关键词(匹配文件名或来源 URL)' },
          mimeType: { type: 'string', description: '可选，文件类型过滤(如 application/pdf, image/png)' },
          limit: { type: 'number', description: '可选，最大返回条数，默认 20' },
        },
      },
    },
  ],

  systemPromptSnippet:
    '【浏览器系统原生管家专属能力 (全维浏览器设置/Tab/工作区/下载/历史/书签)】\n' +
    '你具备直接管理整个浏览器运行环境的系统级权限:\n' +
    '1. 【智能标签页去重与看板】: 当用户提出“整理标签页”、“整理网页”、“查看当前网页”、“关掉重复网页”、“清理标签页”时:\n' +
    '   - 仅调用 listTabs 获取当前打开的所有标签页清单;\n' +
    '   - 【严禁】擅自自动调用 groupTabs 进行分组，也不要擅自直接批量关闭所有网页;\n' +
    '   - 系统界面会自动为用户渲染交互式「标签页去重与清理看板」，包含复选框、重复网页高亮标出、一键勾选重复项与批量关闭按钮;\n' +
    '   - 你只需在回复中简明扼要地汇报标签页总数、检测到的重复网页数量，并引导用户使用下方看板自主操作;\n' +
    '2. 【闲置标签页休眠与释放内存】: 当用户提出“休眠闲置标签页”、“释放内存”、“电脑好卡帮我省内存”时:\n' +
    '   - 调用 discardTabs 休眠非激活的标签页，释放系统内存但保留网页标签与位置;\n' +
    '3. 【项目工作区快照与恢复】: 当用户提出“保存当前工作区/会话”、“恢复上次的工作区”、“查看工作区快照”时:\n' +
    '   - 保存工作区: 调用 saveWorkspace(name="...") 保存快照，可配合 closeAfterSave=true 清爽视口;\n' +
    '   - 还原工作区: 调用 restoreWorkspace(nameOrId="...") 一键重新打开所有网页;\n' +
    '   - 查看工作区: 调用 listWorkspaces 展示历史快照列表;\n' +
    '4. 【误关网页秒级召回】: 当用户提出“刚才不小心关掉的网页帮我找回”、“恢复误关的标签页”时:\n' +
    '   - 调用 getRecentlyClosedTabs 查看最近关闭的列表，或直接调用 restoreClosedTab 重新秒级唤醒打开;\n' +
    '5. 【历史记录追溯与直达链接】: 当用户提出“帮我找之前看过的某篇文章/网页”、“历史访问”时:\n' +
    '   - 调用 searchHistory 检索条目，【必须】将每一个网页标题格式化为可直接点击的 Markdown 超链接（格式如：`1. [网页完整标题](URL)`）；\n' +
    '6. 【定向清理缓存与Cookie】: 当用户提出“清缓存”、“清理当前网站 Cookie”时:\n' +
    '   - 调用 clearBrowsingData 定向清理指定域名，保护其他网站登录态不丢失;\n' +
    '7. 【窗口分流与缩放调节】: 当用户提出“把这些网页放到新窗口”、“放大/缩小网页”时:\n' +
    '   - 调用 moveTabsToNewWindow 将标签页拆分到新窗口，或调用 setTabZoom 调整网页字体与视口缩放;\n' +
    '8. 【下载文件快速定位】: 当用户提出“帮我找今天下载的PDF/文件”时:\n' +
    '   - 调用 searchDownloads 检索已下载的文件并汇报状态。',

  quickActions: [
    {
      id: 'organize-tabs',
      label: '整理与去重标签页',
      prompt: '扫描当前打开的所有标签页，列出全部网页清单并排查重复项',
      icon: '🏷️',
      description: '交互看板展示、去重与自主勾选清理',
    },
    {
      id: 'discard-idle-tabs',
      label: '休眠闲置标签页',
      prompt: '将当前窗口所有非激活的闲置标签页一键休眠，释放浏览器内存占用',
      icon: '💤',
      description: '释放80%+内存，保留网页不丢失',
    },
    {
      id: 'save-workspace',
      label: '保存为工作区快照',
      prompt: '把当前窗口的所有标签页保存为一个命名的工作区会话快照',
      icon: '💾',
      description: '多项目多任务一键保存与随时恢复',
    },
    {
      id: 'restore-closed-tab',
      label: '找回误关网页',
      prompt: '帮我查看最近关闭的标签页并一键恢复找回',
      icon: '🔄',
      description: '秒级唤醒最近意外关闭的网页',
    },
    {
      id: 'search-history',
      label: '查找历史访问',
      prompt: '帮我搜索最近浏览过的技术文章和重要历史网页，并列出可点击直达的链接',
      icon: '🔍',
      description: '自然语言模糊追溯历史并带直达链接',
    },
    {
      id: 'clear-site-cache',
      label: '定向清理站点缓存',
      prompt: '清理当前网站的浏览缓存与 Cookie，不要影响其他网站登录状态',
      icon: '🧹',
      description: '精细化清理，保留其他站点登录态',
    },
  ],
};
