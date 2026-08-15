// 微信公众号专属精美排版主题色板与行内样式定义
export type WechatThemeId = 'tech-blue' | 'wechat-green' | 'minimal-black' | 'elegant-purple' | 'warm-amber';

export interface WechatTheme {
  id: WechatThemeId;
  name: string;
  primary: string;
  secondary: string;
  textColor: string;
  bgLight: string;
  borderColor: string;
  codeBg: string;
}

export const WECHAT_THEMES: Record<WechatThemeId, WechatTheme> = {
  'tech-blue': {
    id: 'tech-blue',
    name: '科技商务蓝',
    primary: '#2563eb',
    secondary: '#eff6ff',
    textColor: '#334155',
    bgLight: '#f8fafc',
    borderColor: '#bfdbfe',
    codeBg: '#1e293b',
  },
  'wechat-green': {
    id: 'wechat-green',
    name: '微信经典绿',
    primary: '#07c160',
    secondary: '#f0fdf4',
    textColor: '#27272a',
    bgLight: '#f4f4f5',
    borderColor: '#bbf7d0',
    codeBg: '#27272a',
  },
  'minimal-black': {
    id: 'minimal-black',
    name: '极简高级黑',
    primary: '#0f172a',
    secondary: '#f1f5f9',
    textColor: '#1e293b',
    bgLight: '#f8fafc',
    borderColor: '#cbd5e1',
    codeBg: '#1e293b',
  },
  'elegant-purple': {
    id: 'elegant-purple',
    name: '典雅学术紫',
    primary: '#7c3aed',
    secondary: '#f5f3ff',
    textColor: '#334155',
    bgLight: '#faf5ff',
    borderColor: '#ddd6fe',
    codeBg: '#1e1b4b',
  },
  'warm-amber': {
    id: 'warm-amber',
    name: '活力暖阳橙',
    primary: '#ea580c',
    secondary: '#fff7ed',
    textColor: '#334155',
    bgLight: '#fffbeb',
    borderColor: '#fed7aa',
    codeBg: '#292524',
  },
};

export function getWechatTheme(themeId?: string): WechatTheme {
  if (themeId && themeId in WECHAT_THEMES) {
    return WECHAT_THEMES[themeId as WechatThemeId];
  }
  return WECHAT_THEMES['tech-blue'];
}
