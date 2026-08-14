# 技术设计:飞书文档 AI 提效助手(M1)

> 文档版本:v0.2
> 状态:**已实现(M1)** 2026-08-13;实现与本文档一致
> 上游:`docs/requirements/requirements.md`
> M1 交付:飞书适配 + 侧边栏 + AI 引擎(多 provider)+ 设置页 + T1/T2/T6 能力;M2 其余类型提示词预留

---

## 1. 架构总览

```
┌────────────────────────── Chrome Extension (MV3 / WXT) ──────────────────────────┐
│                                                                                  │
│  entrypoints/content(飞书页面)         entrypoints/background                    │
│  ┌──────────────────────────┐         ┌──────────────────────────────┐          │
│  │ FeishuAdapter            │         │ 消息路由 (runtime.onMessage)   │          │
│  │  · URL 匹配/识别         │◄────────►│  AI 引擎                     │          │
│  │  · DOM → DocContent      │  post   │   · ProviderClient           │          │
│  │  · Markdown 序列化       │  message│   · 提示词模板(按文档类型)     │          │
│  └──────────────────────────┘         │   · token 估算/分段          │          │
│                                       └───────────────┬──────────────┘          │
│                                                       │ SSE 流(port 消息)      │
│  entrypoints/sidepanel (React)                        ▼                        │
│  ┌──────────────────────────────┐         ┌──────────────────────┐             │
│  │ 内容面板/能力面板/结果区/隐私确认│────────►│ Provider: Anthropic  │             │
│  │ 流式渲染 · 复制 · 重新生成     │  fetch  │          DeepSeek     │             │
│  └──────────────────────────────┘         │          OpenAI 兼容   │             │
│  entrypoints/options (设置页)             └──────────────────────┘             │
│  · provider 配置 · 阈值 · 隐私                                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

**核心原则**:
1. **平台隔离**:所有平台差异收敛在 `PlatformAdapter`;飞书首发,钉钉/企微只加 adapter
2. **AI 引擎复用**:提示词与 provider 逻辑与平台无关
3. **用户主动触发**:插件不做后台扫描;文档内容仅在用户点击 AI 操作时才提取并发送
4. **无自动写回**(M1):结果侧边栏展示 + 一键复制,由用户粘贴回文档

## 2. 模块与目录

```
src/                          # WXT 默认源码根
├── entrypoints/
│   ├── background.ts         # 消息路由 + AI 请求(规避 content 的 CORS)
│   ├── content.ts            # 注入飞书页面,调用 FeishuAdapter
│   ├── sidepanel/
│   │   ├── index.html
│   │   └── main.tsx          # 侧边栏 UI
│   └── options/
│       ├── index.html
│       └── main.tsx          # 设置页
├── components/               # React 组件(结果区/能力列表/隐私确认等)
├── utils/
│   ├── platform/
│   │   ├── types.ts          # PlatformAdapter 接口 + DocContent 类型
│   │   ├── feishu/
│   │   │   ├── detect.ts     # URL 匹配、元数据
│   │   │   ├── extract.ts    # DOM → blocks
│   │   │   └── markdown.ts   # blocks → Markdown
│   │   └── index.ts          # adapter registry
│   ├── ai/
│   │   ├── provider/
│   │   │   ├── types.ts      # ProviderClient 接口 + StreamEvent
│   │   │   ├── anthropic.ts
│   │   │   ├── deepseek.ts
│   │   │   ├── openaiCompat.ts
│   │   │   └── index.ts      # 按配置选 provider
│   │   ├── prompts/
│   │   │   ├── review.ts     # T1 需求评审
│   │   │   ├── report.ts     # T2 周报补全
│   │   │   ├── general.ts    # T6 润色/翻译/摘要
│   │   │   └── index.ts
│   │   ├── docType.ts        # 文档类型识别(规则 + LLM 兜底)
│   │   ├── tokens.ts         # token 估算
│   │   └── streaming.ts      # SSE 事件统一解析
│   ├── storage.ts            # chrome.storage.local 封装(provider 配置/历史)
│   └── messaging.ts          # content ↔ background ↔ sidepanel 消息类型
├── tests/                    # 单元测试(Vitest)
├── assets/                   # 图标
└── wxt.config.ts             # manifest 配置
```

## 3. 核心接口

### 3.1 PlatformAdapter(平台隔离)

```ts
interface PlatformAdapter {
  readonly id: 'feishu' | 'dingtalk' | 'wecom';
  detect(url: string): boolean;              // 是否匹配本平台
  extract(doc: Document): Promise<DocContent>; // 从页面 DOM 提取
}

interface DocContent {
  platform: PlatformAdapter['id'];
  title: string;
  docId: string;
  blocks: Block[];        // 结构化块(段落/标题/列表/表格/引用)
  markdown: string;       // 序列化后的 Markdown
  blockCount: number;
}
```

### 3.2 ProviderClient(AI 服务商隔离)

```ts
interface ProviderClient {
  id: 'anthropic' | 'deepseek' | 'openai-compat';
  stream(req: StreamRequest): AsyncIterable<StreamEvent>; // 统一流事件
}

type StreamEvent =
  | { type: 'text-delta'; text: string }   // 增量文本
  | { type: 'done' }
  | { type: 'error'; message: string };
```

### 3.3 消息协议(content ↔ background ↔ sidepanel)

```ts
// sidepanel → background
{ type: 'AI:RUN', doc: DocContent, docType: DocType, capability: CapabilityId, providerId: string }
// content → background(由 sidepanel 触发时反向拉取)
{ type: 'EXTRACT:REQUEST' } / { type: 'EXTRACT:RESULT', doc: DocContent }
// background → sidepanel(经 Port 流式)
{ type: 'AI:STREAM', event: StreamEvent }
```

## 4. 关键流程

### 4.1 提取与识别
1. 用户打开飞书文档,侧边栏可见(内容面板显示"检测中")
2. sidepanel → content 发 `EXTRACT:REQUEST`
3. content 用 `FeishuAdapter.extract()` 提取 blocks + markdown + 标题
4. 返回侧边栏:标题、自动识别文档类型(置信度)、token 估算;用户可手动改类型

### 4.2 AI 处理(流式,对话式,ADR-0006)
1. 用户点快捷能力或输入问题;首轮 user = 能力指令 + 文档内容,追问为纯文本
2. 隐私确认(发送内容到 {provider}?)→"本会话记住"可跳过后续确认
3. sidepanel 将**完整对话历史**经 Port 发给 background;background 按能力生成稳定 system 并透传历史 → `ProviderClient.stream()`
4. 经 Port 逐事件推送到侧边栏,作为一条 assistant 消息流式渲染
5. 每条回复可复制 / 重新生成;多轮追问上下文保留在会话内

## 5. 关键选型与理由

| 决策 | 选择 | 理由 |
|---|---|---|
| 扩展框架 | WXT | 2026 主流;manifest 自动生成;多浏览器;dev/HMR 体验好 |
| UI | React + Tailwind | 侧边栏组件化效率高;Tailwind 快速样式 |
| 构建 | Vite(内置) | WXT 依赖 Vite |
| AI 调用位置 | background | 规避 content script 的 CORS 限制;sidepanel 直连亦需处理 |
| 流式协议 | 各自适配 → 统一事件 | Anthropic(SSE)/DeepSeek(OpenAI 兼容 SSE)/OpenAI 兼容格式统一抽象 |
| Key 存储 | chrome.storage.local | 仅本机;不出扩展 |
| 写回 | 一键复制(v1) | 避免 DOM 注入脆弱性;稳定优先 |

## 6. 非功能落点

- **性能**:提取在 content 同步 DOM 遍历,单文档 ≤2s;流式首 token ≤3s
- **稳定性**:DOM 提取做防御式(可选链 + 缺失降级);表格无法保真时降级纯文本并提示
- **可测性**:`extract.ts`、`markdown.ts`、`streaming.ts`、`prompts/*` 纯函数化,便于 Vitest 覆盖

## 7. 里程碑对应
- 本设计覆盖 M1;M2(其余文档类型 = 新增 prompts + 能力项)、M3(新增 adapter)、M4(写回增强)在接口层已预留,不在本版本实现。

---

## 8. v2 通用浏览器智能体架构(需求 v2.0)

> 自飞书专用升级为通用 AI 操作 DOM。飞书读/写并入通用工具集,不再特殊对待。

### 8.1 整体

```
sidepanel(对话 + Agent 过程展示)
   │ 目标/指令                    思考/工具调用/结果
   ▼                               ▲
background(Agent Loop + 工具路由 + 安全确认)
   │ 工具调用(经消息)               │ 执行结果
   ▼                               ▲
content(通用 DOM 工具执行)
   ▼
任意网页
```

### 8.2 Agent Loop
1. 用户给目标 → 组装场景 system + 工具 schema(JSON) → LLM 流式
2. LLM 返回 `tool_use` → 校验安全(敏感操作需确认)→ 经 content 执行
3. 执行结果回填 → LLM 继续,直到 `完成` / 询问 / 需确认
4. 循环上限与手动停止

### 8.3 工具集(content,新增 utils/domTools/)
- `readPage` / `clickElement` / `typeInto` / `scrollTo` / `waitFor` / `sleep`
- `extractData`(表格/列表 → CSV/JSON)
- `navigate` / `getPageInfo`
- `evaluate`(默认禁用)
- 模块:`types.ts` / `toolRegistry.ts` / `readPage.ts` / `extractData.ts` / `actions.ts` / `safety.ts`

### 8.4 provider tool use(扩展 provider 层)
- StreamEvent 增加 `tool-use` / `tool-result` 类型(完整见 `AgentEvent`)
- Anthropic `tools` 参数;DeepSeek/OpenAI `tools` + `tool_calls` 解析
- 解析归一化放纯函数 `utils/ai/toolCallParsing.ts`;Agent Loop 消费结构化工具调用

### 8.5 安全
- 敏感操作(提交/发布/删除/支付)按钮由 `SENSITIVE_PATTERNS` 匹配 → 强制确认
- 确认经 sidepanel 弹层 → 用户批准后才执行;拒绝回填结果让 AI 调整
- `navigate` 离开当前域、`typeInto` 密码框也触发确认

### 8.6 场景 = system 提示词 + 工具子集(新增 utils/ai/agents/)
- `dataExtract.ts`(S1)/ `formFill.ts`(S2)/ `publish.ts`(S3)/ `research.ts`(S4)

> **完整落地设计见 `docs/design/agent.md`(模块/接口/协议/Loop 算法/测试计划)。**
