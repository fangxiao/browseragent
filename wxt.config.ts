import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 参见 docs/design/design.md;ADR-0001 技术栈
// 注:使用 @vitejs/plugin-react@5(兼容 WXT 内置 Vite 7,不用 module-react 以避免其拉取需 Vite 8 的 plugin-react@6)
export default defineConfig({
  srcDir: 'src',
  outDir: 'output',
  vite: () => ({
    plugins: [react(), tailwindcss()],
    build: {
      // 扩展环境下 modulepreload 会触发 cross-world mismatch 报错;chunk 经 import 正常加载
      modulePreload: false,
    },
  }),
  manifest: {
    name: 'AI 浏览器操作助手',
    description: '通用 AI 浏览器智能体:在任意网页通过 AI 操作 DOM,完成数据提取、表单填写、内容发布、研究总结等任务',
    permissions: [
      'sidePanel',
      'storage',
      'tabs',
      'scripting',
      'notifications',
      'tabGroups',
      'bookmarks',
      'history',
      'browsingData',
      'downloads',
      'sessions',
      'debugger',
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '打开 AI 侧边栏',
    },
  },
});
