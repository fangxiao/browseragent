import { describe, expect, it, vi } from 'vitest';
import {
  buildPerformanceReportHtml,
  exportPerformancePdfReport,
  type PerformanceMetricData,
} from '../src/utils/reportExport';

describe('reportExport (PDF 与打印报告生成引擎)', () => {
  const mockMetrics: PerformanceMetricData[] = [
    {
      title: '百度首页',
      url: 'https://www.baidu.com',
      dnsMs: 10,
      tcpMs: 25,
      ttfbMs: 145,
      fcpMs: 220,
      domReadyMs: 310,
      loadMs: 520,
      resourceCount: 86,
      transferSizeKb: 170,
      protocol: 'http/1.1',
      topSlowResources: [
        { name: 'all_async_search.js', url: 'https://dss0.bdstatic.com/all_async_search.js', durationMs: 240, type: 'script', sizeKb: 780 },
      ],
      resourceBreakdown: {
        js: { count: 40, sizeKb: 120 },
        css: { count: 10, sizeKb: 20 },
        image: { count: 30, sizeKb: 25 },
        api: { count: 4, sizeKb: 5 },
        other: { count: 2, sizeKb: 0 },
      },
    },
    {
      title: 'Google 首页',
      url: 'https://www.google.com',
      dnsMs: 15,
      tcpMs: 950,
      ttfbMs: 330,
      fcpMs: 1400,
      domReadyMs: 1550,
      loadMs: 4100,
      resourceCount: 48,
      transferSizeKb: 60,
      protocol: 'h2',
      topSlowResources: [
        { name: 'avatar.png', url: 'https://lh3.googleusercontent.com/avatar.png', durationMs: 2700, type: 'img', sizeKb: 1 },
      ],
    },
  ];

  it('buildPerformanceReportHtml: 生成包含完整时序、表格、架构健康度与诊断建议的 HTML', () => {
    const aiSummary = '结论：百度赢在本地延迟低，Google 赢在架构轻量。';
    const html = buildPerformanceReportHtml(mockMetrics, aiSummary);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('网页性能对比与深度诊断报告');
    expect(html).toContain('百度首页');
    expect(html).toContain('Google 首页');
    expect(html).toContain('145 ms'); // TTFB
    expect(html).toContain('4100 ms'); // Load
    expect(html).toContain('all_async_search.js'); // Slow resource
    expect(html).toContain('avatar.png'); // Slow resource
    expect(html).toContain('运行时卡顿与架构健康度体检');
    expect(html).toContain('window.print()'); // Print trigger
    expect(html).toContain('@media print'); // Print stylesheet
    expect(html).toContain(aiSummary);
  });

  it('exportPerformancePdfReport: 写入 storage 并打开 /report.html 扩展标签页', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 999 });
    const mockSet = vi.fn().mockResolvedValue(undefined);
    (globalThis as any).browser = {
      storage: {
        local: {
          set: mockSet,
        },
      },
      runtime: {
        getURL: vi.fn().mockReturnValue('chrome-extension://my-extension-id/report.html'),
      },
      tabs: {
        create: mockCreate,
      },
    };

    await exportPerformancePdfReport(mockMetrics, '测试诊断建议');

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        temp_performance_report_payload: expect.objectContaining({
          metricsList: mockMetrics,
          aiAnalysisText: '测试诊断建议',
        }),
      }),
    );
    expect(mockCreate).toHaveBeenCalledWith({ url: 'chrome-extension://my-extension-id/report.html' });
  });
});
