# ADR-0001:技术栈选型(WXT + React + Tailwind + TypeScript)

- **状态**:已接受(2026-08-13)
- **关联**:`docs/design/design.md`

## 背景
全新 Chrome MV3 插件项目,需覆盖多平台(飞书首发,钉钉/企微后续),要求良好的开发体验与可维护性。

## 决策
- 扩展框架:**WXT**(自动 manifest、多浏览器、HMR)
- UI:**React + Tailwind CSS**
- 语言:**TypeScript**
- 构建:Vite(由 WXT 提供)

## 后果
- 正面:脚手架成本低;Vite 生态兼容;React 组件化利于侧边栏 UI;多浏览器(Chrome/Edge)零额外工作
- 负面:引入框架抽象层,极端场景下调试需理解 WXT 生命周期;依赖版本需锁定
