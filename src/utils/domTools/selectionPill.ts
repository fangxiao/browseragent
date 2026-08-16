// 网页划词即问与局部透镜悬浮工具条 (Floating Selection Quick-Action Pill)
// 采用 Shadow DOM 100% 隔离宿主网页样式，确保在任何网页中均可稳定渲染并响应交互。

const PILL_CONTAINER_ID = 'ai-agent-floating-selection-pill-container';

/** 初始化网页划词监听器 */
export function initSelectionPill(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  // 避免在同一个页面重复注册多次
  if (document.getElementById(PILL_CONTAINER_ID)) {
    return;
  }

  let hostEl: HTMLElement | null = null;
  let shadowRoot: ShadowRoot | null = null;
  let activeSelectedText = '';
  let checkDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const removePill = () => {
    if (hostEl && hostEl.parentNode) {
      hostEl.parentNode.removeChild(hostEl);
    }
    hostEl = null;
    shadowRoot = null;
    activeSelectedText = '';
  };

  const handleAction = async (actionType: 'explain' | 'data' | 'translate' | 'ask', btnEl?: HTMLElement) => {
    if (!activeSelectedText) return;
    const textSnippet = activeSelectedText.slice(0, 3000);

    if (btnEl) {
      btnEl.textContent = '⏳ 已发送...';
    }

    let prompt = '';
    switch (actionType) {
      case 'explain':
        prompt = `请结合当前网页，对以下我选中的段落进行【深度解读与核心逻辑剖析】：\n「${textSnippet}」`;
        break;
      case 'data':
        prompt = `请提取以下我选中的内容中的【核心数据/指标/参数清单】，并整理成结构化 Markdown 表格：\n「${textSnippet}」`;
        break;
      case 'translate':
        prompt = `请将以下我选中的外文/复杂段落进行【专业通俗化意译与白话总结】：\n「${textSnippet}」`;
        break;
      case 'ask':
      default:
        prompt = `我对网页中以下这段内容有疑问，请为我做深度拆解与回答：\n「${textSnippet}」`;
        break;
    }

    try {
      await browser.runtime.sendMessage({
        type: 'SIDEBAR:QUICK_ASK',
        prompt,
        selectedText: textSnippet,
      });
    } catch {
      /* 忽略发送异常 */
    }

    setTimeout(removePill, 120);
  };

  const createPill = (rect: DOMRect, text: string) => {
    removePill();
    activeSelectedText = text;

    const host = document.createElement('div');
    host.id = PILL_CONTAINER_ID;
    const shadow = host.attachShadow({ mode: 'open' });

    // 计算最佳呈现坐标(自适应顶部/底部边界)
    const pillWidth = 320;
    const pillHeight = 36;
    let top = rect.top - pillHeight - 8;
    if (top < 10) {
      // 距离视窗顶部太近时,呈现在选区下方
      top = rect.bottom + 8;
    }
    let left = rect.left + rect.width / 2 - pillWidth / 2;
    if (left < 10) left = 10;
    if (left + pillWidth > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - pillWidth - 10);
    }

    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          left: ${left}px;
          top: ${top}px;
          z-index: 2147483647;
          pointer-events: auto;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        }
        .pill-wrapper {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 4px 6px;
          background: rgba(17, 24, 39, 0.95);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 9999px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.45), 0 4px 10px -2px rgba(0, 0, 0, 0.25);
          box-sizing: border-box;
          animation: pillSlideIn 0.16s cubic-bezier(0.16, 1, 0.3, 1);
          user-select: none;
        }
        @keyframes pillSlideIn {
          from { opacity: 0; transform: translateY(5px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .pill-brand {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 0 4px 0 2px;
          font-size: 11px;
          font-weight: 700;
          color: #60a5fa;
        }
        .pill-btn {
          all: unset;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: 3px 8px;
          border-radius: 9999px;
          background: transparent;
          color: #f3f4f6;
          cursor: pointer;
          font-size: 11px;
          font-weight: 500;
          line-height: 1.2;
          white-space: nowrap;
          box-sizing: border-box;
          transition: background 0.12s, color 0.12s, transform 0.1s;
        }
        .pill-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          color: #ffffff;
        }
        .pill-btn:active {
          transform: scale(0.95);
        }
        .pill-btn-explain {
          background: rgba(59, 130, 246, 0.25);
          color: #93c5fd;
        }
        .pill-btn-explain:hover {
          background: rgba(59, 130, 246, 0.45);
          color: #ffffff;
        }
        .pill-divider {
          width: 1px;
          height: 12px;
          background: rgba(255, 255, 255, 0.18);
          margin: 0 1px;
        }
      </style>
      <div class="pill-wrapper" id="pill-wrap">
        <span class="pill-brand">✨</span>
        <button class="pill-btn pill-btn-explain" id="btn-explain" title="深度解读此段逻辑">💡 解读</button>
        <button class="pill-btn" id="btn-data" title="将此段数据整理成表格">📊 提数据</button>
        <button class="pill-btn" id="btn-translate" title="通俗意译与白话总结">🌐 意译</button>
        <div class="pill-divider"></div>
        <button class="pill-btn" id="btn-ask" title="针对此段在侧边栏提问">🔍 提问</button>
      </div>
    `;

    // 绑定点击事件
    const btnExplain = shadow.getElementById('btn-explain');
    const btnData = shadow.getElementById('btn-data');
    const btnTranslate = shadow.getElementById('btn-translate');
    const btnAsk = shadow.getElementById('btn-ask');

    btnExplain?.addEventListener('click', (e) => {
      e.stopPropagation();
      void handleAction('explain', btnExplain);
    });
    btnData?.addEventListener('click', (e) => {
      e.stopPropagation();
      void handleAction('data', btnData);
    });
    btnTranslate?.addEventListener('click', (e) => {
      e.stopPropagation();
      void handleAction('translate', btnTranslate);
    });
    btnAsk?.addEventListener('click', (e) => {
      e.stopPropagation();
      void handleAction('ask', btnAsk);
    });

    document.documentElement.appendChild(host);
    hostEl = host;
    shadowRoot = shadow;
  };

  const checkSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      removePill();
      return;
    }

    const text = sel.toString().trim();
    if (text.length < 2 || text.length > 5000) {
      removePill();
      return;
    }

    // 排除可编辑输入框/文本域内划词
    const anchorNode = sel.anchorNode;
    const parentEl = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
    if (parentEl?.closest('input, textarea, [contenteditable="true"]')) {
      return;
    }

    if (sel.rangeCount > 0) {
      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          createPill(rect, text);
        }
      } catch {
        /* 忽略异常 */
      }
    }
  };

  const onSelectionChangeOrMouseUp = (e?: Event) => {
    // 若事件发生在 pill 内部(通过 composedPath 检查 shadow dom),不予处理
    if (e && e.composedPath().some((el) => (el as HTMLElement)?.id === PILL_CONTAINER_ID)) {
      return;
    }

    if (checkDebounceTimer) clearTimeout(checkDebounceTimer);
    checkDebounceTimer = setTimeout(checkSelection, 50);
  };

  // 监听 mouseup, touchend, pointerup 与 selectionchange
  document.addEventListener('mouseup', onSelectionChangeOrMouseUp, { passive: true });
  document.addEventListener('touchend', onSelectionChangeOrMouseUp, { passive: true });
  document.addEventListener('keyup', (e) => {
    if (['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      onSelectionChangeOrMouseUp();
    }
  });

  // 点击网页其他空白处时自动隐藏
  document.addEventListener(
    'mousedown',
    (e) => {
      if (!e.composedPath().some((el) => (el as HTMLElement)?.id === PILL_CONTAINER_ID)) {
        removePill();
      }
    },
    { passive: true },
  );
}
