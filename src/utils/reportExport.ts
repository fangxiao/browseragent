// 页面性能诊断 PDF / 打印报告生成引擎。
// 构建自包含的企业级排版 HTML,并通过新标签页调起浏览器原生另存为 PDF(window.print)对话框。

export interface PerformanceMetricData {
  url: string;
  title: string;
  dnsMs: number;
  tcpMs: number;
  ttfbMs: number;
  fcpMs?: number;
  domReadyMs: number;
  loadMs: number;
  resourceCount: number;
  transferSizeKb: number;
  decodedBodySizeKb?: number;
  protocol?: string;
  topSlowResources?: Array<{ name: string; url?: string; durationMs: number; type: string; sizeKb?: number }>;
  topHeavyResources?: Array<{ name: string; url?: string; sizeKb: number; durationMs?: number; type: string }>;
  resourceBreakdown?: {
    js: { count: number; sizeKb: number };
    css: { count: number; sizeKb: number };
    image: { count: number; sizeKb: number };
    api: { count: number; sizeKb: number };
    other: { count: number; sizeKb: number };
  };
  // 深度体检指标
  longTaskCount?: number;
  totalLongTaskMs?: number;
  maxLongTaskMs?: number;
  domNodeCount?: number;
  maxDomDepth?: number;
  jsHeapUsedMb?: number;
  jsHeapTotalMb?: number;
  cachedResourceCount?: number;
  cacheHitRatePct?: number;
  uncompressedAssets?: Array<{ name: string; url?: string; sizeKb: number; wastedKb: number; type: string }>;
  renderBlockingCount?: number;
  renderBlockingList?: Array<{ name: string; url?: string; type: string }>;
}

export function buildPerformanceReportHtml(
  metricsList: PerformanceMetricData[],
  aiAnalysisText?: string,
): string {
  const generatedAt = new Date().toLocaleString();
  const maxLoad = Math.max(...metricsList.map((m) => m.loadMs || 100), 500);

  const escapeHtml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const renderTimelineBar = (m: PerformanceMetricData) => {
    const total = Math.max(m.loadMs, 100);
    const dnsPct = ((m.dnsMs || 0) / maxLoad) * 100;
    const tcpPct = ((m.tcpMs || 0) / maxLoad) * 100;
    const ttfbPct = (Math.max(0, m.ttfbMs - m.tcpMs - m.dnsMs) / maxLoad) * 100;
    const domPct = (Math.max(0, m.domReadyMs - m.ttfbMs) / maxLoad) * 100;
    const loadPct = (Math.max(0, m.loadMs - m.domReadyMs) / maxLoad) * 100;

    return `
      <div style="margin-bottom: 16px;">
        <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600; margin-bottom:4px; color:#1e293b;">
          <span>${escapeHtml(m.title || m.url)}</span>
          <span style="color:#2563eb;">总耗时: ${m.loadMs} ms ${m.fcpMs ? `(FCP: ${m.fcpMs}ms)` : ''}</span>
        </div>
        <div style="height:22px; width:100%; background:#f1f5f9; border-radius:6px; overflow:hidden; display:flex; font-size:10px; color:#fff; font-weight:600; line-height:22px; text-align:center;">
          ${dnsPct > 1 ? `<div style="width:${dnsPct}%; background:#f59e0b;" title="DNS: ${m.dnsMs}ms">DNS</div>` : ''}
          ${tcpPct > 1 ? `<div style="width:${tcpPct}%; background:#ea580c;" title="TCP: ${m.tcpMs}ms">TCP</div>` : ''}
          ${ttfbPct > 1 ? `<div style="width:${ttfbPct}%; background:#3b82f6;" title="TTFB: ${m.ttfbMs}ms">TTFB</div>` : ''}
          ${domPct > 1 ? `<div style="width:${domPct}%; background:#6366f1;" title="DOM: ${m.domReadyMs}ms">DOM</div>` : ''}
          <div style="width:${Math.max(loadPct, 4)}%; background:#10b981;" title="Load: ${m.loadMs}ms">Load</div>
        </div>
        <div style="display:flex; gap:12px; font-size:11px; color:#64748b; margin-top:4px;">
          <span>🌐 DNS: <b>${m.dnsMs}ms</b></span>
          <span>⚡ TCP: <b>${m.tcpMs}ms</b></span>
          <span>📡 TTFB: <b>${m.ttfbMs}ms</b></span>
          <span>📄 DOM就绪: <b>${m.domReadyMs}ms</b></span>
          <span>🏁 完全加载: <b>${m.loadMs}ms</b></span>
        </div>
      </div>
    `;
  };

  const renderTableRows = () => {
    return metricsList
      .map(
        (m, idx) => `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px;">
          <td style="padding: 10px 12px; font-weight: 600; color: #1e293b;">
            #${idx + 1} ${escapeHtml(m.title || '网页')}
            <div style="font-size: 11px; font-weight: 400; color: #64748b; word-break: break-all;">${escapeHtml(m.url)}</div>
          </td>
          <td style="padding: 10px 12px; text-align:center; font-weight: 600; color: #2563eb;">${m.ttfbMs} ms</td>
          <td style="padding: 10px 12px; text-align:center; font-weight: 600; color: ${m.fcpMs && m.fcpMs < 1800 ? '#16a34a' : '#d97706'};">${m.fcpMs ? `${m.fcpMs} ms` : '-'}</td>
          <td style="padding: 10px 12px; text-align:center;">${m.domReadyMs} ms</td>
          <td style="padding: 10px 12px; text-align:center; font-weight: 700; color: #0f172a;">${m.loadMs} ms</td>
          <td style="padding: 10px 12px; text-align:center;">${m.resourceCount} 个</td>
          <td style="padding: 10px 12px; text-align:center;">${m.transferSizeKb} KB</td>
          <td style="padding: 10px 12px; text-align:center; font-family: monospace; font-size:11px;">${m.protocol || 'HTTP/2'}</td>
        </tr>
      `,
      )
      .join('');
  };

  const renderSlowResources = () => {
    const hasSlow = metricsList.some((m) => m.topSlowResources && m.topSlowResources.length > 0);
    if (!hasSlow) return '';

    return `
      <div style="margin-top: 28px;">
        <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 12px; display:flex; align-items:center; gap:6px;">
          <span>🔍</span> 慢请求与阻塞资源穿透诊断 (Top Slow Requests)
        </h3>
        ${metricsList
          .map(
            (m) => `
          <div style="margin-bottom: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
            <div style="font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 6px;">
              📄 ${escapeHtml(m.title || m.url)}:
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <thead>
                <tr style="color: #64748b; text-align: left; border-bottom: 1px solid #cbd5e1;">
                  <th style="padding: 4px 6px;">资源名称</th>
                  <th style="padding: 4px 6px;">类型</th>
                  <th style="padding: 4px 6px;">耗时 (Duration)</th>
                  <th style="padding: 4px 6px;">传输体积</th>
                </tr>
              </thead>
              <tbody>
                ${(m.topSlowResources || [])
                  .map(
                    (r) => `
                  <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 6px; font-family: monospace; color: #1e293b; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(r.url || r.name)}">
                      ${escapeHtml(r.name)}
                    </td>
                    <td style="padding: 6px; color: #64748b;">${r.type}</td>
                    <td style="padding: 6px; font-weight: 700; color: #dc2626;">${r.durationMs} ms</td>
                    <td style="padding: 6px; color: #475569;">${r.sizeKb || 0} KB</td>
                  </tr>
                `,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `,
          )
          .join('')}
      </div>
    `;
  };

  const renderArchitectureHealth = () => {
    return `
      <div style="margin-top: 24px;">
        <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 12px; display:flex; align-items:center; gap:6px;">
          <span>🧠</span> 运行时卡顿与架构健康度体检 (Runtime, Memory & DOM)
        </h3>
        <table style="width: 100%; border-collapse: collapse; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px;">
          <thead>
            <tr style="background: #f8fafc; color: #475569; text-align: center; border-bottom: 1px solid #cbd5e1;">
              <th style="padding: 8px 10px; text-align: left;">页面</th>
              <th style="padding: 8px 10px;">DOM 节点数</th>
              <th style="padding: 8px 10px;">最大嵌套层级</th>
              <th style="padding: 8px 10px;">JS 堆内存 (已用)</th>
              <th style="padding: 8px 10px;">主线程长任务 (卡顿)</th>
              <th style="padding: 8px 10px;">本地缓存命中率</th>
            </tr>
          </thead>
          <tbody>
            ${metricsList
              .map(
                (m) => `
              <tr style="border-bottom: 1px solid #f1f5f9; text-align: center;">
                <td style="padding: 8px 10px; text-align: left; font-weight: 600; color: #1e293b;">${escapeHtml(m.title || m.url)}</td>
                <td style="padding: 8px 10px; font-weight: 600; color: ${(m.domNodeCount || 0) > 2000 ? '#dc2626' : '#16a34a'};">${m.domNodeCount ?? '-'} 个</td>
                <td style="padding: 8px 10px;">${m.maxDomDepth ? `${m.maxDomDepth} 层` : '-'}</td>
                <td style="padding: 8px 10px; font-weight: 600;">${m.jsHeapUsedMb ? `${m.jsHeapUsedMb} MB` : '-'}</td>
                <td style="padding: 8px 10px; color: ${(m.longTaskCount || 0) > 0 ? '#ea580c' : '#16a34a'};">
                  ${m.longTaskCount ? `⚠️ ${m.longTaskCount} 次 (卡死 ${m.totalLongTaskMs}ms)` : '🟢 0 次 (极度丝滑)'}
                </td>
                <td style="padding: 8px 10px;">${m.cacheHitRatePct != null ? `${m.cacheHitRatePct}%` : '-'}</td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderUncompressedAndBlocking = () => {
    const hasUncompressed = metricsList.some((m) => m.uncompressedAssets && m.uncompressedAssets.length > 0);
    const hasBlocking = metricsList.some((m) => m.renderBlockingList && m.renderBlockingList.length > 0);
    if (!hasUncompressed && !hasBlocking) return '';

    return `
      <div style="margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
        ${
          hasUncompressed
            ? `
          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; font-size: 12px;">
            <h4 style="margin: 0 0 6px 0; color: #b45309; font-size: 13px; font-weight: 700; display:flex; align-items:center; gap:4px;">
              <span>🚨</span> 未压缩传输资源 (未开 Gzip/Brotli)
            </h4>
            <div style="color: #78350f; font-size: 11px; margin-bottom: 6px;">开启压缩预计可立省 65% 网络流量:</div>
            ${metricsList
              .map((m) =>
                (m.uncompressedAssets || [])
                  .map(
                    (u) => `
                <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-family: monospace;">
                  <span style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(u.name)}">${escapeHtml(u.name)}</span>
                  <span style="color:#b45309; font-weight:600;">${u.sizeKb}KB (省~${u.wastedKb}K)</span>
                </div>
              `,
                  )
                  .join(''),
              )
              .join('')}
          </div>
        `
            : ''
        }
        ${
          hasBlocking
            ? `
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; font-size: 12px;">
            <h4 style="margin: 0 0 6px 0; color: #b91c1c; font-size: 13px; font-weight: 700; display:flex; align-items:center; gap:4px;">
              <span>🛑</span> 首屏关键渲染阻塞项 (Head 同步脚本)
            </h4>
            <div style="color: #7f1d1d; font-size: 11px; margin-bottom: 6px;">建议在 script 标签增加 defer/async 属性:</div>
            ${metricsList
              .map((m) =>
                (m.renderBlockingList || [])
                  .map(
                    (b) => `
                <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-family: monospace;">
                  <span style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</span>
                  <span style="color:#b91c1c; font-weight:600;">[${b.type}]</span>
                </div>
              `,
                  )
                  .join(''),
              )
              .join('')}
          </div>
        `
            : ''
        }
      </div>
    `;
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>网页性能对比与深度诊断报告 - AI 浏览器助手</title>
  <style>
    @media print {
      body { margin: 0; padding: 15mm; background: #fff !important; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
      .card { box-shadow: none !important; border: 1px solid #cbd5e1 !important; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f8fafc;
      color: #334155;
      margin: 0;
      padding: 30px 20px;
      line-height: 1.6;
    }
    .container {
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      padding: 32px 36px;
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.06);
      border: 1px solid #e2e8f0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .title {
      font-size: 22px;
      font-weight: 800;
      color: #0f172a;
      margin: 0;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      background: #eff6ff;
      color: #2563eb;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid #bfdbfe;
    }
    .print-btn {
      background: #2563eb;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.2s;
    }
    .print-btn:hover {
      background: #1d4ed8;
    }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      margin: 24px 0 12px 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 class="title">🚀 网页性能对比与深度诊断报告</h1>
        <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
          生成时间: ${generatedAt} · 由 AI 浏览器助手生成
        </div>
      </div>
      <div class="no-print" style="display:flex; gap:8px;">
        <button class="print-btn" onclick="window.print()">
          <span>🖨️ 打印 / 另存为 PDF</span>
        </button>
      </div>
    </div>

    <!-- 1. 时序瀑布流对比图 -->
    <div class="section-title">
      <span>📊</span> 加载时序瀑布流对比 (Waterfall Timeline)
    </div>
    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:18px; margin-bottom:20px;">
      ${metricsList.map((m) => renderTimelineBar(m)).join('')}
      <div style="display:flex; gap:16px; justify-content:center; font-size:11px; color:#475569; margin-top:12px; border-top:1px dashed #cbd5e1; pt-2;">
        <span><span style="display:inline-block; width:10px; height:10px; background:#f59e0b; border-radius:2px;"></span> DNS解析</span>
        <span><span style="display:inline-block; width:10px; height:10px; background:#ea580c; border-radius:2px;"></span> TCP建连</span>
        <span><span style="display:inline-block; width:10px; height:10px; background:#3b82f6; border-radius:2px;"></span> TTFB首字节</span>
        <span><span style="display:inline-block; width:10px; height:10px; background:#6366f1; border-radius:2px;"></span> DOM就绪</span>
        <span><span style="display:inline-block; width:10px; height:10px; background:#10b981; border-radius:2px;"></span> 完全加载</span>
      </div>
    </div>

    <!-- 2. 核心指标对比表格 -->
    <div class="section-title">
      <span>📋</span> 核心指标横向对齐矩阵
    </div>
    <table style="width:100%; border-collapse:collapse; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
      <thead>
        <tr style="background:#f1f5f9; color:#475569; font-size:12px; text-align:center; border-bottom:1px solid #cbd5e1;">
          <th style="padding:10px 12px; text-align:left;">页面 / URL</th>
          <th style="padding:10px 12px;">TTFB</th>
          <th style="padding:10px 12px;">FCP (首绘)</th>
          <th style="padding:10px 12px;">DOM 就绪</th>
          <th style="padding:10px 12px;">完全加载</th>
          <th style="padding:10px 12px;">资源总数</th>
          <th style="padding:10px 12px;">传输体积</th>
          <th style="padding:10px 12px;">协议</th>
        </tr>
      </thead>
      <tbody>
        ${renderTableRows()}
      </tbody>
    </table>

    <!-- 3. 慢资源穿透 -->
    ${renderSlowResources()}

    <!-- 4. 运行时卡顿与架构健康度体检 -->
    ${renderArchitectureHealth()}

    <!-- 5. 压缩漏配与首屏关键阻塞扫描 -->
    ${renderUncompressedAndBlocking()}

    <!-- 6. AI 诊断建议 -->
    ${
      aiAnalysisText
        ? `
      <div style="margin-top: 28px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 18px;">
        <h3 style="font-size: 15px; font-weight: 700; color: #1e40af; margin-top: 0; margin-bottom: 10px; display:flex; align-items:center; gap:6px;">
          <span>🤖</span> AI 智能诊断与工程优化建议
        </h3>
        <div style="font-size: 13px; color: #1e3a8a; line-height: 1.7; white-space: pre-wrap;">${escapeHtml(
          aiAnalysisText,
        )}</div>
      </div>
    `
        : ''
    }

    <div style="margin-top: 36px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center;">
      AI 浏览器助手 (AI Browser Agent) · 原生客户端时序分析
    </div>
  </div>

  <script>
    // 页面加载后自动触发浏览器打印/保存 PDF 弹窗
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        window.print();
      }, 400);
    });
  </script>
</body>
</html>`;
}

const REPORT_STORAGE_KEY = 'temp_performance_report_payload';

/** 一键导出 PDF 诊断报告:通过标准扩展页面 /report.html 渲染并调起打印另存为 PDF (100% 遵循 MV3 CSP) */
export async function exportPerformancePdfReport(
  metricsList: PerformanceMetricData[],
  aiAnalysisText?: string,
): Promise<void> {
  const payload = {
    metricsList,
    aiAnalysisText,
    timestamp: Date.now(),
  };

  if (typeof browser !== 'undefined' && browser.storage?.local && browser.runtime?.getURL && browser.tabs?.create) {
    await browser.storage.local.set({ [REPORT_STORAGE_KEY]: payload });
    const reportUrl = browser.runtime.getURL('/report.html');
    await browser.tabs.create({ url: reportUrl });
  } else if (typeof window !== 'undefined') {
    const html = buildPerformanceReportHtml(metricsList, aiAnalysisText);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    window.open(URL.createObjectURL(blob), '_blank');
  }
}
