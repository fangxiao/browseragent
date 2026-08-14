import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/main.css';
import type { DocContent } from '@/utils/pageExtract/types';
import type { DocTypeId } from '@/utils/ai/docType';
import { guessDocType, DOC_TYPE_LABELS } from '@/utils/ai/docType';
import type { CapabilityId, ChatMessage, StreamEvent } from '@/utils/ai/provider/types';
import type { CapabilityMeta } from '@/utils/ai/capabilities';
import type { AiSettings } from '@/utils/ai/provider/types';
import {
  getActiveTabId,
  getSettings,
  hasUsableProvider,
  requestExtract,
  saveSettings,
  startAiStream,
  writebackToDoc,
  type AiStreamHandle,
} from '@/utils/sidepanelClient';
import { mdToHtml } from '@/utils/mdToHtml';
import { ContentPanel } from '@/components/sidepanel/ContentPanel';
import { CapabilityChips } from '@/components/sidepanel/CapabilityChips';
import { MessageItem, type UiMessage } from '@/components/sidepanel/MessageItem';
import { PrivacyConfirm } from '@/components/sidepanel/PrivacyConfirm';
import { AgentView } from '@/components/sidepanel/AgentView';

type Mode = 'chat' | 'agent';

/** 能力 → 首轮指令文案(首轮 user 消息 = 指令 + 文档) */
const CAP_CMD: Record<CapabilityId, string> = {
  review: '请对下面这篇「需求文档」进行 AI 评审',
  complete: '请补全下面这篇「周报/月报」',
  actionItems: '请提炼下面这篇「会议纪要」的结论与待办',
  riskReview: '请对下面这篇「技术方案」进行风险评审',
  structure: '请补全下面这篇「复盘总结」的结构',
  polish: '请润色下面这篇文档',
  translate: '请翻译下面这篇文档',
  summary: '请为下面这篇文档生成摘要',
  outline: '请为下面这篇文档生成大纲',
};

const newId = (): string => (globalThis.crypto?.randomUUID?.() ?? `m_${Date.now()}`);

interface PendingRun {
  send: ChatMessage[];
  cap: CapabilityId;
}

function App() {
  const [mode, setMode] = useState<Mode>('chat');
  const [doc, setDoc] = useState<DocContent | null>(null);
  const [docType, setDocType] = useState<DocTypeId>('other');
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [extractError, setExtractError] = useState('');

  const [uiMessages, setUiMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null);
  const [providerLabel, setProviderLabel] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((t: string) => {
    setToast(t);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2500);
  }, []);

  const handleRef = useRef<AiStreamHandle | null>(null);
  const lastCapRef = useRef<CapabilityId>('summary');
  const settingsRef = useRef<AiSettings | null>(null);
  const uiRef = useRef<UiMessage[]>([]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    uiRef.current = uiMessages;
  }, [uiMessages]);

  /** 提取当前文档(可重试) */
  const loadDoc = useCallback(async () => {
    setExtractError('');
    try {
      const tabId = await getActiveTabId();
      if (tabId == null) {
        setExtractError('未找到当前标签页');
        return;
      }
      const content = await requestExtract(tabId);
      setDoc(content);
      const guess = guessDocType(content.title, content.markdown);
      setDocType(guess.type);
    } catch (err) {
      setExtractError((err as Error).message);
    }
  }, []);

  // 初始化:加载设置 + 提取当前文档
  useEffect(() => {
    void (async () => {
      const s = await getSettings();
      setSettings(s);
      await loadDoc();
    })();
  }, [loadDoc]);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setLoading(false);
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<UiMessage>) => {
    setUiMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  /** 组装首轮 user(指令 + 文档),处理大文档截断 */
  const buildFirstUser = useCallback(
    (cap: CapabilityId): string => {
      const s = settingsRef.current!;
      let markdown = doc!.markdown;
      if (doc!.textLength > s.maxDocChars) {
        const first = doc!.blocks.slice(0, 80).map((b) => b.text).join('\n');
        markdown = `【文档过大,仅提取前 80 块】\n\n${first}`;
      }
      return `${CAP_CMD[cap]}。\n\n文档标题:${doc!.title}\n\n文档内容(Markdown):\n${markdown}`;
    },
    [doc],
  );

  /** 真正的发送:组装历史 + 新 user 消息,推送流式 assistant 占位 */
  const stream = useCallback(
    (send: ChatMessage[], cap: CapabilityId) => {
      const s = settingsRef.current;
      if (!s) return;
      if (!hasUsableProvider(s)) {
        setUiMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: 'assistant',
            text: '',
            error: '尚未配置 AI 服务,请先在扩展设置中添加 API Key',
          },
        ]);
        return;
      }
      lastCapRef.current = cap;
      setLoading(true);
      const id = newId();
      setUiMessages((prev) => [...prev, { id, role: 'assistant', text: '', streaming: true, capability: cap }]);
      handleRef.current = startAiStream(
        { capability: cap, messages: send, providerId: s.activeProviderId },
        (event: StreamEvent) => {
          if (event.type === 'text-delta') {
            setUiMessages((prev) =>
              prev.map((m) => (m.id === id ? { ...m, text: m.text + event.text } : m)),
            );
          } else if (event.type === 'error') {
            patchMessage(id, { streaming: false, error: event.message });
            setLoading(false);
          } else if (event.type === 'done') {
            patchMessage(id, { streaming: false });
            setLoading(false);
          }
        },
        () => {
          patchMessage(id, { streaming: false });
          setLoading(false);
        },
      );
    },
    [patchMessage],
  );

  /** 校验隐私确认;通过则执行 */
  const guardAndRun = useCallback(
    (build: () => { send: ChatMessage[]; cap: CapabilityId }) => {
      const s = settingsRef.current;
      if (!s) return;
      const { send, cap } = build();
      const cfg = s.providers.find((p) => p.id === s.activeProviderId);
      if (s.confirmOnSend && !s.trustedSession) {
        setProviderLabel(cfg?.label ?? 'AI 服务');
        setPendingRun({ send, cap });
        return;
      }
      stream(send, cap);
    },
    [stream],
  );

  /** 点击快捷能力:首轮 user = 指令 + 文档 */
  const runCapability = useCallback(
    (cap: CapabilityMeta) => {
      if (!doc) return;
      const send: ChatMessage[] = [
        ...uiRef.current.map((m) => ({ role: m.role, content: m.text })),
        { role: 'user', content: buildFirstUser(cap.id) },
      ];
      setUiMessages((prev) => [
        ...prev,
        { id: newId(), role: 'user', text: buildFirstUser(cap.id) },
      ]);
      guardAndRun(() => ({ send, cap: cap.id }));
    },
    [doc, buildFirstUser, guardAndRun],
  );

  /** 输入框追问:纯文本 user 消息,沿用最近能力保持 system 一致 */
  const askQuestion = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || loading) return;
      const send: ChatMessage[] = [
        ...uiRef.current.map((m) => ({ role: m.role, content: m.text })),
        { role: 'user', content: t },
      ];
      setUiMessages((prev) => [...prev, { id: newId(), role: 'user', text: t }]);
      guardAndRun(() => ({ send, cap: lastCapRef.current }));
      setInput('');
    },
    [loading, guardAndRun],
  );

  /** 重新生成:移除该条 assistant 及之后,用之前历史重发 */
  const regenerate = useCallback(
    (id: string) => {
      const idx = uiRef.current.findIndex((m) => m.id === id);
      if (idx < 0) return;
      const before = uiRef.current.slice(0, idx);
      const cap = uiRef.current[idx]!.capability ?? 'summary';
      setUiMessages(before);
      const send: ChatMessage[] = before.map((m) => ({ role: m.role, content: m.text }));
      guardAndRun(() => ({ send, cap }));
    },
    [guardAndRun],
  );

  const copyMessage = useCallback(async (id: string) => {
    const m = uiRef.current.find((x) => x.id === id);
    if (m) {
      await navigator.clipboard.writeText(m.text);
      showToast('已复制');
    }
  }, [showToast]);

  /** 写回:Markdown → HTML → 追加到末尾 / 插入光标处 */
  const insertIntoDoc = useCallback(
    async (id: string, mode: 'append' | 'cursor') => {
      const m = uiRef.current.find((x) => x.id === id);
      if (!m) return;
      try {
        const tabId = await getActiveTabId();
        if (tabId == null) {
          showToast('未找到当前标签页');
          return;
        }
        const msg = await writebackToDoc(tabId, mdToHtml(m.text), mode);
        showToast(msg);
      } catch (err) {
        showToast((err as Error).message);
      }
    },
    [showToast],
  );

  const confirmSend = useCallback(
    async (remember: boolean) => {
      const s = settingsRef.current;
      if (s && remember) {
        const next = { ...s, trustedSession: true };
        setSettings(next);
        settingsRef.current = next;
        await saveSettings(next).catch(() => {});
      }
      if (pendingRun) stream(pendingRun.send, pendingRun.cap);
      setPendingRun(null);
    },
    [pendingRun, stream],
  );

  const lastAssistantId =
    [...uiMessages].reverse().find((m) => m.role === 'assistant' && !m.streaming)?.id ?? '';

  return (
    <div className="flex h-screen flex-col gap-2 p-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5">
          {(['chat', 'agent'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                mode === m ? 'bg-white font-medium text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {m === 'chat' ? '对话' : '智能体'}
            </button>
          ))}
        </div>
        <button
          onClick={() => browser.runtime.openOptionsPage()}
          className="text-xs text-blue-600 hover:underline"
        >
          设置
        </button>
      </header>

      {mode === 'agent' ? (
        <AgentView />
      ) : doc ? (
        <>
          <ContentPanel doc={doc} docType={docType} onChangeDocType={setDocType} />
          {doc.textLength < 50 && (
            <div className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
              <div>
                ⚠ 文档内容为空,AI 无法处理。诊断:长度 {doc.textLength} 字符 / {doc.blockCount} 块
              </div>
              {doc.markdown.trim() ? (
                <div className="mt-1 max-h-16 overflow-y-auto text-[10px] text-amber-600">
                  提取预览:{doc.markdown.slice(0, 200)}
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-xs text-gray-400">
          {extractError ? (
            <div>
              <div className="mb-1 text-red-500">无法读取当前文档</div>
              <div>{extractError}</div>
              <button
                onClick={() => void loadDoc()}
                className="mt-2 rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100"
              >
                重试读取
              </button>
            </div>
          ) : (
            '正在读取文档...'
          )}
        </div>
      )}

      {/* 消息流 */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-1">
        {uiMessages.length === 0 && doc && (
          <div className="pt-8 text-center text-xs text-gray-400">
            👋 选择下方能力,或直接输入问题开始
            <div className="mt-1 text-gray-300">当前类型:{DOC_TYPE_LABELS[docType]}</div>
          </div>
        )}
        {uiMessages.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            isLastAssistant={m.id === lastAssistantId}
            onCopy={copyMessage}
            onRegenerate={regenerate}
            onInsert={(id, mode) => void insertIntoDoc(id, mode)}
          />
        ))}
      </div>

      {/* 底部:能力 chips + 输入框 */}
      {doc && (
        <div className="space-y-1.5 border-t border-gray-100 pt-2">
          <CapabilityChips docType={docType} disabled={loading} onRun={runCapability} />
          <div className="flex items-center gap-1.5">
            <input
              value={input}
              disabled={loading}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') askQuestion(input);
              }}
              placeholder={loading ? 'AI 生成中...' : '输入问题,可基于上文继续追问'}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 disabled:opacity-50"
            />
            <button
              disabled={loading || !input.trim()}
              onClick={() => askQuestion(input)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '生成中' : '发送'}
            </button>
            {loading && (
              <button onClick={stop} className="text-xs text-gray-400 hover:text-gray-600">
                停止
              </button>
            )}
          </div>
        </div>
      )}

      {pendingRun && (
        <PrivacyConfirm
          providerLabel={providerLabel}
          onConfirm={(remember) => void confirmSend(remember)}
          onCancel={() => setPendingRun(null)}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex justify-center">
          <div className="rounded-full bg-gray-800/90 px-3 py-1.5 text-xs text-white">{toast}</div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
