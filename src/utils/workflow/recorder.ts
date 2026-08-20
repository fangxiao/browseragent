// 流程自动化录制器:在网页端捕获用户的真实拟人操作,支持跨页面/表单提交/跳转持久化录制
import type { CapturedAction, WorkflowStep } from './types';
import {
  getActiveRecordingSession,
  startActiveRecordingSession,
  appendActionToSession,
  stopActiveRecordingSession,
} from './storage';

let isRecording = false;
let floatingBadge: HTMLElement | null = null;
let inputDebounceTimer: number | null = null;
let lastInputTarget: { el: HTMLElement; value: string; action: CapturedAction } | null = null;

/** 智能向上寻找真正承载业务意图的可交互容器 (如 SVG 图标容器、带点击事件的 div、AntD 图标 span) */
function resolveInteractiveTarget(rawTarget: HTMLElement): HTMLElement {
  // 1. 标准语义交互元素
  const standard = rawTarget.closest<HTMLElement>(
    'button, a, [role="button"], input, select, textarea, [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="option"], [role="treeitem"], [role="link"], label, li',
  );
  if (standard) return standard;

  // 2. 如果点击的是 SVG / Path / 图标字体 / 图片或内联小图标
  const isSvgOrIcon =
    rawTarget instanceof SVGElement ||
    rawTarget.tagName === 'SVG' ||
    rawTarget.tagName === 'PATH' ||
    rawTarget.tagName === 'I' ||
    rawTarget.tagName === 'IMG' ||
    rawTarget.tagName === 'USE' ||
    (typeof rawTarget.className === 'string' && /anticon|icon|svg|avatar|btn|trigger/i.test(rawTarget.className));

  if (isSvgOrIcon) {
    // 向上寻找具有 title / aria-label / data-* 属性或具有交互类名的父级容器
    const container = rawTarget.closest<HTMLElement>(
      '[onclick], [title], [aria-label], [data-title], [data-tooltip], [data-tip], [data-name], [data-id], [class*="btn"], [class*="icon"], [class*="trigger"], [class*="item"], [class*="header"], [class*="tab"], [class*="card"], [class*="entry"], span, div',
    );
    if (container && container !== document.body && container !== document.documentElement) {
      return container;
    }
  }

  // 3. 检查是否有带 onclick 或可点击标记的父级
  const clickableParent = rawTarget.closest<HTMLElement>('[onclick], [data-clickable="true"]');
  if (clickableParent) return clickableParent;

  return rawTarget;
}

/** 生成尽量简明、独特且稳定的 CSS 选择器 (抗动态内容与无意义相对路径干扰) */
function getElementSelector(el: HTMLElement): string {
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }
  const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }
  const name = el.getAttribute('name');
  if (name) {
    return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    return `[aria-label="${CSS.escape(ariaLabel)}"]`;
  }
  const title = el.getAttribute('title');
  if (title && title.length <= 20) {
    return `[title="${CSS.escape(title)}"]`;
  }
  const dataName = el.getAttribute('data-name') || el.getAttribute('data-id');
  if (dataName && dataName.length <= 30) {
    return `[data-name="${CSS.escape(dataName)}"]`;
  }
  const placeholder = el.getAttribute('placeholder');
  if (placeholder && placeholder.length <= 10 && !/[\d]{3,}|新闻|热搜|失联|遇难|突发|热点/i.test(placeholder)) {
    return `${el.tagName.toLowerCase()}[placeholder="${CSS.escape(placeholder)}"]`;
  }

  // 向上追溯 DOM 层级路径 (避免单一纯标签如 "button" 误命中)
  const path: string[] = [];
  let curr: HTMLElement | null = el;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    let seg = curr.tagName.toLowerCase();
    if (curr.id) {
      path.unshift(`#${CSS.escape(curr.id)}`);
      break;
    }
    const parent: HTMLElement | null = curr.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === curr!.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(curr) + 1;
        seg += `:nth-of-type(${index})`;
      }
    }
    path.unshift(seg);
    curr = parent;
    if (path.length >= 4) break;
  }
  return path.join(' > ') || el.tagName.toLowerCase();
}

/** 提取关联的 label 文本 */
function getNearestLabel(el: HTMLElement): string {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return (label.textContent || '').trim();
  }
  const parentLabel = el.closest('label');
  if (parentLabel) return (parentLabel.textContent || '').trim();
  return '';
}

/** 获取元素的抗干扰语义名称 (智能消除动态热搜占位符干扰，提取 SVG 图标意图) */
function getElementSemanticName(target: HTMLElement, rawTarget?: HTMLElement): string {
  const isInput =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.getAttribute('role') === 'textbox' ||
    target.getAttribute('contenteditable') === 'true';

  if (isInput) {
    const aria = target.getAttribute('aria-label') || '';
    if (aria) return aria;
    const label = getNearestLabel(target);
    if (label) return label;
    const name = target.getAttribute('name') || '';
    if (/wd|kw|query|search|keyword|q/i.test(name) || target.id === 'kw') {
      return '搜索输入框';
    }
    const placeholder = target.getAttribute('placeholder') || '';
    if (/[\d]{3,}|新闻|热搜|失联|遇难|突发|热点/i.test(placeholder) || placeholder.length > 12) {
      return '搜索输入框';
    }
    if (placeholder) return placeholder;
    return '输入框';
  }

  // 1. 尝试从直接文本提取
  let rawText = (target.innerText || target.textContent || rawTarget?.innerText || rawTarget?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();

  // 如果提取出来的文本纯粹是 "svg" 或空，则尝试从各类属性与结构中提取真实意图
  if (!rawText || /^svg$/i.test(rawText)) {
    const title =
      target.getAttribute('title') ||
      rawTarget?.getAttribute('title') ||
      target.getAttribute('data-title') ||
      target.getAttribute('data-tooltip') ||
      target.getAttribute('data-tip') ||
      target.getAttribute('data-name') ||
      target.getAttribute('aria-label') ||
      rawTarget?.getAttribute('aria-label') ||
      '';
    if (title) return title.trim();

    // 检查子元素中的 svg title
    const svgTitle = target.querySelector('title')?.textContent?.trim();
    if (svgTitle) return svgTitle;

    // 检查紧邻的兄弟节点文本
    const nextText = target.nextElementSibling?.textContent?.trim();
    if (nextText && nextText.length <= 15) return nextText;
    const prevText = target.previousElementSibling?.textContent?.trim();
    if (prevText && prevText.length <= 15) return prevText;

    // 检查父级文本
    const parentText = target.parentElement?.innerText?.trim();
    if (parentText && parentText.length <= 20) return parentText;

    // 检查 class 名称推断
    const classStr = `${target.className || ''} ${rawTarget?.className || ''}`;
    const iconMatch = classStr.match(/(?:icon[-_]|btn[-_]|i-)([a-zA-Z0-9_\u4e00-\u9fa5]+)/i);
    if (iconMatch && iconMatch[1] && !/svg|span|div|i|ant/i.test(iconMatch[1])) {
      return `${iconMatch[1]} 图标按钮`;
    }

    return '图标/菜单项';
  }

  return rawText.slice(0, 50);
}

/** 更新页面顶部录制指示条 (仅在主窗口顶层呈现，杜绝 iframe 重复渲染) */
async function updateBadge(currentCount?: number): Promise<void> {
  // 仅在顶层窗口创建悬浮条，避免在 iframe 内部重复出现两个悬浮条
  if (typeof window !== 'undefined' && window.top !== window) {
    return;
  }

  let count = currentCount;
  if (count === undefined) {
    const session = await getActiveRecordingSession();
    count = session?.actions?.length || 0;
  }

  // 查找已有 DOM 节点避免重复创建
  let badgeEl = document.getElementById('__ai_agent_recorder_badge__');
  if (!badgeEl) {
    badgeEl = document.createElement('div');
    badgeEl.id = '__ai_agent_recorder_badge__';
    Object.assign(badgeEl.style, {
      position: 'fixed',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      backgroundColor: '#1e293b',
      color: '#ffffff',
      padding: '6px 14px',
      borderRadius: '20px',
      fontSize: '12px',
      fontWeight: '500',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      pointerEvents: 'auto',
      userSelect: 'none',
      border: '1px solid rgba(255,255,255,0.1)',
    });
    document.body.appendChild(badgeEl);
    floatingBadge = badgeEl;
  }

  badgeEl.innerHTML = `
    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:#ef4444;animation:pulse 1.5s infinite;"></span>
    <span>🔴 正在录制流程</span>
    <span style="background:rgba(255,255,255,0.15);padding:1px 6px;border-radius:10px;font-size:11px;">已捕获 ${count} 步</span>
  `;
}

function removeBadge(): void {
  const badgeEl = document.getElementById('__ai_agent_recorder_badge__');
  if (badgeEl) badgeEl.remove();
  if (floatingBadge) {
    floatingBadge.remove();
    floatingBadge = null;
  }
}

/** 鼠标点击捕获 */
function handleClick(e: MouseEvent): void {
  if (!isRecording) return;
  const rawTarget = e.target as HTMLElement;
  if (!rawTarget || rawTarget.closest('#__ai_agent_recorder_badge__')) return;

  // 优先定位真正可交互的容器(如点击 svg/图标时锁定外层容器或按钮)
  const target = resolveInteractiveTarget(rawTarget);

  // 如果刚刚在输入，先沉淀最后的输入
  flushLastInput();

  const semanticText = getElementSemanticName(target, rawTarget);
  const selector = getElementSelector(target);
  const placeholder = target.getAttribute('placeholder') || undefined;
  const ariaLabel = target.getAttribute('aria-label') || getNearestLabel(target) || undefined;
  const role = target.getAttribute('role') || undefined;

  const act: CapturedAction = {
    type: 'click',
    timestamp: Date.now(),
    selector,
    targetText: semanticText,
    tag: target.tagName.toLowerCase(),
    role,
    placeholder,
    ariaLabel,
    url: window.location.href,
    title: document.title,
  };

  void appendActionToSession(act).then((count) => updateBadge(count));
}

/** 输入内容防抖捕获 */
function handleInput(e: Event): void {
  if (!isRecording) return;
  const rawTarget = e.target as HTMLElement;
  if (!rawTarget || rawTarget.closest('#__ai_agent_recorder_badge__')) return;

  const target =
    (rawTarget.closest('input, textarea, select, [contenteditable="true"]') as HTMLInputElement | HTMLTextAreaElement) ||
    (rawTarget as HTMLInputElement);

  const val = (target as any)?.value ?? target?.innerText ?? '';
  const selector = getElementSelector(target);
  const semanticText = getElementSemanticName(target, rawTarget);
  const placeholder = target.getAttribute('placeholder') || undefined;
  const ariaLabel = target.getAttribute('aria-label') || getNearestLabel(target) || undefined;

  const act: CapturedAction = {
    type: 'type',
    timestamp: Date.now(),
    selector,
    targetText: semanticText,
    tag: target.tagName.toLowerCase(),
    placeholder,
    ariaLabel,
    value: val,
    url: window.location.href,
    title: document.title,
  };

  lastInputTarget = { el: target, value: val, action: act };

  if (inputDebounceTimer) window.clearTimeout(inputDebounceTimer);
  inputDebounceTimer = window.setTimeout(() => {
    flushLastInput();
  }, 400);
}

/** 回车键 / 表单提交按键监听:沉淀输入并捕获回车提交动作 */
function handleKeydown(e: KeyboardEvent): void {
  if (!isRecording) return;
  if (e.key === 'Enter') {
    flushLastInput();
    const rawTarget = e.target as HTMLElement;
    if (!rawTarget || rawTarget.closest('#__ai_agent_recorder_badge__')) return;

    const target =
      (rawTarget.closest('input, textarea, [contenteditable="true"]') as HTMLElement) || rawTarget;
    const selector = getElementSelector(target);
    const placeholder = target.getAttribute('placeholder') || undefined;
    const ariaLabel = target.getAttribute('aria-label') || getNearestLabel(target) || undefined;

    const act: CapturedAction = {
      type: 'pressEnter',
      timestamp: Date.now(),
      selector,
      targetText: placeholder || ariaLabel || getNearestLabel(target) || '输入框回车提交',
      tag: target.tagName.toLowerCase(),
      placeholder,
      ariaLabel,
      url: window.location.href,
      title: document.title,
    };

    void appendActionToSession(act).then((count) => updateBadge(count));
  }
}

/** 表单提交监听:立刻沉淀输入 */
function handleSubmit(_e: Event): void {
  if (!isRecording) return;
  flushLastInput();
}

function flushLastInput(): void {
  if (lastInputTarget && lastInputTarget.value) {
    const act = lastInputTarget.action;
    act.value = lastInputTarget.value;
    lastInputTarget = null;
    void appendActionToSession(act).then((count) => updateBadge(count));
  }
}

/** 将原始捕获序列转换为结构化 WorkflowStep 列表 (自动过滤冗余前置聚焦点击与快速连击) */
export function buildWorkflowSteps(actions: CapturedAction[]): WorkflowStep[] {
  // 1. 过滤冗余的前置点击 (如点击输入框聚焦后紧接着输入内容或按回车)
  const cleanedActions: CapturedAction[] = [];
  for (let i = 0; i < actions.length; i++) {
    const curr = actions[i]!;
    const next = actions[i + 1];
    if (curr.type === 'click' && next && (next.type === 'type' || next.type === 'pressEnter')) {
      if (
        curr.selector === next.selector ||
        (curr.tag === 'input' && next.tag === 'input') ||
        (curr.tag === 'textarea' && next.tag === 'textarea')
      ) {
        continue; // 过滤冗余的输入框预先聚焦点击
      }
    }
    cleanedActions.push(curr);
  }

  // 2. 过滤 400ms 内对同一选择器的重复连击
  const deduplicated: CapturedAction[] = [];
  for (const act of cleanedActions) {
    const last = deduplicated[deduplicated.length - 1];
    if (
      last &&
      last.type === 'click' &&
      act.type === 'click' &&
      last.selector === act.selector &&
      act.timestamp - last.timestamp < 400
    ) {
      continue;
    }
    deduplicated.push(act);
  }

  // 3. 构建规范化 WorkflowStep
  const steps: WorkflowStep[] = [];
  let idx = 0;
  for (const act of deduplicated) {
    idx++;
    if (!act) continue;
    if (act.type === 'click') {
      const desc = act.targetText ? `点击「${act.targetText}」` : `点击元素 ${act.selector}`;
      steps.push({
        id: `step_${idx}`,
        type: 'click',
        description: desc,
        selector: act.selector,
        targetText: act.targetText,
        url: act.url,
      });
    } else if (act.type === 'type') {
      const desc = act.targetText
        ? `在「${act.targetText}」输入「${act.value || ''}」`
        : `输入「${act.value || ''}」到 ${act.selector}`;
      steps.push({
        id: `step_${idx}`,
        type: 'type',
        description: desc,
        selector: act.selector,
        targetText: act.targetText,
        value: act.value,
        url: act.url,
        humanLike: true,
      });
    } else if (act.type === 'pressEnter') {
      const desc = act.targetText ? `在「${act.targetText}」按下回车键提交` : `在 ${act.selector} 按下回车`;
      steps.push({
        id: `step_${idx}`,
        type: 'pressEnter',
        description: desc,
        selector: act.selector,
        targetText: act.targetText,
        url: act.url,
      });
    }
  }
  return steps;
}

/** 开始录制 (支持初次开启或页面跳转后自动续接) */
export async function startRecording(isResume = false): Promise<{ ok: boolean; message: string }> {
  if (isRecording) {
    return { ok: true, message: '已在录制中' };
  }
  isRecording = true;
  lastInputTarget = null;

  if (!isResume) {
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    await startActiveRecordingSession(undefined, currentUrl);
  }

  document.addEventListener('click', handleClick, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('submit', handleSubmit, true);
  window.addEventListener('beforeunload', flushLastInput);
  window.addEventListener('pagehide', flushLastInput);

  await updateBadge();
  return { ok: true, message: '🔴 开始录制流程，请在网页上进行操作' };
}

/** 结束录制并返回提炼的工作流步骤 (从持久化会话中读取全部跨页面动作与起始 URL) */
export async function stopRecording(): Promise<{
  ok: boolean;
  steps: WorkflowStep[];
  actionCount: number;
  startUrl?: string;
}> {
  flushLastInput();
  isRecording = false;

  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('keydown', handleKeydown, true);
  document.removeEventListener('submit', handleSubmit, true);
  window.removeEventListener('beforeunload', flushLastInput);
  window.removeEventListener('pagehide', flushLastInput);
  removeBadge();

  const { actions, startUrl } = await stopActiveRecordingSession();
  const steps = buildWorkflowSteps(actions);

  return { ok: true, steps, actionCount: actions.length, startUrl };
}

/** 获取当前录制状态 */
export async function getRecordingStatus(): Promise<{ isRecording: boolean; count: number }> {
  const session = await getActiveRecordingSession();
  return { isRecording: Boolean(session?.isRecording), count: session?.actions?.length || 0 };
}

/** 页面加载时自动感知并续接录制状态 (针对百度等搜索跳转/页面刷新场景) */
export async function checkAndResumeRecording(): Promise<void> {
  try {
    const session = await getActiveRecordingSession();
    if (session && session.isRecording) {
      if (Date.now() - (session.startTime || 0) < 5 * 60 * 1000) {
        await startRecording(true /* isResume */);
        return;
      }
    }
    // 无活跃录制会话时，主动清理任何残留的悬浮提示条与监听器
    removeBadge();
    isRecording = false;
  } catch {
    removeBadge();
    isRecording = false;
  }
}
