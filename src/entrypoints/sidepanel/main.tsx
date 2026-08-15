// 侧边栏主视图:统一交互式对话(2026-08-14)。
// 取消「对话|智能体」双模式:输入目标 → AI 经 Agent 薄 loop 操作页面,
// 思考/工具步骤/安全确认/结果全部以对话消息呈现(ADR-0007/0008)。
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/main.css';
import type { AgentEvent } from '@/utils/ai/agentTypes';
import type { AiSettings, ChatMessage } from '@/utils/ai/provider/types';
import type { TabItem, ComparisonMode } from '@/components/sidepanel/TabSelector';
import { getSettings, saveSettings } from '@/utils/storage';
import {
  getActiveTabId,
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
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);

  const scrollToBottom = useCallback((smooth = false) => {
    if (messagesContainerRef.current) {
      if (smooth) {
        messagesContainerRef.current.scrollTo({
          top: messagesContainerRef.current.scrollHeight,
          behavior: 'smooth',
        });
      } else {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }
  }, []);

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

  const LAST_VERSION_KEY = 'last_seen_extension_version';

  // 初始化:加载设置 + 恢复最后会话(若检测到扩展更新则默认开启全新对话)
  useEffect(() => {
    void (async () => {
      const [s, store] = await Promise.all([getSettings(), loadStore()]);
      setSettings(s);

      const currentVersion =
        typeof browser !== 'undefined' && browser.runtime?.getManifest
          ? browser.runtime.getManifest()?.version || '0.2.1'
          : '0.2.1';

      let isUpdated = false;
      try {
        if (typeof browser !== 'undefined' && browser.storage?.local) {
          const res = (await browser.storage.local.get([
            'extension_needs_fresh_session',
            LAST_VERSION_KEY,
          ])) as {
            extension_needs_fresh_session?: boolean;
            [LAST_VERSION_KEY]?: string;
          };
          if (res.extension_needs_fresh_session) {
            isUpdated = true;
            await browser.storage.local.remove('extension_needs_fresh_session');
          } else if (res[LAST_VERSION_KEY] && res[LAST_VERSION_KEY] !== currentVersion) {
            isUpdated = true;
          }
          await browser.storage.local.set({ [LAST_VERSION_KEY]: currentVersion });
        }
      } catch {
        /* 忽略版本存储异常 */
      }

      if (isUpdated) {
        // 插件有版本更新或重新加载时，默认开启全新对话
        const freshId = newId();
        setSessionId(freshId);
        setMessages([]);
        store.currentId = freshId;
        await saveStore(store);
        showToast(`🎉 插件已更新至 v${currentVersion}，已为你开启全新对话`);
      } else if (store.currentId && store.sessions[store.currentId]) {
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

  // 消息内容变化(新增消息/流式输出/步骤推进) → 自动滚动到底部
  useEffect(() => {
    scrollToBottom(false);
  }, [messages, scrollToBottom]);

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

  /** 发送目标:追加 user + agent 消息,携带完整多轮对话上下文启动 Agent */
  const sendWithPrompt = useCallback(
    async (promptText: string) => {
      const goal = promptText.trim();
      if (!goal || running) return;
      const s = settingsRef.current;
      if (!s || !hasUsableProvider(s)) {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'agent', error: '尚未配置 AI 服务,请先在扩展设置中添加 API Key' },
        ]);
        return;
      }
      const tabId = await getActiveTabId();
      if (tabId == null) {
        setMessages((prev) => [...prev, { id: newId(), role: 'agent', error: '未找到当前标签页' }]);
        return;
      }
      const id = newId();

      // 构建多轮历史上下文:将此前已完成的 user 与 assistant/agent 消息转换并传入
      const history: ChatMessage[] = messagesRef.current
        .filter((m) => !m.streaming && !m.error && (m.text || m.role === 'user'))
        .map((m) => ({
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.text ?? '',
        }))
        .filter((m) => m.content.trim().length > 0);

      const payloadMessages: ChatMessage[] = [...history, { role: 'user', content: goal }];

      setMessages((prev) => [
        ...prev,
        { id: newId(), role: 'user', text: goal },
        { id, role: 'agent', streaming: true, thinking: '', steps: [] },
      ]);
      handleRef.current = startAgentSession(
        { messages: payloadMessages, providerId: s.activeProviderId, tabId },
        onEvent(id),
        () => patchMessage(id, (m) => ({ ...m, streaming: false })),
      );
      setInput('');
    },
    [running, onEvent, patchMessage],
  );

  // 监听网页划词透镜派发的快捷提问消息
  useEffect(() => {
    const handler = (msg: any) => {
      if (msg?.type === 'SIDEBAR:APPLY_PROMPT' && typeof msg.prompt === 'string') {
        void sendWithPrompt(msg.prompt);
      }
    };
    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  }, [sendWithPrompt]);

  const send = useCallback(async () => {
    await sendWithPrompt(input);
  }, [input, sendWithPrompt]);

  /** 用户勾选标签页一键发起对比 */
  const handleSelectTabs = useCallback(
    (chosen: TabItem[], mode: ComparisonMode = 'content') => {
      const summary = chosen
        .map((t, idx) => `${idx + 1}. 「${t.title}」(tabId: ${t.tabId}, url: ${t.url})`)
        .join('\n');

      let prompt = '';
      if (mode === 'dialectic') {
        prompt = `请对以下我选中的 ${chosen.length} 篇文章进行【多源辩证交叉验证与观点共识/分歧对抗透镜分析】：\n${summary}\n\n输出要求：\n1. 📊 多源立场全景表（各文章核心立场与侧重）\n2. 🟢 全网一致共识点（所有文章一致认同的已知事实与底层逻辑）\n3. 🔴 核心争议与对抗分歧点（文章间存在哪些不同的观点、判断或数据差异）\n4. ⚖️ 中立事实裁判与根因剖析（深度拆解为何产生这些分歧）\n5. 💡 最终研究洞察与决策建议`;
      } else if (mode === 'performance') {
        prompt = `请对以下我选中的 ${chosen.length} 个标签页进行【网页加载测速与全维度性能深度体检对比】：\n${summary}`;
      } else if (mode === 'data') {
        prompt = `请提取并对比以下我选中的 ${chosen.length} 个标签页的【核心数据表格/参数清单】：\n${summary}`;
      } else if (mode === 'all') {
        prompt = `请对以下我选中的 ${chosen.length} 个标签页进行【全方位综合深度对比】（包含页面内容功能定位与加载性能指标）：\n${summary}`;
      } else {
        prompt = `请分别读取并总结/对比以下我选中的 ${chosen.length} 个标签页的【核心内容与关键信息】：\n${summary}`;
      }

      void sendWithPrompt(prompt);
    },
    [sendWithPrompt],
  );

  const stop = useCallback(() => {
    handleRef.current?.stop();
    // 标记运行中的 agent 消息结束
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  }, []);

  /** 用户点击文章大纲或溯源引用标签,平滑滚动页面并柔光高亮 */
  const handleAnchorClick = useCallback(async (anchorId: string) => {
    try {
      const tabId = await getActiveTabId();
      if (!tabId) return;
      await browser.scripting.executeScript({
        target: { tabId },
        func: (aid) => {
          let targetEl = document.querySelector<HTMLElement>(`[data-agent-anchor="${aid}"], #${aid}`);
          if (!targetEl) return;
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
          if (!document.getElementById('ai-agent-pulse-style')) {
            const style = document.createElement('style');
            style.id = 'ai-agent-pulse-style';
            style.textContent = `
              @keyframes aiAgentPulseGlow {
                0% { outline: 3px solid #f59e0b; box-shadow: 0 0 16px rgba(245, 158, 11, 0.6); background-color: rgba(254, 240, 138, 0.45); }
                50% { outline: 4px solid #d97706; box-shadow: 0 0 24px rgba(245, 158, 11, 0.85); background-color: rgba(254, 240, 138, 0.65); }
                100% { outline: 2px solid transparent; box-shadow: none; background-color: transparent; }
              }
              .ai-agent-pulse-target {
                animation: aiAgentPulseGlow 2.5s ease-out forwards !important;
                border-radius: 4px !important;
              }
            `;
            document.head.appendChild(style);
          }
          targetEl.classList.remove('ai-agent-pulse-target');
          void targetEl.offsetWidth;
          targetEl.classList.add('ai-agent-pulse-target');
          setTimeout(() => {
            targetEl?.classList.remove('ai-agent-pulse-target');
          }, 2600);
        },
        args: [anchorId],
      });
    } catch (err) {
      console.warn('[handleAnchorClick] failed to highlight anchor:', err);
    }
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
            onClick={() => {
              if (!settings) return;
              const next = { ...settings, debugMode: !settings.debugMode };
              setSettings(next);
              void saveSettings(next);
              showToast(next.debugMode ? '已开启调试模式(展开所有步骤)' : '已关闭调试模式');
            }}
            title={settings?.debugMode ? '调试模式已开启(点击关闭)' : '开启调试模式(查看详细步骤与日志)'}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              settings?.debugMode
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-medium'
                : 'border-gray-200 text-gray-500 hover:bg-gray-100'
            }`}
          >
            {settings?.debugMode ? '🐛 调试开' : '🛠️ 调试'}
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
      <div
        ref={messagesContainerRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto py-1 scroll-smooth"
      >
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs">
            <div className="text-sm font-medium text-gray-700">👋 你好,我是 AI 浏览器助手</div>
            <div className="leading-relaxed text-gray-400">
              我能直接操作你当前打开的网页: 长文精读与段落溯源、数据提取导出、
              跨页研究对比、表单填写与测速体检。
            </div>
            <div className="mt-1 text-gray-300">
              直接告诉我你想做什么,比如
              <br />
              "提炼文章核心大纲与论据出处" / "把这个表格整理成 CSV" / "查这几个页面的报价对比"
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            isLastAssistant={m.id === lastAgentId}
            debugMode={Boolean(settings?.debugMode)}
            onCopy={copyMessage}
            onRegenerate={() => {}}
            onInsert={() => {}}
            onConfirmAgent={confirmAgent}
            onSelectTabs={handleSelectTabs}
            onAnchorClick={handleAnchorClick}
          />
        ))}
        <div ref={messagesEndRef} className="h-px pointer-events-none" />
      </div>

      {/* 输入框 + 运行/停止 */}
      <div className="flex items-center gap-1.5 border-t border-gray-100 pt-2">
        <input
          value={input}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          onKeyDown={(e) => {
            // 中文/日文等输入法选字回车时不触发发送
            if (
              e.key === 'Enter' &&
              !e.nativeEvent.isComposing &&
              !isComposingRef.current &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              void send();
            }
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
