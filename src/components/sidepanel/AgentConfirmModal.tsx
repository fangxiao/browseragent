// 智能体敏感操作确认弹层(设计 §8.2,复用 PrivacyConfirm 模式)。
// background 判定敏感 → confirm-request → 此处展示"AI 想执行:…"→ 批准/拒绝。
import type { ToolCall } from '@/utils/domTools/types';

interface Props {
  summary: string;
  tool: ToolCall;
  argsSummary: string;
  onApprove: () => void;
  onReject: () => void;
}

export function AgentConfirmModal({ summary, tool, argsSummary, onApprove, onReject }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full rounded-lg bg-white p-4 text-sm shadow-lg">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-700">
          <span>⚠️</span> 安全确认
        </div>
        <p className="mb-2 text-xs text-gray-700">
          AI 想执行:
          <span className="font-medium text-gray-900">{summary}</span>
        </p>
        <div className="mb-3 rounded bg-gray-50 px-2 py-1.5 text-[11px] text-gray-500">
          <div>工具:{tool.name}</div>
          {argsSummary && <div className="mt-0.5 break-all">参数:{argsSummary}</div>}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onReject}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
          >
            拒绝
          </button>
          <button
            onClick={onApprove}
            className="rounded bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700"
          >
            允许执行
          </button>
        </div>
      </div>
    </div>
  );
}
