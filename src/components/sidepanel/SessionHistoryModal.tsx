// 历史会话列表:切换 / 删除本地保存的对话(2026-08-14)。
import type { AgentSession } from '@/utils/agentSessions';

interface Props {
  sessions: AgentSession[];
  currentId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SessionHistoryModal({ sessions, currentId, onSelect, onDelete, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[70vh] w-full flex-col rounded-lg bg-white p-4 text-sm shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-medium text-gray-800">历史对话</div>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {sessions.length === 0 && (
            <div className="py-6 text-center text-xs text-gray-400">暂无历史对话</div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 ${
                s.id === currentId ? 'border-blue-300 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'
              }`}
            >
              <button
                onClick={() => onSelect(s.id)}
                className="min-w-0 flex-1 text-left"
                title={s.title}
              >
                <div className="truncate text-xs text-gray-800">
                  {s.id === currentId ? '📌 ' : ''}
                  {s.title}
                </div>
                <div className="text-[10px] text-gray-400">{formatTime(s.updatedAt)}</div>
              </button>
              <button
                onClick={() => onDelete(s.id)}
                disabled={sessions.length <= 1}
                title={sessions.length <= 1 ? '至少保留一个会话' : '删除'}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
