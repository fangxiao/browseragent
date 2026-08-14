# ADR-0002:平台适配器模式(平台隔离)

- **状态**:已接受(2026-08-13)
- **关联**:`docs/design/design.md` §3.1

## 背景
需支持飞书/钉钉/企微三类文档平台,各自 DOM 结构与 URL 规则不同;飞书 DOM 变更风险高。

## 决策
定义 `PlatformAdapter` 接口(`detect(url)` / `extract(doc) → DocContent`),所有平台差异收敛于 adapter 实现;注册表按 URL 匹配分发。飞书为首个实现,钉钉/企微仅需新增 adapter。

## 后果
- 正面:AI 引擎与 UI 完全平台无关;新增平台 = 新增 adapter;DOM 变更隔离在单文件内可修
- 负面:adapter 接口需足够通用,早期过度抽象有成本;表格/复杂块保真度受平台渲染限制
