// 智能体模式主视图(设计 §10):场景选择 + 目标输入 + Agent 过程展示 + 停止 + 安全确认。
// 经 AGENT port 与 background 的薄 loop 通信(ADR-0007/0008)。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScenarioId } from '@/utils/ai/agentTypes';
import type { AgentEvent } from '@/utils/ai/agentTypes';
import type { ChatMessage } from '@/utils/ai/provider/types';
import { getScenarioMeta } from '@/utils/ai/agents';
import {
  getActiveTabId,
  getSettings,
  hasUsableProvider,
  startAgentSession,
  type AgentSessionHandle,
} from '@/utils/sidepanelClient';
import { AgentStepCard } from './AgentStepCard';
import { AgentConfirmModal } from './AgentConfirmModal';

const newId = (): string => (globalThis.crypto?.randomUUID?.() ?? `s_${Date.now()}`);

const SCENARIO_META = getScenarioMeta();

export function AgentView() {
  const [scenario, setScenario] = useState<ScenarioId>('dataExtract');
  const [input, setInput] = useState('');
  const [steps, setSteps] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [confirm, setConfirm] = useState<Extract<AgentEvent, { type: 'confirm-request' }> | null>(null);

  const handleRef = useRef<AgentSessionHandle | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scenarioRef = useRef(scenario);
  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  // 步骤流自动滚到底部
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [steps]);

  const onEvent = useCallback((e: AgentEvent) => {
    setSteps((prev) => [...prev, e]);
    if (e.type === 'confirm-request') setConfirm(e);
    else if (e.type === 'confirm-result') setConfirm(null);
    else if (e.type === 'agent-done' || e.type === 'error') setRunning(false);
  }, []);

  const start = useCallback(async () => {
    const goal = input.trim();
    if (!goal || running) return;
    const settings = await getSettings();
    if (!hasUsableProvider(settings)) {
      setSteps((prev) => [
        ...prev,
        { type: 'error', message: '尚未配置 AI 服务,请先在扩展设置中添加 API Key' },
      ]);
      return;
    }
    const tabId = await getActiveTabId();
    if (tabId == null) {
      setSteps((prev) => [...prev, { type: 'error', message: '未找到当前标签页' }]);
      return;
    }
    setSteps([]);
    setConfirm(null);
    setRunning(true);
    const messages: ChatMessage[] = [{ role: 'user', content: goal }];
    handleRef.current = startAgentSession(
      { scenario: scenarioRef.current, messages, providerId: settings.activeProviderId, tabId },
      onEvent,
      () => setRunning(false),
    );
    setInput('');
  }, [input, running, onEvent]);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    setRunning(false);
  }, []);

  const respond = useCallback(
    (approved: boolean) => {
      if (confirm) handleRef.current?.sendConfirm(confirm.confirmId, approved);
    },
    [confirm],
  );

  const argsSummary = confirm
    ? Object.entries(confirm.tool.args ?? {})
        .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
        .join(', ')
    : '';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* 场景选择 */}
      <div className="flex flex-wrap gap-1">
        {SCENARIO_META.map((s) => (
          <button
            key={s.id}
            disabled={running}
            title={s.description}
            onClick={() => setScenario(s.id)}
            className={`rounded-full px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
              scenario === s.id
                ? 'bg-blue-600 text-white'
                : 'border border-gray-300 text-gray-600 hover:bg-gray-100'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 目标输入 + 运行/停止 */}
      <div className="flex items-center gap-1.5">
        <input
          value={input}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void start();
          }}
          placeholder={
            running ? 'AI 正在操作页面…' : '输入目标,如"提取这个表格并转成 CSV"'
          }
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 disabled:opacity-60"
        />
        {running ? (
          <button
            onClick={stop}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
          >
            停止
          </button>
        ) : (
          <button
            disabled={!input.trim()}
            onClick={() => void start()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
          >
            运行
          </button>
        )}
      </div>

      {/* 过程步骤流 */}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded-lg border border-gray-100 bg-white py-1">
        {steps.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-gray-400">
            选择一个场景,输入目标后点击「运行」。<br />
            AI 会读取页面元素、执行操作,敏感动作(提交/发布等)会先征求你的确认。
          </div>
        )}
        {steps.map((e, i) => (
          <AgentStepCard key={`${i}_${e.type}`} event={e} />
        ))}
        {running && (
          <div className="px-2 py-1 text-xs text-gray-400">
            <span className="mr-1 inline-block h-2.5 w-2.5 animate-spin rounded-full border border-blue-400 border-t-transparent align-middle" />
            运行中…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {confirm && (
        <AgentConfirmModal
          summary={confirm.summary}
          tool={confirm.tool}
          argsSummary={argsSummary}
          onApprove={() => respond(true)}
          onReject={() => respond(false)}
        />
      )}
    </div>
  );
}
