# 里程碑:v2 通用浏览器智能体(E1-E7)

> 状态:E1-E7 完成(2026-08-14);交互统一为对话式(2026-08-14)
> 上游:`docs/design/agent.md`、`docs/adr/0007-browser-agent-architecture.md`、`docs/adr/0008-thin-loop-replaceable-brain.md`
> 方向:亮点 = DOM 挖掘 + 信息重组;大脑薄化可替换(ADR-0008)
> 流程:文档 + 测试驱动,每里程碑测试先行

## 任务清单

| # | 里程碑 | 产出 | 测试先行 |
|---|---|---|---|
| E1 | 通用 DOM 工具层 | `utils/domTools/*`(含 elementTree/findElements)+ content 工具执行器 + messaging 扩展 + 任意页面注入 | `extractData`/`safety`/`toolRegistry`/`elementTree` 单测 |
| E2 | 薄 loop + provider tool use | `driver`(可替换接口)/`agentTypes`/`agentLoop`/`toolCallParsing` + background 接入 | `toolCallParsing`/`agentLoop` 单测 |
| E3 | 安全确认 + 侧边栏过程展示 | `AgentStepCard`/`AgentConfirmModal`/场景选择/停止 | `agents` 单测 |
| E4 | 场景 S1 数据提取闭环 | dataExtract agent + `recombine` 重组 + CSV 下载/复制 | `recombine` 单测 + E2E 手动清单 |
| E5 | 场景 S2 表单自动化 | formFill agent | E2E 手动清单 |
| E6 | 场景 S3/S4 | publish / research agent(研究含重组总结) | E2E 手动清单 |
| E7 | 测试与文档同步 + 提交 | 全绿 + 文档一致 | 全部 |

## E1 详细清单(首个实施里程碑)

1. `utils/domTools/types.ts` — ToolSpec/ToolCall/ToolResult/DomToolExecutor
2. `utils/domTools/safety.ts` — 敏感判定纯函数
3. `utils/domTools/extractData.ts` — 数据提取纯函数(CSV/JSON)
4. `utils/domTools/elementTree.ts` — 语义元素树 + findElements(挖掘核心,纯逻辑可测)
5. `utils/domTools/actions.ts` — 点击/输入/滚动/等待/读取 DOM 薄壳
6. `utils/domTools/toolRegistry.ts` — 注册表 + schema 校验
7. `utils/domTools/executor.ts` — 注册表 + actions 装配 DomToolExecutor
8. `messaging.ts` 扩展 TOOL:CALL / TOOL:RESULT / CONFIRM
9. `content.ts` 改造:实现 DomToolExecutor,注入匹配放宽为 `<all_urls>`(已完成 E1a)
10. `wxt.config.ts`:content_scripts matches 放宽 + 相应权限(已完成 E1a)
11. 测试:`extractData`/`safety`/`toolRegistry`/`elementTree` 单测

## 验证命令

```bash
pnpm compile   # 类型检查
pnpm test      # 单元测试(纯函数层全绿)
pnpm build     # 构建 output/
```

## E3 详细清单(2026-08-14 完成)

1. `utils/ai/agents/index.ts` — 场景配置化:`{system, tools, onDone, label, description}`;`buildScenarioTools`(工具子集)+ `getScenarioMeta`(UI 元数据)+ `assertScenarioToolsValid`
2. `domTools/toolRegistry.ts` — `toLlmTools(filter?)` 支持场景工具子集过滤
3. `ai/driver.ts` — loop 只暴露该场景允许的工具(ADR-0008:场景 = system + 工具子集)
4. `sidepanelClient.ts` — `startAgentSession`(AGENT port:事件回推 / sendConfirm / stop)
5. `components/sidepanel/AgentStepCard.tsx` — 步骤卡:agent-thinking / tool-use / tool-result / confirm / agent-done / error
6. `components/sidepanel/AgentConfirmModal.tsx` — 敏感操作确认弹层(批准/拒绝)
7. `components/sidepanel/AgentView.tsx` — 场景选择 + 目标输入 + 步骤流 + 停止 + 确认闭环
8. `sidepanel/main.tsx` — 顶部「对话 | 智能体」模式切换,`<AgentView/>` 挂载
9. 测试:`agents.test.ts`(system 非空 / 工具子集 ⊆ 注册表 / 元数据完整)+ `toolRegistry` 过滤测试
10. 验证:`pnpm compile` ✅ / `pnpm test` 68 passed ✅ / `pnpm build` ✅

## E4 详细清单(2026-08-14 完成)

1. `domTools/extractData.ts` — 新增 `DataTable` 类型 + `projectColumns`(按列名投影,重组前置)
2. `utils/ai/recombine.ts` — **信息重组层(亮点之二)**:`mergeTables`(同构表合并,缺列补空)+ `mdTableToCsv`(从文本提取 Markdown 表格转 CSV)
3. `toolRegistry.ts` — `extractData` 增加 `columns` 参数(只取指定列)
4. `actions.ts` — `extractData` 支持 columns 投影(需有表头)
5. `agents/index.ts` — dataExtract 提示词深化:重组编排 + 输出 Markdown 表格(供侧边栏识别导出)
6. `components/sidepanel/ExportButtons.tsx` — CSV 下载(Blob,带 BOM 兼容 Excel)/ 复制按钮
7. `components/sidepanel/AgentStepCard.tsx` — extractData 成功结果 + agent-done(含 markdown 表格)挂导出按钮
8. 测试:`recombine.test.ts`(mergeTables 并集补空 / mdTableToCsv 提取)+ projectColumns(extractData.test.ts)
9. 验证:`pnpm compile` ✅ / `pnpm test` 76 passed ✅ / `pnpm build` ✅ / `pnpm dev` 构建 OK

## E2E 手动验证清单(E4 阶段)

1. **数据提取闭环**:任意网页(如 GitHub 列表页)打开侧边栏 → 智能体 → 场景「数据提取」→ 目标"提取这个表格"→ 观察 AI 调 readPage → extractData → 结果卡片出现「⬇ 下载 CSV / 复制」→ 点击下载得到 CSV(Excel 可开)
2. **重组输出**:目标"提取表并只留 X/Y 两列" → extractData 传 columns;完成卡片含 Markdown 表格时同样可下载/复制
3. **安全确认**:表单场景停在"提交"前弹确认;拒绝后 AI 应调整而非强推
4. **停止**:运行中点停止,应立即终止并显示已停止
5. **内容脚本未注入**:页面在扩展重载前打开 → 工具失败回填"刷新页面",侧边栏提示刷新后重试

## E5 详细清单(2026-08-14 完成)

1. `agents/index.ts` — formFill 提示词深化:字段语义识别(input/textarea/select/checkbox/radio)+ 逐项核对 + 不臆造未给内容;`buildAgentSystem` 拼接 **onDone 完成约定**(此前为死配置,现已进入 system)
2. `domTools/form.ts` — 新增 `findOptionIndex` 纯函数:select 选项定位(value 精确 → text 精确 → 包含容错)
3. `actions.ts` — `typeInto` 支持 select(选中+change)/ checkbox/radio(勾选);select 无匹配返回可选列表供 AI 调整
4. 测试:`form.test.ts`(findOptionIndex 5 项)+ `agents.test.ts` 补充(onDone 拼接 / formFill 提交前确认 / dataExtract Markdown 输出)
5. 验证:`pnpm compile` ✅ / `pnpm test` 84 passed ✅ / `pnpm build` ✅

### E2E 手动清单(E5 表单场景)

1. 打开含表单的网页(如注册/问卷页)→ 智能体 → 场景「表单填写」→ 目标"帮我填这个表单"→ 观察 AI readPage → 逐个 typeInto(含下拉 select)→ 填完**停在提交按钮前**弹确认
2. 下拉框:AI 传选项文本,正确选中;无匹配时回填可选列表,AI 应调整
3. 拒绝提交:点「拒绝」→ AI 收到 `{ok:false, error:'用户拒绝'}` 应调整而非强推

## E6 详细清单(2026-08-14 完成)

1. `background.ts` — **navigate 真实接线(修复 content 占位)**:`doNavigate` 经 `tabs.update` 执行 + 轮询 `tab.status==='complete'`(新文档自动注入 content script);executeTool 拦截 navigate 不走 content;维护 `currentOrigin` 闭包(启动时 + navigate 后更新)
2. `safety.ts` — `isSensitiveToolCall(call, ctx)` 支持注入 `currentOrigin`(优先于 call.args,修正同域绝对 URL 误判)
3. `agentLoop.ts` / `driver.ts` — `AgentLoopDeps.getCurrentOrigin` / `AgentHooks.getCurrentOrigin` 透传
4. `agents/index.ts` — publish 深化(登录态确认/跨站导航确认/不绕过后台);research 深化(多页对比 Markdown 表格可导出 CSV/引用来源)
5. 测试:`safety.test.ts`(navigate 注入 origin 同域/跨域/无注入兜底)+ `agents.test.ts`(publish/research 断言)
6. 验证:`pnpm compile` ✅ / `pnpm test` 88 passed ✅ / `pnpm build` ✅

### E2E 手动清单(E6 发布/研究场景)

1. **跨站导航**:研究/发布场景让 AI navigate 到另一站点 → 弹确认(离开当前站点);批准后新页面 readPage 可用(等加载)
2. **多平台发布**:登录态平台 → AI 填内容 → 停在发布按钮前 → 弹确认 → 拒绝/批准
3. **研究对比**:跨多页提取同维度数据(价格/规格)→ AI 输出 Markdown 对比表 → 完成卡片可下载/复制 CSV

## E7 详细清单(2026-08-14 完成)

1. 全量验证:`pnpm compile` ✅ / `pnpm test` 88 passed ✅ / `pnpm build` ✅
2. 文档同步(`docs/design/agent.md`):
   - §3 目录:agents 集中为 `index.ts`(场景配置),补 `form.ts`/`toolCallParsing.ts`,移除未实现的 `agentLog.ts`,测试清单补 elementTree/form/recombine
   - §5 消息协议:更新为实际 `AgentPortMessage`(AGENT:START/EVENT/CONFIRM/STOP)+ 双流并存说明
   - §6.1 工具表:readPage/extractData/navigate 参数与返回对齐实现(navigate = background tabs.update + origin 注入)
   - §7.1 AgentHooks:补 `getCurrentOrigin` / confirmId 签名
   - §9 场景表:工具子集补 `findElements`(全场景);注明配置集中在 `agents/index.ts`
   - §8.3:agentLog → AgentStepCard 步骤流;§10:双模式 + ExportButtons
3. 状态行同步:`requirements.md` v2.0 实现进展 + `milestones/agent.md` E1-E7 完成

## 交互统一(2026-08-14,用户反馈)

**背景**:「对话 | 智能体」双模式割裂,用户要求统一为交互式对话。

**改动**:
1. `main.tsx` 重写:单一对话流,移除双模式切换;场景 chips 置顶(默认数据提取);输入目标 → user + agent 消息
2. `AgentMessage.tsx`(新):agent 消息 = 场景标签 + 流式思考 + 步骤卡片 + **内嵌安全确认** + 最终结果 + 复制
3. `MessageItem.tsx`:`UiMessage` 扩展 `scenario/thinking/steps`,`role: 'agent'` 分支渲染 AgentMessage
4. 确认交互:全屏 `AgentConfirmModal` → **对话内确认卡片**(`onConfirmAgent` → AGENT:CONFIRM)
5. M1 文档对话 UI(9 能力 chips / ContentPanel / 写回 / PrivacyConfirm)不再使用;`content.ts` EXTRACT/writeback 协议保留(兼容)
6. 遗留孤儿文件已删除(2026-08-14,用户确认):`AgentView.tsx`、`AgentConfirmModal.tsx`、`CapabilityChips.tsx`、`ContentPanel.tsx`、`PrivacyConfirm.tsx`
7. 验证:`pnpm compile` ✅ / `pnpm test` 88 passed ✅ / `pnpm build` ✅(289.42 kB)

## 会话管理(2026-08-14,用户需求)

**背景**:插件对话需支持"开启新对话"+"历史对话本地保存"。

**改动**:
1. `utils/agentSessions.ts`(新):`AgentSession`/`SessionStore`;纯逻辑 `deriveTitle`(首条 user 前 20 字)/`createSession`(恢复时 streaming 复位)/`sortSessions`(更新时间倒序);`loadStore`/`saveStore` 存 `chrome.storage.local`(key `agentSessions:v1`)
2. `main.tsx`:header 加 🆕 新对话 / 📋 历史;启动恢复最后会话;消息变化防抖 400ms 保存;会话切换/删除(至少保留一个)
3. `SessionHistoryModal.tsx`(新):历史列表(标题+时间,当前会话 📌 标记),切换/删除
4. 测试:`agentSessions.test.ts`(标题派生/新建复位/排序 4 项)
5. 验证:`pnpm compile` ✅ / `pnpm test` 92 passed ✅ / `pnpm build` ✅

## 通用助手交互(2026-08-14,用户反馈)

**背景**:场景 chips(数据提取/表单/发布/研究)让用户先选场景,意义不明显;用户希望能力放介绍里——输入"你好",AI 回复能做什么,然后直接给目标。

**改动**:
1. `agentTypes.ts`:`ScenarioId` 增加 `general`(UI 默认)
2. `agents/index.ts`:`GENERAL_SYSTEM`(4 能力介绍 + 问好引导 + 安全规则 + 不臆造内容),`buildAgentSystem`/`buildScenarioTools` 对 general 返回通用 system + 全工具集;`getScenarioLabel`;`ConcreteScenario` 类型
3. `main.tsx`:移除场景 chips;`scenario: 'general'` 固定;空状态改为**欢迎介绍卡**(4 能力 + 示例)
4. `AgentMessage.tsx`:场景标签用 `getScenarioLabel`(general → 通用助手)
5. 测试:`agents.test.ts` 加 general 断言(system 含 4 能力 + 问好 / 全工具集 / label)
6. 验证:`pnpm compile` ✅ / `pnpm test` 93 passed ✅ / `pnpm build` ✅

## 流程录制与 RPA 工作台(2026-08-20,eca85e1)

**背景**:在通用 AI 操作之外,新增"录制演示 → 提炼为可复用流程"的确定性自动化路径,覆盖两类用途:
- **RPA 业务代办**:录制拟人操作,支持 `{{variable}}` 动态入参(如每日打卡、填报)
- **QA 自动化测试**:录制 + 断言 + 自然语言验收标准 → 一键运行 → 生成测试报告

**改动**:
1. `utils/workflow/types.ts`(新):`CapturedAction` / `WorkflowStep`(含 `isLoop` / `loopItemSelector`)/ `WorkflowRecipe`(双模式 `rpa` | `qa`,含 `parameters`/`assertions`/`acceptanceCriteria`/`lastTestReport`)/ `TestAssertion` / `TestRunReport` / `TestSuiteRunReport` / `TestSkillTemplate` / `RecordingSession`
2. `utils/workflow/recorder.ts`(新):content 内捕获真实拟人操作(点击/输入/回车/SVG 图标意图解析),抗干扰语义名 + 稳定 CSS 选择器生成,输入防抖合并;`buildWorkflowSteps` 提炼(过滤输入框前置聚焦点击/400ms 内连击)
3. `utils/workflow/storage.ts`(新):配方 CRUD / 跨页面录制会话(异步互斥队列防竞态,5 分钟残留自清理)/ 验收 Skill 库(4 个预设 + 自定义增删)
4. `utils/workflow/client.ts`(新):`sendWorkflowMessageToTab` —— 受限页面(chrome:// 等)拦截 + 6 次自愈重试 + content script 动态注入
5. `entrypoints/workbench/main.tsx`(新):RPA 工作台,4 导航 `rpa` / `qa` / `skills` / `reports`;含录制控制、步骤编辑、参数化运行、QA 断言执行与 HTML 报告导出、Skill 蒸馏文本导入
6. `components/sidepanel/WorkflowManagerCard.tsx`(新):侧边栏流程管理(录制入口 / 流程列表 / 运行 / 删除 / 技能蒸馏)
7. `domTools/actions.ts` / `toolRegistry.ts`:执行端工具扩展
8. 测试:`tests/workflow/workflow.test.ts`(steps 提炼 / 配方 CRUD / 会话持久化 / 断言与报告 / 技能库 / 双模分流)

**验证**:`pnpm compile` ✅ / `pnpm test` 137 passed ✅ / `pnpm build` ✅

## 同构列表循环遍历智能化(Loop Generalization,2026-08-24 完成)

**背景**:用户录制时演示"点击第 1 行 → 点击第 2 行",期望系统理解意图为"遍历整个列表"而非机械重放两次;执行端需支持批量循环处理同构列表项(批量审批/批量浏览/长表格逐项检查)。

**改动**:
1. `utils/workflow/recorder.ts` — `buildWorkflowSteps` 新增 **Loop Induction**:连续两个 `:nth-of-type(n)` / `:nth-child(n)` 同构选择器的点击示范,自动归纳为单条 `isLoop` 循环步骤(`loopItemSelector` = 去 nth 的通用选择器)
2. `domTools/actions.ts` — 新增 `loopElements` 工具:自动查找当前可见同构列表项/表格行逐条拟人点击(鼠标事件序列 + 滚动居中),指定选择器失效时自动降级 `table tbody tr` 等通用兜底
3. `toolRegistry.ts` — 注册 `loopElements`(含 `maxItems` / `delayMs` 参数)
4. `utils/workflow/storage.ts` — `saveTestSkill` 支持 `existingId` 更新既有 Skill(蒸馏二次保存不产生重复)
5. UI:`WorkflowManagerCard` / `workbench` 接入循环步骤与 `loopElements` 执行
6. 测试:`workflow.test.ts` 增补 Loop Generalization 用例(归纳为单条循环步骤 + 通用选择器正确)

**验证**:`pnpm compile` ✅ / `pnpm test` 137 passed ✅

## 单次示范智能习惯归纳与复合循环 RPA Skill (One-shot Habit Synthesis, 2026-08-27 完成)

**背景**:用户仅需操作 1 条样本(如进入审批列表对第 1 条记录点击详情 -> 输入意见 -> 提交同意),系统由 AI 大模型(或启发式规则)自动分析 DOM 轨迹与页面结构,泛化总结为针对全列表的批量 RPA Skill;用户可在可视化卡片上微调纠偏,运行时自适应全量批量审批。

**改动**:
1. `utils/workflow/types.ts` — 扩展 `WorkflowStep`(`subSteps` / `maxLoopCount` / `onItemError` / `loopSummary`)与 `DistilledHabit` 数据模型
2. `utils/workflow/skillDistiller.ts`(新) — **AI RPA 习惯归纳引擎**:
   - `distillHabitHeuristic`: 离线秒级启发式归纳(列表特征识别、子动作序列提取、变量动态提取)
   - `distillHabitWithLLM`: 结合活动模型(OpenAI / Claude / DeepSeek)智能推导业务习惯意图与结构化参数,失败平滑降级
3. `domTools/actions.ts` — `loopElements` 升级:支持按 `itemSelector` 匹配全部可见项,并对每项按序执行 `subSteps`(支持元素内限定作用域、全局弹窗穿透、表单输入、回车提交与逐项自愈)
4. `domTools/toolRegistry.ts` — `loopElements` 更新 schema,新增 `subSteps` 与 `onItemError` 参数定义
5. `utils/workflow/storage.ts` — `interpolateStepVariables` 支持对 `subSteps` 进行嵌套变量递归替换
6. UI 升级:
   - `WorkflowManagerCard.tsx`: 录制完成后调用 AI 习惯归纳,展示「AI 习惯归纳与微调卡片」,支持模式切换(批量循环 vs 单次)、循环选择器快捷标签调整、子步骤折叠微调与动态参数配置;执行端实时派发复合子步骤
   - `workbench/main.tsx`: 详情页展示循环子动作列表,执行引擎全面接入 `subSteps` 批量执行
7. 测试: 新增 `tests/workflow/skillDistiller.test.ts`(4 项)+ `tests/domTools/loopElements.test.ts` 增补 `subSteps` 执行测试(共 164 项测试全绿)

**验证**:`pnpm compile` ✅ / `pnpm test` 164 passed ✅ / `pnpm build` ✅ (790 kB)

