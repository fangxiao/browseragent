// 内容脚本:注入任意页面。职责:
//  1. 文档提取(EXTRACT:REQUEST 响应):通用富文本编辑器检测 + 提取
//  2. 写回(WRITEBACK:APPEND / WRITEBACK:CURSOR,富文本插入,ADR-0004 更新)
//  3. v2:通用 DOM 工具执行(TOOL:CALL,见 utils/domTools)——E1 起
//  通用编辑器为自研结构,写回策略为 contenteditable + execCommand;真机验证时以 console 日志为准。
import { isEditableEditor, extractDocId } from '@/utils/pageExtract/editor/detect';
import { extractDocContent } from '@/utils/pageExtract/editor/extract';
import { createDomExecutor } from '@/utils/domTools/executor';
import { initSelectionPill } from '@/utils/domTools/selectionPill';
import { startRecording, stopRecording, getRecordingStatus, checkAndResumeRecording } from '@/utils/workflow/recorder';
import type { ExtractRequest, ExtractResponse, WritebackRequest, WritebackResponse, ToolRequest, ToolResponse } from '@/utils/messaging';

declare global {
  interface Window {
    __AI_AGENT_DEBUG__?: {
      extracted: unknown;
      extractedAt: number;
    };
  }
}

/** 定位页面可编辑区域(优先 contenteditable) */
function findEditor(): HTMLElement | null {
  const ce = document.querySelector<HTMLElement>('[contenteditable="true"]');
  if (ce) return ce;
  return document.querySelector<HTMLElement>(
    '[role="textbox"], [class*="editor" i], [class*="render" i]',
  );
}

function placeCursorAtEnd(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false); // 折叠到末尾
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  el.focus();
}

function insertHtml(html: string, mode: 'append' | 'cursor'): { ok: boolean; message: string } {
  const el = findEditor();
  if (!el) return { ok: false, message: '未找到可编辑区域' };
  if (mode === 'append' || !window.getSelection()?.rangeCount) placeCursorAtEnd(el);
  else el.focus();
  try {
    const ok = document.execCommand('insertHTML', false, html);
    return ok
      ? { ok: true, message: '已插入' }
      : { ok: false, message: '编辑器不支持 insertHTML(结构可能特殊)' };
  } catch (err) {
    return { ok: false, message: `插入失败:${(err as Error).message}` };
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  main() {
    console.log('[ai-agent] content script injected; url:', location.href);

    // 初始化网页划词即问与局部透镜悬浮条
    try {
      initSelectionPill();
    } catch {
      /* 忽略异常 */
    }

    // 自动感知并续接跨页面流程录制状态 (针对百度等搜索跳转/页面刷新场景)
    try {
      void checkAndResumeRecording();
    } catch {
      /* 忽略异常 */
    }

    // v2 通用 DOM 工具执行器(evaluate 默认禁用;后续由 options 控制)
    const executor = createDomExecutor({ allowEvaluate: false });

    browser.runtime.onMessage.addListener(
      (msg: ExtractRequest | WritebackRequest | ToolRequest, _sender, sendResponse) => {
        if (msg?.type === 'TOOL:CALL') {
          executor
            .execute(msg.call.name, msg.call.args)
            .then((result): ToolResponse => ({ type: 'TOOL:RESULT', callId: msg.call.id, result }))
            .catch((err): ToolResponse => ({
              type: 'TOOL:RESULT',
              callId: msg.call.id,
              result: { ok: false, error: err instanceof Error ? err.message : String(err) },
            }))
            .then(sendResponse);
          return true; // 异步响应
        }
        if (msg?.type === 'EXTRACT:REQUEST') {
          if (!isEditableEditor(document)) {
            sendResponse({
              type: 'EXTRACT:ERROR',
              message: '当前页面没有可提取的文档内容(未检测到富文本编辑器)。请打开一篇在线文档后重试。',
            } satisfies ExtractResponse);
            return true;
          }
          extractDocContent(document, location.href)
            .then(
              (doc): ExtractResponse => ({ type: 'EXTRACT:RESULT', doc }),
              (err): ExtractResponse => ({ type: 'EXTRACT:ERROR', message: String(err) }),
            )
            .catch((err): ExtractResponse => ({ type: 'EXTRACT:ERROR', message: String(err) }))
            .then(sendResponse);
          return true; // 异步响应
        }

        if (msg?.type === 'WRITEBACK:APPEND' || msg?.type === 'WRITEBACK:CURSOR') {
          const mode = msg.type === 'WRITEBACK:APPEND' ? 'append' : 'cursor';
          const res = insertHtml(String(msg.html ?? ''), mode);
          console.log('[ai-agent] writeback', msg.type, res);
          sendResponse({ type: 'WRITEBACK:RESULT', ...res } satisfies WritebackResponse);
          return true;
        }

        // 流程自动化录制消息监听 (异步响应)
        if ((msg as any)?.type === 'WORKFLOW:START_RECORDING') {
          startRecording()
            .catch((err) => ({ ok: false, message: String(err) }))
            .then(sendResponse);
          return true;
        }
        if ((msg as any)?.type === 'WORKFLOW:STOP_RECORDING') {
          stopRecording()
            .catch((err) => ({ ok: false, steps: [], actionCount: 0, message: String(err) }))
            .then(sendResponse);
          return true;
        }
        if ((msg as any)?.type === 'WORKFLOW:GET_STATUS') {
          getRecordingStatus()
            .catch((err) => ({ isRecording: false, count: 0, error: String(err) }))
            .then(sendResponse);
          return true;
        }

        return undefined;
      },
    );

    if (!isEditableEditor(document)) return;

    const runExtract = async () => {
      try {
        const content = await extractDocContent(document, location.href);
        console.log('[ai-agent] extract result', {
          title: content.title,
          docId: content.docId,
          blockCount: content.blockCount,
          textLength: content.textLength,
          extractionRate: content.extractionRate,
          warnings: content.warnings,
        });
        window.__AI_AGENT_DEBUG__ = { extracted: content, extractedAt: Date.now() };
      } catch (err) {
        console.warn('[ai-agent] extract failed', err);
      }
    };

    // 等待编辑器渲染完成后再提取(SPA 内容延迟挂载)
    const waitReady = (retries = 10): void => {
      const text = document.body?.innerText?.trim() ?? '';
      if (text.length > 50 || retries <= 0) {
        void runExtract();
        return;
      }
      setTimeout(() => waitReady(retries - 1), 500);
    };
    waitReady();
  },
});
