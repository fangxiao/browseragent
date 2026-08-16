import { useState } from 'react';
import { generateReadingNoteMarkdown, downloadMarkdownFile } from '@/utils/readingNotesExport';

export interface OutlineItem {
  anchorId: string;
  level: number;
  tag: string;
  title: string;
  snippet: string;
}

export interface OutlineData {
  title: string;
  url?: string;
  totalSections: number;
  totalWords: number;
  outline: OutlineItem[];
  textSummary?: string;
}

interface Props {
  data: OutlineData;
  onNavigate: (anchorId: string, title?: string) => void;
}

export function ArticleOutlineCard({ data, onNavigate }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<'outline' | 'mindmap'>('outline');
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const [copiedNote, setCopiedNote] = useState(false);

  const handleJump = (anchorId: string, title?: string) => {
    setActiveAnchor(anchorId);
    onNavigate(anchorId, title);
  };

  const handleDownloadNote = () => {
    const md = generateReadingNoteMarkdown(data);
    const cleanTitle = (data.title || '网页研报笔记').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
    downloadMarkdownFile(`研报_${cleanTitle}.md`, md);
  };

  const handleCopyNote = async () => {
    const md = generateReadingNoteMarkdown(data);
    await navigator.clipboard.writeText(md);
    setCopiedNote(true);
    setTimeout(() => setCopiedNote(false), 2000);
  };

  const headings = data.outline.filter((o) => o.level > 0);

  if (headings.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-amber-200/80 bg-amber-50/40 p-2.5 text-xs text-gray-800 shadow-xs transition-all">
      {/* 头部标题与视图切换 */}
      <div className="flex items-center justify-between font-medium text-amber-900 mb-1.5 pb-1 border-b border-amber-200/60">
        <div className="flex items-center gap-1.5 font-semibold">
          <span>📖</span>
          <span>文章大纲与精准导读 ({headings.length} 章节 · 约 {data.totalWords.toLocaleString()} 字)</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          {/* 模式切换 */}
          <div className="inline-flex rounded border border-amber-300/80 bg-white/80 p-0.5 shadow-2xs">
            <button
              onClick={() => setViewMode('outline')}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                viewMode === 'outline' ? 'bg-amber-500 text-white font-medium' : 'text-amber-800 hover:bg-amber-100'
              }`}
            >
              📑 目录
            </button>
            <button
              onClick={() => setViewMode('mindmap')}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                viewMode === 'mindmap' ? 'bg-amber-500 text-white font-medium' : 'text-amber-800 hover:bg-amber-100'
              }`}
            >
              🧠 脑图
            </button>
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-[11px] text-amber-700 hover:text-amber-900 hover:underline ml-0.5"
          >
            {collapsed ? '展开 ▼' : '收起 ▲'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* 模式 1: 经典层级目录树 */}
          {viewMode === 'outline' && (
            <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
              {headings.map((h, i) => {
                const indentClass =
                  h.level === 1 ? 'font-bold text-gray-900 pl-0' :
                  h.level === 2 ? 'font-medium text-gray-800 pl-3' :
                  h.level === 3 ? 'text-gray-700 pl-6' : 'text-gray-600 pl-8';

                const isActive = activeAnchor === h.anchorId;

                return (
                  <button
                    key={`${h.anchorId}_${i}`}
                    onClick={() => handleJump(h.anchorId, h.title)}
                    title={`点击在网页中定位：${h.title}\n${h.snippet}`}
                    className={`w-full text-left flex items-start gap-1.5 py-1 px-1.5 rounded transition-colors text-[11px] ${indentClass} ${
                      isActive ? 'bg-amber-200/80 text-amber-950 font-semibold' : 'hover:bg-amber-100/60'
                    }`}
                  >
                    <span className="text-amber-600 shrink-0 select-none text-[10px]">
                      {h.level === 1 ? '📌' : h.level === 2 ? '🔹' : '▪'}
                    </span>
                    <span className="truncate flex-1">{h.title}</span>
                    <span className="text-[10px] text-amber-600/70 shrink-0 font-normal">📍定位</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 模式 2: 视觉化思维导图脉络图 (Mindmap) */}
          {viewMode === 'mindmap' && (
            <div className="max-h-64 overflow-x-auto overflow-y-auto p-1.5 bg-white/70 rounded border border-amber-200/60 space-y-2">
              {/* 核心主题根节点 */}
              <div className="inline-block rounded-md bg-gradient-to-r from-amber-500 to-orange-500 px-2.5 py-1 text-white font-semibold text-[11px] shadow-xs">
                🎯 {data.title.slice(0, 28) || '文章核心主旨'}
              </div>

              {/* 脑图分支连线结构 */}
              <div className="pl-3 border-l-2 border-dashed border-amber-300 space-y-1.5 my-1">
                {headings.map((h, idx) => {
                  const isH1 = h.level === 1;
                  const isH2 = h.level === 2;
                  const isActive = activeAnchor === h.anchorId;

                  return (
                    <div
                      key={`mm_${h.anchorId}_${idx}`}
                      className={`relative flex items-center gap-1.5 transition-all ${
                        isH1 ? 'pl-0 font-semibold' : isH2 ? 'pl-3 font-medium' : 'pl-6 font-normal'
                      }`}
                    >
                      {/* 横向分支指示线 */}
                      <span className="text-amber-400 select-none text-[10px]">─</span>

                      <button
                        onClick={() => handleJump(h.anchorId, h.title)}
                        title={`点击在网页中定位：${h.title}\n${h.snippet}`}
                        className={`inline-flex items-center gap-1 py-0.5 px-2 rounded-md border text-[10.5px] transition-all cursor-pointer ${
                          isActive
                            ? 'bg-amber-300 border-amber-500 text-amber-950 font-bold shadow-xs scale-[1.02]'
                            : isH1
                            ? 'bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200'
                            : isH2
                            ? 'bg-orange-50 border-orange-200 text-orange-900 hover:bg-orange-100'
                            : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <span>{isH1 ? '📌' : isH2 ? '🔹' : '▪'}</span>
                        <span className="max-w-[200px] truncate">{h.title}</span>
                        <span className="text-[9px] text-amber-600/70 font-normal">📍</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 底部功能条: 一键导出 Obsidian / Notion 研报笔记 */}
          <div className="mt-2 pt-1.5 border-t border-amber-200/60 flex items-center justify-between text-[11px] text-amber-800">
            <span className="text-amber-700/80 text-[10px]">💡 支持点击脑图/目录节点高亮原文</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyNote}
                className="text-amber-700 hover:text-amber-900 hover:underline flex items-center gap-0.5"
              >
                <span>📋</span>
                <span>{copiedNote ? '已复制 Markdown' : '复制研报'}</span>
              </button>
              <span className="text-amber-300">|</span>
              <button
                onClick={handleDownloadNote}
                className="text-amber-700 hover:text-amber-900 font-medium hover:underline flex items-center gap-0.5"
              >
                <span>📥</span>
                <span>导出笔记 (.md)</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
