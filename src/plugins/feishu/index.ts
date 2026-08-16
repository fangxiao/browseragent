// 飞书办公生态插件 (Feishu Workspace Plugin)
// 包含: DocX 纯净高保真转 Markdown、本地图片 ZIP 离线归档、PRD 4 维智能逻辑评审雷达

import type { BrowserAgentPlugin } from '../types';

export const FeishuPlugin: BrowserAgentPlugin = {
  id: 'feishu',
  name: '飞书办公生态 Pro',
  description: '飞书 DocX 深度解析、纯净 Markdown 转换、图片离线 ZIP 归档与 PRD 4 维智能评审雷达',
  icon: '📄',
  version: '1.0.0',

  matchUrl: (url: string) => /feishu\.cn|larksuite\.com/i.test(url),

  tools: [
    {
      name: 'exportDocMarkdown',
      description:
        '【一键全量导出文档】自动穿透扫描飞书 (feishu.cn / larksuite.com) 或长文档虚拟列表，高保真转换为纯净标准 Markdown (完整保留 H1~H6 标题、Callout 引用块、表格、代码块、待办清单、图片与附件)，并在侧边栏直接生成下载与离线 ZIP 卡片。此工具为单步终态操作，执行后即已完成，严禁再调用 readPage 或 getArticleOutline！',
      inputSchema: {
        type: 'object',
        properties: {
          textLimit: { type: 'number', description: '最大字符限制, 默认 200000 字符, 支持全量扫描' },
          tabId: { type: 'number', description: '可选, 指定目标标签页 ID' },
        },
      },
    },
  ],

  systemPromptSnippet:
    '【飞书办公与文档生态专属能力】\n' +
    '- 纯粹导出 Markdown 工作流 (单步原子终态操作，绝不追加多余工具调用):\n' +
    '  1. 当用户要求“导出 Markdown”、“转为 md”、“获取文档全文”、“下载 md”或“导出文档”时:\n' +
    '  2. 必须且仅调用 exportDocMarkdown 一次；\n' +
    '  3. 【严禁追加任何工具】：exportDocMarkdown 返回后任务即已全部完成，【严禁】再调用 readPage、getArticleOutline 或 getPagePerformance！\n' +
    '  4. 【严禁输出导读】：严禁输出任何导读脑图、大纲导读、段落溯源或 PRD 评审！\n' +
    '  5. 拿到结果后立即结束回复，仅需简短汇报：“✅ 已为您完整提取飞书文档《xxx》（约 X 字，Y 章节），下方卡片已支持一键复制与下载离线 ZIP。”，侧边栏会自动渲染【📄 文档 Markdown 全文提取】卡片。\n' +
    '- PRD / 架构方案深度智能评审雷达工作流: 【仅当用户明确提出“评审/Review/审阅 PRD/方案评审/架构评审/挑刺找漏洞”等评审意图时才触发】:\n' +
    '  1. 先调用 readPage 读取文档全文;\n' +
    '  2. 进行 4 维深度逻辑扫描并输出以 `# 🛡️ 飞书 PRD / 方案智能评审雷达` 为一级标题的结构化报告: ① 📊 综合质量评分 (0-100分与评级)、② 🔴 严重逻辑冲突与流程死锁、③ 🟡 边界条件与异常分支遗漏、④ 🟢 QA 核心验收测试矩阵、⑤ ☑️ 改进待办清单(Action Items);\n' +
    '  3. 提供复制待办清单与导出 Markdown 报告功能, 不破坏原文档。\n',

  quickActions: [
    {
      id: 'feishu-export-md',
      label: '导出 Markdown / ZIP',
      prompt: '将当前飞书文档全量转为 Markdown 并提供下载',
      icon: '📥',
      description: '高保真提取，完整保留表格、代码块与图片',
    },
    {
      id: 'feishu-prd-review',
      label: 'PRD 4 维逻辑评审',
      prompt: '对当前飞书文档进行 PRD 智能逻辑深度评审，找出死锁与边界遗漏',
      icon: '🛡️',
      description: '4 维逻辑扫描，提取缺陷与 QA 验收矩阵',
    },
    {
      id: 'feishu-action-items',
      label: '提炼核心待办',
      prompt: '梳理这篇文档中的所有待办事项、负责人与推进计划',
      icon: '☑️',
      description: '一键生成项目推进 Todo 清单',
    },
  ],
};
