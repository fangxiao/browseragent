import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCachedCloudConfig,
  fetchAndSyncCloudConfig,
  getCachedCloudConfig,
  getEffectiveSystemPrompt,
  saveCachedCloudConfig,
  type AgentCloudConfig,
} from '../../src/utils/ai/remoteConfig';

const store: Record<string, unknown> = {};
(globalThis as any).browser = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: store[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      }),
      remove: vi.fn(async (key: string) => {
        delete store[key];
      }),
    },
  },
};

describe('remoteConfig (云端大脑与动态规则热更)', () => {
  beforeEach(async () => {
    for (const k of Object.keys(store)) delete store[k];
    await clearCachedCloudConfig();
    vi.restoreAllMocks();
  });

  it('未配置云端规则时, getEffectiveSystemPrompt 返回内置原生提示词', async () => {
    const prompt = await getEffectiveSystemPrompt();
    expect(prompt).toContain('通用 AI 浏览器操作助手');
    expect(prompt).toContain('readPage');
    expect(prompt).toContain('getPagePerformance');
  });

  it('保存并读取云端扩展规则: 自动拼接云端动态规则', async () => {
    const mockConfig: AgentCloudConfig = {
      version: '2026.08.15.2',
      updatedAt: Date.now(),
      additionalRules: [
        '电商对比专用: 遇到商品页时自动提取优惠券、券后价与月销量',
        '知乎/微信专用: 自动提取阅读数与点赞数',
      ],
    };

    await saveCachedCloudConfig(mockConfig);
    const cached = await getCachedCloudConfig();
    expect(cached).toEqual(mockConfig);

    const prompt = await getEffectiveSystemPrompt();
    expect(prompt).toContain('通用 AI 浏览器操作助手');
    expect(prompt).toContain('云端动态扩展规则 (v2026.08.15.2)');
    expect(prompt).toContain('电商对比专用');
    expect(prompt).toContain('知乎/微信专用');
  });

  it('若云端下发完整 systemPrompt, 则优先使用完整覆盖版本', async () => {
    const fullCustom = '自定义云端完整 Prompt：这是一个完全由云端动态接管的超级智能体。' + 'x'.repeat(120);
    await saveCachedCloudConfig({
      version: '2026.09.01',
      updatedAt: Date.now(),
      systemPrompt: fullCustom,
    });

    const prompt = await getEffectiveSystemPrompt();
    expect(prompt).toBe(fullCustom);
  });

  it('fetchAndSyncCloudConfig 成功解析合规的云端配置', async () => {
    const mockPayload: AgentCloudConfig = {
      version: '2026.08.15.3',
      updatedAt: 1786780000000,
      additionalRules: ['新规则测试 1'],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockPayload,
    } as Response);

    const res = await fetchAndSyncCloudConfig('https://api.test.com/rules.json');
    expect(res.success).toBe(true);
    expect(res.config?.version).toBe('2026.08.15.3');

    const cached = await getCachedCloudConfig();
    expect(cached?.version).toBe('2026.08.15.3');
  });

  it('fetchAndSyncCloudConfig 遇到网络错误时安全返回错误, 不抛错', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network unreachable'));

    const res = await fetchAndSyncCloudConfig('https://api.test.com/rules.json');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Network unreachable');
  });
});
