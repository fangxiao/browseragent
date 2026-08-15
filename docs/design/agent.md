# 技术设计:通用浏览器智能体(Browser Agent)

> 文档版本:v1.0(补全)
> 状态:设计阶段,待实现(E1-E7)
> 上游:`docs/requirements/requirements.md` v2.0
> 关联:`docs/design/design.md` §8(本章为其完整展开)、ADR-0007
> 范围:通用 AI 操作任意网页 DOM;飞书降级为普通页面,其读/写能力并入通用工具集

---

## 1. 目标与边界

### 1.1 目标
侧边栏输入目标 → AI 通过浏览器工具自主操作当前页面(读取/点击/输入/滚动/等待/提取/导航),多步"观察→操作→再观察"直到完成或询问;敏感动作(提交/发布/删除/支付)前强制用户确认。

### 1.2 非目标(边界)
- 不做后台常驻代理:仅在侧边栏会话内操作当前标签页
- 不做跨域数据回传:页面内容仅发送给用户配置的 provider
- 不实现多标签页编排(v2 只操作用户当前活动标签;`navigate` 会改变当前标签 URL)
- `evaluate`(任意 JS)默认禁用,不做默认能力

### 1.3 侧重点(ADR-0008,方向性确认)
- **项目亮点 = DOM 元素挖掘 + 信息重组**:从任意页面挖出用户要的元素/数据,并按意图重组(表格化/对比/合并/总结)
- **挖掘由 AI 用自然语言驱动**:LLM 通过语义工具(readPage 元素树 + findElements)定位,extractData 抽取,重组层产出最终结果
- **大脑薄化、可替换**:agent 循环用轻量自研薄 loop(保多 provider),封装为可替换接口(`AgentDriver`);成熟 agent(如 Anthropic Agent SDK)留作后续切换
- 工具执行层(content script)必须本地自研,任何云端 agent 都碰不到用户已打开页面

## 2. 架构总览

```
sidepanel(对话 + Agent 过程展示)
   │ 目标/指令 + 确认响应        思考文本/工具调用/工具结果/确认请求
   ▼                             ▲
background(Agent Loop + 工具路由 + 安全确认)
   │ TOOL:CALL(经 tabs.sendMessage)   │ TOOL:RESULT
   ▼                             ▲
content(通用 DOM 工具执行,任意 http/https 页面)
   ▼
任意网页 DOM
```

**核心原则**(承接 design.md §1):
1. **Agent Loop 在 background**:LLM 调用、工具调度、安全确认、状态机集中在 background,便于跨 provider 复用与单测
2. **工具执行在 content**:DOM 操作必须运行在页面上下文;content 与 background 之间只传 JSON(selector + 结构化结果)
3. **安全先于执行**:所有工具调用经 `SafetyPolicy` 判定;敏感操作暂停等待用户确认
4. **场景 = system + 工具子集**:引擎复用,新增场景只加 `utils/ai/agents/*` 提示词

## 3. 模块与目录(v2 增量)

```
src/
├── entrypoints/
│   ├── content.ts            # 通用工具执行器(任意 http/https 页面)+ 页面提取 + 写回(E1a 已去飞书化)
│   ├── background.ts         # 改造:接入 Agent Loop(现有 provider 流式保留)
│   ├── sidepanel/main.tsx    # 改造:目标输入 + Agent 过程展示 + 确认弹层
│   └── options/main.tsx      # 新增:evaluate 开关(默认关)
├── utils/
│   ├── domTools/
│   │   ├── types.ts          # ToolSpec / ToolCall / ToolResult / 工具输入 schema
│   │   ├── toolRegistry.ts   # 工具清单 + 按名解析 + inputSchema 校验(纯函数)
│   │   ├── elementTree.ts    # 语义元素树构建 + findElements(挖掘核心,纯逻辑可测)
│   │   ├── extractData.ts    # 表格/列表 → {headers, rows} → CSV/JSON(纯函数可测)
│   │   ├── actions.ts        # click/type/scroll/wait/sleep(依赖 DOM,content 内执行)
│   │   ├── safety.ts         # SENSITIVE 白名单匹配 + 判定(纯函数可测)
│   │   └── executor.ts       # 注册表 + actions 装配为 DomToolExecutor
│   ├── ai/
│   │   ├── driver.ts         # AgentDriver 抽象(薄 loop 默认 / 成熟 agent 可替换)
│   │   ├── agentTypes.ts     # AgentRunPayload / AgentEvent
│   │   ├── agentLoop.ts      # 薄 loop 编排(纯逻辑,注入依赖可测)
│   │   ├── toolCallParsing.ts# Anthropic/OpenAI tool_use 归一化(纯函数可测)
│   │   ├── recombine.ts      # 信息重组:mergeTables/mdTableToCsv(纯逻辑可测)
│   │   └── agents/
│   │       └── index.ts      # 智能体通用提示词与工具集构建(buildAgentSystem / buildAgentTools)
│   ├── domTools/form.ts      # 表单纯函数:findOptionIndex(select 选项定位,可测)
│   ├── messaging.ts          # 扩展:TOOL:CALL / TOOL:RESULT / AGENT:* / AI:EVENT
│   └── sidepanelClient.ts    # 扩展:startAgentSession / confirm 响应 / stop
└── tests/
    ├── domTools/extractData.test.ts   # 数据提取纯函数(CSV/JSON/列投影)
    ├── domTools/safety.test.ts        # 敏感操作判定(navigate 注入 origin)
    ├── domTools/toolRegistry.test.ts  # schema 校验/工具名解析/子集过滤
    ├── domTools/elementTree.test.ts   # 语义元素树构建 + findElements
    ├── domTools/form.test.ts          # select 选项定位
    ├── ai/agentLoop.test.ts           # Loop 编排(注入 fake provider + fake executor)
    ├── ai/toolCallParsing.test.ts     # Anthropic/OpenAI tool_use 解析
    ├── ai/agents.test.ts              # 通用提示词与工具集约束单测
    └── ai/recombine.test.ts           # 表合并 / md 表格 → CSV
```

## 4. 核心类型与接口

### 4.1 工具定义(ToolSpec)

```ts
// utils/domTools/types.ts
export interface ToolSpec {
  name: string;
  description: string;                       // 给 LLM 看
  inputSchema: Record<string, unknown>;      // JSON Schema(参数)
  /** 是否可能触发敏感/破坏性动作(见 safety.ts) */
  sensitive?: boolean;
  /** content 侧执行函数;返回 JSON 可序列化结果 */
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolCall {
  id: string;                  // 关联 LLM 的 tool_use id
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  /** 结构化结果(回填 LLM) */
  data?: unknown;
  /** 失败原因(回填 LLM 重试) */
  error?: string;
}
```

### 4.2 Agent 事件(StreamEvent 扩展,单向 background → sidepanel)

```ts
// utils/ai/agentTypes.ts —— 新增事件类型,追加到现有 StreamEvent 联合
export type AgentEvent =
  | { type: 'agent-thinking'; text: string }   // AI 推理文本(增量)
  | { type: 'tool-use'; call: ToolCall }        // 即将执行某工具(展示)
  | { type: 'tool-result'; call: ToolCall; result: ToolResult } // 工具结果(展示 + 回填)
  | { type: 'confirm-request'; confirmId: string; summary: string; tool: ToolCall } // 需用户确认
  | { type: 'confirm-result'; confirmId: string; approved: boolean }
  | { type: 'agent-done'; summary: string }
  | { type: 'text-delta'; text: string }        // 复用现有文本增量(最终输出)
  | { type: 'done' }
  | { type: 'error'; message: string };
```

> 说明:`StreamEvent` 现有定义在 `utils/ai/provider/types.ts`;新增事件为 Agent 会话专属,建议新联合 `AgentEvent` 与 provider 层解耦(见 4.3)。

### 4.3 运行请求

```ts
// utils/ai/agentTypes.ts
export interface AgentRunPayload {
  /** 对话历史(不含 system;system 由 background 生成) */
  messages: ChatMessage[];
  providerId?: string;
  /** 工具执行目标标签页(由 sidepanel 在启动时携带) */
  tabId: number;
}
```

### 4.4 content 侧工具执行器接口

```ts
// utils/domTools/types.ts
export interface DomToolExecutor {
  /** 执行工具;返回结构化结果 */
  execute(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  /** 可用的工具清单(供 LLM schema) */
  list(): ToolSpec[];
}
```

`content.ts` 实现 `DomToolExecutor`(运行在页面上下文),`agentLoop.ts` 只持有接口引用,不直接碰 DOM。

## 5. 消息协议扩展(messaging.ts)

```ts
// background ↔ content(经 chrome.tabs.sendMessage)
export type ToolRequest = { type: 'TOOL:CALL'; call: ToolCall };
export type ToolResponse = { type: 'TOOL:RESULT'; callId: string; result: ToolResult };

// 对话流:sidepanel ↔ background(经命名 Port STREAM_PORT_NAME)
export interface PortStreamMessage { type: 'AI:EVENT'; event: StreamEvent; }   // 保留 M1 对话流
export interface PortStartMessage   { type: 'AI:START'; payload: AiRunPayload; }

// Agent 流:sidepanel ↔ background(经命名 Port AGENT_PORT_NAME='agent-stream')
export type AgentPortMessage =
  | { type: 'AGENT:START'; payload: AgentRunPayload }       // 启动 Agent 运行
  | { type: 'AGENT:EVENT'; event: AgentEvent }              // background → sidepanel 事件流
  | { type: 'AGENT:CONFIRM'; confirmId: string; approved: boolean } // 安全确认响应
  | { type: 'AGENT:STOP' };                                 // 停止当前运行
```

> 2026-08-14 起侧边栏统一为**交互式对话**:输入目标 → Agent 流(AGENT:*)。M1 文档对话流(对话流/AI:START、EXTRACT、写回)协议保留(协议层兼容),UI 不再使用。

## 6. 工具集(content 实现)—— 核心亮点

> **定位**:工具层是项目最大差异化(ADR-0008)。围绕"挖元素 + 重组"设计,核心是**语义元素树 + 语义查询**,让 AI 用自然语言就能定位、抽取、重组。

### 6.1 挖掘工具(重点)

| 工具 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `readPage` | `{selector?}` | `{url, title, summary, tree}` | **核心**:输出分层**语义元素树**(role/类型/可访问名/可见文本/层级,深度≤4/子≤20 超限折叠),AI 据此理解页面结构 |
| `findElements` | `{role?, type?, text?, placeholder?, keyword?}` | `{count, elements[]}` | **核心**:按语义条件精确定位(如 role=button+text=提交;input+placeholder=邮箱);返回定位器与摘要供后续 click/type/extract |
| `clickElement` | `{selector, description?}` | `{ok}` | 点击;先经 `SafetyPolicy` 判定 |
| `typeInto` | `{selector, text, clear?}` | `{ok}` | 聚焦输入框,支持先清空 |
| `scrollTo` | `{selector?, direction?}` | `{ok}` | 滚动到元素或按方向滚动 |
| `waitFor` | `{selector, timeoutMs?}` | `{found, selector}` | 轮询等待元素出现 |
| `sleep` | `{ms}` | `{ok}` | 等待(页面加载/异步渲染) |
| `extractData` | `{selector, format?: 'csv'\|'json', columns?}` | `{rows, hasHeader, csv?, json?}` | 表格/列表 → 结构化数据;`columns` 指定只取某几列(重组前置,需有表头) |
| `getPageInfo` | - | `{url, title, lang}` | 当前页信息 |
| `navigate` | `{url}` | `{ok, url}` | **background 经 tabs.update 跳转**(content 侧为占位);`currentOrigin` 由 background 注入用于跨域判定;导航后等待页面加载完成 |
| `evaluate` | `{js}` | `{ok, result}` | **默认禁用**;options 开关开启后可用(高风险) |

### 6.2 语义元素树(设计要点)

- 节点 = `{ tag, role, type, label(可访问名), text(可见文本摘要), selectable(selector 提示), children[] }`
- `readPage` 返回根级节点 + 每节点限 `maxDepth`/`maxChildren`,超限折叠为 `{folded: count}` 提示
- AI 拿到树后:先 `readPage` 概览 → `findElements` 精确定位 → `extractData` 抽取 → 重组
- 选择器优先语义(`[role=button]`/`aria-label`/可见文本),对 class 变化不敏感;失败回填 `error` 让 AI 换策略

### 6.3 信息重组层(亮点之二,`utils/ai/recombine.ts`)

抽取的**原始数据**不是终点,交给 AI 按用户意图重组(此层在 background 由 AI 完成,纯数据输入):

- 多卡片/多行 → **合并为一张表**(同构字段对齐)
- 表内散列 → **按需重排列**(只留用户要的列/行)
- 跨页面数据 → **对比表**(规格/价格/评分并排)
- 研究资料 → **结构化总结**(要点/结论/引用)

> 重组是 S1-S4 差异化核心:引擎只有一套挖掘工具,重组逻辑由各场景 system 提示词驱动(见 §9)。

## 7. Agent 大脑(薄 loop,ADR-0008)

> 重点不在实现 agent 底层;循环是**薄适配层**,封装为可替换接口。真正的投入在 §6 挖掘工具与 §9 重组。

### 7.1 可替换大脑(AgentDriver)

```ts
// utils/ai/driver.ts —— 大脑抽象:薄 loop 是默认实现,成熟 agent 可平滑替换
export interface AgentDriver {
  run(req: AgentRunPayload, hooks: AgentHooks): Promise<void>;
}
interface AgentHooks {
  onEvent(e: AgentEvent): void;              // 推给 sidepanel
  executeTool(call: ToolCall): Promise<ToolResult>; // 经 content 执行;navigate 由 background 拦截处理
  requestConfirm(call: ToolCall, reason: string, confirmId: string): Promise<boolean>; // 敏感操作确认
  getCurrentOrigin?(): string;               // 当前页面 origin(navigate 跨域判定)
  signal(): AbortSignal;                     // 停止信号
}
// 实现:ThinLoopDriver(默认,多 provider)/ MatureAgentDriver(后续可选)
```

### 7.2 薄 loop 算法(默认实现)

```
1. sidepanel AGENT:START {scenario, messages, tabId}
2. background 生成 system(scenario) + tools schema(该场景子集)
3. 循环(maxSteps=25,默认;可配置):
   a. provider.stream(messages, tools, signal) —— 流式收集
   b. 事件分流:
      · text → 转发 agent-thinking / text-delta
      · tool_use → 构造 ToolCall
        1. SafetyPolicy 判定(命中敏感 → requestConfirm 挂起等待)
        2. 经 tabs.sendMessage(tabId, TOOL:CALL) 发 content 执行
        3. content 返回 TOOL:RESULT
        4. 事件回填:工具结果作为 tool-result 消息追加到 messages → 回到 3
      · assistant 最终文本 → agent-done(summary)→ 结束
4. 异常:工具失败 → 结果含 error 回填,LLM 决定重试/换策略
5. 停止:AGENT:STOP / 循环上限 / port 断开 → abort provider + 清理
```

### 7.3 状态机(纯逻辑,`agentLoop.ts`)

```ts
type LoopState =
  | { phase: 'idle' }
  | { phase: 'running'; step: number }
  | { phase: 'awaiting-confirm'; confirmId: string; pending: ToolCall }
  | { phase: 'done'; summary: string }
  | { phase: 'error'; message: string };

// 输入:provider 事件序列 + 确认响应 + 工具执行器
// 输出:发给 sidepanel 的事件序列 + 最终状态
// 纯函数化设计:注入 (streamProvider, executeTool, sendEvent, getConfirm)
// → 便于单测(不依赖真实网络/DOM)
```

### 7.3 provider 适配(新增 tool use)
- **Anthropic**:请求体加 `tools:[{name,description,input_schema}]`;SSE 解析 `content_block_start(type=tool_use)` 累积 `input` → 产出 ToolCall;工具结果以 `{role:'user', content:[{type:'tool_result', tool_use_id, content}]}` 回填
- **DeepSeek / OpenAI 兼容**:请求体加 `tools`;解析 `delta.tool_calls[].function`;回填 `{role:'tool', tool_call_id, content}`;`choices[].finish_reason === 'tool_calls'` 时继续循环
- 统一:provider 层把两者都归一为 `AgentEvent['tool-use']` / 结构化回填消息(新增 `utils/ai/toolCallParsing.ts` 纯函数负责解析,单测覆盖)

## 8. 安全设计(重点)

### 8.1 敏感动作白名单(safety.ts,纯函数)

```ts
// 点击目标命中以下可访问名/文本/type → 判定为敏感
const SENSITIVE_PATTERNS = [
  /提交/i, /发布/i, /保存/i, /删除/i, /支付/i, /付款/i, /下单/i,
  /确认.*(删除|发布|支付|提交)/i, /settle|checkout|delete|submit|publish|pay/i,
  /type\s*=\s*"submit"/i,
];
// 另有:typeInto 密码框(type=password)→ 提示性确认
// navigate 离开当前域 → 确认
```

判定函数:`isSensitiveToolCall(call: ToolCall): { sensitive: boolean; reason?: string }`

### 8.2 确认流程
1. background 判定敏感 → 发 `confirm-request`(含 summary + tool 描述)→ 状态切 `awaiting-confirm`
2. sidepanel 弹层展示"AI 想执行:<动作>,是否允许?"
3. 用户批准/拒绝 → `AGENT:CONFIRM {confirmId, approved}`
4. 批准 → 执行并继续;拒绝 → 结果回填 `{ok:false, error:'用户拒绝'}` 让 AI 调整

### 8.3 其他
- `evaluate` 默认禁用(options 开关,默认 off)
- 用户随时可停止(AGENT:STOP);过程步骤流(AgentStepCard)实时可见
- 不做跨域回传:所有页面数据只流向用户所选 provider

## 9. 智能体提示词与工具调度(utils/ai/agents/)

统一使用通用智能体 System 提示词 (`buildAgentSystem`) 与全量默认可用工具集 (`buildAgentTools`)，无需预设僵化的细分场景分类。

- **System 提示词规范**：明确告知 AI 观察（readPage / findElements）、交互（clickElement / typeInto / scrollTo / waitFor / sleep）、数据提取（extractData / Markdown 表格输出）等全套能力。
- **安全与合规约束**：敏感动作停留在提交/确认前、处理懒加载滚动策略、自然语言友好沟通、严禁虚构未提供的信息。
- **工具集构建**：由 `buildAgentTools()` 导出默认工具集（排除高危的 `evaluate`），并通过 `toLlmTools` 转换给 Provider 进行 Tool Calling。

## 10. 侧边栏(统一交互式对话)

- **单一对话流**：用户输入自然语言目标 → 追加 user 气泡 + agent 消息；agent 运行的思考、步骤、确认、结果全部内嵌在该消息中。
- **通用助手模式**：AI 自主判断任务类型，全工具集调度，敏感操作由安全策略自动拦截并弹出确认。
- **空状态欢迎卡**：介绍通用操作能力与提示示例；输入问好时友好回应，不盲目调用工具。
- **AgentMessage**：智能体标识 + 思考过程（流式灰字） + 过程步骤卡片 + 内嵌安全确认 + 最终 Markdown 渲染结果 + 复制。
- **AgentStepCard**：`agent-thinking`、`tool-use`（工具名 + 参数摘要）、`tool-result`（ok/error 摘要）、`agent-done`（summary）。
- **内嵌确认**：对话内卡片 "⚠️ 允许 AI 执行:<动作> [拒绝][允许]" → AGENT:CONFIRM。
- **结果导出**：`ExportButtons` —— `extractData` 结果或最终结果含 Markdown 表格时，自动提供 CSV 下载（Blob 带 BOM）与一键复制。
- **停止按钮**：运行中可随时通过 AGENT:STOP 终止运行。
- **会话持久化**：支持新建对话、本地历史列表切换与删除（存储于 `chrome.storage.local`，防抖保存）。

## 11. 测试计划(TDD,新增 tests/)

> 项目 vitest 为 node 环境。策略:**纯函数层全部单测**,DOM 依赖层(content)抽薄壳 + E2E 手动验证清单。不新增 jsdom/happy-dom 依赖(避免引入环境复杂度)。

| 文件 | 覆盖 | 验收 |
|---|---|---|
| `domTools/extractData.test.ts` | 表格/列表 → rows/CSV/JSON(空值/零宽/列投影) | 关键格式正确 |
| `domTools/safety.test.ts` | 敏感文本(中/英)/密码框/navigate 跨域(含注入 origin) | 白名单判定准确 |
| `domTools/toolRegistry.test.ts` | 按名解析、必填校验、子集过滤 | 注册表完整 |
| `domTools/elementTree.test.ts` | 语义树折叠 / findElements 匹配 | 挖掘准确 |
| `domTools/form.test.ts` | findOptionIndex select 定位 | 表单填充可靠 |
| `ai/toolCallParsing.test.ts` | Anthropic tool_use SSE、OpenAI tool_calls delta | 归一化正确 |
| `ai/agentLoop.test.ts` | 正常完成/敏感暂停→批准/拒绝/循环上限/停止 | 编排全分支 |
| `ai/agents.test.ts` | 场景 system 非空/onDone 拼接/工具子集 ⊆ 注册表/关键指令 | 场景约束 |
| `ai/recombine.test.ts` | mergeTables 并集补空 / mdTableToCsv 提取 | 重组正确 |

**E2E 手动清单**(各场景完成后):任意数据表格页 → 提取 → CSV 下载;表单 → 停在提交前;发布 → 发布前确认;研究 → 跨站导航确认。

## 12. 里程碑对应(E1-E7)

| 里程碑 | 内容 | 测试先行 |
|---|---|---|
| E1 | 通用 DOM 工具层:types/toolRegistry/elementTree/extractData/actions/safety/executor + content 工具执行器 + messaging 扩展 + 任意页面注入 | extractData/safety/toolRegistry/elementTree 单测 |
| E2 | 薄 loop + provider tool use:driver/agentTypes/agentLoop/toolCallParsing + background 接入(ADR-0008) | toolCallParsing/agentLoop 单测 |
| E3 | 安全确认 + 侧边栏过程展示:AgentStepCard/AgentConfirmModal/场景选择/停止 | agents 单测 |
| E4 | 场景 S1 数据提取闭环(下载/复制 + 重组对比) | recombine 单测 + E2E 手动清单 |
| E5 | 场景 S2 表单自动化 | E2E 手动清单 |
| E6 | 场景 S3/S4(发布含多平台确认;研究含重组总结) | E2E 手动清单 |
| E7 | 测试与文档同步 + 提交 | 全绿 |

## 13. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 页面选择器脆弱(class 变化) | 工具失败 | 语义/可访问性优先 + 失败回填重试 |
| provider tool use 差异 | 归一化错误 | toolCallParsing 纯函数 + 单测隔离 |
| 敏感误判(漏判危险操作) | 安全 | 白名单保守(宁多确认);navigate 跨域强制确认 |
| 误判过多 → 用户疲于确认 | 体验 | 确认摘要清晰 + 拒绝不阻断会话 |
| content 未注入(页面在扩展加载前打开) | 工具无响应 | 失败回填"刷新页面";侧边栏提示 |
| SPA 动态渲染延迟 | waitFor 失败 | sleep/waitFor 重试策略 + 提示刷新 |

---

## 附:与 design.md §8 的对应
本文档为 design.md §8(8.1-8.6)的完整展开与落地细节;§8 保持总览,细节以本文档为准。实现时以本文档为唯一实现依据。
