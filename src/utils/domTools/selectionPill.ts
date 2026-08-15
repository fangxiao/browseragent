// 网页划词即问与局部透镜悬浮工具条 (Floating Selection Quick-Action Pill)

const PILL_ID = 'ai-agent-floating-selection-pill';

/** 初始化网页划词监听器 */
export function initSelectionPill(): void {
  if (typeof document === 'undefined') return;

  let pillEl: HTMLElement | null = null;
  let activeSelectedText = '';

  const removePill = () => {
    if (pillEl && pillEl.parentNode) {
      pillEl.parentNode.removeChild(pillEl);
      pillEl = null;
    }
    activeSelectedText = '';
  };

  const handleAction = async (actionType: 'explain' | 'data' | 'translate' | 'ask') => {
    if (!activeSelectedText) return;
    const textSnippet = activeSelectedText.slice(0, 3000);

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

    removePill();
  };

  const createPill = (x: number, y: number, text: string) => {
    removePill();
    activeSelectedText = text;

    const container = document.createElement('div');
    container.id = PILL_ID;
    container.style.cssText = `
      position: fixed;
      left: ${Math.max(10, Math.min(window.innerWidth - 280, x))}px;
      top: ${Math.max(10, y - 42)}px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 6px;
      background: rgba(17, 24, 39, 0.92);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 9999px;
      box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.35), 0 2px 6px -1px rgba(0, 0, 0, 0.2);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      color: #f9fafb;
      user-select: none;
      animation: aiAgentPillFadeIn 0.15s ease-out;
      transition: all 0.15s ease;
    `;

    // 动态注入轻量动画样式
    if (!document.getElementById('ai-agent-pill-style')) {
      const style = document.createElement('style');
      style.id = 'ai-agent-pill-style';
      style.textContent = `
        @keyframes aiAgentPillFadeIn {
          from { opacity: 0; transform: translateY(4px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .ai-pill-btn {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 2px 7px;
          border-radius: 9999px;
          background: transparent;
          color: #f3f4f6;
          border: none;
          cursor: pointer;
          font-size: 11px;
          font-weight: 500;
          transition: background 0.12s, color 0.12s;
          white-space: nowrap;
        }
        .ai-pill-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          color: #ffffff;
        }
        .ai-pill-btn:active {
          transform: scale(0.96);
        }
      `;
      document.head.appendChild(style);
    }

    const actions = [
      { label: '💡 解读', type: 'explain' as const, title: '深度解读此段落逻辑' },
      { label: '📊 提数据', type: 'data' as const, title: '将此段数据整理成表格' },
      { label: '🌐 意译', type: 'translate' as const, title: '通俗意译与白话总结' },
      { label: '🔍 提问', type: 'ask' as const, title: '针对此段在侧边栏提问' },
    ];

    for (const act of actions) {
      const btn = document.createElement('button');
      btn.className = 'ai-pill-btn';
      btn.textContent = act.label;
      btn.title = act.title;
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        void handleAction(act.type);
      };
      container.appendChild(btn);
    }

    document.body.appendChild(container);
    pillEl = container;
  };

  const handleSelectionChange = () => {
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

    // 若选区在 input/textarea/可编辑区内部,不弹悬浮条
    const anchorNode = sel.anchorNode;
    const parentEl = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
    if (parentEl?.closest('input, textarea, [contenteditable="true"], #' + PILL_ID)) {
      return;
    }

    if (sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        createPill(rect.left + rect.width / 2 - 120, rect.top, text);
      }
    }
  };

  document.addEventListener('mouseup', (e) => {
    // 若点击在 pill 内部不处理
    if ((e.target as HTMLElement)?.closest?.('#' + PILL_ID)) return;
    setTimeout(handleSelectionChange, 50);
  });

  document.addEventListener('mousedown', (e) => {
    if (!(e.target as HTMLElement)?.closest?.('#' + PILL_ID)) {
      removePill();
    }
  });
}
