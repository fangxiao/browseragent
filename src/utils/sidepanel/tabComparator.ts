import { getSettings } from '../storage';

export interface TabDataSnapshot {
  tab_id: number;
  title: string;
  url: string;
  summary: string;
  extracted_data?: {
    hasHeader: boolean;
    rows: string[][];
  };
  selected_text?: string;
}

export interface MultiTabReportPayload {
  plugin: 'access-browser-assistant';
  message: string;
  timestamp: number;
  tabs: TabDataSnapshot[];
}

/** 扫描并抓取当前窗口所有有效业务网页的数据摘要与表格结构 */
export async function scanAndCollectWindowTabs(options?: {
  maxTabs?: number;
}): Promise<MultiTabReportPayload> {
  if (typeof browser === 'undefined' || !browser.tabs?.query) {
    throw new Error('未检测到浏览器扩展环境');
  }

  const maxTabs = options?.maxTabs || 6;
  const allTabs = await browser.tabs.query({ currentWindow: true });

  const validTabs = allTabs
    .filter(
      (t) =>
        t.id &&
        t.url &&
        /^https?:\/\//i.test(t.url) &&
        !/chrome-extension:|devtools:|about:|chrome:/i.test(t.url),
    )
    .slice(0, maxTabs);

  if (validTabs.length === 0) {
    throw new Error('当前窗口未发现打开的网页（需打开至少一个 http/https 网页）');
  }

  const tabSnapshots: TabDataSnapshot[] = [];

  for (const tab of validTabs) {
    const tabId = tab.id!;
    let summary = '';
    let extractedData: { hasHeader: boolean; rows: string[][] } | undefined;
    let selectedText = '';

    try {
      // 1. 获取页面文本摘要
      const readRes = await browser.tabs.sendMessage(tabId, {
        type: 'TOOL:CALL',
        call: { id: `tab_read_${Date.now()}`, name: 'readPage', args: { textLimit: 3000 } },
      }).catch(() => null);

      if (readRes?.result?.ok && readRes.result.data) {
        summary = readRes.result.data.summary || '';
      }

      // 2. 尝试提取表格数据
      const tableRes = await browser.tabs.sendMessage(tabId, {
        type: 'TOOL:CALL',
        call: { id: `tab_extract_${Date.now()}`, name: 'extractData', args: { format: 'matrix' } },
      }).catch(() => null);

      if (tableRes?.result?.ok && tableRes.result.data?.matrix) {
        const matrix = tableRes.result.data.matrix as string[][];
        if (matrix.length > 0) {
          extractedData = {
            hasHeader: true,
            rows: matrix.slice(0, 10),
          };
        }
      }

      // 3. 读取用户在页面选中的文本
      const selRes = await browser.scripting.executeScript({
        target: { tabId },
        func: () => window.getSelection()?.toString() || '',
      }).catch(() => null);

      if (selRes?.[0]?.result) {
        selectedText = String(selRes[0].result).trim().slice(0, 500);
      }
    } catch {
      /* ignore single tab error */
    }

    tabSnapshots.push({
      tab_id: tabId,
      title: tab.title || '未命名网页',
      url: tab.url || '',
      summary: summary.slice(0, 1500) || `[${tab.title}] 网页正文加载中`,
      extracted_data: extractedData,
      selected_text: selectedText || undefined,
    });
  }

  return {
    plugin: 'access-browser-assistant',
    message: `请对当前打开的 ${tabSnapshots.length} 个网页进行横向比对与多维研报分析`,
    timestamp: Date.now(),
    tabs: tabSnapshots,
  };
}

/** 本地离线合成多 Tab 横向比对研报与 SWOT 矩阵 */
export function generateLocalComparisonMatrix(payload: MultiTabReportPayload): string {
  const tabs = payload.tabs;
  if (tabs.length === 0) return '未扫描到有效网页。';

  let md = `## 📊 多 Tab 竞品与内容横向比对研报\n\n`;
  md += `> 本次共扫描当前工作区 **${tabs.length}** 个网页，生成多维比对矩阵与分析结论：\n\n`;

  // 1. 核心对象列表
  md += `### 1. 扫描对象概览\n\n`;
  md += `| 序号 | 网页/产品名称 | 目标网址 | 核心提取状态 |\n`;
  md += `| :---: | :--- | :--- | :--- |\n`;
  tabs.forEach((t, idx) => {
    const hasTable = t.extracted_data ? `✅ 表格 (${t.extracted_data.rows.length}行)` : '📄 文本摘要';
    md += `| ${idx + 1} | [${t.title.slice(0, 30)}](${t.url}) | \`${new URL(t.url).hostname}\` | ${hasTable} |\n`;
  });

  // 2. 差异化特征与关键信息提取
  md += `\n### 2. 多维横向比对矩阵\n\n`;
  md += `| 维度 / 网页 | ${tabs.map((t) => t.title.slice(0, 15)).join(' | ')} |\n`;
  md += `| :--- | ${tabs.map(() => ':---').join(' | ')} |\n`;
  md += `| **核心定位** | ${tabs.map((t) => t.summary.slice(0, 45) + '…').join(' | ')} |\n`;
  md += `| **关键数据/定价** | ${tabs.map((t) => (t.extracted_data?.rows[0] ? t.extracted_data.rows[0].join(' / ').slice(0, 40) : '见正文详情')).join(' | ')} |\n`;
  md += `| **用户重点关注** | ${tabs.map((t) => (t.selected_text ? `"${t.selected_text.slice(0, 35)}…"` : '全局综合')).join(' | ')} |\n`;

  // 3. 综合 SWOT 决策与总结
  md += `\n### 3. 综合研判与建议\n\n`;
  md += `- **核心共识**：${tabs.map((t) => `\`${t.title.slice(0, 12)}\``).join('、')} 均聚焦于当前业务领域的解决方案。\n`;
  md += `- **差异化亮点**：不同产品在定价策略、功能深度与交互形态上各有侧重。\n`;
  md += `- **行动建议**：建议结合上述表格提取的数据指标，针对关键差异项进行专项深入调研。\n`;

  return md;
}

/** 执行多 Tab 联合研报流程 (优先请求本地/平台端 API，无服务时自动降级使用本地矩阵) */
export async function executeMultiTabComparison(): Promise<{
  reportMarkdown: string;
  tabsCount: number;
  payload: MultiTabReportPayload;
  source: 'platform' | 'local';
}> {
  const payload = await scanAndCollectWindowTabs();
  const settings = await getSettings().catch(() => null);
  const platformUrl = (settings?.platformApiUrl || 'http://127.0.0.1:8000').replace(/\/+$/, '');

  try {
    const response = await fetch(`${platformUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      const json = await response.json();
      const report = json.reply || json.content || json.markdown || json.data?.report;
      if (report) {
        return {
          reportMarkdown: report,
          tabsCount: payload.tabs.length,
          payload,
          source: 'platform',
        };
      }
    }
  } catch {
    /* 本地 API 未启动或不可达，降级到本地合成 */
  }

  const localReport = generateLocalComparisonMatrix(payload);
  return {
    reportMarkdown: localReport,
    tabsCount: payload.tabs.length,
    payload,
    source: 'local',
  };
}
