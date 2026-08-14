// 会话管理:对话历史本地持久化(chrome.storage.local)+ 新建/切换/删除。
// 纯逻辑(deriveTitle/createSession/sort)可单测;storage 为薄封装(node 无 chrome,不测)。
import type { UiMessage } from '@/components/sidepanel/MessageItem';

export interface AgentSession {
  id: string;
  /** 会话标题:首条 user 消息前 20 字 */
  title: string;
  updatedAt: number;
  messages: UiMessage[];
}

export interface SessionStore {
  currentId: string | null;
  sessions: Record<string, AgentSession>;
}

const KEY = 'agentSessions:v1';

/** 从消息派生会话标题 */
export function deriveTitle(messages: UiMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.text);
  const t = (firstUser?.text ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return '新对话';
  return t.length > 20 ? t.slice(0, 20) + '…' : t;
}

/** 新建会话(恢复时把运行中的 streaming 标记复位,保证展示为已完成) */
export function createSession(id: string, messages: UiMessage[] = []): AgentSession {
  const normalized = messages.map((m) => ({ ...m, streaming: false }));
  return { id, title: deriveTitle(normalized), updatedAt: Date.now(), messages: normalized };
}

/** 会话列表(按更新时间倒序) */
export function sortSessions(sessions: Record<string, AgentSession>): AgentSession[] {
  return Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadStore(): Promise<SessionStore> {
  const raw = await browser.storage.local.get(KEY);
  const store = raw[KEY] as SessionStore | undefined;
  return store ?? { currentId: null, sessions: {} };
}

export async function saveStore(store: SessionStore): Promise<void> {
  await browser.storage.local.set({ [KEY]: store });
}
