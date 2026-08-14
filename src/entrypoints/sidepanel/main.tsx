// 侧边栏主视图:统一交互式对话(2026-08-14)。
// 取消「对话|智能体」双模式:输入目标 → AI 经 Agent 薄 loop 操作页面,
// 思考/工具步骤/安全确认/结果全部以对话消息呈现(ADR-0007/0008)。
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/main.css';
import type { AgentEvent } from '@/utils/ai/agentTypes';
import type { AiSettings } from '@/utils/ai/provider/types';
import {
  getActiveTabId,
  getSettings,
  hasUsableProvider,
  startAgentSession,
  type AgentSessionHandle,
} from '@/utils/sidepanelClient';
import { MessageItem, type UiMessage } from '@/components/sidepanel/MessageItem';
import { SessionHistoryModal } from '@/components/sidepanel/SessionHistoryModal';
import {
  createSession,
  loadStore,
  saveStore,
  sortSessions,
  type AgentSession,
} from '@/utils/agentSessions';

const newId = (): string => (globalThis.crypto?.randomUUID?.() ?? `m_${Date.now()}`);

function App() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AgentSession[]>([]);
  const [input, setInput] = useState('');
  const [toast, setToast] = useState('');

  const handleRef = useRef<AgentSessionHandle | null>(null);
  const settingsRef = useRef<AiSettings | null>(null);
  const messagesRef = useRef<UiMessage[]>([]);
  const sessionIdRef = useRef('');
  const toastTimer = useRef<number | null>(null);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const showToast = useCallback((t: string) => {
    setToast(t);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2500);
  }, []);

  // 初始化:加载设置 + 恢复最后会话
  useEffect(() => {
    void (async () => {
      const [s, store] = await Promise.all([getSettings(), loadStore()]);
      setSettings(s);
      if (store.currentId && store.sessions[store.currentId]) {
        const cur = store.sessions[store.currentId]!;
        setSessionId(cur.id);
        setMessages(cur.messages);
      } else {
        setSessionId(newId());
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 消息变化 → 防抖保存到当前会话(chrome.storage.local,本地持久化)
  useEffect(() => {
    if (!sessionIdRef.current) return;
    const t = window.setTimeout(() => {
      void (async () => {
        const store = await loadStore();
        store.sessions[sessionIdRef.current] = createSession(sessionIdRef.current, messages);
        store.currentId = sessionIdRef.current;
        await saveStore(store);
      })();
    }, 400);
    return () => window.clearTimeout(t);
  }, [messages]);

  const running = messages.some((m) => m.streaming);
  const lastAgentId = [...messages].reverse().find((m) => m.role === 'agent')?.id ?? '';

  /** 开启新对话(本地保存当前,清空界面) */
  const newChat = useCallback(() => {
    if (running) return;
    setSessionId(newId());
    setMessages([]);
  }, [running]);

  /** 打开历史列表 */
  const openHistory = useCallback(() => {
    if (running) return;
    void loadStore().then((store) => {
      setHistory(sortSessions(store.sessions));
      setShowHistory(true);
    });
  }, [running]);

  /** 切换到历史会话 */
  const selectSession = useCallback(
    (id: string) => {
      void loadStore().then((store) => {
        const s = store.sessions[id];
        if (!s) return;
        setSessionId(id);
        setMessages(s.messages);
        setShowHistory(false);
      });
    },
    [],
  );

  /** 删除历史会话(至少保留一个) */
  const deleteSession = useCallback(
    (id: string) => {
      void (async () => {
        const store = await loadStore();
        if (Object.keys(store.sessions).length <= 1) return;
        delete store.sessions[id];
        if (store.currentId === id) store.currentId = null;
        await saveStore(store);
        setHistory(sortSessions(store.sessions));
        // 删除的是当前会话 → 新开
        if (sessionIdRef.current === id) {
          setSessionId(newId());
          setMessages([]);
        }
      })();
    },
    [],
  );

  const patchMessage = useCallback((id: string, updater: (m: UiMessage) => UiMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  }, []);

  /** 事件回调(绑定到某条 agent 消息) */
  const onEvent = useCallback(
    (id: string) => (e: AgentEvent) => {
      if (e.type === 'agent-thinking') {
        patchMessage(id, (m) => ({ ...m, thinking: (m.thinking ?? '') + e.text }));
      } else if (e.type === 'tool-use' || e.type === 'tool-result' || e.type === 'confirm-request' || e.type === 'confirm-result') {
        patchMessage(id, (m) => ({ ...m, steps: [...(m.steps ?? []), e] }));
      } else if (e.type === 'agent-done') {
        patchMessage(id, (m) => ({ ...m, streaming: false, text: e.summary }));
      } else if (e.type === 'error') {
        patchMessage(id, (m) => ({ ...m, streaming: false, error: e.message }));
      }
    },
    [patchMessage],
  );

  /** 发送目标:追加 user + agent 消息,启动 Agent 会话(自由对话) */
  const send = useCallback(async () => {
    const goal = input.trim();
    if (!goal || running) return;
    const s = settingsRef.current;
    if (!s || !hasUsableProvider(s)) {
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: 'agent', scenario: 'general', error: '尚未配置 AI 服务,请先在扩展设置中添加 API Key' },
      ]);
      return;
    }
    const tabId = await getActiveTabId();
    if (tabId == null) {
      setMessages((prev) => [...prev, { id: newId(), role: 'agent', scenario: 'general', error: '未找到当前标签页' }]);
      return;
    }
    const id = newId();
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: 'user', text: goal },
      { id, role: 'agent', scenario: 'general', streaming: true, thinking: '', steps: [] },
    ]);
    handleRef.current = startAgentSession(
      { scenario: 'general', messages: [{ role: 'user', content: goal }], providerId: s.activeProviderId, tabId },
      onEvent(id),
      () => patchMessage(id, (m) => ({ ...m, streaming: false })),
    );
    setInput('');
  }, [input, running, onEvent, patchMessage]);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    // 标记运行中的 agent 消息结束
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  }, []);

  /** 内嵌确认响应 */
  const confirmAgent = useCallback((confirmId: string, approved: boolean) => {
    handleRef.current?.sendConfirm(confirmId, approved);
  }, []);

  const copyMessage = useCallback(async (id: string) => {
    const m = messagesRef.current.find((x) => x.id === id);
    if (m && m.text) {
      await navigator.clipboard.writeText(m.text);
      showToast('已复制');
    }
  }, [showToast]);

  return (
    <div className="flex h-screen flex-col gap-2 p-3">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-gray-800">AI 浏览器助手</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={newChat}
            disabled={running}
            title="开启新对话"
            className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            🆕 新对话
          </button>
          <button
            onClick={openHistory}
            disabled={running}
            title="历史对话(本地保存)"
            className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            📋 历史
          </button>
          <button
            onClick={() => browser.runtime.openOptionsPage()}
            className="text-xs text-blue-600 hover:underline"
          >
            设置
          </button>
        </div>
      </header>

      {/* 对话消息流 */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-1">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs">
            <div className="text-sm font-medium text-gray-700">👋 你好,我是 AI 浏览器助手</div>
            <div className="leading-relaxed text-gray-400">
              我能直接操作你当前打开的网页:读取内容、提取数据成表格、填写表单、
              点击操作、跨页研究汇总。
            </div>
            <div className="mt-1 text-gray-300">
              直接告诉我你想做什么,比如
              <br />
              "把这个表格整理成 CSV" / "帮我填这个表单" / "查这几个页面的报价对比"
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            isLastAssistant={m.id === lastAgentId}
            onCopy={copyMessage}
            onRegenerate={() => {}}
            onInsert={() => {}}
            onConfirmAgent={confirmAgent}
          />
        ))}
      </div>

      {/* 输入框 + 运行/停止 */}
      <div className="flex items-center gap-1.5 border-t border-gray-100 pt-2">
        <input
          value={input}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
          placeholder={running ? 'AI 正在操作页面…' : '输入目标,回车运行'}
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
            onClick={() => void send()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
          >
            运行
          </button>
        )}
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex justify-center">
          <div className="rounded-full bg-gray-800/90 px-3 py-1.5 text-xs text-white">{toast}</div>
        </div>
      )}

      {showHistory && (
        <SessionHistoryModal
          sessions={history}
          currentId={sessionId}
          onSelect={selectSession}
          onDelete={deleteSession}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
