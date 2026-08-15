// 侧边栏原生可视化性能图表卡片(瀑布时序流 + 资源构成堆叠条 + 一键导出 PDF/CSV)。
import React, { useState } from 'react';
import { exportPerformancePdfReport, type PerformanceMetricData } from '@/utils/reportExport';

interface Props {
  metrics: PerformanceMetricData[];
  textSummary?: string;
}

export function PerformanceVisualCard({ metrics, textSummary }: Props) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (!metrics || metrics.length === 0) return null;

  const maxLoad = Math.max(...metrics.map((m) => m.loadMs || 100), 400);

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      await exportPerformancePdfReport(metrics, textSummary);
    } finally {
      setTimeout(() => setExporting(false), 1000);
    }
  };

  const handleExportCsv = () => {
    const headers = ['页面标题', 'URL', 'TTFB(ms)', 'FCP(ms)', 'DOM就绪(ms)', '完全加载(ms)', '资源数', '传输体积(KB)', '网络协议'];
    const rows = metrics.map((m) => [
      `"${(m.title || '').replace(/"/g, '""')}"`,
      `"${(m.url || '').replace(/"/g, '""')}"`,
      m.ttfbMs,
      m.fcpMs || '',
      m.domReadyMs,
      m.loadMs,
      m.resourceCount,
      m.transferSizeKb,
      `"${m.protocol || ''}"`,
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance_benchmark_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    const text = metrics
      .map(
        (m) =>
          `【${m.title}】\n` +
          `• TTFB: ${m.ttfbMs}ms | FCP: ${m.fcpMs ?? '-'}ms | DOM: ${m.domReadyMs}ms | Load: ${m.loadMs}ms\n` +
          `• 资源数: ${m.resourceCount} 个 | 传输体积: ${m.transferSizeKb}KB | 协议: ${m.protocol || 'H2'}`,
      )
      .join('\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-2 rounded-lg border border-indigo-100 bg-white p-3 shadow-xs text-xs text-gray-800">
      {/* 头部标题与徽章 */}
      <div className="flex items-center justify-between font-medium text-gray-800 mb-2">
        <span className="flex items-center gap-1">
          <span>📊</span>
          <span>页面时序瀑布流对比 (Waterfall)</span>
        </span>
        <span className="text-[10px] rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 font-medium">
          {metrics.length > 1 ? `${metrics.length} 页横向对标` : '单页深度测速'}
        </span>
      </div>

      {/* 瀑布流横向条形图 */}
      <div className="space-y-2.5 mb-3">
        {metrics.map((m, idx) => {
          const dnsPct = ((m.dnsMs || 0) / maxLoad) * 100;
          const tcpPct = ((m.tcpMs || 0) / maxLoad) * 100;
          const ttfbPct = (Math.max(0, m.ttfbMs - m.tcpMs - m.dnsMs) / maxLoad) * 100;
          const domPct = (Math.max(0, m.domReadyMs - m.ttfbMs) / maxLoad) * 100;
          const loadPct = (Math.max(0, m.loadMs - m.domReadyMs) / maxLoad) * 100;

          return (
            <div key={`${m.url}_${idx}`} className="rounded-md bg-gray-50/80 p-1.5 border border-gray-100">
              <div className="flex items-center justify-between text-[11px] font-medium text-gray-700 mb-1">
                <span className="truncate flex-1 max-w-[200px]" title={m.title || m.url}>
                  #{idx + 1} {m.title || m.url}
                </span>
                <span className="font-mono text-indigo-600 font-bold shrink-0">
                  {m.loadMs}ms
                  {m.fcpMs ? <span className="text-[10px] text-gray-400 font-normal ml-1">(FCP {m.fcpMs}ms)</span> : null}
                </span>
              </div>

              {/* 彩色横向比例条 */}
              <div className="flex h-3 w-full overflow-hidden rounded bg-gray-200 text-[8px] font-bold text-white leading-3 text-center">
                {dnsPct > 1 && (
                  <div style={{ width: `${dnsPct}%` }} className="bg-amber-400" title={`DNS: ${m.dnsMs}ms`} />
                )}
                {tcpPct > 1 && (
                  <div style={{ width: `${tcpPct}%` }} className="bg-orange-500" title={`TCP: ${m.tcpMs}ms`} />
                )}
                {ttfbPct > 1 && (
                  <div style={{ width: `${ttfbPct}%` }} className="bg-blue-500" title={`TTFB: ${m.ttfbMs}ms`} />
                )}
                {domPct > 1 && (
                  <div style={{ width: `${domPct}%` }} className="bg-indigo-500" title={`DOM: ${m.domReadyMs}ms`} />
                )}
                <div
                  style={{ width: `${Math.max(loadPct, 4)}%` }}
                  className="bg-emerald-500"
                  title={`Load: ${m.loadMs}ms`}
                />
              </div>

              {/* 关键微型指标 */}
              <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1">
                <span>TTFB: <b className="text-gray-600">{m.ttfbMs}ms</b></span>
                <span>DOM: <b className="text-gray-600">{m.domReadyMs}ms</b></span>
                <span>资源: <b className="text-gray-600">{m.resourceCount}</b></span>
                <span>体积: <b className="text-gray-600">{m.transferSizeKb}KB</b></span>
              </div>

              {/* 架构与健康度微型标签(DOM/内存/卡顿/未压缩) */}
              <div className="mt-1.5 pt-1 border-t border-gray-200/50 flex flex-wrap items-center gap-1.5 text-[9px]">
                {m.domNodeCount != null && (
                  <span className={`px-1 py-0.2 rounded border ${m.domNodeCount > 2000 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                    🌳 DOM {m.domNodeCount}节点
                  </span>
                )}
                {m.jsHeapUsedMb != null && m.jsHeapUsedMb > 0 && (
                  <span className="px-1 py-0.2 rounded bg-gray-100 text-gray-600 border border-gray-200">
                    🧠 内存 {m.jsHeapUsedMb}MB
                  </span>
                )}
                {m.longTaskCount != null && (
                  <span className={`px-1 py-0.2 rounded border ${m.longTaskCount > 0 ? 'bg-amber-50 text-amber-700 border-amber-200 font-medium' : 'bg-green-50 text-green-700 border-green-200'}`}>
                    {m.longTaskCount > 0 ? `⚡ 卡顿 ${m.longTaskCount}次(${m.totalLongTaskMs}ms)` : '🟢 0次卡顿'}
                  </span>
                )}
                {m.uncompressedAssets && m.uncompressedAssets.length > 0 && (
                  <span className="px-1 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                    🚨 {m.uncompressedAssets.length}个未压缩大文件
                  </span>
                )}
              </div>

              {/* 资源体积构成比例条(若有) */}
              {m.resourceBreakdown && (
                <div className="mt-1 pt-1 border-t border-gray-200/40 flex items-center gap-1.5 text-[10px]">
                  <span className="text-gray-400 shrink-0">构成:</span>
                  <div className="flex-1 flex h-1.5 rounded overflow-hidden bg-gray-200">
                    {m.resourceBreakdown.js.sizeKb > 0 && (
                      <div
                        style={{ width: `${(m.resourceBreakdown.js.sizeKb / (m.transferSizeKb || 1)) * 100}%` }}
                        className="bg-blue-500"
                        title={`JS: ${m.resourceBreakdown.js.sizeKb}KB (${m.resourceBreakdown.js.count}个)`}
                      />
                    )}
                    {m.resourceBreakdown.image.sizeKb > 0 && (
                      <div
                        style={{ width: `${(m.resourceBreakdown.image.sizeKb / (m.transferSizeKb || 1)) * 100}%` }}
                        className="bg-emerald-500"
                        title={`图片: ${m.resourceBreakdown.image.sizeKb}KB (${m.resourceBreakdown.image.count}个)`}
                      />
                    )}
                    {m.resourceBreakdown.css.sizeKb > 0 && (
                      <div
                        style={{ width: `${(m.resourceBreakdown.css.sizeKb / (m.transferSizeKb || 1)) * 100}%` }}
                        className="bg-purple-500"
                        title={`CSS: ${m.resourceBreakdown.css.sizeKb}KB (${m.resourceBreakdown.css.count}个)`}
                      />
                    )}
                    {m.resourceBreakdown.api.sizeKb > 0 && (
                      <div
                        style={{ width: `${(m.resourceBreakdown.api.sizeKb / (m.transferSizeKb || 1)) * 100}%` }}
                        className="bg-amber-500"
                        title={`API: ${m.resourceBreakdown.api.sizeKb}KB (${m.resourceBreakdown.api.count}个)`}
                      />
                    )}
                  </div>
                  <span className="text-gray-500 font-mono text-[9px]">
                    JS {m.resourceBreakdown.js.sizeKb}K / 图 {m.resourceBreakdown.image.sizeKb}K
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 图例 */}
      <div className="flex items-center justify-center gap-2 text-[10px] text-gray-400 border-t border-gray-100 pt-1.5 mb-2">
        <span className="flex items-center gap-0.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />DNS</span>
        <span className="flex items-center gap-0.5"><span className="h-1.5 w-1.5 rounded-full bg-orange-500" />TCP</span>
        <span className="flex items-center gap-0.5"><span className="h-1.5 w-1.5 rounded-full bg-blue-500" />TTFB</span>
        <span className="flex items-center gap-0.5"><span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />DOM</span>
        <span className="flex items-center gap-0.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Load</span>
      </div>

      {/* 底部操作栏:导出 PDF 报告 / CSV / 复制 */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-2">
        <button
          onClick={handleExportCsv}
          className="text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
        >
          📊 导出 CSV
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleCopy()}
            className="text-[11px] text-blue-600 hover:underline"
          >
            {copied ? '已复制' : '复制数据'}
          </button>
          <button
            disabled={exporting}
            onClick={() => void handleExportPdf()}
            className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 transition-colors shadow-2xs flex items-center gap-1"
          >
            <span>📄</span>
            <span>{exporting ? '正在生成…' : '导出 PDF 报告'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
