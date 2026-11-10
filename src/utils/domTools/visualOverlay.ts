// 网页 DOM 动作视觉高亮与气泡遮罩层 (Visual Action Overlay)
// 在 AI 执行点击、输入、悬停等操作时提供清晰、美观的视觉反馈

export interface HighlightOptions {
  label?: string;
  actionType?: 'click' | 'type' | 'hover' | 'scroll' | 'select' | 'extract';
  color?: string;
  durationMs?: number;
}

const OVERLAY_CONTAINER_ID = '__browseragent_action_overlay__';

/** 动作类型对应的主题色与图标 */
const ACTION_THEMES: Record<string, { color: string; icon: string; label: string }> = {
  click: { color: '#3b82f6', icon: '🎯', label: '点击' },
  type: { color: '#10b981', icon: '✍️', label: '输入' },
  hover: { color: '#8b5cf6', icon: '👆', label: '悬停' },
  scroll: { color: '#f59e0b', icon: '📜', label: '滚动' },
  select: { color: '#06b6d4', icon: '☑️', label: '选择' },
  extract: { color: '#ec4899', icon: '📊', label: '提取' },
};

const DEFAULT_THEME = { color: '#3b82f6', icon: '🎯', label: '点击' };

/** 绘制元素操作高亮框与提示气泡 */
export function highlightActionElement(el: HTMLElement, options: HighlightOptions = {}): void {
  if (typeof document === 'undefined' || !el || typeof el.getBoundingClientRect !== 'function') {
    return;
  }

  try {
    const actionType = options.actionType || 'click';
    const theme = (actionType in ACTION_THEMES ? ACTION_THEMES[actionType] : undefined) ?? DEFAULT_THEME;
    const color = options.color || theme.color;
    const durationMs = options.durationMs ?? 1800;
    const customLabel = options.label || theme.label;

    // 确保元素滚动进入视野(平滑居中)
    try {
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    } catch {
      /* 忽略滚动异常 */
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    // 获取或创建全局 Overlay 容器
    let container = document.getElementById(OVERLAY_CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = OVERLAY_CONTAINER_ID;
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100vw';
      container.style.height = '100vh';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '2147483647'; // 最高层级
      document.body?.appendChild(container);
    }

    // 创建当前高亮卡片
    const box = document.createElement('div');
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    box.style.position = 'fixed';
    box.style.left = `${rect.left - 4}px`;
    box.style.top = `${rect.top - 4}px`;
    box.style.width = `${rect.width + 8}px`;
    box.style.height = `${rect.height + 8}px`;
    box.style.border = `2.5px solid ${color}`;
    box.style.borderRadius = '6px';
    box.style.boxShadow = `0 0 16px ${color}88, inset 0 0 10px ${color}33`;
    box.style.backgroundColor = `${color}15`;
    box.style.pointerEvents = 'none';
    box.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
    box.style.opacity = '1';
    box.style.transform = 'scale(1)';

    // 创建标签气泡
    const badge = document.createElement('div');
    badge.style.position = 'absolute';
    badge.style.top = rect.top < 36 ? `${rect.height + 12}px` : '-32px';
    badge.style.left = '0';
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '4px';
    badge.style.padding = '3px 8px';
    badge.style.backgroundColor = color;
    badge.style.color = '#ffffff';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = '600';
    badge.style.borderRadius = '4px';
    badge.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.25)';
    badge.style.whiteSpace = 'nowrap';
    badge.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    badge.innerHTML = `<span>${theme.icon}</span> <span>${customLabel}</span>`;

    box.appendChild(badge);
    container.appendChild(box);

    // 动画淡出与清理
    setTimeout(() => {
      box.style.opacity = '0';
      box.style.transform = 'scale(0.96)';
      setTimeout(() => {
        try {
          box.remove();
          if (container && container.childNodes && container.childNodes.length === 0) {
            container.remove();
          }
        } catch {
          /* ignore */
        }
      }, 250);
    }, durationMs);
  } catch {
    /* 忽略视觉修饰异常 */
  }
}

/** 兼容旧版闪烁高亮 API */
export function flashHighlight(el: HTMLElement, color = '#3b82f6'): void {
  highlightActionElement(el, { color, durationMs: 1800 });
}
