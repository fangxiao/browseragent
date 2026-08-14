# 通用 AI 浏览器操作助手(Browser Agent)

Chrome 插件:侧边栏输入目标,AI 自主操作任意网页 DOM 完成任务——网页数据提取(S1)、表单与流程自动化(S2)、多平台内容发布(S3)、网页研究总结(S4)。敏感动作(提交/发布/删除/支付)强制用户确认。

> 前身:飞书文档 AI 提效助手(M1,文档评审/补全/提炼/润色,读/写能力已并入通用工具集)。

## 技术栈

WXT + React + Tailwind CSS v4 + TypeScript(MV3)。

## 开发

```bash
pnpm install        # 安装依赖(含 wxt prepare)
pnpm dev            # 开发模式,WXT 自动打开浏览器加载扩展
pnpm build          # 构建 output/
pnpm compile        # 类型检查
pnpm test           # 单元测试
```

## 文档

- 需求:`docs/requirements/requirements.md`(v2.0)
- 设计:`docs/design/agent.md`(v2 完整技术设计)、`docs/design/design.md`(M1 + v2 总览)
- 决策:`docs/adr/`(0001-0007)
- 里程碑:`docs/milestones/agent.md`(E1-E7)、`docs/milestones/m1.md`
