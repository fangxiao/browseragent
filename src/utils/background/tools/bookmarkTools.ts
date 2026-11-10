// 书签管理相关后台工具实现
import type { ToolCall, ToolResult } from '@/utils/domTools/types';

export async function executeBookmarkTool(call: ToolCall): Promise<ToolResult | null> {
  // 1. getBookmarksTree 读取书签树
  if (call.name === 'getBookmarksTree') {
    try {
      const parentId = call.args?.parentId ? String(call.args.parentId) : undefined;
      const maxDepth = Number(call.args?.maxDepth) || 4;
      let rawTree: any[] = [];
      if (parentId) {
        rawTree = await browser.bookmarks.getSubTree(parentId);
      } else {
        rawTree = await browser.bookmarks.getTree();
      }
      const simplifyNode = (node: any, depth: number): any => {
        if (!node) return null;
        const isFolder = !node.url && (Array.isArray(node.children) || node.childrenCount != null);
        const res: any = {
          id: node.id,
          title: node.title || (isFolder ? '未命名文件夹' : '未命名书签'),
        };
        if (node.url) res.url = node.url;
        if (node.dateAdded) res.dateAdded = new Date(node.dateAdded).toISOString().split('T')[0];
        if (isFolder && depth < maxDepth && Array.isArray(node.children)) {
          res.children = node.children
            .map((c: any) => simplifyNode(c, depth + 1))
            .filter(Boolean);
        } else if (isFolder && Array.isArray(node.children)) {
          res.itemCount = node.children.length;
        }
        return res;
      };
      const tree = rawTree.map((r) => simplifyNode(r, 1)).filter(Boolean);
      return {
        ok: true,
        data: {
          tree,
          note: '获取书签树成功',
        },
      };
    } catch (err) {
      return { ok: false, error: `获取书签树失败: ${(err as Error).message}` };
    }
  }

  // 2. searchBookmarks 关键词搜索书签
  if (call.name === 'searchBookmarks') {
    try {
      const query = String(call.args?.query ?? '').trim();
      if (!query) return { ok: false, error: '未指定搜索关键词 query' };
      const items = await browser.bookmarks.search(query);
      const results = items.slice(0, 30).map((b) => ({
        id: b.id,
        title: b.title,
        url: b.url,
        isFolder: !b.url,
        parentId: b.parentId,
      }));
      return {
        ok: true,
        data: {
          totalCount: items.length,
          results,
        },
      };
    } catch (err) {
      return { ok: false, error: `搜索书签失败: ${(err as Error).message}` };
    }
  }

  // 3. createBookmark 创建书签/文件夹
  if (call.name === 'createBookmark') {
    try {
      const title = String(call.args?.title ?? '').trim();
      const url = call.args?.url ? String(call.args.url).trim() : undefined;
      const parentId = call.args?.parentId ? String(call.args.parentId).trim() : undefined;
      const index = call.args?.index != null ? Number(call.args.index) : undefined;
      if (!title) return { ok: false, error: '未指定书签标题 title' };
      const created = await browser.bookmarks.create({
        title,
        url,
        parentId,
        index,
      });
      return {
        ok: true,
        data: {
          id: created.id,
          title: created.title,
          url: created.url,
          parentId: created.parentId,
          isFolder: !created.url,
          note: created.url ? `🔖 已成功创建书签: ${title}` : `📁 已成功创建书签文件夹: ${title}`,
        },
      };
    } catch (err) {
      return { ok: false, error: `创建书签失败: ${(err as Error).message}` };
    }
  }

  // 4. moveBookmark 移动/重命名书签
  if (call.name === 'moveBookmark') {
    try {
      const id = String(call.args?.id ?? '').trim();
      const parentId = call.args?.parentId ? String(call.args.parentId).trim() : undefined;
      const index = call.args?.index != null ? Number(call.args.index) : undefined;
      const title = call.args?.title ? String(call.args.title).trim() : undefined;
      if (!id) return { ok: false, error: '未指定书签 id' };
      if (parentId != null || index != null) {
        await browser.bookmarks.move(id, { parentId, index });
      }
      if (title) {
        await browser.bookmarks.update(id, { title });
      }
      return {
        ok: true,
        data: { id, parentId, title, note: `✨ 已成功更新/移动书签 ID: ${id}` },
      };
    } catch (err) {
      return { ok: false, error: `移动/修改书签失败: ${(err as Error).message}` };
    }
  }

  // 5. removeBookmark 删除书签/文件夹
  if (call.name === 'removeBookmark') {
    try {
      const id = String(call.args?.id ?? '').trim();
      const isFolder = Boolean(call.args?.isFolder);
      if (!id) return { ok: false, error: '未指定要删除的书签 id' };
      if (isFolder && typeof browser.bookmarks.removeTree === 'function') {
        await browser.bookmarks.removeTree(id);
      } else {
        await browser.bookmarks.remove(id);
      }
      return {
        ok: true,
        data: { id, isFolder, note: `🗑️ 已成功删除书签${isFolder ? '文件夹' : ''} (ID: ${id})` },
      };
    } catch (err) {
      return { ok: false, error: `删除书签失败: ${(err as Error).message}` };
    }
  }

  return null;
}
