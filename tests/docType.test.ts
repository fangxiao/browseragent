import { describe, expect, it } from 'vitest';
import { guessDocType } from '../src/utils/ai/docType';

describe('guessDocType', () => {
  it('识别需求文档', () => {
    const r = guessDocType('XX 功能需求文档', '背景...验收标准...用户故事...目标');
    expect(r.type).toBe('requirement');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('识别周报', () => {
    const r = guessDocType('2026-W33 周报', '本周进展...下周计划...');
    expect(r.type).toBe('report');
  });

  it('识别会议纪要', () => {
    const r = guessDocType('产品评审会纪要', '参会人:张三 会议结论...待办事项...');
    expect(r.type).toBe('meeting');
  });

  it('识别技术方案', () => {
    const r = guessDocType('订单系统改造方案', '技术选型...架构设计...方案评审');
    expect(r.type).toBe('technical');
  });

  it('无关键词时回退 other 且低置信度', () => {
    const r = guessDocType('随手笔记', '随便写的一些内容');
    expect(r.type).toBe('other');
    expect(r.confidence).toBeLessThan(0.5);
  });
});
