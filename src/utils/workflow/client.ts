// 流程自动化与工作流客户端通信工具:处理 Content Script 动态注入、系统页面拦截与重试机制
export async function sendWorkflowMessageToTab(
  tabId: number,
  message: { type: string; [key: string]: any },
): Promise<any> {
  let tabUrl = '';
  try {
    if (typeof browser !== 'undefined' && browser.tabs?.get) {
      const tab = await browser.tabs.get(tabId);
      tabUrl = tab?.url || '';
    }
  } catch {
    /* ignore */
  }

  // 1. 拦截浏览器受限页面
  if (/^(chrome|edge|about|chrome-extension):/i.test(tabUrl) || /chromewebstore|addons\.mozilla/i.test(tabUrl)) {
    throw new Error(`无法在浏览器系统内部页面 (${tabUrl || '内部页面'}) 操作，请切换到目标业务网页后再试`);
  }

  // 2. 带自愈重试与动态注入的消息发送循环 (自适应页面跳转、通道中断与脚本重载)
  let lastError: Error | null = null;
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await browser.tabs.sendMessage(tabId, message);
    } catch (err) {
      lastError = err as Error;
      const errMsg = lastError?.message || '';
      const isConnErr =
        /Receiving end does not exist|Could not establish connection|Cannot access contents|message channel closed|asynchronous response|closed before a response was received|frame was removed|tab was closed/i.test(
          errMsg,
        );

      // 如果不是连接/通道中断类错误且不是第 1 次，直接抛出
      if (!isConnErr && attempt > 1) {
        throw err;
      }

      // 在页面跳转或新页面加载中，等待标签页稳定并尝试注入 Content Script
      try {
        if (typeof browser !== 'undefined') {
          if (browser.tabs?.get) {
            const tab = await browser.tabs.get(tabId);
            if (tab?.status === 'loading') {
              await new Promise((r) => setTimeout(r, 450));
            }
          }
          if (browser.scripting?.executeScript) {
            await browser.scripting.executeScript({
              target: { tabId },
              files: ['/content-scripts/content.js' as any],
            });
          }
        }
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }

  throw lastError || new Error('当前页面尚未加载助手脚本，请按 F5 刷新网页后再试');
}
