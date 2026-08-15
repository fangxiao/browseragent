// 云端动态大脑与提示词热更引擎(Remote Config & Prompt Hot-Sync)。
// 允许在无需重新打包/发布扩展的前提下,动态推送 Agent 提示词规则、场景工作流与模型参数。
import { buildAgentSystem as getBuiltinSystemPrompt } from './agents';

export interface AgentCloudConfig {
  /** 规则版本号,如 "2026.08.15.1" */
  version: string;
  /** 更新时间戳(ms) */
  updatedAt: number;
  /** 完整覆盖的 System Prompt(若提供) */
  systemPrompt?: string;
  /** 动态追加的增量规则列表(若提供) */
  additionalRules?: string[];
  /** 场景推荐或预设信息 */
  announcement?: string;
}

const STORAGE_KEY = 'agent_cloud_config';

/** 默认官方规则分发地址(可用 GitHub Raw、jsDelivr 或自建 CDN) */
export const DEFAULT_CLOUD_CONFIG_URL =
  'https://raw.githubusercontent.com/fangxiao/tabsmanager/main/config/agent-rules.json';

/** 获取本地缓存的云端配置 */
export async function getCachedCloudConfig(): Promise<AgentCloudConfig | null> {
  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      const res = (await browser.storage.local.get(STORAGE_KEY)) as { [STORAGE_KEY]?: AgentCloudConfig };
      return res[STORAGE_KEY] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** 写入/更新本地缓存的云端配置 */
export async function saveCachedCloudConfig(config: AgentCloudConfig): Promise<void> {
  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      await browser.storage.local.set({ [STORAGE_KEY]: config });
    }
  } catch (err) {
    console.warn('[RemoteConfig] 保存云端配置缓存失败:', err);
  }
}

/** 清理云端缓存(恢复纯本地规则) */
export async function clearCachedCloudConfig(): Promise<void> {
  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      await browser.storage.local.remove(STORAGE_KEY);
    }
  } catch (err) {
    console.warn('[RemoteConfig] 清理缓存失败:', err);
  }
}

/** 从云端拉取最新配置并持久化缓存;支持传入自定义更新源 */
export async function fetchAndSyncCloudConfig(
  url: string = DEFAULT_CLOUD_CONFIG_URL,
): Promise<{ success: boolean; config?: AgentCloudConfig; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000); // 6s 超时防卡死

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { success: false, error: `云端服务返回错误状态码: ${res.status}` };
    }

    const json = (await res.json()) as Partial<AgentCloudConfig>;
    if (!json || typeof json !== 'object' || !json.version) {
      return { success: false, error: '云端配置格式不合法(缺少 version 字段)' };
    }

    const validConfig: AgentCloudConfig = {
      version: String(json.version),
      updatedAt: Number(json.updatedAt) || Date.now(),
      systemPrompt: json.systemPrompt ? String(json.systemPrompt) : undefined,
      additionalRules: Array.isArray(json.additionalRules)
        ? json.additionalRules.map((r) => String(r))
        : undefined,
      announcement: json.announcement ? String(json.announcement) : undefined,
    };

    await saveCachedCloudConfig(validConfig);
    return { success: true, config: validConfig };
  } catch (err) {
    const msg = (err as Error).name === 'AbortError' ? '网络请求超时' : (err as Error).message;
    return { success: false, error: msg || '网络连接异常' };
  }
}

/**
 * 获取当前生效的最终 System Prompt:
 * 1. 优先使用云端下发的高级/覆盖 Prompt;
 * 2. 其次使用内置 Prompt + 云端追加规则;
 * 3. 离线或网络故障时 100% 优雅回退到内置原生 Prompt。
 */
export async function getEffectiveSystemPrompt(): Promise<string> {
  const cached = await getCachedCloudConfig();
  const base = getBuiltinSystemPrompt();

  if (!cached) return base;

  if (cached.systemPrompt && cached.systemPrompt.trim().length > 100) {
    return cached.systemPrompt;
  }

  if (cached.additionalRules && cached.additionalRules.length > 0) {
    const extra =
      '\n\n【云端动态扩展规则 (v' +
      cached.version +
      ')】\n' +
      cached.additionalRules.map((r) => `- ${r}`).join('\n');
    return base + extra;
  }

  return base;
}
