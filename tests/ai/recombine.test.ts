// E4 信息重组层单测(设计 §6.3):mergeTables 同构合并 / mdTableToCsv 提取。
import { describe, expect, it } from 'vitest';
import { mergeTables, mdTableToCsv } from '../../src/utils/ai/recombine';
import { projectColumns } from '../../src/utils/domTools/extractData';

describe('recombine(信息重组)', () => {
  describe('mergeTables', () => {
    it('同构表直接拼接', () => {
      const out = mergeTables([
        { headers: ['名称', '价格'], rows: [['苹果', '5'], ['梨', '4']] },
        { headers: ['名称', '价格'], rows: [['桃', '6']] },
      ]);
      expect(out).toEqual({
        headers: ['名称', '价格'],
        rows: [
          ['苹果', '5'],
          ['梨', '4'],
          ['桃', '6'],
        ],
      });
    });

    it('表头不同:取并集,缺列补空', () => {
      const out = mergeTables([
        { headers: ['名称', '价格'], rows: [['苹果', '5']] },
        { headers: ['名称', '产地'], rows: [['苹果', '烟台']] },
      ]);
      expect(out.headers).toEqual(['名称', '价格', '产地']);
      expect(out.rows[0]).toEqual(['苹果', '5', '']);
      expect(out.rows[1]).toEqual(['苹果', '', '烟台']);
    });
  });

  describe('mdTableToCsv(从文本提取表格)', () => {
    it('标准 Markdown 表格 → CSV(含表头,去分隔行)', () => {
      const md = '结果如下:\n\n| 名称 | 价格 |\n| --- | --- |\n| 苹果 | 5 |\n| 梨 | 4 |\n\n完毕';
      const csv = mdTableToCsv(md);
      expect(csv).toBe('名称,价格\r\n苹果,5\r\n梨,4');
    });

    it('无表格文本 → null', () => {
      expect(mdTableToCsv('这里没有表格数据')).toBeNull();
    });

    it('表格不足两行(仅表头)→ null', () => {
      expect(mdTableToCsv('| 名称 |\n| --- |')).toBeNull();
    });
  });

  describe('projectColumns(列投影)', () => {
    const table = { headers: ['名称', '价格', '评分'], rows: [['A', '10', '4.5'], ['B', '20', '4.2']] };

    it('只保留指定列(按 columns 顺序)', () => {
      expect(projectColumns(table, ['价格', '名称'])).toEqual({
        headers: ['价格', '名称'],
        rows: [
          ['10', 'A'],
          ['20', 'B'],
        ],
      });
    });

    it('未知列名被忽略', () => {
      expect(projectColumns(table, ['名称', '不存在'])).toEqual({
        headers: ['名称'],
        rows: [['A'], ['B']],
      });
    });

    it('无匹配列 → 原表(不破坏数据)', () => {
      expect(projectColumns(table, ['不存在'])).toBe(table);
    });
  });
});
