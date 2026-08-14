import { describe, expect, it } from 'vitest';
import { isEditableEditorTexts, extractDocId } from '../src/utils/pageExtract/editor/detect';

describe('editor detect(通用编辑器检测)', () => {
  it('存在大文本 contenteditable 区域时判定为文档编辑器(纯函数)', () => {
    expect(isEditableEditorTexts([])).toBe(false);
    expect(isEditableEditorTexts(['短'])).toBe(false);
    expect(isEditableEditorTexts(['短', 'x'.repeat(200)])).toBe(true);
  });

  it('提取文档 ID(兼容 docs/docx/wiki/edit 等路径,含 _ 与 -)', () => {
    expect(extractDocId('https://example.com/docs/AbC123?from=search')).toBe('AbC123');
    expect(extractDocId('https://example.com/wiki/wikid')).toBe('wikid');
    expect(extractDocId('https://example.com/edit/abc_1')).toBe('abc_1');
    expect(extractDocId('https://example.com/edit/abc-1')).toBe('abc-1');
    expect(extractDocId('https://example.com/')).toBe('');
  });
});
