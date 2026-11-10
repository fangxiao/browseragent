// 视觉多模态 Grounding (Set-of-Marks / SoM)
// 为页面可交互元素生成数字编号视觉标记，支持截图多模态大模型直接指挥精准点击与坐标交互

export interface MarkInfo {
  id: number;
  tag: string;
  role?: string;
  text: string;
  selector: string;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  center: {
    x: number;
    y: number;
  };
}

const SOM_CONTAINER_ID = '__browseragent_som_overlay__';

// 彩色标签调色板(高对比度且不遮挡文字)
const MARK_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899',
];

let cachedMarks: MarkInfo[] = [];

/** 扫描页面可视可交互元素并打上 Set-of-Marks 数字编号遮罩 */
export function injectSetOfMarksOverlay(options?: { maxMarks?: number }): MarkInfo[] {
  if (typeof document === 'undefined' || !document.body) return [];

  // 清理已有标记
  removeSetOfMarksOverlay();

  const maxMarks = options?.maxMarks ?? 50;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1920;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1080;

  // 待检测的交互候选元素
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'a, button, input, textarea, select, canvas, svg, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="menuitem"], [onclick], [tabindex]:not([tabindex="-1"])',
    ),
  );

  const container = document.createElement('div');
  container.id = SOM_CONTAINER_ID;
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = '0';
  container.style.width = '100vw';
  container.style.height = '100vh';
  container.style.pointerEvents = 'none';
  container.style.zIndex = '2147483646'; // 极高层级

  const marks: MarkInfo[] = [];
  let markIndex = 1;

  for (const el of candidates) {
    if (markIndex > maxMarks) break;
    if (!el || typeof el.getBoundingClientRect !== 'function') continue;

    // 检查元素是否在 DOM 中且具有可见尺寸
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    // 检查是否在当前可视视口内
    if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) {
      continue;
    }

    const win = typeof window !== 'undefined' ? window : (globalThis as any).window;
    const style = win?.getComputedStyle ? win.getComputedStyle(el) : ((el as any).style || {});
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
      continue;
    }

    const color = MARK_COLORS[(markIndex - 1) % MARK_COLORS.length]!;
    const markId = markIndex++;

    // 1. 元素外框线
    const box = document.createElement('div');
    box.style.position = 'fixed';
    box.style.left = `${Math.max(0, rect.left)}px`;
    box.style.top = `${Math.max(0, rect.top)}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.style.border = `2px solid ${color}`;
    box.style.borderRadius = '3px';
    box.style.boxShadow = `0 0 4px ${color}66`;
    box.style.pointerEvents = 'none';

    // 2. 左上角数字徽章
    const badge = document.createElement('div');
    badge.style.position = 'absolute';
    badge.style.top = '-14px';
    badge.style.left = '0px';
    badge.style.backgroundColor = color;
    badge.style.color = '#ffffff';
    badge.style.fontSize = '10px';
    badge.style.fontWeight = 'bold';
    badge.style.lineHeight = '1';
    badge.style.padding = '2px 4px';
    badge.style.borderRadius = '3px';
    badge.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)';
    badge.style.fontFamily = 'monospace, sans-serif';
    badge.textContent = `${markId}`;

    box.appendChild(badge);
    container.appendChild(box);

    const text = (el.innerText || el.textContent || (el as HTMLInputElement).placeholder || (el as HTMLInputElement).value || '').trim();
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || undefined;

    // 构造简化选择器
    let selector = tag;
    if (el.id) selector = `#${el.id}`;
    else if (el.getAttribute('data-testid')) selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
    else if (el.className && typeof el.className === 'string') {
      const cls = el.className.split(/\s+/).filter((c) => c && !c.includes(':'))[0];
      if (cls) selector = `${tag}.${cls}`;
    }

    marks.push({
      id: markId,
      tag,
      role,
      text: text.slice(0, 60),
      selector,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      center: {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      },
    });
  }

  document.body.appendChild(container);
  cachedMarks = marks;
  return marks;
}

/** 清除 Set-of-Marks 编号遮罩 */
export function removeSetOfMarksOverlay(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(SOM_CONTAINER_ID);
  if (el) {
    try {
      el.remove();
    } catch {
      /* ignore */
    }
  }
}

/** 获取当前缓存的 Marks 列表 */
export function getCachedMarks(): MarkInfo[] {
  return cachedMarks;
}

/** 在指定屏幕坐标 (x, y) 触发高保真点击事件 (支持 Canvas / 图表 / 无常规选择器元素) */
export function clickAtCoordinate(x: number, y: number): { ok: boolean; targetTag?: string; targetText?: string; error?: string } {
  if (typeof document === 'undefined') {
    return { ok: false, error: '非浏览器 DOM 环境' };
  }

  try {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) {
      return { ok: false, error: `坐标 (${x}, ${y}) 处未找到可交互元素` };
    }

    // 派发全套鼠标/指针事件流以触发复杂前端框架监听
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
    };

    el.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
    el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    el.focus?.();
    el.dispatchEvent(new PointerEvent('pointerup', eventOptions));
    el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    el.dispatchEvent(new MouseEvent('click', eventOptions));

    const text = (el.innerText || el.textContent || '').trim().slice(0, 40);
    return {
      ok: true,
      targetTag: el.tagName.toLowerCase(),
      targetText: text,
    };
  } catch (err) {
    return { ok: false, error: `坐标点击失败: ${(err as Error).message}` };
  }
}
