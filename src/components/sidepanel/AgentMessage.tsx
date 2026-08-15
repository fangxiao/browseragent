import { useEffect, useState } from 'react';
import type { AgentEvent } from '@/utils/ai/agentTypes';
import { mdToHtml } from '@/utils/mdToHtml';
import { AgentStepCard } from './AgentStepCard';

/** 渲染前清洗 AI 输出的 HTML:去 script/iframe/on* 属性,href 仅允许安全协议(防注入) */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\shref="[^"]*"/gi, (m) => {
      const url = m.replace(/\shref="/, '').replace(/"$/, '');
      return /^(https?:|mailto:|#|\/)/i.test(url) ? m : ' href="#"';
    });
}

import type { TabItem, ComparisonMode } from './TabSelector';
import { TabSelector } from './TabSelector';
import { PerformanceVisualCard } from './PerformanceVisualCard';
import type { PerformanceMetricData } from '@/utils/reportExport';
import { ArticleOutlineCard, type OutlineData } from './ArticleOutlineCard';

interface Props {
  thinking: string;
  steps: AgentEvent[];
  text?: string;
  streaming?: boolean;
  error?: string;
  debugMode?: boolean;
  onConfirm: (confirmId: string, approved: boolean) => void;
  onCopy: () => void;
  onSelectTabs?: (tabs: TabItem[], mode: ComparisonMode) => void;
  onAnchorClick?: (anchorId: string) => void;
}

/** steps 中最后一条待处理的确认请求(其后无 confirm-result) */
function pendingConfirm(steps: AgentEvent[]): Extract<AgentEvent, { type: 'confirm-request' }> | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const e = steps[i]!;
    if (e.type === 'confirm-request') return e;
    if (e.type === 'confirm-result') return null;
  }
  return null;
}

export function AgentMessage({
  thinking,
  steps,
  text,
  streaming,
  error,
  debugMode = false,
  onConfirm,
  onCopy,
  onSelectTabs,
  onAnchorClick,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [showSteps, setShowSteps] = useState(debugMode);

  // 调试模式切换时自动同步状态
  useEffect(() => {
    if (debugMode) setShowSteps(true);
  }, [debugMode]);

  // 仅运行中展示确认按钮;结束后(agent-done/error/port 断开)自动消失,避免对已断开 port 发消息
  const confirm = streaming ? pendingConfirm(steps) : null;

  // 提取最新的 listTabs 结果中的 tabs 列表(供直接勾选交互)
  const listTabsResult = steps
    .filter((e): e is Extract<AgentEvent, { type: 'tool-result' }> => e.type === 'tool-result' && e.call.name === 'listTabs' && e.result.ok)
    .pop();
  const tabList = (listTabsResult?.result.data as { tabs?: TabItem[] } | undefined)?.tabs;

  // 仅在明确是写公众号草稿动作时排除 TabSelector(避免寻找微信后台标签时误弹)
  const isDraftWritingAction = Boolean(
    text?.includes('未检测到微信公众平台草稿页') ||
      steps.some(
        (e) =>
          (e.type === 'tool-use' || e.type === 'tool-result') &&
          e.call.name === 'writeWechatDraft',
      ),
  );

  const isTabComparisonScenario = Boolean(
    !isDraftWritingAction &&
      tabList &&
      tabList.length > 0 &&
      onSelectTabs &&
      (Boolean(
        text &&
          (text.includes('对比') ||
            text.includes('总结') ||
            text.includes('选择') ||
            text.includes('挑选') ||
            text.includes('候选') ||
            text.includes('哪两个') ||
            text.includes('哪些') ||
            text.includes('哪个') ||
            text.includes('请确认') ||
            text.includes('请问您是指') ||
            text.includes('指定') ||
            text.includes('标签页') ||
            text.includes('打开了') ||
            text.includes('tabId')),
      ) ||
        (thinking &&
          (thinking.includes('对比') ||
            thinking.includes('总结') ||
            thinking.includes('多标签') ||
            thinking.includes('跨标签') ||
            thinking.includes('挑选标签') ||
            thinking.includes('查看当前打开') ||
            thinking.includes('扫描标签页')))),
  );

  // 提取所有的 getPagePerformance 结果(供渲染可视化时序瀑布流与导出 PDF)
  const perfMetrics: PerformanceMetricData[] = steps
    .filter(
      (e): e is Extract<AgentEvent, { type: 'tool-result' }> =>
        e.type === 'tool-result' &&
        e.call.name === 'getPagePerformance' &&
        e.result.ok &&
        Boolean(e.result.data),
    )
    .map((e) => e.result.data as PerformanceMetricData);

  // 提取最新的 getArticleOutline 结果(供渲染交互式大纲与段落导航)
  const outlineResult = steps
    .filter(
      (e): e is Extract<AgentEvent, { type: 'tool-result' }> =>
        e.type === 'tool-result' &&
        e.call.name === 'getArticleOutline' &&
        e.result.ok &&
        Boolean(e.result.data),
    )
    .pop();
  const outlineData = outlineResult?.result.data as OutlineData | undefined;

  const handleCopy = async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.cite-anchor-badge, [data-anchor]');
    if (target) {
      const anchor = target.getAttribute('data-anchor');
      if (anchor && onAnchorClick) {
        e.preventDefault();
        e.stopPropagation();
        onAnchorClick(anchor);
      }
    }
  };

  return (
    <div className="max-w-[92%] rounded-lg rounded-tl-sm border border-blue-100 bg-blue-50/40 px-3 py-2 text-xs leading-relaxed text-gray-800">
      {/* 头部:智能体标识 */}
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-blue-700">
        <span>🤖</span>
        <span>AI 浏览器助手</span>
        {streaming && <span className="text-blue-400">运行中…</span>}
      </div>

      {/* 思考(运行中流式可见;完成后在调试模式下可见,避免与最终回复重复) */}
      {thinking && (streaming || debugMode) && (
        <div className="mb-1 rounded bg-blue-50/50 px-2 py-1 text-[11px] whitespace-pre-wrap text-gray-500 italic border border-blue-100/50">
          <span className="font-medium not-italic text-blue-600">💭 思考: </span>
          {thinking}
        </div>
      )}

      {/* 过程步骤卡片(默认折叠,保持对话清爽) */}
      {steps.length > 0 && (
        <div className="mb-1">
          <button
            onClick={() => setShowSteps((v) => !v)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-blue-600/80 hover:bg-blue-100/50 transition-colors"
          >
            <span className="text-[9px]">{showSteps ? '▼' : '▶'}</span>
            <span>
              {streaming
                ? `正在执行操作 (${steps.length} 步)...`
                : `已完成 ${steps.length} 个操作步骤`}
            </span>
            <span className="text-[10px] text-gray-400">({showSteps ? '收起' : '展开详情'})</span>
          </button>

          {showSteps && (
            <div className="mt-1 space-y-0.5 rounded-md border border-blue-100/60 bg-white/60 px-1 py-0.5">
              {steps.map((e, i) => (
                <AgentStepCard key={`${i}_${e.type}`} event={e} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 内嵌安全确认(对话式,替代全屏弹层) */}
      {confirm && (
        <div className="mb-1 flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800">
          <span className="flex-1">
            ⚠️ 允许 AI 执行:
            <span className="font-medium">{confirm.summary}</span>
          </span>
          <button
            onClick={() => onConfirm(confirm.confirmId, false)}
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100"
          >
            拒绝
          </button>
          <button
            onClick={() => onConfirm(confirm.confirmId, true)}
            className="rounded bg-amber-600 px-2 py-0.5 text-[11px] text-white hover:bg-amber-700"
          >
            允许
          </button>
        </div>
      )}

      {/* 最终结果(Markdown 渲染;<br> 等 AI 常见换行标签先转成换行) */}
      {text && (
        <div
          onClick={handleBodyClick}
          className="md-body"
          dangerouslySetInnerHTML={{
            __html: sanitizeHtml(mdToHtml(text.replace(/<br\s*\/?>/gi, '\n'))),
          }}
        />
      )}

      {/* 沉浸式阅读:文章大纲与段落导航卡片 */}
      {outlineData && onAnchorClick && (
        <ArticleOutlineCard data={outlineData} onNavigate={onAnchorClick} />
      )}

      {/* 交互式标签页复选框选择器(仅在明确对比意图下展示) */}
      {isTabComparisonScenario && tabList && onSelectTabs && (
        <TabSelector tabs={tabList} onConfirm={onSelectTabs} />
      )}

      {/* 原生性能可视化瀑布图与一键导出 PDF 报告卡片 */}
      {perfMetrics.length > 0 && (
        <PerformanceVisualCard metrics={perfMetrics} textSummary={text} />
      )}

      {streaming && !text && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-blue-400" />}
      {error && <div className="mt-1 rounded bg-red-50 px-2 py-1 text-red-600">{error}</div>}

      {/* 操作:复制 */}
      {!streaming && text && (
        <div className="mt-1.5 flex items-center gap-2 border-t border-blue-100 pt-1.5">
          <button onClick={() => void handleCopy()} className="text-[11px] text-blue-600 hover:underline">
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}
    </div>
  );
}
