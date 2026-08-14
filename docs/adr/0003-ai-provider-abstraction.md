# ADR-0003:AI provider 抽象与统一流事件

- **状态**:已接受(2026-08-13)
- **关联**:`docs/design/design.md` §3.2

## 背景
需支持 Anthropic / DeepSeek / OpenAI 兼容端点,三者请求与流式返回格式各异;国内网络环境下 provider 可切换是刚需。

## 决策
定义 `ProviderClient` 接口(`stream(req) → AsyncIterable<StreamEvent>`),统一流事件 `text-delta / done / error`。各 provider 独立适配(Anthropic SSE、DeepSeek 与 OpenAI 兼容 SSE),按用户配置在 background 中选型调用。

## 后果
- 正面:新增 provider 只加一个 client;流式渲染逻辑单一;密钥仅存本机
- 负面:需要维护多套请求/解析逻辑,靠单元测试兜底;不同 provider 能力差异(如长上下文、工具调用)需在提示词层收敛
