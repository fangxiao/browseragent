import { describe, expect, it } from 'vitest';
import { generateReadingNoteMarkdown } from '../src/utils/readingNotesExport';

describe('readingNotesExport(深度研报与笔记导出引擎)', () => {
  it('generateReadingNoteMarkdown: 包含标准 YAML FrontMatter 与结构化大纲导读', () => {
    const md = generateReadingNoteMarkdown({
      title: 'DeepSeek 架构深度解析',
      url: 'https://example.com/deepseek-arch',
      totalWords: 15800,
      date: '2026-08-15',
      textSummary: '本文深入拆解了 DeepSeek 的 MoE 架构演进与 MLA 机制。',
      outline: [
        {
          anchorId: 'anchor-1',
          level: 1,
          tag: 'h1',
          title: '一、核心架构演进',
          snippet: 'MoE 稀疏激活在提升容量的同时显著降低推理计算开销。',
        },
        {
          anchorId: 'anchor-2',
          level: 2,
          tag: 'h2',
          title: '1.1 MLA 多头潜在注意力',
          snippet: '低秩键值联合压缩大幅降低显存占用与 KV 缓存。',
        },
      ],
    });

    expect(md).toContain('---');
    expect(md).toContain('title: "DeepSeek 架构深度解析"');
    expect(md).toContain('source_url: "https://example.com/deepseek-arch"');
    expect(md).toContain('tags:');
    expect(md).toContain('web-reading');
    expect(md).toContain('# 📖 深度阅读研报：DeepSeek 架构深度解析');
    expect(md).toContain('一、核心架构演进');
    expect(md).toContain('1.1 MLA 多头潜在注意力');
    expect(md).toContain('📌 核心主旨与导读要点');
  });

  it('generateReadingNoteMarkdown: 缺省字段容错', () => {
    const md = generateReadingNoteMarkdown({
      title: '测试简短网页',
    });
    expect(md).toContain('title: "测试简短网页"');
    expect(md).toContain('📖 深度阅读研报：测试简短网页');
  });
});
