// 研发工程与性能诊断插件 (DevTool & Performance Plugin)
// 包含: 真实毫秒级性能诊断、Core Web Vitals 评级、慢请求穿透归因、Web-to-Skill 自进化扩展

import type { BrowserAgentPlugin } from '../types';

export const DevToolPlugin: BrowserAgentPlugin = {
  id: 'devtool',
  name: '研发与性能诊断 Pro',
  description: '页面真实加载性能、Core Web Vitals 毫秒指标、主线程阻塞、慢资源穿透归因与一键导出 PDF 报告',
  icon: '⚡',
  version: '1.0.0',

  matchUrl: () => true, // 全网可用

  tools: [
    {
      name: 'getPagePerformance',
      description:
        '获取页面的真实加载性能与网络耗时深度指标(毫秒级:DNS解析/TCP建连/TTFB首字节/FCP首次绘制/DOM就绪/完全加载/总资源数/体积、以及 Top 3 慢请求和 Top 3 大文件具体清单)。用于性能诊断、测速对比、SEO分析。支持 tabId 指定目标标签页。',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: '可选,指定要获取性能指标的目标标签页 ID(不传则读取当前标签页)' },
        },
      },
    },
  ],

  systemPromptSnippet:
    '【页面测速与全维度性能诊断专属能力】\n' +
    '- 当用户要求测速、诊断或对比页面加载速度时,直接对目标页面调用 getPagePerformance 获取真实毫秒指标。输出包含以下维度的专家级报告:\n' +
    '  1. 📊 核心指标横向对比表(含 TTFB、FCP首屏绘制、DOM就绪、完全加载、总请求数、传输体积、网络协议);\n' +
    '  2. 🚦 Core Web Vitals 体验评级(FCP < 1.8s 为 🟢 优秀, 1.8-3.0s 为 🟡 需改进, > 3.0s 为 🔴 较差; TTFB < 800ms 为 🟢 优秀);\n' +
    '  3. 🔍 瓶颈穿透归因(利用 topSlowResources、topHeavyResources 具体点名拖慢耗时的大文件与慢请求);\n' +
    '  4. 🧠 运行时卡顿与架构健康度(分析 longTaskCount/totalLongTaskMs 主线程阻塞时长、domNodeCount 节点膨胀、jsHeapUsedMb 堆内存占用);\n' +
    '  5. 🚨 压缩漏配与阻塞扫描(若存在 uncompressedAssets 点名未开 Gzip/Brotli 的文件并估算节省带宽; 若存在 renderBlockingList 提示消除 head 阻塞);\n' +
    '  6. 💡 针对性工程优化建议(结合数据提出代码拆包、Brotli/Gzip 开启、图片转 WebP/AVIF、虚拟列表优化、CDN 边缘加速等落地方案)。\n',

  quickActions: [
    {
      id: 'devtool-perf-audit',
      label: '全维度性能诊断',
      prompt: '对当前页面进行全维度性能测速与诊断，输出核心 Web 指标与优化方案',
      icon: '📊',
      description: 'TTFB/FCP/DOM/慢资源与主线程阻塞',
    },
    {
      id: 'devtool-cwv-rating',
      label: 'Core Web Vitals 评级',
      prompt: '评估当前网页的 Core Web Vitals 体验评级并给出前端架构优化清单',
      icon: '🚦',
      description: '首屏绘制与加载体验深度诊断',
    },
  ],
};
