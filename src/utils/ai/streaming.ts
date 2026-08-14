// 通用 SSE 行解析器:将 fetch Response body 按 data: 行切分产出
export async function* readSSEStream(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (!res.body) throw new Error('响应无 body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}
