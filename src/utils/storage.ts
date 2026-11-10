// chrome.storage.local 封装:AI 设置(ADR-0005:仅本机存储)
import type { AiSettings } from './ai/provider/types';

const SETTINGS_KEY = 'aiSettings';

export const DEFAULT_SETTINGS: AiSettings = {
  providers: [],
  activeProviderId: '',
  maxDocChars: 120_000,
  confirmOnSend: true,
  rememberSession: true,
  trustedSession: false,
  debugMode: false,
  platformHost: 'http://localhost:8000',
  platformToken: '',
  tunnelUrl: 'ws://localhost:8000/api/browser/tunnel',
  enableTunnel: true,
};

export async function getSettings(): Promise<AiSettings> {
  const { [SETTINGS_KEY]: stored } = (await browser.storage.local.get(SETTINGS_KEY)) as {
    [SETTINGS_KEY]?: Partial<AiSettings>;
  };
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: AiSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}
