import { useState } from 'react';

export interface PrdReviewItem {
  type: 'critical' | 'warning' | 'suggestion';
  title: string;
  desc: string;
  module?: string;
}

export interface PrdReviewData {
  score: number;
  docTitle?: string;
  summary: string;
  items: PrdReviewItem[];
  actionItems: string[];
}

interface Props {
  data: PrdReviewData;
}

export function FeishuPrdReviewCard({ data }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  const criticals = data.items.filter((i) => i.type === 'critical');
  const warnings = data.items.filter((i) => i.type === 'warning');
  const suggestions = data.items.filter((i) => i.type === 'suggestion');

  const getScoreBadge = (score: number) => {
    if (score >= 85) return { color: 'text-emerald-700 bg-emerald-100 border-emerald-300', label: '🟢 结构完善' };
    if (score >= 70) return { color: 'text-amber-700 bg-amber-100 border-amber-300', label: '🟡 待补齐边界' };
    return { color: 'text-rose-700 bg-rose-100 border-rose-300', label: '🔴 存在逻辑死锁' };
  };

  const scoreBadge = getScoreBadge(data.score);

  const generateReportMarkdown = () => {
    return [
      `# 🛡️ PRD / 方案智能评审雷达`,
      `> 📊 **综合质量评分**: ${data.score}/100 (${scoreBadge.label})`,
      `> 📌 **评审总结**: ${data.summary}`,
      '',
      '## 🚨 核心漏洞与边界遗漏',
      ...data.items.map((i) => `- [${i.type === 'critical' ? '🔴 严重' : i.type === 'warning' ? '🟡 警告' : '🟢 建议'}] **${i.title}**: ${i.desc}`),
      '',
      '## ☑️ 改进待办清单 (Action Items)',
      ...data.actionItems.map((a) => `- [ ] ${a}`),
    ].join('\n');
  };

  const handleCopy = async () => {
    const text = generateReportMarkdown();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const text = generateReportMarkdown();
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PRD评审报告_${(data.docTitle || '文档').replace(/[\\/:*?"<>|]/g, '_').slice(0, 25)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-2 rounded-lg border border-indigo-200/90 bg-indigo-50/40 p-2.5 text-xs text-gray-800 shadow-xs transition-all">
      {/* 头部标题与评分 */}
      <div className="flex items-center justify-between font-medium text-indigo-950 mb-1.5 pb-1 border-b border-indigo-200/60">
        <div className="flex items-center gap-1.5 font-semibold">
          <span>🛡️</span>
          <span>PRD / 方案智能评审雷达</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${scoreBadge.color}`}>
            {data.score}分 · {scoreBadge.label}
          </span>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-[11px] text-indigo-700 hover:text-indigo-900 hover:underline"
        >
          {collapsed ? '展开评审 ▼' : '收起 ▲'}
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-2">
          {/* 一句话总结 */}
          <div className="text-[11.5px] text-indigo-900/90 bg-white/80 p-1.5 rounded border border-indigo-100">
            {data.summary}
          </div>

          {/* 漏洞统计胶囊 */}
          <div className="grid grid-cols-3 gap-1.5 text-center text-[10.5px]">
            <div className="rounded bg-rose-50 border border-rose-200 p-1 text-rose-800">
              <div className="font-bold text-rose-600 text-[13px]">{criticals.length}</div>
              <span>🔴 严重逻辑死锁</span>
            </div>
            <div className="rounded bg-amber-50 border border-amber-200 p-1 text-amber-800">
              <div className="font-bold text-amber-600 text-[13px]">{warnings.length}</div>
              <span>🟡 边界条件遗漏</span>
            </div>
            <div className="rounded bg-emerald-50 border border-emerald-200 p-1 text-emerald-800">
              <div className="font-bold text-emerald-600 text-[13px]">{suggestions.length}</div>
              <span>🟢 测试验收建议</span>
            </div>
          </div>

          {/* 详细列表 */}
          <div className="max-h-48 overflow-y-auto space-y-1 pr-0.5">
            {data.items.map((item, idx) => (
              <div
                key={idx}
                className={`p-1.5 rounded text-[11px] border leading-relaxed ${
                  item.type === 'critical'
                    ? 'bg-rose-50/60 border-rose-200 text-rose-950'
                    : item.type === 'warning'
                    ? 'bg-amber-50/60 border-amber-200 text-amber-950'
                    : 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                }`}
              >
                <div className="font-semibold flex items-center gap-1">
                  <span>{item.type === 'critical' ? '🔴' : item.type === 'warning' ? '🟡' : '🟢'}</span>
                  <span>{item.title}</span>
                  {item.module && <span className="text-[9.5px] font-normal opacity-70">({item.module})</span>}
                </div>
                <div className="text-[10.5px] mt-0.5 opacity-90 pl-3.5">{item.desc}</div>
              </div>
            ))}
          </div>

          {/* 底部操作区 (安全非破坏性：仅提供复制与导出) */}
          <div className="pt-1.5 border-t border-indigo-200/60 flex items-center justify-between text-[11px]">
            <span className="text-indigo-700/80 text-[10px]">
              共 {data.actionItems.length} 项改进待办
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="text-indigo-700 hover:text-indigo-900 hover:underline flex items-center gap-0.5"
              >
                <span>📋</span>
                <span>{copied ? '已复制' : '复制待办'}</span>
              </button>
              <span className="text-indigo-300">|</span>
              <button
                onClick={handleDownload}
                className="text-indigo-700 hover:text-indigo-900 font-medium hover:underline flex items-center gap-0.5"
              >
                <span>📥</span>
                <span>导出报告 (.md)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
