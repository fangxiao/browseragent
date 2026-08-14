# 里程碑:v2 通用浏览器智能体(E1-E7)

> 状态:E1-E7 完成(2026-08-14)
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
