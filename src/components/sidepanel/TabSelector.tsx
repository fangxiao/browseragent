// 交互式标签页复选框选择器:供用户在多标签页场景下勾选目标并一键发起对比。
import { useState } from 'react';

export interface TabItem {
  tabId: number;
  title: string;
  url: string;
  active?: boolean;
}

export type ComparisonMode = 'content' | 'performance' | 'data' | 'dialectic' | 'all';

interface Props {
  tabs: TabItem[];
  onConfirm: (selected: TabItem[], mode: ComparisonMode) => void;
}

export function TabSelector({ tabs, onConfirm }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submittedMode, setSubmittedMode] = useState<ComparisonMode>('content');

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = tabs.filter(
    (t) =>
      t.title.toLowerCase().includes(filter.toLowerCase()) ||
      t.url.toLowerCase().includes(filter.toLowerCase()),
  );

  const handleConfirm = (mode: ComparisonMode) => {
    const chosen = tabs.filter((t) => selectedIds.has(t.tabId));
    if (chosen.length === 0) return;
    setSubmitted(true);
    setSubmittedMode(mode);
    onConfirm(chosen, mode);
  };

  const getModeLabel = (m: ComparisonMode) => {
    switch (m) {
      case 'dialectic':
        return '⚔️ 观点共识与分歧透镜';
      case 'performance':
        return '⚡ 测速与性能体检';
      case 'data':
        return '📊 数据与参数对比';
      case 'all':
        return '🔍 综合全维度对比';
      case 'content':
      default:
        return '📝 内容总结与对比';
    }
  };

  if (submitted) {
    return (
      <div className="mt-1.5 rounded-md border border-blue-200 bg-blue-50/70 px-2.5 py-1.5 text-[11px] text-blue-800 flex items-center justify-between">
        <span>✅ 已发起 {selectedIds.size} 个标签页的【{getModeLabel(submittedMode)}】</span>
        <button
          onClick={() => setSubmitted(false)}
          className="text-blue-600 hover:underline text-[10px]"
        >
          重新选择
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-white p-2.5 shadow-xs text-xs text-gray-800">
      <div className="flex items-center justify-between font-medium text-gray-700 mb-1.5">
        <span className="flex items-center gap-1">
          <span>📑</span>
          <span>选择要处理/总结的标签页 ({selectedIds.size}/{tabs.length})</span>
        </span>
        <div className="flex items-center gap-1.5 text-[11px]">
          <button
            onClick={() => setSelectedIds(new Set(tabs.map((t) => t.tabId)))}
            className="text-blue-600 hover:underline"
          >
            全选
          </button>
          <span className="text-gray-300">|</span>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-gray-500 hover:underline"
          >
            清空
          </button>
        </div>
      </div>

      {tabs.length > 5 && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索标签页标题或域名..."
          className="mb-1.5 w-full rounded border border-gray-200 px-2 py-1 text-[11px] outline-none focus:border-blue-400"
        />
      )}

      <div className="max-h-44 overflow-y-auto space-y-0.5 pr-0.5">
        {filtered.map((t, idx) => {
          const isChecked = selectedIds.has(t.tabId);
          let hostname = '';
          try {
            hostname = new URL(t.url).hostname.replace(/^www\./, '');
          } catch {
            hostname = '';
          }
          return (
            <label
              key={t.tabId}
              className={`flex items-start gap-1.5 rounded px-1.5 py-1 text-[11px] cursor-pointer transition-colors ${
                isChecked
                  ? 'bg-blue-50/90 text-blue-900 font-medium border border-blue-100'
                  : 'hover:bg-gray-50 text-gray-700'
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(t.tabId)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-0"
              />
              <span className="text-gray-400 font-mono text-[10px] w-4 shrink-0">#{idx + 1}</span>
              <span className="flex-1 truncate" title={t.title}>
                {t.title}
              </span>
              {hostname && (
                <span className="text-[10px] text-gray-400 shrink-0">{hostname}</span>
              )}
            </label>
          );
        })}
      </div>

      {/* 对比维度选择与操作栏 */}
      <div className="mt-2.5 border-t border-gray-100 pt-2">
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1.5 font-medium">
          <span>👇 选择对比维度发起分析:</span>
          <span className="text-[10px] text-gray-400">已勾选 {selectedIds.size} 项</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            disabled={selectedIds.size === 0}
            onClick={() => handleConfirm('content')}
            className="flex items-center justify-center gap-1 rounded border border-blue-200 bg-blue-50/80 px-2 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            <span>📝</span>
            <span>内容总结与对比</span>
          </button>
          <button
            disabled={selectedIds.size === 0}
            onClick={() => handleConfirm('dialectic')}
            className="flex items-center justify-center gap-1 rounded border border-rose-200 bg-rose-50/80 px-2 py-1.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            <span>⚔️</span>
            <span>共识与分歧透镜</span>
          </button>
          <button
            disabled={selectedIds.size === 0}
            onClick={() => handleConfirm('performance')}
            className="flex items-center justify-center gap-1 rounded border border-emerald-200 bg-emerald-50/80 px-2 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            <span>⚡</span>
            <span>测速与性能体检</span>
          </button>
          <button
            disabled={selectedIds.size === 0}
            onClick={() => handleConfirm('data')}
            className="flex items-center justify-center gap-1 rounded border border-purple-200 bg-purple-50/80 px-2 py-1.5 text-[11px] font-medium text-purple-700 hover:bg-purple-100 active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            <span>📊</span>
            <span>提取数据对比</span>
          </button>
        </div>
      </div>
    </div>
  );
}
