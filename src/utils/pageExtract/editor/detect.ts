// 通用文档编辑器检测与元数据提取(原飞书专用,已通用化)
// 从任意富文本编辑器页面(contenteditable/role=textbox 大区域)识别是否可提取文档。

/** 从 URL 提取文档 ID(如 /docs/ABC123、/wiki/abc123) */
export function extractDocId(url: string): string {
  const m = url.match(/\/(?:docs|docx|wiki|edit|document|doc)\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? '';
}

/** 判断是否"文档级"富文本编辑器(纯函数,便于单测)。阈值:最大可编辑区域 50 字以上 */
export function isEditableEditorTexts(texts: readonly string[]): boolean {
  let max = 0;
  for (const t of texts) {
    const len = (t ?? '').trim().length;
    if (len > max) max = len;
  }
  return max >= 50;
}

/** 页面是否包含富文本可编辑区域(编辑器特征) */
export function isEditableEditor(doc: Document): boolean {
  const els = Array.from(
    doc.querySelectorAll<HTMLElement>('[contenteditable="true"], [role="textbox"]'),
  );
  return isEditableEditorTexts(els.map((el) => el.innerText ?? ''));
}
