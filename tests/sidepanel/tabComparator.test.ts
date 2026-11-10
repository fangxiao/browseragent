import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  generateLocalComparisonMatrix,
  scanAndCollectWindowTabs,
  type MultiTabReportPayload,
} from '../../src/utils/sidepanel/tabComparator';

describe('tabComparator(多 Tab 聚合研报与横向比对 RFC-E2)', () => {
  const originalBrowser = (globalThis as any).browser;

  beforeEach(() => {
    (globalThis as any).browser = {
      tabs: {
        query: vi.fn(async () => [
          { id: 101, title: 'Notion 官网', url: 'https://www.notion.so/pricing' },
          { id: 102, title: 'Obsidian 官网', url: 'https://obsidian.md' },
        ]),
        sendMessage: vi.fn(async (_tabId: number, req: any) => {
          if (req?.call?.name === 'readPage') {
            return { result: { ok: true, data: { summary: '这是该网页的核心正文介绍' } } };
          }
          if (req?.call?.name === 'extractData') {
            return {
              result: {
                ok: true,
                data: {
                  matrix: [
                    ['功能', '价格'],
                    ['个人版', '免费'],
                    ['企业版', '$10/月'],
                  ],
                },
              },
            };
          }
          return { result: { ok: true } };
        }),
      },
      scripting: {
        executeScript: vi.fn(async () => [{ result: '重点选中文本' }]),
      },
    };
  });

  afterEach(() => {
    (globalThis as any).browser = originalBrowser;
  });

  it('generateLocalComparisonMatrix: 能够生成多维 Markdown 矩阵与 SWOT 研报', () => {
    const mockPayload: MultiTabReportPayload = {
      plugin: 'access-browser-assistant',
      message: '请对以下网页进行多维比对分析',
      timestamp: Date.now(),
      tabs: [
        {
          tab_id: 101,
          title: 'Notion 定价与功能',
          url: 'https://www.notion.so/pricing',
          summary: 'Notion 是一款集成了笔记、知识库与协作的综合工作空间',
          extracted_data: {
            hasHeader: true,
            rows: [
              ['版本', '费用'],
              ['Plus', '$10/月'],
            ],
          },
          selected_text: 'Plus $10/月',
        },
        {
          tab_id: 102,
          title: 'Obsidian 知识图谱',
          url: 'https://obsidian.md',
          summary: 'Obsidian 是基于本地 Markdown 文件的双链知识库工具',
        },
      ],
    };

    const report = generateLocalComparisonMatrix(mockPayload);
    expect(report).toContain('多 Tab 竞品与内容横向比对研报');
    expect(report).toContain('Notion 定价与功能');
    expect(report).toContain('Obsidian 知识图谱');
    expect(report).toContain('多维横向比对矩阵');
    expect(report).toContain('综合研判与建议');
  });

  it('scanAndCollectWindowTabs: 扫描当前窗口有效标签页并构造标准 Contract Payload', async () => {
    const payload = await scanAndCollectWindowTabs();
    expect(payload.plugin).toBe('access-browser-assistant');
    expect(payload.tabs.length).toBe(2);
    expect(payload.tabs[0]!.tab_id).toBe(101);
    expect(payload.tabs[0]!.extracted_data?.rows.length).toBe(3);
    expect(payload.tabs[0]!.selected_text).toBe('重点选中文本');
  });
});
