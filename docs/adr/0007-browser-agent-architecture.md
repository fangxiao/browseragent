# ADR-0007:通用浏览器智能体架构(Agent Loop 分层)

- **状态**:已接受(2026-08-13)
- **关联**:`docs/requirements/requirements.md` v2.0 §3、`docs/design/agent.md`
- **类型**:架构决策

## 背景
自飞书文档助手升级为通用浏览器智能体:AI 需操作任意网页 DOM 完成目标(数据提取/表单/发布/研究)。关键架构问题:Agent Loop 放哪里?工具如何跨 context 执行?安全如何保证?

## 决策

### 1. Agent Loop 在 background,工具执行在 content
- **background** 持有 Agent Loop 状态机(agentLoop.ts,纯逻辑注入依赖):调用 LLM、调度工具、处理确认、循环控制
- **content** 实现 `DomToolExecutor`:DOM 操作必须在页面上下文;与 background 之间只传 JSON(selector + 结构化结果)
- 理由:① 工具执行与规划解耦,便于单测;② content 不持有 provider 凭证;③ 一个会话固定操作用户活动标签页

### 2. 场景 = system 提示词 + 工具子集
- 引擎复用,新增场景只加 `utils/ai/agents/*`(dataExtract/formFill/publish/research)
- 每场景显式声明允许的工具清单,LLM 只能调用白名单内工具

### 3. 安全:敏感操作强制确认
- `safety.ts` 纯函数判定:点击命中"提交/发布/删除/支付"等模式、typeInto 密码框、navigate 跨域 → 挂起等用户确认
- 确认经 sidepanel 弹层,批准才执行;拒绝则回填结果让 AI 调整

### 4. provider tool use 归一化
- Anthropic `tools` / DeepSeek/OpenAI `tool_calls` → 统一 `ToolCall`;解析放纯函数 `toolCallParsing.ts`
- StreamEvent 扩展 `AgentEvent`(thinking/tool-use/tool-result/confirm/done)

### 5. evaluate 默认禁用
- 任意 JS 执行风险高,默认关闭;options 显式开启

## 备选方案(未选)
- **Agent Loop 放 content**:content 需持 provider 凭证且难做跨 provider 复用,放弃
- **工具经 port 双向流**:现有 AI:EVENT port 单向推送,工具结果走独立的 `tabs.sendMessage` 请求-响应更简单,确认响应另设 port 消息
- **jsdom/happy-dom 单测 DOM 工具**:新增运行时依赖 + 环境复杂度,改为纯函数层单测 + DOM 薄壳,放弃

## 后果
- 正面:引擎可测、场景可插拔、安全强制;单测覆盖纯函数层,真机只验证 DOM 壳
- 负面:DOM 工具在真机(任意网站)鲁棒性需逐步打磨;敏感判定依赖模式匹配,存在误判(宁多确认);evaluate 能力受限
