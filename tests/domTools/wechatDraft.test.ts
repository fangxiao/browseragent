import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { actions } from '../../src/utils/domTools/actions';

describe('writeWechatDraft (严格 DOM 校验与自动保存草稿)', () => {
  const originalDocument = (globalThis as any).document;
  const originalEvent = (globalThis as any).Event;

  beforeEach(() => {
    (globalThis as any).Event = class {
      constructor(public type: string, public options?: any) {}
    };
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
    (globalThis as any).Event = originalEvent;
  });

  it('当未定位到标题或正文编辑框时，必须返回 ok: false 与友好提示', async () => {
    // 模拟非图文编辑页面 (没有 #title 和 editorBody)
    (globalThis as any).document = {
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    const res = await actions.writeWechatDraft({
      title: '测试标题',
      htmlContent: '<p>正文内容</p>',
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('未检测到微信图文编辑框，请确保当前浏览器停留在【新建图文】草稿编辑页面');
  });

  it('当仅有标题但没有正文容器时，也必须返回 ok: false', async () => {
    const mockTitleEl = {
      value: '',
      dispatchEvent: vi.fn(),
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => {
        if (sel.includes('#title')) return mockTitleEl;
        return null;
      },
      querySelectorAll: () => [],
    };

    const res = await actions.writeWechatDraft({
      title: '测试标题',
      htmlContent: '<p>正文内容</p>',
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('未检测到微信图文编辑框，请确保当前浏览器停留在【新建图文】草稿编辑页面');
  });

  it('当标题与正文容器都存在时，成功注入并自动触发保存按钮点击', async () => {
    let saveClicked = false;

    const mockTitleEl: any = {
      value: '',
      dispatchEvent: vi.fn(),
    };
    const mockAuthorEl: any = {
      value: '',
      dispatchEvent: vi.fn(),
    };
    const mockDigestEl: any = {
      value: '',
      dispatchEvent: vi.fn(),
    };
    const mockEditorBody: any = {
      innerHTML: '',
      focus: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    const mockSaveBtn: any = {
      innerText: '保存为草稿',
      click: vi.fn(() => {
        saveClicked = true;
      }),
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => {
        if (sel.includes('#title')) return mockTitleEl;
        if (sel.includes('#author')) return mockAuthorEl;
        if (sel.includes('#js_description')) return mockDigestEl;
        if (sel.includes('#ueditor_0')) return mockEditorBody;
        if (sel.includes('#js_send') || sel.includes('button.js_save')) return mockSaveBtn;
        return null;
      },
      querySelectorAll: () => [mockSaveBtn],
    };

    const res = await actions.writeWechatDraft({
      title: '2026 AI Agent最新趋势',
      author: 'DeepMind',
      digest: '深度技术长文摘要',
      htmlContent: '<p style="color: blue;">正文内容</p>',
    });

    expect(res.ok).toBe(true);
    expect(saveClicked).toBe(true);
    expect((res.data as any).savedDraft).toBe(true);
    expect((res.data as any).injectedFields.editorBody).toBe(true);
    expect(mockTitleEl.value).toBe('2026 AI Agent最新趋势');
    expect(mockAuthorEl.value).toBe('DeepMind');
    expect(mockDigestEl.value).toBe('深度技术长文摘要');
  });
});
