// 敏感操作判定纯函数。见 docs/design/agent.md §8、ADR-0007
import type { ToolCall } from './types';

/** 中文 + 英文敏感动作模式(宁多确认,勿漏判) */
const SENSITIVE_PATTERNS: RegExp[] = [
  /提交|发布|保存|删除|支付|付款|下单|确认(删除|发布|支付|提交|下单)|关闭账号|注销/i,
  /submit|publish|delete|remove|pay|checkout|order|confirm/i,
];

export function isSensitiveText(text: string): boolean {
  if (!text) return false;
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

/** 是否跨域离开当前站点(当前标签导航走 tabs.update,离开需确认) */
export function isSensitiveNavigate(url: string, currentOrigin: string): boolean {
  if (!url) return false;
  if (url.startsWith('/') || url.startsWith('#')) return false; // 站内相对路径
  try {
    return new URL(url, currentOrigin).origin !== currentOrigin;
  } catch {
    return true; // 解析失败按敏感处理
  }
}

/** 是否密码输入(避免明文密码被 AI 自动填写,需用户确认) */
function isPasswordInput(selector: string): boolean {
  return /password|passwd|pwd/i.test(selector);
}

/** 判定上下文(background 注入页面信息,如 navigate 跨域判定用 currentOrigin) */
export interface SafetyContext {
  /** 当前页面 origin;优先于 call.args.currentOrigin */
  currentOrigin?: string;
}

/** 判定一次工具调用是否敏感 */
export function isSensitiveToolCall(
  call: ToolCall,
  ctx: SafetyContext = {},
): { sensitive: boolean; reason?: string } {
  switch (call.name) {
    case 'clickElement': {
      const target = String(call.args?.selector ?? '') + ' ' + String(call.args?.description ?? '');
      if (isSensitiveText(target)) {
        return { sensitive: true, reason: `点击目标可能为敏感动作:${target.trim().slice(0, 60)}` };
      }
      return { sensitive: false };
    }
    case 'typeInto': {
      const sel = String(call.args?.selector ?? '');
      if (isPasswordInput(sel)) {
        return { sensitive: true, reason: '向密码框输入内容,需用户确认' };
      }
      return { sensitive: false };
    }
    case 'navigate': {
      const url = String(call.args?.url ?? '');
      const origin = ctx.currentOrigin ?? String(call.args?.currentOrigin ?? '');
      if (isSensitiveNavigate(url, origin)) {
        return { sensitive: true, reason: `导航离开当前站点:${url.slice(0, 60)}` };
      }
      return { sensitive: false };
    }
    case 'evaluate':
      // 通俗文案:普通用户看到的是"在页面上运行一段代码",而非"执行任意 JS"
      return { sensitive: true, reason: '在页面上运行一段代码(高级功能)' };
    default:
      return { sensitive: false };
  }
}
