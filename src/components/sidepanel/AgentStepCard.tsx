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

/** 工具结果摘要(截断,单行) */
function summarizeResult(result: ToolResult): string {
  if (!result.ok) {
    const e = typeof result.error === 'string' ? result.error : JSON.stringify(result.error ?? '');
    return e.length > 90 ? e.slice(0, 90) + '…' : e;
  }
  if (result.data == null) return 'ok';
  const s = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
  return s.length > 90 ? s.slice(0, 90) + '…' : s;
}

const TOOL_LABELS: Record<string, string> = {
  getPageInfo: '读取页面信息',
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

export function AgentStepCard({ event }: { event: AgentEvent }) {
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
      return (
        <div
          className={`${row} ${
            event.result.ok ? 'border-green-100 bg-green-50/60 text-green-800' : 'border-red-100 bg-red-50/60 text-red-700'
          } rounded`}
        >
          <span>{event.result.ok ? '✅' : '⚠️'}</span>
          <span className="min-w-0 flex-1 break-all">{summarizeResult(event.result)}</span>
          {event.result.ok && csv && <ExportButtons csv={csv} filename="extracted.csv" />}
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
