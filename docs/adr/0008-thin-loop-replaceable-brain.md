# ADR-0008:Agent 大脑采用薄 loop,多 provider 优先,可替换

- **状态**:已接受(2026-08-13)
- **关联**:`docs/design/agent.md` §7、`docs/milestones/agent.md` E2
- **类型**:架构决策(方向性,用户确认)

## 背景
用户强调项目亮点是 **DOM 元素挖掘 + 信息重组**,agent 底层不是重点,甚至可外购成熟 agent 服务。讨论后确认:工具执行层(content script)必须自研且本地;大脑(规划循环)可成熟/可外购,但成熟 agent 运行时常绑定单一厂商,与"多 provider"诉求冲突。

## 决策
1. **大脑先用轻量自研薄 loop**,保留多 provider 自由(Anthropic / DeepSeek / OpenAI tool use 均已支持)
2. **大脑做成可替换接口**(`AgentDriver` 抽象):薄 loop 是默认实现;后续某场景证明值得绑定厂商时,可平滑切换到成熟 agent(如 Anthropic Agent SDK / Tool Runner),不改工具层与 UI
3. **亮点投入不变**:`readPage` 语义元素树 + `findElements` 语义查询 + `extractData` + 信息重组层,是核心差异化,全力做深
4. 云端浏览器 agent SaaS 不采用(碰不到用户已打开的页面,与插件模式冲突)

## 后果
- 正面:方向不锁死;多 provider 自由保留;亮点(挖掘/重组)不受影响
- 负面:薄 loop 需自维护(~百行);切成熟 agent 时有一次性适配成本(已由接口隔离)
