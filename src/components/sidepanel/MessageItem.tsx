// 对话流中的单条消息(user / assistant / agent 统一对话式)
import { useEffect, useRef, useState } from 'react';
import type { CapabilityId } from '@/utils/ai/provider/types';
import type { AgentEvent } from '@/utils/ai/agentTypes';
import { AgentMessage } from './AgentMessage';

import type { TabItem, ComparisonMode } from './TabSelector';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant' | 'agent';
  text?: string;
  streaming?: boolean;
  error?: string;
  /** assistant 消息记录生成它的能力(用于重新生成/追问上下文) */
  capability?: CapabilityId;
  /** agent 消息:流式思考文本 */
  thinking?: string;
  /** agent 消息:过程步骤事件 */
  steps?: AgentEvent[];
}

interface Props {
  message: UiMessage;
  isLastAssistant: boolean;
  debugMode?: boolean;
  onCopy: (id: string) => void;
  onRegenerate: (id: string) => void;
  onInsert: (id: string, mode: 'append' | 'cursor') => void;
  /** agent 消息内嵌安全确认响应 */
  onConfirmAgent: (confirmId: string, approved: boolean) => void;
  onSelectTabs?: (tabs: TabItem[], mode: ComparisonMode) => void;
  onAnchorClick?: (anchorId: string) => void;
}

export function MessageItem({
  message,
  isLastAssistant,
  debugMode,
  onCopy,
  onRegenerate,
  onInsert,
  onConfirmAgent,
  onSelectTabs,
  onAnchorClick,
}: Props) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && message.streaming) ref.current.scrollIntoView({ block: 'end' });
  }, [message.text, message.thinking, message.streaming]);

  const handleCopy = async () => {
    await onCopy(message.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-blue-600 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-white">
          {message.text}
        </div>
      </div>
    );
  }

  if (message.role === 'agent') {
    return (
      <div ref={ref} className="flex justify-start">
        <AgentMessage
          thinking={message.thinking ?? ''}
          steps={message.steps ?? []}
          text={message.text}
          streaming={message.streaming}
          error={message.error}
          debugMode={debugMode}
          onConfirm={onConfirmAgent}
          onCopy={() => void handleCopy()}
          onSelectTabs={onSelectTabs}
          onAnchorClick={onAnchorClick}
        />
      </div>
    );
  }

  return (
    <div ref={ref} className="flex justify-start">
      <div className="max-w-[92%] rounded-lg rounded-tl-sm border border-gray-200 bg-white px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-gray-800">
        {message.text}
        {message.streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-blue-400" />}
        {message.error && (
          <div className="mt-1 rounded bg-red-50 px-2 py-1 text-red-600">{message.error}</div>
        )}
        {!message.streaming && message.text && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-1.5">
            <button onClick={() => void handleCopy()} className="text-[11px] text-blue-600 hover:underline">
              {copied ? '已复制' : '复制'}
            </button>
            {isLastAssistant && (
              <button onClick={() => onRegenerate(message.id)} className="text-[11px] text-gray-500 hover:underline">
                重新生成
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
