// 工作区快照管理相关后台工具实现
import type { ToolCall, ToolResult } from '@/utils/domTools/types';

const WORKSPACE_KEY = 'workspaces_store';

export async function executeWorkspaceTool(call: ToolCall): Promise<ToolResult | null> {
  // 1. saveWorkspace 保存项目工作区快照
  if (call.name === 'saveWorkspace') {
    try {
      const name = String(call.args?.name ?? '').trim();
      if (!name) return { ok: false, error: '请提供工作区名称' };
      const targetTabIds = (call.args?.tabIds as number[]) || [];
      const closeAfterSave = Boolean(call.args?.closeAfterSave);

      const allWindowTabs = await browser.tabs.query({ currentWindow: true });
      const selectedTabs = targetTabIds.length > 0
        ? allWindowTabs.filter((t) => targetTabIds.includes(t.id!))
        : allWindowTabs.filter((t) => t.url && !t.url.startsWith('chrome-extension://'));

      const chromeGlobal = (globalThis as any).chrome;
      const groupMap = new Map<number, { title?: string; color?: string }>();
      if (typeof chromeGlobal?.tabGroups?.get === 'function') {
        for (const t of selectedTabs) {
          const gid = (t as any).groupId;
          if (gid != null && gid > -1 && !groupMap.has(gid)) {
            try {
              const gInfo = await chromeGlobal.tabGroups.get(gid);
              if (gInfo) groupMap.set(gid, { title: gInfo.title, color: gInfo.color });
            } catch {
              /* ignore */
            }
          }
        }
      }

      const snapshotTabs = selectedTabs.map((t) => {
        const gid = (t as any).groupId;
        const gInfo = gid != null && gid > -1 ? groupMap.get(gid) : undefined;
        return {
          title: t.title || '未命名标签',
          url: t.url!,
          pinned: t.pinned ?? false,
          groupTitle: gInfo?.title,
          groupColor: gInfo?.color,
        };
      });

      const storageRes = (await browser.storage.local.get(WORKSPACE_KEY)) as { [WORKSPACE_KEY]?: Record<string, any> };
      const store = storageRes[WORKSPACE_KEY] || {};

      const wsId = `ws_${Date.now()}`;
      store[wsId] = {
        id: wsId,
        name,
        createdAt: Date.now(),
        tabs: snapshotTabs,
      };

      await browser.storage.local.set({ [WORKSPACE_KEY]: store });

      if (closeAfterSave && selectedTabs.length > 0) {
        const toClose = selectedTabs.map((t) => t.id!).filter(Boolean);
        await browser.tabs.remove(toClose);
      }

      return {
        ok: true,
        data: {
          workspaceId: wsId,
          name,
          tabCount: snapshotTabs.length,
          closedAfterSave: closeAfterSave,
          note: `💾 已成功将 ${snapshotTabs.length} 个标签页保存为工作区快照「${name}」！`,
        },
      };
    } catch (err) {
      return { ok: false, error: `保存工作区失败: ${(err as Error).message}` };
    }
  }

  // 2. listWorkspaces 获取已保存工作区快照
  if (call.name === 'listWorkspaces') {
    try {
      const storageRes = (await browser.storage.local.get(WORKSPACE_KEY)) as { [WORKSPACE_KEY]?: Record<string, any> };
      const store = storageRes[WORKSPACE_KEY] || {};
      const list = Object.values(store).map((ws: any) => ({
        id: ws.id,
        name: ws.name,
        createdAt: new Date(ws.createdAt).toLocaleString('zh-CN'),
        tabCount: Array.isArray(ws.tabs) ? ws.tabs.length : 0,
        tabsPreview: Array.isArray(ws.tabs)
          ? ws.tabs.slice(0, 5).map((t: any) => `[${t.title}](${t.url})`).join('、') + (ws.tabs.length > 5 ? '…' : '')
          : '',
      }));
      return {
        ok: true,
        data: {
          count: list.length,
          workspaces: list,
          note: `已获取 ${list.length} 个项目工作区快照`,
        },
      };
    } catch (err) {
      return { ok: false, error: `获取工作区列表失败: ${(err as Error).message}` };
    }
  }

  // 3. restoreWorkspace 还原工作区快照
  if (call.name === 'restoreWorkspace') {
    try {
      const nameOrId = String(call.args?.nameOrId ?? '').trim().toLowerCase();
      const inNewWindow = Boolean(call.args?.inNewWindow);
      if (!nameOrId) return { ok: false, error: '请指定要还原的工作区名称或 ID' };

      const storageRes = (await browser.storage.local.get(WORKSPACE_KEY)) as { [WORKSPACE_KEY]?: Record<string, any> };
      const store = storageRes[WORKSPACE_KEY] || {};
      const targetWs = Object.values(store).find(
        (ws: any) => ws.id === nameOrId || String(ws.name).toLowerCase().includes(nameOrId),
      ) as any;

      if (!targetWs || !Array.isArray(targetWs.tabs) || targetWs.tabs.length === 0) {
        return { ok: false, error: `未找到名为「${nameOrId}」的工作区快照或该工作区无可用网页` };
      }

      let windowId: number | undefined;
      const createdTabIds: number[] = [];
      const groupMap = new Map<string, number[]>(); // groupTitle -> tabIds

      for (let i = 0; i < targetWs.tabs.length; i++) {
        const item = targetWs.tabs[i];
        if (inNewWindow && i === 0) {
          const win = await browser.windows.create({ url: item.url });
          windowId = win?.id;
          if (win?.tabs?.[0]?.id) createdTabIds.push(win.tabs[0].id);
        } else {
          const tab = await browser.tabs.create({
            url: item.url,
            windowId,
            pinned: Boolean(item.pinned),
            active: i === 0,
          });
          if (tab.id) createdTabIds.push(tab.id);
        }

        if (item.groupTitle && createdTabIds.length > 0) {
          const lastId = createdTabIds[createdTabIds.length - 1]!;
          const arr = groupMap.get(item.groupTitle) || [];
          arr.push(lastId);
          groupMap.set(item.groupTitle, arr);
        }
      }

      // 还原标签组
      const chromeGlobal = (globalThis as any).chrome;
      if (typeof chromeGlobal?.tabs?.group === 'function') {
        for (const [gTitle, tIds] of groupMap.entries()) {
          try {
            const gid = await chromeGlobal.tabs.group({ tabIds: tIds });
            if (gid != null && typeof chromeGlobal?.tabGroups?.update === 'function') {
              const refItem = targetWs.tabs.find((t: any) => t.groupTitle === gTitle);
              await chromeGlobal.tabGroups.update(gid, {
                title: gTitle,
                color: refItem?.groupColor || 'blue',
              });
            }
          } catch {
            /* 忽略分组失败 */
          }
        }
      }

      return {
        ok: true,
        data: {
          name: targetWs.name,
          restoredCount: targetWs.tabs.length,
          inNewWindow,
          note: `🎉 已成功恢复工作区「${targetWs.name}」中的 ${targetWs.tabs.length} 个网页！`,
        },
      };
    } catch (err) {
      return { ok: false, error: `还原工作区失败: ${(err as Error).message}` };
    }
  }

  // 4. deleteWorkspace 删除工作区快照
  if (call.name === 'deleteWorkspace') {
    try {
      const nameOrId = String(call.args?.nameOrId ?? '').trim().toLowerCase();
      if (!nameOrId) return { ok: false, error: '请指定要删除的工作区名称或 ID' };
      const storageRes = (await browser.storage.local.get(WORKSPACE_KEY)) as { [WORKSPACE_KEY]?: Record<string, any> };
      const store = storageRes[WORKSPACE_KEY] || {};
      const targetKey = Object.keys(store).find(
        (k) => k === nameOrId || String(store[k]?.name).toLowerCase() === nameOrId,
      );
      if (!targetKey) {
        return { ok: false, error: `未找到要删除的工作区「${nameOrId}」` };
      }
      const wsName = store[targetKey]?.name || nameOrId;
      delete store[targetKey];
      await browser.storage.local.set({ [WORKSPACE_KEY]: store });
      return {
        ok: true,
        data: { name: wsName, note: `🗑️ 已成功删除工作区「${wsName}」` },
      };
    } catch (err) {
      return { ok: false, error: `删除工作区失败: ${(err as Error).message}` };
    }
  }

  return null;
}
