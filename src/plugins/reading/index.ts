// 泛网页沉浸式阅读伴侣插件 (Reading & Citation Plugin)
// 包含: H1~H4 多级大纲脑图提取、平滑滚动高亮脉冲、微型锚点 [📍 1] 精准引用溯源

import type { BrowserAgentPlugin } from '../types';

export const ReadingPlugin: BrowserAgentPlugin = {
  id: 'reading',
  name: '沉浸阅读与精准溯源',
  description: '多级大纲脑图解析、文章核心脉络梳理、平滑滚动高亮脉冲与 [📍 1] 精准原文论据溯源',
  icon: '📖',
  version: '1.0.0',

  matchUrl: () => true, // 全网可用

  tools: [
    {
      name: 'getArticleOutline',
      description:
        '提取文章的多级目录大纲树(H1~H4)与段落锚点信息。返回包含层次结构的大纲列表、总章节数与预估字数。用于沉浸式阅读、大纲导读、段落跳转定位。',
      inputSchema: {
        type: 'object',
        properties: {
          maxDepth: { type: 'number', description: '最大提取深度 (1-4, 默认 4)' },
          tabId: { type: 'number', description: '可选, 指定目标标签页 ID' },
        },
      },
    },
    {
      name: 'highlightAndScrollTo',
      description:
        '平滑滚动网页视口至指定段落锚点，并施加 2 秒柔光高亮脉冲动画。用于 AI 解读与文章原段落之间的精准定位与穿梭。',
      inputSchema: {
        type: 'object',
        properties: {
          anchorId: { type: 'string', description: '段落锚点 ID (由 getArticleOutline 返回)' },
          textSnippet: { type: 'string', description: '可选, 补充文本片段以辅助精确定位' },
          tabId: { type: 'number', description: '可选, 指定目标标签页 ID' },
        },
        required: ['anchorId'],
      },
    },
  ],

  systemPromptSnippet:
    '【网页长文阅读伴侣与精准溯源专属能力】\n' +
    '- 当用户要求阅读、总结、速读、深度解读或针对长文/文档提问时:\n' +
    '  1. 【严格实时读取当前激活页】严禁凭历史对话残留臆断! 必须先调用 getArticleOutline(或 readPage) 直接读取当前激活标签页的内容,确保总结的内容 100% 对应用户当前正在浏览的网页;\n' +
    '  2. 梳理文章脉络,输出包含:📌【一句话核心主旨】、📑【章节精读与关键论点】、💡【深度洞察与数据结论】的结构化报告;【严禁误输出 PRD 评审或评分!】;\n' +
    '  3. 【必须精准溯源】在输出的每一个核心论点、论据或关键数据后面,规范附带微型溯源链接,格式统一为: `[📍 1](cite:anchor-1)`、`[📍 2](cite:anchor-2)`(其中 anchor-ID 对应 getArticleOutline 返回的 anchorId)。用户点击后网页将一秒穿梭至原文段落并闪烁高亮!\n',

  quickActions: [
    {
      id: 'reading-summary',
      label: '深度精读与洞察',
      prompt: '梳理这篇文章的核心脉络，提炼主旨、章节精读与深度洞察，并附带精准段落溯源',
      icon: '💡',
      description: '生成带 [📍] 溯源标记的高价值研报',
    },
    {
      id: 'reading-outline',
      label: '提取大纲与脑图',
      prompt: '提取当前网页的多级大纲目录结构与核心章节锚点',
      icon: '📑',
      description: '可视化大纲树与段落快速导航',
    },
  ],
};
