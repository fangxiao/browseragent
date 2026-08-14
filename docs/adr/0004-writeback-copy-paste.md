# ADR-0004:写回策略(先复制,后富文本插入)

- **状态**:已接受(2026-08-13);**更新**:2026-08-13 实现富文本写回(末尾追加 + 光标插入),M1 内迭代
- **关联**:`docs/requirements/requirements.md` §1.3、§5

## 背景
将 AI 结果写回飞书文档有两种路径:官方 API(需逐文档授权,繁琐)或 DOM 模拟输入(脆弱,平台改版即失效)。

## 决策(演进)
- **v1 初版**:不实现自动写回,AI 结果侧边栏展示 + 复制粘贴(本 ADR 原决策)
- **M1 迭代更新**:实现**富文本写回**。AI 结果 Markdown → HTML(`utils/mdToHtml.ts`),经 content script 在飞书编辑器内插入:`WRITEBACK:APPEND`(末尾)/ `WRITEBACK:CURSOR`(光标处),基于 `contenteditable + document.execCommand('insertHTML')`
- 飞书为自研编辑器,insertHTML 策略需真机验证;失败时 content console 打印 `[feishu-ai] writeback` 日志,可换剪贴板粘贴或块 DOM 操作策略

## 后果
- 正面:核心价值成立("AI 写进文档");复制粘贴仍保留为兜底
- 负面:飞书编辑器结构敏感,写回可能不触发飞书同步/撤销;需持续真机回归;复杂排版保真度有限
