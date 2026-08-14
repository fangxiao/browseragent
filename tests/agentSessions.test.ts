// 会话管理纯逻辑单测(标题派生/新建/排序)。storage 封装(node 无 chrome)不测。
import { describe, expect, it } from 'vitest';
import { createSession, deriveTitle, sortSessions } from '../src/utils/agentSessions';
import type { UiMessage } from '../src/components/sidepanel/MessageItem';

const user = (text: string): UiMessage => ({ id: 'u1', role: 'user', text });

describe('agentSessions(会话管理纯逻辑)', () => {
  it('deriveTitle:取首条 user 消息前 20 字', () => {
    expect(deriveTitle([user('帮我提取这个表格的数据')])).toBe('帮我提取这个表格的数据');
    const long = 'x'.repeat(30);
    expect(deriveTitle([user(long)])).toBe('x'.repeat(20) + '…');
  });

  it('deriveTitle:无 user 消息 → 新对话', () => {
    expect(deriveTitle([])).toBe('新对话');
  });

  it('createSession:重置 streaming,保存过程字段', () => {
    const msg: UiMessage[] = [
      user('提取表格'),
      { id: 'a1', role: 'agent', scenario: 'dataExtract', streaming: true, thinking: '先读页', steps: [] },
    ];
    const s = createSession('s1', msg);
    expect(s.title).toBe('提取表格');
    expect(s.messages[1]!.streaming).toBe(false);
    expect(s.messages[1]!.thinking).toBe('先读页');
    expect(s.updatedAt).toBeGreaterThan(0);
  });

  it('sortSessions:按更新时间倒序', () => {
    const out = sortSessions({
      old: { id: 'old', title: 'a', updatedAt: 100, messages: [] },
      new: { id: 'new', title: 'b', updatedAt: 300, messages: [] },
      mid: { id: 'mid', title: 'c', updatedAt: 200, messages: [] },
    });
    expect(out.map((s) => s.id)).toEqual(['new', 'mid', 'old']);
  });
});
