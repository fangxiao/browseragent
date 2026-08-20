// 交互式标签页整理与去重管理看板:供用户可视化查看当前所有网页、自动识别重复项并一键批量关闭/建组。
import { useMemo, useState } from 'react';
import type { TabItem } from './TabSelector';

interface Props {
  initialTabs: TabItem[];
  onTabsChanged?: (remainingTabs: TabItem[]) => void;
}

export interface DuplicateGroupSummary {
  key: string;
  representativeTitle: string;
  hostname: string;
  totalCount: number;
  copyCount: number;
  copyIds: number[];
  originalId: number;
  tabIds: number[];
}

/** 智能规范化标签页指纹 (消除追踪参数、百度/谷歌动态参数、哈希与冗余后缀，支持按标题+域名精准聚合) */
export function getTabFingerprint(t: TabItem): string {
  try {
    const u = new URL(t.url);
    const host = u.host.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '') || '/';

    // 1. 搜索引擎参数提纯
    if (host.includes('baidu.com') && (path === '/s' || path === '/baidu')) {
      const wd = u.searchParams.get('wd') || u.searchParams.get('word') || '';
      if (wd) return `search:baidu:${wd.trim().toLowerCase()}`;
    }
    if (host.includes('google.') && path === '/search') {
      const q = u.searchParams.get('q') || '';
      if (q) return `search:google:${q.trim().toLowerCase()}`;
    }
    if (host.includes('bing.com') && path === '/search') {
      const q = u.searchParams.get('q') || '';
      if (q) return `search:bing:${q.trim().toLowerCase()}`;
    }
    if (host.includes('sogou.com') && path.includes('web')) {
      const query = u.searchParams.get('query') || '';
      if (query) return `search:sogou:${query.trim().toLowerCase()}`;
    }

    // 2. 过滤常见 UTM 及广告追踪参数
    const cleanParams = new URLSearchParams();
    const ignoreKeys = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'spm', 'from', 'ref', 'source', 'rsv_spt', 'rsv_bp', 'rsv_idx', 'rsv_t',
      'oq', 'f', 'issp', 'ie', 'ch', 'tn', 'bar', 'ts', 't', '_', 'ssl_s',
      'fbclid', 'gclid', 'msclkid', 'hmsr', 'mm_g',
    ]);
    u.searchParams.forEach((v, k) => {
      if (!ignoreKeys.has(k.toLowerCase()) && !k.startsWith('utm_') && !k.startsWith('rsv_')) {
        cleanParams.append(k, v);
      }
    });

    const searchStr = cleanParams.toString();
    return `${host}${path}${searchStr ? `?${searchStr}` : ''}`;
  } catch {
    return (t.url || t.title).trim().toLowerCase();
  }
}

/** 计算重复标签页信息并按重复规模降序归纳重复组 */
export function computeDuplicateInfo(tabList: TabItem[]) {
  const countMap = new Map<string, number>();
  const tabsByGroup = new Map<string, TabItem[]>();
  const copyIds: number[] = [];
  const origIds = new Set<number>();

  for (const t of tabList) {
    const key = getTabFingerprint(t);
    countMap.set(key, (countMap.get(key) || 0) + 1);
    const list = tabsByGroup.get(key) || [];
    list.push(t);
    tabsByGroup.set(key, list);
  }

  const duplicateGroups: DuplicateGroupSummary[] = [];

  for (const [key, groupTabs] of tabsByGroup.entries()) {
    if (groupTabs.length > 1) {
      const orig = groupTabs[0]!;
      origIds.add(orig.tabId);
      const groupCopyIds = groupTabs.slice(1).map((t) => t.tabId);
      copyIds.push(...groupCopyIds);

      let hostname = '';
      try {
        hostname = new URL(orig.url).hostname.replace(/^www\./, '');
      } catch {
        hostname = '';
      }

      duplicateGroups.push({
        key,
        representativeTitle: orig.title || '未命名网页',
        hostname,
        totalCount: groupTabs.length,
        copyCount: groupCopyIds.length,
        copyIds: groupCopyIds,
        originalId: orig.tabId,
        tabIds: groupTabs.map((t) => t.tabId),
      });
    }
  }

  // 按照重复数量由大到小排序 (例如 7 个 > 3 个 > 2 个)
  duplicateGroups.sort((a, b) => b.totalCount - a.totalCount);

  return { copyIds, origIds, countMap, duplicateGroups };
}

/** 按重复度降序对标签列表进行智能排序 (大重复源排最前，组内勾选项排最前) */
export function sortTabsByDuplicatePriority(
  tabList: TabItem[],
  duplicateGroups: DuplicateGroupSummary[],
  copyIdsSet: Set<number>,
): TabItem[] {
  const groupRankMap = new Map<string, { rank: number; totalCount: number }>();
  duplicateGroups.forEach((g, idx) => {
    groupRankMap.set(g.key, { rank: idx, totalCount: g.totalCount });
  });

  return [...tabList].sort((a, b) => {
    const keyA = getTabFingerprint(a);
    const keyB = getTabFingerprint(b);

    const infoA = groupRankMap.get(keyA);
    const infoB = groupRankMap.get(keyB);

    const countA = infoA ? infoA.totalCount : 1;
    const countB = infoB ? infoB.totalCount : 1;

    // 1. 重复数量多的排在前面 (例如 7 个 > 3 个 > 2 个 > 1 个)
    if (countA !== countB) {
      return countB - countA;
    }

    // 2. 相同重复数量下，按 group rank 聚合在一起
    if (infoA && infoB && infoA.rank !== infoB.rank) {
      return infoA.rank - infoB.rank;
    }

    // 3. 在同一个重复组内部：可勾选清理的副本(⚠️) 排在最前面，保留的主标签(🌟) 紧跟其后
    if (infoA && infoB) {
      const isCopyA = copyIdsSet.has(a.tabId) ? 0 : 1;
      const isCopyB = copyIdsSet.has(b.tabId) ? 0 : 1;
      if (isCopyA !== isCopyB) {
        return isCopyA - isCopyB;
      }
    }

    return 0;
  });
}

const TAB_GROUP_COLORS = [
  { name: 'blue', label: '蓝', bg: 'bg-blue-500' },
  { name: 'red', label: '红', bg: 'bg-red-500' },
  { name: 'green', label: '绿', bg: 'bg-green-500' },
  { name: 'yellow', label: '黄', bg: 'bg-amber-500' },
  { name: 'purple', label: '紫', bg: 'bg-purple-500' },
  { name: 'orange', label: '橙', bg: 'bg-orange-500' },
  { name: 'grey', label: '灰', bg: 'bg-gray-500' },
];

export function TabManagerCard({ initialTabs, onTabsChanged }: Props) {
  const [tabs, setTabs] = useState<TabItem[]>(initialTabs);
  // 默认自动勾选所有识别到的重复副本
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => {
    const { copyIds } = computeDuplicateInfo(initialTabs);
    return new Set<number>(copyIds);
  });
  const [filter, setFilter] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isOperating, setIsOperating] = useState(false);

  // 建组表单状态
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupColor, setGroupColor] = useState('blue');

  // 工作区保存状态
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [closeAfterSave, setCloseAfterSave] = useState(false);

  // 计算重复网页统计信息与分组
  const {
    copyIds: duplicateCopyIds,
    origIds: duplicateOriginalIds,
    countMap: urlCountMap,
    duplicateGroups,
  } = useMemo(() => {
    return computeDuplicateInfo(tabs);
  }, [tabs]);

  const copyIdsSet = useMemo(() => new Set<number>(duplicateCopyIds), [duplicateCopyIds]);

  // 始终按重复度降序智能排序与过滤标签列表
  const displayedTabs = useMemo(() => {
    let list = tabs;
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q));
    }
    return sortTabsByDuplicatePriority(list, duplicateGroups, copyIdsSet);
  }, [tabs, filter, duplicateGroups, copyIdsSet]);

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 一键勾选所有重复副本(保留主标签) */
  const handleSelectDuplicates = () => {
    const allSelected = duplicateCopyIds.length > 0 && duplicateCopyIds.every((id: number) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        duplicateCopyIds.forEach((id: number) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        duplicateCopyIds.forEach((id: number) => next.add(id));
        return next;
      });
    }
  };

  /** 全选当前展示结果 */
  const handleSelectAll = () => {
    setSelectedIds(new Set(displayedTabs.map((t) => t.tabId)));
  };

  /** 清空勾选 */
  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  /** 激活/切换聚焦到指定标签页 */
  const handleActivateTab = async (tabId: number) => {
    try {
      if (typeof browser !== 'undefined' && browser.tabs?.update) {
        await browser.tabs.update(tabId, { active: true });
      } else if (typeof (globalThis as any).chrome?.tabs?.update === 'function') {
        await (globalThis as any).chrome.tabs.update(tabId, { active: true });
      }
    } catch {
      /* ignore */
    }
  };

  /** 单个标签页快速关闭 */
  const handleCloseSingleTab = async (tabId: number) => {
    try {
      const chromeGlobal = (globalThis as any).chrome;
      if (typeof chromeGlobal?.tabs?.remove === 'function') {
        await chromeGlobal.tabs.remove(tabId);
      } else if (typeof browser !== 'undefined' && browser.tabs?.remove) {
        await browser.tabs.remove(tabId);
      }
    } catch {
      /* ignore */
    }
    const remaining = tabs.filter((t) => t.tabId !== tabId);
    setTabs(remaining);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
    onTabsChanged?.(remaining);
    setStatusMsg({ type: 'success', text: '🗑️ 已关闭 1 个标签页' });
  };

  /** 批量关闭选中的标签页 */
  const handleBatchClose = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setIsOperating(true);
    try {
      const chromeGlobal = (globalThis as any).chrome;
      for (const tid of ids) {
        try {
          if (typeof chromeGlobal?.tabs?.remove === 'function') {
            await chromeGlobal.tabs.remove(tid);
          } else if (typeof browser !== 'undefined' && browser.tabs?.remove) {
            await browser.tabs.remove(tid);
          }
        } catch {
          /* ignore */
        }
      }
      const remaining = tabs.filter((t) => !selectedIds.has(t.tabId));
      setTabs(remaining);
      setSelectedIds(new Set());
      onTabsChanged?.(remaining);
      setStatusMsg({
        type: 'success',
        text: `🎉 已成功关闭 ${ids.length} 个标签页，释放系统内存`,
      });
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: `批量关闭失败: ${(err as Error).message}`,
      });
    } finally {
      setIsOperating(false);
    }
  };

  /** 刷新并同步最新标签页状态 */
  const handleRefreshTabs = async () => {
    try {
      let rawTabs: any[] = [];
      const chromeGlobal = (globalThis as any).chrome;
      if (typeof chromeGlobal?.tabs?.query === 'function') {
        rawTabs = await chromeGlobal.tabs.query({ currentWindow: true });
      } else if (typeof browser !== 'undefined' && browser.tabs?.query) {
        rawTabs = await browser.tabs.query({ currentWindow: true });
      }
      if (rawTabs.length > 0) {
        const mapped: TabItem[] = rawTabs
          .filter((t) => t.url && !t.url.startsWith('chrome-extension://'))
          .map((t) => ({
            tabId: t.id!,
            title: t.title || '未命名标签',
            url: t.url!,
            active: t.active ?? false,
            pinned: t.pinned ?? false,
            groupId: t.groupId != null && t.groupId > -1 ? t.groupId : undefined,
          }));
        setTabs(mapped);
        setSelectedIds((prev) => {
          const next = new Set<number>();
          const currentIds = new Set(mapped.map((m) => m.tabId));
          for (const id of prev) {
            if (currentIds.has(id)) next.add(id);
          }
          return next;
        });
        onTabsChanged?.(mapped);
        setStatusMsg({ type: 'success', text: `🔄 已同步当前窗口 ${mapped.length} 个标签页` });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: `刷新失败: ${(err as Error).message}` });
    }
  };

  /** 批量休眠选中的标签页 */
  const handleDiscardTabs = async () => {
    let ids = Array.from(selectedIds);
    if (ids.length === 0) {
      ids = tabs.filter((t) => !t.active).map((t) => t.tabId);
    }
    if (ids.length === 0) return;

    setIsOperating(true);
    try {
      const chromeGlobal = (globalThis as any).chrome;
      let count = 0;
      for (const tid of ids) {
        try {
          if (typeof chromeGlobal?.tabs?.discard === 'function') {
            await chromeGlobal.tabs.discard(tid);
            count++;
          } else if (typeof (browser.tabs as any)?.discard === 'function') {
            await (browser.tabs as any).discard(tid);
            count++;
          }
        } catch {
          /* ignore */
        }
      }
      setSelectedIds(new Set());
      setStatusMsg({
        type: 'success',
        text: `💤 已成功休眠挂起 ${count} 个闲置网页，保留标签但释放了系统内存！`,
      });
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: `休眠失败: ${(err as Error).message}`,
      });
    } finally {
      setIsOperating(false);
    }
  };

  /** 保存为项目工作区会话快照 */
  const handleSaveWorkspace = async () => {
    if (!workspaceName.trim()) return;
    setIsOperating(true);
    try {
      const targetTabs = selectedIds.size > 0
        ? tabs.filter((t) => selectedIds.has(t.tabId))
        : tabs;

      const WORKSPACE_KEY = 'workspaces_store';
      let store: Record<string, any> = {};
      if (typeof browser !== 'undefined' && browser.storage?.local) {
        const res = (await browser.storage.local.get(WORKSPACE_KEY)) as { [WORKSPACE_KEY]?: Record<string, any> };
        store = res[WORKSPACE_KEY] || {};
      }
      const wsId = `ws_${Date.now()}`;
      store[wsId] = {
        id: wsId,
        name: workspaceName.trim(),
        createdAt: Date.now(),
        tabs: targetTabs.map((t) => ({
          title: t.title,
          url: t.url,
          pinned: Boolean(t.pinned),
          groupTitle: t.groupTitle,
          groupColor: t.groupColor,
        })),
      };

      if (typeof browser !== 'undefined' && browser.storage?.local) {
        await browser.storage.local.set({ [WORKSPACE_KEY]: store });
      }

      if (closeAfterSave) {
        const toClose = targetTabs.map((t) => t.tabId);
        if (typeof browser !== 'undefined' && browser.tabs?.remove) {
          await browser.tabs.remove(toClose);
        }
        const remaining = tabs.filter((t) => !toClose.includes(t.tabId));
        setTabs(remaining);
        onTabsChanged?.(remaining);
      }

      setShowWorkspaceModal(false);
      setWorkspaceName('');
      setSelectedIds(new Set());
      setStatusMsg({
        type: 'success',
        text: `💾 已保存工作区快照「${workspaceName.trim()}」(${targetTabs.length} 个网页)${closeAfterSave ? '并已关闭标签' : ''}`,
      });
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: `保存工作区失败: ${(err as Error).message}`,
      });
    } finally {
      setIsOperating(false);
    }
  };

  /** 将选中标签页分离至新独立窗口 */
  const handleMoveToNewWindow = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setIsOperating(true);
    try {
      const [first, ...rest] = ids;
      let winId: number | undefined;
      if (typeof browser !== 'undefined' && browser.windows?.create) {
        const win = await browser.windows.create({ tabId: first, focused: true });
        winId = win?.id;
        if (rest.length > 0 && winId != null) {
          await browser.tabs.move(rest, { windowId: winId, index: -1 });
        }
      }
      const remaining = tabs.filter((t) => !selectedIds.has(t.tabId));
      setTabs(remaining);
      setSelectedIds(new Set());
      onTabsChanged?.(remaining);
      setStatusMsg({
        type: 'success',
        text: `🪟 已将 ${ids.length} 个标签页分离至新窗口`,
      });
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: `窗口分离失败: ${(err as Error).message}`,
      });
    } finally {
      setIsOperating(false);
    }
  };

  /** 为选中标签页创建分组 */
  const handleCreateGroup = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || !groupTitle.trim()) return;

    setIsOperating(true);
    try {
      const chromeGlobal = (globalThis as any).chrome;
      let groupId: number | undefined;
      if (typeof chromeGlobal?.tabs?.group === 'function') {
        groupId = await chromeGlobal.tabs.group({ tabIds: ids });
        if (groupId != null && typeof chromeGlobal?.tabGroups?.update === 'function') {
          await chromeGlobal.tabGroups.update(groupId, {
            title: groupTitle.trim(),
            color: groupColor as any,
          });
        }
      } else if (typeof (browser.tabs as any)?.group === 'function') {
        groupId = await (browser.tabs as any).group({ tabIds: ids });
      }

      setStatusMsg({
        type: 'success',
        text: `🏷️ 已将 ${ids.length} 个标签页归入「${groupTitle.trim()}」分组`,
      });
      setShowGroupModal(false);
      setGroupTitle('');
      setSelectedIds(new Set());
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: `建组失败: ${(err as Error).message}`,
      });
    } finally {
      setIsOperating(false);
    }
  };

  if (tabs.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/80 p-3 text-center text-xs text-gray-500">
        ✨ 当前已无待整理的标签页
      </div>
    );
  }

  const isAllDuplicatesSelected =
    duplicateCopyIds.length > 0 && duplicateCopyIds.every((id: number) => selectedIds.has(id));

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-white p-3 shadow-xs text-xs text-gray-800">
      {/* 头部统计与去重提示 */}
      <div className="flex items-center justify-between font-medium text-gray-700 pb-2 border-b border-gray-100">
        <div className="flex items-center gap-1.5">
          <span>🗂️</span>
          <span className="font-semibold text-gray-900">标签页去重与清理看板</span>
          <span className="text-[11px] text-gray-400">({tabs.length})</span>
        </div>
        <div className="flex items-center gap-1.5">
          {duplicateCopyIds.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 border border-rose-200">
              <span>⚠️</span>
              <span>发现 {duplicateCopyIds.length} 个重复副本</span>
            </span>
          )}
          <button
            onClick={() => void handleRefreshTabs()}
            className="text-gray-400 hover:text-blue-600 p-0.5 rounded text-[11px] transition-all cursor-pointer"
            title="重新同步当前所有打开的标签页"
          >
            🔄
          </button>
        </div>
      </div>

      {/* 最大重复源智能推荐卡片 (大重复源前置优先清理) */}
      {duplicateGroups.length > 0 && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/70 p-2 text-[11px] space-y-1.5 animate-in fade-in">
          <div className="flex items-center justify-between text-rose-950 font-semibold">
            <div className="flex items-center gap-1 min-w-0">
              <span>🔥</span>
              <span className="truncate">
                最大重复源:
                {duplicateGroups.slice(0, 2).map((g, i) => (
                  <span key={g.key} className="ml-1 font-bold text-rose-800">
                    {i > 0 && '+ '}「{g.representativeTitle.length > 10 ? `${g.representativeTitle.slice(0, 10)}...` : g.representativeTitle}」{g.totalCount}个
                  </span>
                ))}
              </span>
            </div>
            <span className="text-[10px] text-rose-600 shrink-0 ml-1">
              建议优先清理
            </span>
          </div>

          {/* 快捷勾选芯片按钮 */}
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {duplicateGroups.slice(0, 2).map((g) => {
              const isGroupFullySelected = g.copyIds.every((id: number) => selectedIds.has(id));
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (isGroupFullySelected) {
                        g.copyIds.forEach((id: number) => next.delete(id));
                      } else {
                        g.copyIds.forEach((id: number) => next.add(id));
                      }
                      return next;
                    });
                  }}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium border transition-all cursor-pointer ${
                    isGroupFullySelected
                      ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
                      : 'bg-white text-rose-800 border-rose-200 hover:bg-rose-100'
                  }`}
                  title={`点击${isGroupFullySelected ? '取消' : '一键'}勾选「${g.representativeTitle}」的 ${g.copyCount} 个重复副本`}
                >
                  <span>{isGroupFullySelected ? '✓' : '🧹'}</span>
                  <span>
                    {isGroupFullySelected ? '已选' : '仅选'}「{g.representativeTitle.length > 8 ? `${g.representativeTitle.slice(0, 8)}...` : g.representativeTitle}」
                    <span className="opacity-85 font-mono">({g.copyCount}副本)</span>
                  </span>
                </button>
              );
            })}

            {duplicateGroups.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  const topCopyIds = duplicateGroups.slice(0, 2).flatMap((g) => g.copyIds);
                  const isTopSelected = topCopyIds.every((id: number) => selectedIds.has(id));
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (isTopSelected) {
                      topCopyIds.forEach((id: number) => next.delete(id));
                    } else {
                      topCopyIds.forEach((id: number) => next.add(id));
                    }
                    return next;
                  });
                }}
                className="inline-flex items-center gap-1 rounded bg-rose-100 text-rose-900 border border-rose-300 px-2 py-0.5 text-[10px] font-semibold hover:bg-rose-200 transition-all cursor-pointer"
                title="一键勾选排名前两大重复源的所有副本"
              >
                <span>⚡</span>
                <span>优先清理前两组 ({duplicateGroups.slice(0, 2).reduce((sum, g) => sum + g.copyCount, 0)}副本)</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 快捷操作栏 */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
        <div className="flex items-center gap-1.5">
          {duplicateCopyIds.length > 0 && (
            <button
              onClick={handleSelectDuplicates}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                isAllDuplicatesSelected
                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                  : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
              }`}
            >
              <span>🧹</span>
              <span>{isAllDuplicatesSelected ? '取消全部重复' : `勾选全部重复 (${duplicateCopyIds.length})`}</span>
            </button>
          )}
          <button
            onClick={handleSelectAll}
            className="text-blue-600 hover:underline cursor-pointer"
          >
            全选
          </button>
          <span className="text-gray-300">|</span>
          <button
            onClick={handleClearSelection}
            className="text-gray-500 hover:underline cursor-pointer"
          >
            清空
          </button>
        </div>

        <span className="text-[10px] text-gray-400">
          已勾选 <span className="font-semibold text-blue-600">{selectedIds.size}</span> 项
        </span>
      </div>

      {/* 搜索过滤框 */}
      {tabs.length > 4 && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索网页标题或域名过滤..."
          className="mt-2 w-full rounded border border-gray-200 px-2 py-1 text-[11px] outline-none focus:border-blue-400"
        />
      )}

      {/* 状态通知横幅 */}
      {statusMsg && (
        <div
          className={`mt-2 flex items-center justify-between rounded px-2 py-1 text-[11px] ${
            statusMsg.type === 'success'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <span>{statusMsg.text}</span>
          <button
            onClick={() => setStatusMsg(null)}
            className="text-[10px] text-gray-400 hover:text-gray-700 ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* 网页列表 */}
      <div className="mt-2 max-h-56 overflow-y-auto space-y-1 pr-0.5">
        {displayedTabs.map((t, idx) => {
          const isChecked = selectedIds.has(t.tabId);
          const isDuplicateCopy = duplicateCopyIds.includes(t.tabId);
          const isDuplicateOriginal = duplicateOriginalIds.has(t.tabId);
          const key = getTabFingerprint(t);
          const duplicateTotal = urlCountMap.get(key) || 1;

          let hostname = '';
          try {
            hostname = new URL(t.url).hostname.replace(/^www\./, '');
          } catch {
            hostname = '';
          }

          return (
            <div
              key={t.tabId}
              className={`group flex items-center gap-1.5 rounded px-2 py-1.5 text-[11px] transition-colors border ${
                isDuplicateCopy
                  ? 'border-rose-300 bg-rose-50/90 text-rose-950 font-medium'
                  : isDuplicateOriginal
                  ? 'border-emerald-200 bg-emerald-50/50 text-emerald-950'
                  : isChecked
                  ? 'border-blue-300 bg-blue-50/90 text-blue-900 font-medium'
                  : 'border-gray-100 bg-white hover:bg-gray-50/90 text-gray-700'
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(t.tabId)}
                className={`h-3.5 w-3.5 rounded border-gray-300 focus:ring-0 cursor-pointer shrink-0 ${
                  isDuplicateCopy ? 'accent-rose-600' : 'text-blue-600'
                }`}
              />

              <span className="text-gray-400 font-mono text-[10px] w-4 shrink-0">#{idx + 1}</span>

              {/* 标题 & 跳转 */}
              <div
                onClick={() => void handleActivateTab(t.tabId)}
                className="flex-1 min-w-0 cursor-pointer"
                title={`${t.title}\n${t.url}`}
              >
                <div className="flex items-center gap-1">
                  {t.active && (
                    <span className="rounded bg-green-100 px-1 py-0.2 text-[9px] font-normal text-green-700 shrink-0">
                      当前
                    </span>
                  )}
                  {t.pinned && (
                    <span className="text-[10px] shrink-0" title="固定标签">
                      📌
                    </span>
                  )}
                  <span className="truncate hover:text-blue-600 hover:underline">{t.title}</span>
                </div>
              </div>

              {/* 徽章标记: 重复副本 / 主页面 */}
              {isDuplicateCopy && (
                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700 shrink-0 border border-rose-300 shadow-xs">
                  ⚠️ 重复副本 (建议清理)
                </span>
              )}
              {isDuplicateOriginal && (
                <span
                  className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-800 shrink-0 border border-emerald-300 shadow-xs"
                  title={`共有 ${duplicateTotal} 个重复标签页，此为主标签`}
                >
                  🌟 主标签 (共{duplicateTotal}个，保留)
                </span>
              )}

              {/* 域名标签 */}
              {hostname && (
                <span className="text-[10px] text-gray-400 shrink-0 max-w-[80px] truncate hidden sm:inline">
                  {hostname}
                </span>
              )}

              {/* 单项快速关闭按钮 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleCloseSingleTab(t.tabId);
                }}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 hover:bg-red-50 p-0.5 rounded transition-all text-[11px] shrink-0 cursor-pointer"
                title="立即关闭此标签页"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* 底部操作工具栏 */}
      <div className="mt-3 border-t border-gray-100 pt-2.5 space-y-2">
        <div className="flex items-center gap-1.5">
          {/* 主操作: 批量关闭勾选项 */}
          <button
            disabled={selectedIds.size === 0 || isOperating}
            onClick={() => void handleBatchClose()}
            className="flex-1 flex items-center justify-center gap-1 rounded-md border border-rose-300 bg-rose-600 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-xs hover:bg-rose-700 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            <span>🗑️</span>
            <span>关闭选中 ({selectedIds.size})</span>
          </button>

          {/* 休眠操作 */}
          <button
            disabled={isOperating}
            onClick={() => void handleDiscardTabs()}
            className="flex items-center justify-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer"
            title={selectedIds.size > 0 ? '休眠选中的网页释放内存' : '休眠所有后台非激活网页释放内存'}
          >
            <span>💤</span>
            <span>{selectedIds.size > 0 ? `休眠(${selectedIds.size})` : '一键休眠闲置'}</span>
          </button>

          {/* 工作区快照 */}
          <button
            disabled={isOperating}
            onClick={() => setShowWorkspaceModal((v) => !v)}
            className="flex items-center justify-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer"
            title="将网页保存为命名工作区快照"
          >
            <span>💾</span>
            <span>存快照</span>
          </button>

          {/* 设为分组 */}
          <button
            disabled={selectedIds.size === 0 || isOperating}
            onClick={() => setShowGroupModal((v) => !v)}
            className="flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-100 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            title="将勾选的网页聚合为一个彩色标签组"
          >
            <span>🏷️</span>
            <span>建组</span>
          </button>

          {/* 独立新窗口 */}
          {selectedIds.size > 0 && (
            <button
              disabled={isOperating}
              onClick={() => void handleMoveToNewWindow()}
              className="flex items-center justify-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] font-medium text-sky-700 hover:bg-sky-100 active:scale-[0.98] transition-all cursor-pointer"
              title="将勾选网页分离至新窗口"
            >
              <span>🪟</span>
              <span>分流</span>
            </button>
          )}
        </div>

        {/* 保存工作区内嵌表单 */}
        {showWorkspaceModal && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2 text-[11px] space-y-2 animate-in fade-in">
            <div className="flex items-center justify-between font-medium text-emerald-900">
              <span>保存 {selectedIds.size > 0 ? selectedIds.size : tabs.length} 个网页为工作区快照:</span>
              <button
                onClick={() => setShowWorkspaceModal(false)}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="工作区名称 (如「技术调研」「电商比价」)"
                className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] outline-none focus:border-emerald-500"
                autoFocus
              />
              <button
                disabled={!workspaceName.trim() || isOperating}
                onClick={() => void handleSaveWorkspace()}
                className="rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-40 cursor-pointer"
              >
                保存
              </button>
            </div>
            <label className="flex items-center gap-1.5 text-[10px] text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={closeAfterSave}
                onChange={(e) => setCloseAfterSave(e.target.checked)}
                className="rounded text-emerald-600 focus:ring-0 cursor-pointer"
              />
              <span>保存成功后自动关闭这些网页(释放视口空间)</span>
            </label>
          </div>
        )}

        {/* 建组内嵌表单 */}
        {showGroupModal && (
          <div className="rounded-md border border-blue-200 bg-blue-50/50 p-2 text-[11px] space-y-2 animate-in fade-in">
            <div className="flex items-center justify-between font-medium text-blue-900">
              <span>为选中的 {selectedIds.size} 个标签页设置分组:</span>
              <button
                onClick={() => setShowGroupModal(false)}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="分组名称 (如 💻 开发、📖 研报)"
                className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] outline-none focus:border-blue-500"
                autoFocus
              />
              <button
                disabled={!groupTitle.trim() || isOperating}
                onClick={() => void handleCreateGroup()}
                className="rounded bg-blue-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40 cursor-pointer"
              >
                确认
              </button>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-gray-500 text-[10px]">颜色:</span>
              {TAB_GROUP_COLORS.map((c) => (
                <button
                  key={c.name}
                  onClick={() => setGroupColor(c.name)}
                  className={`h-4 w-4 rounded-full ${c.bg} ${
                    groupColor === c.name ? 'ring-2 ring-blue-500 ring-offset-1 scale-110' : 'opacity-70 hover:opacity-100'
                  } transition-all cursor-pointer`}
                  title={c.label}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
