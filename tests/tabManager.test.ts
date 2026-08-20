import { describe, expect, it } from 'vitest';
import { buildAgentSystem } from '../src/utils/ai/agents';
import { BrowserManagerPlugin } from '../src/plugins/browser';

import {
  getTabFingerprint,
  computeDuplicateInfo,
  sortTabsByDuplicatePriority,
} from '../src/components/sidepanel/TabManagerCard';

interface TabItem {
  tabId: number;
  title: string;
  url: string;
}

describe('TabManager 标签页去重与管理', () => {
  it('正确规范化标签页指纹并识别不同追踪参数/动态参数的搜索页面', () => {
    const t1 = { tabId: 1, title: 'BAI - 百度搜索', url: 'https://www.baidu.com/s?wd=BAI&rsv_spt=1&issp=1&f=8&rsv_bp=1' };
    const t2 = { tabId: 2, title: 'BAI - 百度搜索', url: 'https://www.baidu.com/s?wd=BAI&rsv_spt=2&issp=0&f=3&rsv_bp=2' };
    expect(getTabFingerprint(t1)).toBe(getTabFingerprint(t2));

    const g1 = { tabId: 3, title: 'AI - Google Search', url: 'https://google.com/search?q=AI&utm_source=test' };
    const g2 = { tabId: 4, title: 'AI - Google Search', url: 'https://google.com/search?q=ai&utm_campaign=winter' };
    expect(getTabFingerprint(g1)).toBe(getTabFingerprint(g2));
  });

  it('准确识别重复副本并保留首个主标签', () => {
    const tabs: TabItem[] = [
      { tabId: 101, title: 'GitHub - Main', url: 'https://github.com/test/repo' },
      { tabId: 102, title: 'Google', url: 'https://www.google.com' },
      { tabId: 103, title: 'GitHub - Duplicate 1', url: 'https://github.com/test/repo/' },
      { tabId: 104, title: 'GitHub - Duplicate 2', url: 'https://github.com/test/repo#section' },
      { tabId: 105, title: 'Google Duplicate', url: 'https://www.google.com/' },
      { tabId: 106, title: 'BAI - 百度搜索', url: 'https://www.baidu.com/s?wd=BAI&rsv_spt=1' },
      { tabId: 107, title: 'BAI - 百度搜索', url: 'https://www.baidu.com/s?wd=BAI&rsv_bp=2' },
    ];

    const result = computeDuplicateInfo(tabs);

    // 重复副本列表: 103, 104 (针对 github), 105 (针对 google), 107 (针对 百度搜索 BAI)
    expect(result.copyIds).toEqual([103, 104, 105, 107]);

    // 主标签集合: 101 (github), 102 (google), 106 (百度搜索 BAI)
    expect(result.origIds.has(101)).toBe(true);
    expect(result.origIds.has(102)).toBe(true);
    expect(result.origIds.has(106)).toBe(true);
    expect(result.origIds.has(107)).toBe(false);
  });

  it('正确提取并排序最大重复源 (例如「社会招聘」7个 + 「海尔消费金融官网」3个)', () => {
    const tabs: TabItem[] = [
      { tabId: 1, title: '单页A', url: 'https://single.com/a' },
      // 社会招聘 7 个
      { tabId: 10, title: '社会招聘 - 主页', url: 'https://job.haiercash.com/social' },
      { tabId: 11, title: '社会招聘', url: 'https://job.haiercash.com/social?from=1' },
      { tabId: 12, title: '社会招聘', url: 'https://job.haiercash.com/social?from=2' },
      { tabId: 13, title: '社会招聘', url: 'https://job.haiercash.com/social?from=3' },
      { tabId: 14, title: '社会招聘', url: 'https://job.haiercash.com/social?from=4' },
      { tabId: 15, title: '社会招聘', url: 'https://job.haiercash.com/social?from=5' },
      { tabId: 16, title: '社会招聘', url: 'https://job.haiercash.com/social?from=6' },
      // 海尔消费金融官网 3 个
      { tabId: 20, title: '海尔消费金融官网', url: 'https://www.haiercash.com/' },
      { tabId: 21, title: '海尔消费金融官网', url: 'https://www.haiercash.com/?utm_source=baidu' },
      { tabId: 22, title: '海尔消费金融官网', url: 'https://www.haiercash.com/?spm=123' },
      { tabId: 2, title: '单页B', url: 'https://single.com/b' },
    ];

    const result = computeDuplicateInfo(tabs);
    expect(result.duplicateGroups.length).toBe(2);

    // 第一大重复源是「社会招聘」 (7个标签，6个副本)
    expect(result.duplicateGroups[0]?.totalCount).toBe(7);
    expect(result.duplicateGroups[0]?.copyCount).toBe(6);
    expect(result.duplicateGroups[0]?.representativeTitle).toContain('社会招聘');

    // 第二大重复源是「海尔消费金融官网」 (3个标签，2个副本)
    expect(result.duplicateGroups[1]?.totalCount).toBe(3);
    expect(result.duplicateGroups[1]?.copyCount).toBe(2);
    expect(result.duplicateGroups[1]?.representativeTitle).toContain('海尔消费金融官网');

    // 测试标签排序：大重复源排最前，组内待清理副本排最前
    const copyIdsSet = new Set(result.copyIds);
    const sorted = sortTabsByDuplicatePriority(tabs, result.duplicateGroups, copyIdsSet);

    // 前6个应为社会招聘的副本 (tabId 11-16)
    const firstSixIds = sorted.slice(0, 6).map((t) => t.tabId);
    expect(firstSixIds).toEqual([11, 12, 13, 14, 15, 16]);

    // 第7个为社会招聘的主标签 (tabId 10)
    expect(sorted[6]?.tabId).toBe(10);

    // 第8、9个为海尔消费金融官网的副本 (tabId 21, 22)
    expect(sorted[7]?.tabId).toBe(21);
    expect(sorted[8]?.tabId).toBe(22);

    // 第10个为海尔消费金融官网的主标签 (tabId 20)
    expect(sorted[9]?.tabId).toBe(20);

    // 最后为独立单页
    expect(sorted[10]?.tabId).toBe(1);
    expect(sorted[11]?.tabId).toBe(2);
  });

  it('系统提示词不包含强制自动调用 groupTabs 的指令，而是交由交互看板', () => {
    const systemPrompt = buildAgentSystem();
    expect(systemPrompt).toContain('listTabs');
    expect(systemPrompt).toContain('【严禁】擅自调用 groupTabs 直接自动分组');

    expect(BrowserManagerPlugin.systemPromptSnippet).toContain('【严禁】擅自自动调用 groupTabs 进行分组');
  });
});
