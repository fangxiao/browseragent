// 智能体过程步骤卡(设计 §10):把 AgentEvent 渲染为可读步骤。
// agent-thinking(灰字)/ tool-use(工具+参数摘要)/ tool-result(ok/error)/ agent-done(summary)。
import type { AgentEvent } from '@/utils/ai/agentTypes';
import type { ToolCall, ToolResult } from '@/utils/domTools/types';
import { mdTableToCsv } from '@/utils/ai/recombine';
import { ExportButtons } from './ExportButtons';

/** extractData 返回的数据结构(actions.ts) */
interface ExtractDataResult {
  rows: string[][];
  hasHeader: boolean;
  csv?: string;
  json?: string;
}

/** 从工具结果里取出 CSV 文本(仅 extractData 成功时) */
function extractCsvFromData(data: unknown): string | null {
  const d = data as ExtractDataResult | undefined;
  return typeof d?.csv === 'string' && d.csv.length > 0 ? d.csv : null;
}

/** 提取工具参数摘要(取常用关键字段,拼接成一行) */
function summarizeArgs(call: ToolCall): string {
  const a = call.args ?? {};
  const pick = (k: string): string => (a[k] != null ? String(a[k]) : '');
  const parts: string[] = [];
  for (const k of ['selector', 'text', 'url', 'ms', 'keyword', 'role', 'format', 'direction'] as const) {
    const v = pick(k);
    if (v) parts.push(k === 'text' ? `“${v.length > 60 ? v.slice(0, 60) + '…' : v}”` : v);
  }
  return parts.join(', ');
}

/** 工具结果摘要:按工具类型转成普通用户可读的一句话(替代原始 JSON) */
function summarizeResult(call: ToolCall, result: ToolResult): string {
  if (!result.ok) {
    const e = typeof result.error === 'string' ? result.error : JSON.stringify(result.error ?? '');
    return e.length > 90 ? e.slice(0, 90) + '…' : e;
  }
  if (result.data == null) return '完成';
  const d = result.data as Record<string, unknown>;
  const s = (v: unknown): string => (v != null ? String(v) : '');
  switch (call.name) {
    case 'listTabs':
      return `已发现 ${s(d.count) || (Array.isArray(d.tabs) ? d.tabs.length : 0)} 个标签页`;
    case 'readPage':
    case 'getPageInfo':
      return `页面:${s(d.title)}`;
    case 'getPagePerformance': {
      const fcp = d.fcpMs ? `FCP: ${s(d.fcpMs)}ms, ` : '';
      return `加载耗时: ${s(d.loadMs)}ms (${fcp}TTFB: ${s(d.ttfbMs)}ms, ${s(d.resourceCount)} 个资源, ${s(d.transferSizeKb)}KB)`;
    }
    case 'findElements':
      return `找到 ${s(d.count) || 0} 个元素`;
    case 'extractData': {
      const n = Array.isArray(d.rows) ? d.rows.length : 0;
      return `已提取 ${n} 行数据`;
    }
    case 'clickElement':
      return `已点击:${s(d.clicked)}`;
    case 'typeInto':
      if (d.typed != null) return `已输入:${s(d.typed)}`;
      if (d.selected != null) return `已选择:${s(d.selected)}`;
      if (d.checked != null) return d.checked ? '已勾选' : '已取消勾选';
      return '已填写';
    case 'navigate':
      return `已跳转:${s(d.url)}`;
    case 'scrollTo':
      return d.scrolledTo != null ? `已滚动到:${s(d.scrolledTo)}` : `已滚动${s(d.direction) ? `:${s(d.direction)}` : ''}`;
    case 'waitFor':
      return `已找到:${s(d.found)}`;
    case 'sleep':
      return `已等待 ${s(d.sleptMs) || 0}ms`;
    case 'evaluate':
      return '代码已执行';
    default:
      if (typeof d === 'object' && d !== null) {
        try {
          const json = JSON.stringify(d);
          return json.length > 90 ? json.slice(0, 90) + '…' : json;
        } catch {
          return '完成';
        }
      }
      return s(d).length > 90 ? s(d).slice(0, 90) + '…' : s(d);
  }
}

const TOOL_LABELS: Record<string, string> = {
  getPageInfo: '读取页面信息',
  getPagePerformance: '分析页面性能',
  listTabs: '扫描标签页',
  readPage: '读取页面元素',
  findElements: '查找元素',
  clickElement: '点击',
  typeInto: '输入文本',
  scrollTo: '滚动',
  waitFor: '等待元素',
  sleep: '等待',
  extractData: '提取数据',
  navigate: '导航',
  evaluate: '执行脚本',
};

import { TabSelector, type TabItem } from './TabSelector';

export function AgentStepCard({
  event,
  onSelectTabs,
}: {
  event: AgentEvent;
  onSelectTabs?: (tabs: TabItem[]) => void;
}) {
  // 共享行容器样式
  const row = 'flex items-start gap-1.5 px-2 py-1 text-xs';

  switch (event.type) {
    case 'agent-thinking':
      return (
        <div className={`${row} text-gray-500 italic`}>
          <span>💭</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{event.text}</span>
        </div>
      );

    case 'tool-use':
      return (
        <div className={`${row} rounded border border-blue-100 bg-blue-50/60 text-blue-800`}>
          <span>🔧</span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{TOOL_LABELS[event.call.name] ?? event.call.name}</span>
            {summarizeArgs(event.call) && (
              <span className="ml-1 break-all text-blue-700/80">· {summarizeArgs(event.call)}</span>
            )}
          </span>
        </div>
      );

    case 'tool-result': {
      const csv = event.call.name === 'extractData' ? extractCsvFromData(event.result.data) : null;
      const tabData = event.call.name === 'listTabs' && event.result.ok ? (event.result.data as { tabs?: TabItem[] }) : null;
      const tabs = Array.isArray(tabData?.tabs) ? tabData.tabs : null;

      return (
        <div className="space-y-1">
          <div
            className={`${row} ${
              event.result.ok ? 'border-green-100 bg-green-50/60 text-green-800' : 'border-red-100 bg-red-50/60 text-red-700'
            } rounded`}
          >
            <span>{event.result.ok ? '✅' : '⚠️'}</span>
            <span className="min-w-0 flex-1 break-all">{summarizeResult(event.call, event.result)}</span>
            {event.result.ok && csv && <ExportButtons csv={csv} filename="extracted.csv" />}
          </div>
          {tabs && tabs.length > 0 && onSelectTabs && (
            <TabSelector tabs={tabs} onConfirm={onSelectTabs} />
          )}
        </div>
      );
    }

    case 'confirm-request':
      return (
        <div className={`${row} rounded border border-amber-200 bg-amber-50 text-amber-800`}>
          <span>⏳</span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">等待你确认:</span> {event.summary}
          </span>
        </div>
      );

    case 'confirm-result':
      return (
        <div className={`${row} text-gray-400`}>
          <span>{event.approved ? '✅' : '🚫'}</span>
          <span className="min-w-0 flex-1">{event.approved ? '已批准' : '已拒绝'}</span>
        </div>
      );

    case 'agent-done': {
      const csv = mdTableToCsv(event.summary);
      return (
        <div className={`${row} rounded border border-emerald-200 bg-emerald-50 text-emerald-900`}>
          <span>🏁</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{event.summary}</span>
          {csv && <ExportButtons csv={csv} />}
        </div>
      );
    }

    case 'error':
      return (
        <div className={`${row} rounded border border-red-200 bg-red-50 text-red-700`}>
          <span>❌</span>
          <span className="min-w-0 flex-1 break-all">{event.message}</span>
        </div>
      );

    default:
      return null;
  }
}
