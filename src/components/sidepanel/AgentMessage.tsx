import { useEffect, useState } from 'react';
import type { AgentEvent } from '@/utils/ai/agentTypes';
import { mdToHtml } from '@/utils/mdToHtml';
import { AgentStepCard } from './AgentStepCard';
import type { TabItem, ComparisonMode } from './TabSelector';
import { TabSelector } from './TabSelector';
import { TabManagerCard } from './TabManagerCard';
import { WorkflowManagerCard } from './WorkflowManagerCard';
import { PerformanceVisualCard } from './PerformanceVisualCard';
import type { PerformanceMetricData } from '@/utils/reportExport';

/** 渲染前清洗 AI 输出的 HTML:去 script/iframe/on* 属性,href 仅允许安全协议(防注入)并默认配置 target=_blank */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\shref="[^"]*"/gi, (m) => {
      const url = m.replace(/\shref="/, '').replace(/"$/, '');
      return /^(https?:|mailto:|#|\/)/i.test(url)
        ? ` href="${url}" target="_blank" rel="noopener noreferrer"`
        : ' href="#"';
    });
}

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

  // 判定是否处于多标签页对比/挑选场景 (严格排查: 整理/分组/关闭等系统管理场景绝不展示对比勾选框)
  const isTabComparisonScenario = Boolean(
    !streaming &&
      text &&
      !text.includes('未检测到微信') &&
      !text.includes('未找到微信') &&
      !text.includes('分组') &&
      !text.includes('整理') &&
      !text.includes('清理') &&
      !text.includes('去重') &&
      !text.includes('关闭') &&
      !steps.some((e) => e.type === 'tool-result' && (e.call.name === 'groupTabs' || e.call.name === 'closeTabs')) &&
      steps.some(
        (e) =>
          e.type === 'tool-result' &&
          e.call.name === 'listTabs' &&
          e.result.ok &&
          Array.isArray((e.result.data as any)?.tabs) &&
          (e.result.data as any).tabs.length > 1,
      ) &&
      (text.includes('对比') || text.includes('比对') || text.includes('横向比较') || text.includes('请勾选要对比')),
  );

  // 判定是否处于标签页整理/去重管理看板场景
  const isTabManagerScenario = Boolean(
    !streaming &&
      tabList &&
      tabList.length > 0 &&
      !isTabComparisonScenario &&
      !text?.includes('未检测到微信') &&
      !text?.includes('未找到微信') &&
      steps.some(
        (e) =>
          e.type === 'tool-result' &&
          e.call.name === 'listTabs' &&
          e.result.ok &&
          Array.isArray((e.result.data as any)?.tabs),
      ),
  );

  // 判定是否处于流程自动化 / 工作流管理看板场景 (严格匹配工具调用或明确的工作流意图，严禁在整理Tab时误触发)
  const isWorkflowScenario = Boolean(
    !streaming &&
      !isTabManagerScenario &&
      (steps.some(
        (e) =>
          e.type === 'tool-result' &&
          [
            'startWorkflowRecording',
            'stopWorkflowRecording',
            'listWorkflowRecipes',
            'saveWorkflowRecipe',
            'runWorkflowRecipe',
          ].includes(e.call.name),
      ) ||
        text?.includes('自动化工作流') ||
        text?.includes('工作流配方') ||
        text?.includes('已开启流程录制') ||
        text?.includes('已结束流程录制')),
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

  const handleCopy = async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  /** 点击 Markdown 渲染区域中的链接直接在浏览器新标签页中打开 */
  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest('a');
    if (anchor && anchor.href && /^https?:/i.test(anchor.href)) {
      e.preventDefault();
      try {
        if (typeof browser !== 'undefined' && browser.tabs?.create) {
          void browser.tabs.create({ url: anchor.href });
        } else if (typeof (globalThis as any).chrome?.tabs?.create === 'function') {
          void (globalThis as any).chrome.tabs.create({ url: anchor.href });
        } else {
          window.open(anchor.href, '_blank', 'noopener,noreferrer');
        }
      } catch {
        window.open(anchor.href, '_blank', 'noopener,noreferrer');
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
          className="md-body"
          onClick={handleBodyClick}
          dangerouslySetInnerHTML={{
            __html: sanitizeHtml(mdToHtml(text.replace(/<br\s*\/?>/gi, '\n'))),
          }}
        />
      )}

      {/* 交互式标签页复选框选择器(仅在明确对比意图下展示) */}
      {isTabComparisonScenario && tabList && onSelectTabs && (
        <TabSelector tabs={tabList} onConfirm={onSelectTabs} />
      )}

      {/* 交互式标签页整理与去重看板 */}
      {isTabManagerScenario && tabList && (
        <TabManagerCard initialTabs={tabList} />
      )}

      {/* 流程自动化与工作流管理看板 */}
      {isWorkflowScenario && <WorkflowManagerCard />}

      {/* 原生性能可视化瀑布图与一键导出 PDF 报告卡片 */}
      {perfMetrics.length > 0 && (
        <PerformanceVisualCard metrics={perfMetrics} textSummary={text} />
      )}

      {streaming && !text && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-blue-400" />}
      {error && <div className="mt-1 rounded bg-red-50 px-2 py-1 text-red-600">{error}</div>}

      {/* 操作:复制 */}
      {!streaming && text && (
        <div className="mt-1.5 flex items-center gap-2 border-t border-blue-100 pt-1 text-[11px]">
          <button
            onClick={() => void handleCopy()}
            className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}
    </div>
  );
}
