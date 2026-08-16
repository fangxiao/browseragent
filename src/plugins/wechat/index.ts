// 微信公众号自媒体创作插件 (WeChat Publisher Plugin)
// 包含: 全内联精美主题排版、草稿箱字段注入 (标题/作者/摘要/正文)

import type { BrowserAgentPlugin } from '../types';

export const WechatPlugin: BrowserAgentPlugin = {
  id: 'wechat',
  name: '微信公众号创作 Pro',
  description: '全内联 CSS 精美排版引擎、爆款标题与 120 字摘要提炼、微信公众平台图文草稿一键注入',
  icon: '✍️',
  version: '1.0.0',

  matchUrl: (url: string) => /mp\.weixin\.qq\.com/i.test(url),

  tools: [
    {
      name: 'writeWechatDraft',
      description:
        '将生成或排版好的图文内容自动转换为微信公众号专属的精美全内联富文本(含科技蓝/微信绿/极简黑/典雅紫等主题样式、Mac代码块、双色标题、优雅引用框), 并自动注入 mp.weixin.qq.com 编辑器的标题、作者、120字摘要与正文。',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '文章主标题(微信建议64字以内)' },
          author: { type: 'string', description: '文章作者名' },
          digest: { type: 'string', description: '图文摘要引言(微信限制120字以内)' },
          contentMarkdown: { type: 'string', description: '正文 Markdown 源码(自动转化为全内联微信样式)' },
          htmlContent: { type: 'string', description: '直接传入渲染好的 HTML(可选,优先于 contentMarkdown)' },
          theme: {
            type: 'string',
            description: '排版主题: tech-blue(科技蓝,默认)|wechat-green(微信绿)|minimal-black(极简黑)|elegant-purple(典雅紫)|warm-amber(暖阳琥珀)',
          },
          tabId: { type: 'number', description: '可选,指定要写入的微信后台标签页 ID' },
        },
      },
    },
  ],

  systemPromptSnippet:
    '【微信公众号创作与草稿写入专属能力】\n' +
    '- 当用户要求写文章并发布/写入微信公众号草稿时:\n' +
    '  1. 撰写正文,提炼 64 字以内爆款标题与 120 字引言摘要,并生成精美 Markdown 内容;\n' +
    '  2. 调用 listTabs 寻找当前打开的标签页中是否有 mp.weixin.qq.com 微信公众平台图文草稿页:\n' +
    '     - 若找到了微信后台标签页:立即调用 writeWechatDraft(tabId=...) 将排版好的文章注入微信草稿箱,并向用户汇报字数、标题与摘要;\n' +
    '     - 若未找到微信后台标签页(用户未打开微信后台):【严禁去列出或对比其他无关标签页!】在回答顶部输出醒目的提示卡片:\"⚠️ **未检测到微信公众平台草稿页**\\n\\n当前浏览器标签页中未找到已打开的 `mp.weixin.qq.com` 图文编辑页。\\n\\n💡 **操作指引**:\\n1. 请在浏览器中打开 [微信公众平台 (mp.weixin.qq.com)](https://mp.weixin.qq.com) 微信图文编辑草稿页;\\n2. 打开后直接在对话框回复 **‘写入公众号’**,我将立即为你自动排版注入;\\n3. 或直接复制下方文章使用。\",随后完整输出生成好的推荐标题、120字摘要与文章正文;\n',

  quickActions: [
    {
      id: 'wechat-format-draft',
      label: '注入公众号草稿',
      prompt: '将当前文章按科技蓝精美主题排版，并注入到微信公众平台草稿箱',
      icon: '🚀',
      description: '全内联样式排版，写入标题、摘要与正文',
    },
    {
      id: 'wechat-titles',
      label: '生成 5 个爆款标题',
      prompt: '为当前文章构思 5 个符合微信公众号传播特点的高点击率爆款标题与 120 字摘要',
      icon: '🔥',
      description: '结合悬念、痛点与数字法则',
    },
  ],
};
