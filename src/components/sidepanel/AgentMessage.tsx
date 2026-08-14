// 智能体对话消息:一条 agent 运行 = 思考(流式)+ 过程步骤卡片 + 内嵌安全确认 + 最终结果。
// 统一对话式交互(2026-08-14,取消「对话|智能体」双模式)。
import { useState } from 'react';
import type { AgentEvent, ScenarioId } from '@/utils/ai/agentTypes';
import { getScenarioMeta } from '@/utils/ai/agents';
import { AgentStepCard } from './AgentStepCard';

const SCENARIO_LABELS = new Map(getScenarioMeta().map((s) => [s.id, s.label]));

interface Props {
  scenario: ScenarioId;
  thinking: string;
  steps: AgentEvent[];
  text?: string;
  streaming?: boolean;
  error?: string;
  onConfirm: (confirmId: string, approved: boolean) => void;
  onCopy: () => void;
}

/** steps 中最后一条待处理的确认请求(其后无 confirm-result) */
function pendingConfirm(steps: AgentEvent[]): Extract<AgentEvent, { type: 'confirm-request' }> | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const e = steps[i]!;
    if (e.type === 'confirm-request') return e;
    if (e.type === 'confirm-result') return null;
  }
  return null;
}

export function AgentMessage({ scenario, thinking, steps, text, streaming, error, onConfirm, onCopy }: Props) {
  const [copied, setCopied] = useState(false);
  const confirm = pendingConfirm(steps);

  const handleCopy = async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="max-w-[92%] rounded-lg rounded-tl-sm border border-blue-100 bg-blue-50/40 px-3 py-2 text-xs leading-relaxed text-gray-800">
      {/* 头部:场景标签 */}
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-blue-700">
        <span>🤖</span>
        <span>{SCENARIO_LABELS.get(scenario) ?? scenario}</span>
        {streaming && <span className="text-blue-400">运行中…</span>}
      </div>

      {/* 思考(流式) */}
      {thinking && <div className="mb-1 whitespace-pre-wrap text-gray-500 italic">{thinking}</div>}

      {/* 过程步骤卡片 */}
      {steps.length > 0 && (
        <div className="mb-1 space-y-0.5 rounded-md border border-blue-100/60 bg-white/60 px-1 py-0.5">
          {steps.map((e, i) => (
            <AgentStepCard key={`${i}_${e.type}`} event={e} />
          ))}
        </div>
      )}

      {/* 内嵌安全确认(对话式,替代全屏弹层) */}
      {confirm && (
        <div className="mb-1 flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800">
          <span className="flex-1">
            ⚠️ 允许 AI 执行:
            <span className="font-medium">{confirm.summary}</span>
          </span>
          <button
            onClick={() => onConfirm(confirm.confirmId, false)}
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100"
          >
            拒绝
          </button>
          <button
            onClick={() => onConfirm(confirm.confirmId, true)}
            className="rounded bg-amber-600 px-2 py-0.5 text-[11px] text-white hover:bg-amber-700"
          >
            允许
          </button>
        </div>
      )}

      {/* 最终结果 */}
      {text && <div className="whitespace-pre-wrap">{text}</div>}
      {streaming && !text && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-blue-400" />}
      {error && <div className="mt-1 rounded bg-red-50 px-2 py-1 text-red-600">{error}</div>}

      {/* 操作:复制 */}
      {!streaming && text && (
        <div className="mt-1.5 flex items-center gap-2 border-t border-blue-100 pt-1.5">
          <button onClick={() => void handleCopy()} className="text-[11px] text-blue-600 hover:underline">
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}
    </div>
  );
}
