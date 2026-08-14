import { describe, expect, it } from 'vitest';
import {
  normalizeMatrix,
  matrixToCsv,
  matrixToJson,
  collectRows,
} from '../../src/utils/domTools/extractData';

describe('extractData(数据提取纯函数)', () => {
  it('collectRows:从 table 提取行列,跳过空行', () => {
    const matrix = [
      ['姓名', '部门'],
      ['张三', '研发'],
      ['李四', ''],
      ['', ''],
    ];
    expect(collectRows(matrix)).toEqual([
      ['姓名', '部门'],
      ['张三', '研发'],
      ['李四', ''],
    ]);
  });

  it('normalizeMatrix:统一列宽(补空),去零宽字符', () => {
    const m = [
      ['a', 'b'],
      ['c'],
      ['d', 'e', 'f'],
    ];
    const n = normalizeMatrix(m);
    expect(n).toEqual([
      ['a', 'b', ''],
      ['c', '', ''],
      ['d', 'e', 'f'],
    ]);
  });

  it('matrixToCsv:标准转义(逗号/引号/换行)', () => {
    const rows = [
      ['name', 'note'],
      ['a,b', 'say "hi"'],
      ['line1\nline2', 'plain'],
    ];
    expect(matrixToCsv(rows)).toBe(
      'name,note\r\n"a,b","say ""hi"""\r\n"line1\nline2",plain',
    );
  });

  it('matrixToCsv:空矩阵返回空串', () => {
    expect(matrixToCsv([])).toBe('');
  });

  it('matrixToJson:hasHeader=true 时首行做表头', () => {
    const rows = [
      ['姓名', '部门'],
      ['张三', '研发'],
    ];
    expect(matrixToJson(rows, { hasHeader: true })).toBe(
      JSON.stringify([{ 姓名: '张三', 部门: '研发' }]),
    );
  });

  it('matrixToJson:无表头(hasHeader 默认 false)时生成索引列', () => {
    const rows = [
      ['张三', '研发'],
      ['李四', '产品'],
    ];
    expect(matrixToJson(rows)).toBe(
      JSON.stringify([
        { col0: '张三', col1: '研发' },
        { col0: '李四', col1: '产品' },
      ]),
    );
  });

  it('matrixToJson:空矩阵返回 []', () => {
    expect(matrixToJson([])).toBe('[]');
  });
});
