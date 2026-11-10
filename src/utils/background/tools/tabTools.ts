// 标签页管理相关后台工具实现
import type { ToolCall, ToolResult } from '@/utils/domTools/types';

/** 执行标签页导航，并在导航后等待新页面加载 */
export async function doNavigate(tabId: number, url: string): Promise<ToolResult> {
  try {
    await browser.tabs.update(tabId, { url });
    // 等待新文档加载完成(content script 随导航自动注入)
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const tab = await browser.tabs.get(tabId);
      if (tab.status === 'complete') return { ok: true, data: { url } };
      await new Promise((r) => setTimeout(r, 300));
    }
    return { ok: true, data: { url, note: '导航已发起(加载超时,请稍候继续操作)' } };
  } catch (err) {
    return { ok: false, error: `导航失败:${(err as Error).message}` };
  }
}

export async function executeTabTool(call: ToolCall, defaultTabId: number): Promise<ToolResult | null> {
  // 1. listTabs 由 background 查询浏览器标签页
  if (call.name === 'listTabs') {
    try {
      const currentWindow = call.args?.currentWindow !== false;
      const queryInfo: Record<string, unknown> = currentWindow ? { currentWindow: true } : {};
      const tabs = await browser.tabs.query(queryInfo);
      const groupsMap = new Map<number, { title: string; color: string }>();
      const chromeGlobal = (globalThis as any).chrome;
      if (typeof chromeGlobal?.tabGroups?.query === 'function') {
        try {
          const groups = await chromeGlobal.tabGroups.query(queryInfo);
          for (const g of groups) {
            if (g.id != null) groupsMap.set(g.id, { title: g.title || '', color: g.color || 'blue' });
          }
        } catch {
          /* 忽略 tabGroups 查询异常 */
        }
      }
      const validTabs = tabs
        .filter((t) => t.id != null && t.url && /^https?:\/\//i.test(t.url))
        .map((t) => {
          const gid = (t as any).groupId;
          const gInfo = gid != null && gid > -1 ? groupsMap.get(gid) : undefined;
          return {
            tabId: t.id!,
            title: t.title ?? '未命名标签',
            url: t.url!,
            active: t.active ?? false,
            pinned: t.pinned ?? false,
            groupId: gid != null && gid > -1 ? gid : undefined,
            groupTitle: gInfo?.title || undefined,
            groupColor: gInfo?.color || undefined,
          };
        });
      return {
        ok: true,
        data: {
          count: validTabs.length,
          tabs: validTabs,
        },
      };
    } catch (err) {
      return { ok: false, error: `获取标签页列表失败:${(err as Error).message}` };
    }
  }

  // 2. groupTabs 标签页自动分组
  if (call.name === 'groupTabs') {
    try {
      const tabIds = (call.args?.tabIds as number[]) || [];
      const title = String(call.args?.title ?? '').trim();
      const color = (call.args?.color as any) || 'blue';
      const collapsed = Boolean(call.args?.collapsed);
      if (tabIds.length === 0) {
        return { ok: false, error: '未指定要分组的标签页 tabIds' };
      }
      let groupId: number | undefined;
      const chromeGlobal = (globalThis as any).chrome;
      if (typeof chromeGlobal?.tabs?.group === 'function') {
        groupId = await chromeGlobal.tabs.group({ tabIds });
        if (groupId != null && typeof chromeGlobal?.tabGroups?.update === 'function') {
          await chromeGlobal.tabGroups.update(groupId, {
            title,
            color,
            collapsed,
          });
        }
      } else if (typeof (browser.tabs as any)?.group === 'function') {
        groupId = await (browser.tabs as any).group({ tabIds });
      }
      return {
        ok: true,
        data: {
          groupId,
          title,
          color,
          tabCount: tabIds.length,
          note: `🎉 已成功将 ${tabIds.length} 个标签页归入「${title}」分组！`,
        },
      };
    } catch (err) {
      return { ok: false, error: `标签页分组失败: ${(err as Error).message}` };
    }
  }

  // 3. closeTabs 批量关闭标签页
  if (call.name === 'closeTabs') {
    try {
      const rawTabIds = (call.args?.tabIds as number[]) || [];
      const tabIds = rawTabIds.map((id) => Number(id)).filter((id) => !isNaN(id) && id > 0);
      if (tabIds.length === 0) {
        return { ok: false, error: '未指定要关闭的标签页 tabIds' };
      }
      let closedCount = 0;
      const closedTabIds: number[] = [];
      for (const tid of tabIds) {
        try {
          await browser.tabs.remove(tid);
          closedCount++;
          closedTabIds.push(tid);
        } catch {
          // 忽略已关闭或不存在的标签页
        }
      }
      return {
        ok: true,
        data: {
          closedCount,
          closedTabIds,
          note: `🗑️ 已成功关闭 ${closedCount} 个标签页，释放系统内存`,
        },
      };
    } catch (err) {
      return { ok: false, error: `关闭标签页失败: ${(err as Error).message}` };
    }
  }

  // 4. activateTab 聚焦激活标签页
  if (call.name === 'activateTab') {
    try {
      const tabId = Number(call.args?.tabId);
      if (!tabId) return { ok: false, error: '未指定目标 tabId' };
      const tab = await browser.tabs.get(tabId);
      await browser.tabs.update(tabId, { active: true });
      if (tab.windowId != null) {
        await browser.windows.update(tab.windowId, { focused: true });
      }
      return {
        ok: true,
        data: { tabId, title: tab.title, url: tab.url, note: `🎯 已切换至标签页: ${tab.title}` },
      };
    } catch (err) {
      return { ok: false, error: `切换标签页失败: ${(err as Error).message}` };
    }
  }

  // 5. discardTabs 休眠闲置标签页释放内存
  if (call.name === 'discardTabs') {
    try {
      let targetTabIds = (call.args?.tabIds as number[]) || [];
      if (targetTabIds.length === 0) {
        const allTabs = await browser.tabs.query({ currentWindow: true, active: false });
        targetTabIds = allTabs.map((t) => t.id!).filter(Boolean);
      }
      const discardedList: Array<{ id: number; title: string; url: string }> = [];
      const chromeGlobal = (globalThis as any).chrome;
      for (const tid of targetTabIds) {
        try {
          const tab = await browser.tabs.get(tid);
          if (typeof chromeGlobal?.tabs?.discard === 'function') {
            await chromeGlobal.tabs.discard(tid);
          } else if (typeof (browser.tabs as any)?.discard === 'function') {
            await (browser.tabs as any).discard(tid);
          }
          discardedList.push({ id: tid, title: tab.title || '标签页', url: tab.url || '' });
        } catch {
          /* 忽略单个 tab 休眠失败 */
        }
      }
      return {
        ok: true,
        data: {
          discardedCount: discardedList.length,
          discardedTabs: discardedList,
          note: `💤 已成功休眠 ${discardedList.length} 个闲置标签页，释放系统内存`,
        },
      };
    } catch (err) {
      return { ok: false, error: `休眠标签页失败: ${(err as Error).message}` };
    }
  }

  // 6. moveTabsToNewWindow 移动标签页至新窗口
  if (call.name === 'moveTabsToNewWindow') {
    try {
      const tabIds = (call.args?.tabIds as number[]) || [];
      const focused = call.args?.focused !== false;
      if (tabIds.length === 0) return { ok: false, error: '未指定要移出的 tabIds' };
      const [first, ...rest] = tabIds;
      const win = await browser.windows.create({ tabId: first, focused });
      const winId = win?.id;
      if (rest.length > 0 && winId != null) {
        await browser.tabs.move(rest, { windowId: winId, index: -1 });
      }
      return {
        ok: true,
        data: {
          movedCount: tabIds.length,
          windowId: winId,
          note: `🪟 已将 ${tabIds.length} 个标签页分离至新窗口`,
        },
      };
    } catch (err) {
      return { ok: false, error: `移动标签页至新窗口失败: ${(err as Error).message}` };
    }
  }

  // 7. setTabZoom 设置页面缩放比例
  if (call.name === 'setTabZoom') {
    try {
      const targetTabId = Number(call.args?.tabId) || defaultTabId;
      const zoomFactor = Number(call.args?.zoomFactor) || 1.0;
      await browser.tabs.setZoom(targetTabId, zoomFactor);
      return {
        ok: true,
        data: {
          tabId: targetTabId,
          zoomFactor,
          percentage: `${Math.round(zoomFactor * 100)}%`,
          note: `🔍 已将页面缩放调整为 ${Math.round(zoomFactor * 100)}%`,
        },
      };
    } catch (err) {
      return { ok: false, error: `设置缩放失败: ${(err as Error).message}` };
    }
  }

  return null;
}
