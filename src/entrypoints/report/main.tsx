// 独立性能报告展示与打印页面(100% 遵循 Chrome MV3 CSP 规范)
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/main.css';
import type { PerformanceMetricData } from '@/utils/reportExport';

interface ReportPayload {
  metricsList: PerformanceMetricData[];
  aiAnalysisText?: string;
  timestamp: number;
}

const REPORT_STORAGE_KEY = 'temp_performance_report_payload';

function ReportApp() {
  const [report, setReport] = useState<ReportPayload | null>(null);

  useEffect(() => {
    // 从本地存储读取待打印的报告数据
    const load = async () => {
      try {
        if (typeof browser !== 'undefined' && browser.storage?.local) {
          const res = await browser.storage.local.get(REPORT_STORAGE_KEY);
          const data = res[REPORT_STORAGE_KEY] as ReportPayload | undefined;
          if (data) {
            setReport(data);
            // 自动唤起打印
            setTimeout(() => {
              window.print();
            }, 500);
          }
        }
      } catch (err) {
        console.error('加载报告数据失败:', err);
      }
    };
    void load();
  }, []);

  if (!report || !report.metricsList || report.metricsList.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-gray-500">
        正在加载性能诊断报告...
      </div>
    );
  }

  const { metricsList, aiAnalysisText, timestamp } = report;
  const maxLoad = Math.max(...metricsList.map((m) => m.loadMs || 100), 500);

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 print:bg-white print:p-0">
      <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-8 shadow-xs print:border-none print:shadow-none print:p-4">
        {/* 顶部标题栏 */}
        <header className="flex items-center justify-between border-b-2 border-blue-600 pb-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <span>🚀</span>
              <span>网页性能对比与深度诊断报告</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              生成时间: {new Date(timestamp || Date.now()).toLocaleString()} · 由 AI 浏览器助手生成
            </p>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 transition-colors"
            >
              <span>🖨️</span>
              <span>打印 / 另存为 PDF</span>
            </button>
          </div>
        </header>

        {/* 1. 时序瀑布流横向对比 */}
        <section className="mb-8">
          <h2 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-1.5">
            <span>📊</span>
            <span>加载时序瀑布流对比 (Waterfall Timeline)</span>
          </h2>
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 space-y-4">
            {metricsList.map((m, idx) => {
              const dnsPct = ((m.dnsMs || 0) / maxLoad) * 100;
              const tcpPct = ((m.tcpMs || 0) / maxLoad) * 100;
              const ttfbPct = (Math.max(0, m.ttfbMs - m.tcpMs - m.dnsMs) / maxLoad) * 100;
              const domPct = (Math.max(0, m.domReadyMs - m.ttfbMs) / maxLoad) * 100;
              const loadPct = (Math.max(0, m.loadMs - m.domReadyMs) / maxLoad) * 100;

              return (
                <div key={`${m.url}_${idx}`}>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-800 mb-1">
                    <span className="truncate flex-1 max-w-[500px]" title={m.title || m.url}>
                      #{idx + 1} {m.title || m.url}
                    </span>
                    <span className="text-blue-600 font-bold">
                      {m.loadMs} ms {m.fcpMs ? <span className="text-slate-400 font-normal ml-1">(FCP: {m.fcpMs}ms)</span> : null}
                    </span>
                  </div>

                  <div className="flex h-5 w-full overflow-hidden rounded-md bg-slate-200 text-[10px] font-bold text-white leading-5 text-center shadow-inner">
                    {dnsPct > 1 && <div style={{ width: `${dnsPct}%` }} className="bg-amber-500" title={`DNS: ${m.dnsMs}ms`}>DNS</div>}
                    {tcpPct > 1 && <div style={{ width: `${tcpPct}%` }} className="bg-orange-600" title={`TCP: ${m.tcpMs}ms`}>TCP</div>}
                    {ttfbPct > 1 && <div style={{ width: `${ttfbPct}%` }} className="bg-blue-600" title={`TTFB: ${m.ttfbMs}ms`}>TTFB</div>}
                    {domPct > 1 && <div style={{ width: `${domPct}%` }} className="bg-indigo-600" title={`DOM: ${m.domReadyMs}ms`}>DOM</div>}
                    <div style={{ width: `${Math.max(loadPct, 4)}%` }} className="bg-emerald-600" title={`Load: ${m.loadMs}ms`}>Load</div>
                  </div>

                  <div className="flex items-center gap-4 text-[11px] text-slate-500 mt-1.5">
                    <span>🌐 DNS: <b className="text-slate-700">{m.dnsMs}ms</b></span>
                    <span>⚡ TCP: <b className="text-slate-700">{m.tcpMs}ms</b></span>
                    <span>📡 TTFB: <b className="text-slate-700">{m.ttfbMs}ms</b></span>
                    <span>📄 DOM就绪: <b className="text-slate-700">{m.domReadyMs}ms</b></span>
                    <span>🏁 完全加载: <b className="text-slate-700">{m.loadMs}ms</b></span>
                  </div>
                </div>
              );
            })}

            {/* 图例 */}
            <div className="flex items-center justify-center gap-4 border-t border-slate-200/80 pt-2.5 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />DNS解析</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-600" />TCP建连</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-600" />TTFB首字节</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-600" />DOM就绪</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" />完全加载</span>
            </div>
          </div>
        </section>

        {/* 2. 核心指标对比表格 */}
        <section className="mb-8">
          <h2 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-1.5">
            <span>📋</span>
            <span>核心指标横向对齐矩阵</span>
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">页面标题 / 网址</th>
                  <th className="py-2.5 px-3 text-center">TTFB</th>
                  <th className="py-2.5 px-3 text-center">FCP (首绘)</th>
                  <th className="py-2.5 px-3 text-center">DOM 就绪</th>
                  <th className="py-2.5 px-3 text-center">完全加载</th>
                  <th className="py-2.5 px-3 text-center">资源数</th>
                  <th className="py-2.5 px-3 text-center">传输体积</th>
                  <th className="py-2.5 px-3 text-center">网络协议</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metricsList.map((m, idx) => (
                  <tr key={`${m.url}_${idx}`} className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 font-medium text-slate-900">
                      #{idx + 1} {m.title || '网页'}
                      <div className="text-[11px] font-normal text-slate-400 truncate max-w-[280px]">{m.url}</div>
                    </td>
                    <td className="py-2.5 px-3 text-center font-semibold text-blue-600">{m.ttfbMs} ms</td>
                    <td className="py-2.5 px-3 text-center font-semibold text-emerald-600">{m.fcpMs ? `${m.fcpMs} ms` : '-'}</td>
                    <td className="py-2.5 px-3 text-center">{m.domReadyMs} ms</td>
                    <td className="py-2.5 px-3 text-center font-bold text-slate-900">{m.loadMs} ms</td>
                    <td className="py-2.5 px-3 text-center">{m.resourceCount} 个</td>
                    <td className="py-2.5 px-3 text-center">{m.transferSizeKb} KB</td>
                    <td className="py-2.5 px-3 text-center font-mono text-[11px]">{m.protocol || 'HTTP/2'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 3. 慢请求穿透诊断 */}
        {metricsList.some((m) => m.topSlowResources && m.topSlowResources.length > 0) && (
          <section className="mb-8">
            <h2 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-1.5">
              <span>🔍</span>
              <span>慢请求与阻塞资源穿透诊断 (Top Slow Requests)</span>
            </h2>
            <div className="space-y-4">
              {metricsList.map((m, idx) => (
                <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
                  <div className="font-semibold text-slate-700 mb-2">
                    📄 {m.title || m.url}:
                  </div>
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-200">
                        <th className="pb-1.5">资源名称</th>
                        <th className="pb-1.5">类型</th>
                        <th className="pb-1.5 text-right">耗时 (Duration)</th>
                        <th className="pb-1.5 text-right">传输体积</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(m.topSlowResources || []).map((r, rIdx) => (
                        <tr key={rIdx}>
                          <td className="py-1 font-mono text-slate-800 truncate max-w-[320px]" title={r.url || r.name}>
                            {r.name}
                          </td>
                          <td className="py-1 text-slate-500">{r.type}</td>
                          <td className="py-1 text-right font-bold text-red-600">{r.durationMs} ms</td>
                          <td className="py-1 text-right text-slate-500">{r.sizeKb || 0} KB</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 4. 运行时卡顿与架构健康度体检 */}
        <section className="mb-8">
          <h2 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-1.5">
            <span>🧠</span>
            <span>运行时卡顿与架构健康度体检 (Runtime, Memory & DOM)</span>
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">页面标题</th>
                  <th className="py-2.5 px-3 text-center">DOM 节点数</th>
                  <th className="py-2.5 px-3 text-center">最大嵌套层级</th>
                  <th className="py-2.5 px-3 text-center">JS 堆内存 (已用)</th>
                  <th className="py-2.5 px-3 text-center">主线程长任务 (卡顿)</th>
                  <th className="py-2.5 px-3 text-center">本地缓存命中率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metricsList.map((m, idx) => (
                  <tr key={`${m.url}_${idx}`}>
                    <td className="py-2.5 px-3 font-semibold text-slate-800">{m.title || m.url}</td>
                    <td className="py-2.5 px-3 text-center font-semibold" style={{ color: (m.domNodeCount || 0) > 2000 ? '#dc2626' : '#16a34a' }}>
                      {m.domNodeCount ?? '-'} 个
                    </td>
                    <td className="py-2.5 px-3 text-center">{m.maxDomDepth ? `${m.maxDomDepth} 层` : '-'}</td>
                    <td className="py-2.5 px-3 text-center font-semibold">{m.jsHeapUsedMb ? `${m.jsHeapUsedMb} MB` : '-'}</td>
                    <td className="py-2.5 px-3 text-center" style={{ color: (m.longTaskCount || 0) > 0 ? '#ea580c' : '#16a34a' }}>
                      {m.longTaskCount ? `⚠️ ${m.longTaskCount} 次 (卡死 ${m.totalLongTaskMs}ms)` : '🟢 0 次 (极度丝滑)'}
                    </td>
                    <td className="py-2.5 px-3 text-center">{m.cacheHitRatePct != null ? `${m.cacheHitRatePct}%` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 5. 压缩漏配与首屏关键阻塞扫描 */}
        {(metricsList.some((m) => m.uncompressedAssets && m.uncompressedAssets.length > 0) ||
          metricsList.some((m) => m.renderBlockingList && m.renderBlockingList.length > 0)) && (
          <section className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            {metricsList.some((m) => m.uncompressedAssets && m.uncompressedAssets.length > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-xs">
                <h3 className="font-bold text-amber-900 mb-1 flex items-center gap-1.5">
                  <span>🚨</span>
                  <span>未压缩传输资源 (未开 Gzip/Brotli)</span>
                </h3>
                <p className="text-[11px] text-amber-700 mb-3">开启压缩预计可立省 65% 网络流量与加载耗时:</p>
                <div className="space-y-1.5 font-mono text-[11px]">
                  {metricsList.map((m) =>
                    (m.uncompressedAssets || []).map((u, uIdx) => (
                      <div key={uIdx} className="flex justify-between items-center bg-white/70 px-2 py-1 rounded border border-amber-200/50">
                        <span className="truncate max-w-[200px]" title={u.name}>{u.name}</span>
                        <span className="text-amber-800 font-semibold">{u.sizeKb}KB (省~{u.wastedKb}K)</span>
                      </div>
                    )),
                  )}
                </div>
              </div>
            )}

            {metricsList.some((m) => m.renderBlockingList && m.renderBlockingList.length > 0) && (
              <div className="rounded-lg border border-red-200 bg-red-50/60 p-4 text-xs">
                <h3 className="font-bold text-red-900 mb-1 flex items-center gap-1.5">
                  <span>🛑</span>
                  <span>首屏关键渲染阻塞项 (Head 同步脚本)</span>
                </h3>
                <p className="text-[11px] text-red-700 mb-3">建议在 script 标签增加 defer/async 属性避免挂起解析:</p>
                <div className="space-y-1.5 font-mono text-[11px]">
                  {metricsList.map((m) =>
                    (m.renderBlockingList || []).map((b, bIdx) => (
                      <div key={bIdx} className="flex justify-between items-center bg-white/70 px-2 py-1 rounded border border-red-200/50">
                        <span className="truncate max-w-[220px]" title={b.name}>{b.name}</span>
                        <span className="text-red-700 font-semibold">[{b.type}]</span>
                      </div>
                    )),
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* 6. AI 专家级优化诊断报告 */}
        {aiAnalysisText && (
          <section className="mb-8 rounded-lg border border-blue-200 bg-blue-50/50 p-5">
            <h2 className="text-sm font-bold text-blue-900 mb-2 flex items-center gap-1.5">
              <span>🤖</span>
              <span>AI 智能诊断与工程优化建议</span>
            </h2>
            <div className="text-xs text-blue-950 leading-relaxed whitespace-pre-wrap">
              {aiAnalysisText}
            </div>
          </section>
        )}

        {/* 页脚 */}
        <footer className="border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
          AI 浏览器助手 (AI Browser Agent) · 浏览器原生毫秒级性能诊断引擎
        </footer>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<ReportApp />);
