// 历史记录、误关标签恢复、浏览数据清理、下载记录相关工具实现
import type { ToolCall, ToolResult } from '@/utils/domTools/types';

export async function executeHistoryAndDataTool(call: ToolCall): Promise<ToolResult | null> {
  // 1. searchHistory 模糊检索历史记录
  if (call.name === 'searchHistory') {
    try {
      const text = call.args?.text ? String(call.args.text).trim() : '';
      const startTime = call.args?.startTime != null ? Number(call.args.startTime) : Date.now() - 7 * 86400 * 1000;
      const endTime = call.args?.endTime != null ? Number(call.args.endTime) : undefined;
      const maxResults = Math.min(Number(call.args?.maxResults) || 25, 100);
      const items = await browser.history.search({
        text,
        startTime,
        endTime,
        maxResults,
      });
      const historyList = items.map((h) => ({
        id: h.id,
        title: h.title || '未命名网页',
        url: h.url || '',
        visitCount: h.visitCount || 1,
        lastVisitTime: h.lastVisitTime ? new Date(h.lastVisitTime).toLocaleString('zh-CN') : '',
      }));
      return {
        ok: true,
        data: {
          count: historyList.length,
          history: historyList,
          query: text || '最近全部',
        },
      };
    } catch (err) {
      return { ok: false, error: `检索历史记录失败: ${(err as Error).message}` };
    }
  }

  // 2. getRecentlyClosedTabs 获取最近关闭的标签页
  if (call.name === 'getRecentlyClosedTabs') {
    try {
      const maxResults = Math.min(Number(call.args?.maxResults) || 15, 25);
      let sessionsList: any[] = [];
      const chromeGlobal = (globalThis as any).chrome;
      if (typeof chromeGlobal?.sessions?.getRecentlyClosed === 'function') {
        sessionsList = await chromeGlobal.sessions.getRecentlyClosed({ maxResults });
      } else if (typeof (browser as any)?.sessions?.getRecentlyClosed === 'function') {
        sessionsList = await (browser as any).sessions.getRecentlyClosed({ maxResults });
      }
      const closedTabs: any[] = [];
      for (const s of sessionsList) {
        if (s.tab) {
          closedTabs.push({
            sessionId: s.tab.sessionId,
            title: s.tab.title || '未命名网页',
            url: s.tab.url || '',
            lastModified: s.lastModified ? new Date(s.lastModified * 1000).toLocaleTimeString('zh-CN') : '',
          });
        } else if (s.window && Array.isArray(s.window.tabs)) {
          for (const wt of s.window.tabs) {
            closedTabs.push({
              sessionId: wt.sessionId,
              title: wt.title || '未命名网页',
              url: wt.url || '',
              windowId: s.window.sessionId,
              lastModified: s.lastModified ? new Date(s.lastModified * 1000).toLocaleTimeString('zh-CN') : '',
            });
          }
        }
      }
      return {
        ok: true,
        data: {
          count: closedTabs.length,
          closedTabs,
          note: `已找到 ${closedTabs.length} 个最近关闭的网页`,
        },
      };
    } catch (err) {
      return { ok: false, error: `获取最近关闭网页失败: ${(err as Error).message}` };
    }
  }

  // 3. restoreClosedTab 重新秒级唤醒打开误关网页
  if (call.name === 'restoreClosedTab') {
    try {
      const sessionId = call.args?.sessionId ? String(call.args.sessionId) : undefined;
      const chromeGlobal = (globalThis as any).chrome;
      let restoredSession: any;
      if (typeof chromeGlobal?.sessions?.restore === 'function') {
        restoredSession = await chromeGlobal.sessions.restore(sessionId);
      } else if (typeof (browser as any)?.sessions?.restore === 'function') {
        restoredSession = await (browser as any).sessions.restore(sessionId);
      }
      const title = restoredSession?.tab?.title || '目标网页';
      return {
        ok: true,
        data: {
          title,
          note: `🔄 已成功找回并重新打开网页: ${title}`,
        },
      };
    } catch (err) {
      return { ok: false, error: `恢复网页失败: ${(err as Error).message}` };
    }
  }

  // 4. clearBrowsingData 精细化定向清理缓存/Cookie
  if (call.name === 'clearBrowsingData') {
    try {
      const origins = Array.isArray(call.args?.origins) ? (call.args.origins as string[]) : undefined;
      const dataTypes = Array.isArray(call.args?.dataTypes) ? (call.args.dataTypes as string[]) : ['cache', 'cookies'];
      const since = Number(call.args?.timeSince) || 0;

      const dataRemoval: Record<string, boolean> = {};
      for (const t of dataTypes) {
        if (t === 'cache') dataRemoval.cache = true;
        if (t === 'cookies') dataRemoval.cookies = true;
        if (t === 'localStorage') dataRemoval.localStorage = true;
        if (t === 'history') dataRemoval.history = true;
      }
      if (Object.keys(dataRemoval).length === 0) {
        dataRemoval.cache = true;
        dataRemoval.cookies = true;
      }

      const chromeGlobal = (globalThis as any).chrome;
      if (origins && origins.length > 0) {
        if (typeof chromeGlobal?.browsingData?.remove === 'function') {
          await chromeGlobal.browsingData.remove({ origins, since }, dataRemoval);
        } else if (typeof (browser as any)?.browsingData?.remove === 'function') {
          await (browser as any).browsingData.remove({ origins, since }, dataRemoval);
        }
      } else {
        if (typeof chromeGlobal?.browsingData?.remove === 'function') {
          await chromeGlobal.browsingData.remove({ since }, dataRemoval);
        } else if (typeof (browser as any)?.browsingData?.remove === 'function') {
          await (browser as any).browsingData.remove({ since }, dataRemoval);
        }
      }

      return {
        ok: true,
        data: {
          clearedTypes: Object.keys(dataRemoval),
          origins: origins || ['全局'],
          note: `🧹 已成功清理 ${origins ? origins.join(', ') : '全局'} 的 ${Object.keys(dataRemoval).join('/')} 数据`,
        },
      };
    } catch (err) {
      return { ok: false, error: `清理浏览数据失败: ${(err as Error).message}` };
    }
  }

  // 5. searchDownloads 检索下载历史
  if (call.name === 'searchDownloads') {
    try {
      const query = call.args?.query ? String(call.args.query).trim() : undefined;
      const mime = call.args?.mimeType ? String(call.args.mimeType).trim() : undefined;
      const limit = Math.min(Number(call.args?.limit) || 20, 50);

      const chromeGlobal = (globalThis as any).chrome;
      let rawItems: any[] = [];
      if (typeof chromeGlobal?.downloads?.search === 'function') {
        rawItems = await chromeGlobal.downloads.search({ query: query ? [query] : undefined, mime, limit });
      } else if (typeof (browser as any)?.downloads?.search === 'function') {
        rawItems = await (browser as any).downloads.search({ query: query ? [query] : undefined, mime, limit });
      }

      const downloadList = rawItems.map((item) => ({
        id: item.id,
        filename: item.filename ? item.filename.split('/').pop() : '未命名文件',
        fullPath: item.filename || '',
        url: item.url || '',
        fileSize: item.fileSize ? `${(item.fileSize / 1024 / 1024).toFixed(2)} MB` : '未知大小',
        state: item.state || 'complete',
        endTime: item.endTime ? new Date(item.endTime).toLocaleString('zh-CN') : '',
      }));

      return {
        ok: true,
        data: {
          count: downloadList.length,
          downloads: downloadList,
          query: query || '全部文件',
          note: `已检索到 ${downloadList.length} 条下载记录`,
        },
      };
    } catch (err) {
      return { ok: false, error: `检索下载记录失败: ${(err as Error).message}` };
    }
  }

  return null;
}
