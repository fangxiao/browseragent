// 数据提取纯函数:表格/列表 → 结构化数据(CSV/JSON)。不依赖 DOM,便于单测。
// DOM 收集(collectRows 从 Element)在 content 侧执行;本模块只做"已取出的字符串矩阵"处理。
// 表头有无由 DOM 收集端判断(th 存在=有表头),避免纯函数猜表头产生歧义。

/** 剔除全空行 */
export function collectRows(raw: string[][]): string[][] {
  return raw.filter((row) => row.some((c) => (c ?? '').trim() !== ''));
}

/** 规整矩阵:统一列宽(不足补空),清理零宽字符 */
export function normalizeMatrix(raw: string[][]): string[][] {
  const rows = collectRows(raw);
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => {
    const cells = r.map((c) => (c ?? '').replace(/​/g, '').trim());
    while (cells.length < width) cells.push('');
    return cells;
  });
}

/** CSV 转义:含逗号/引号/换行的字段加双引号,内部引号翻倍 */
function escapeCsv(cell: string): string {
  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

/** 矩阵 → CSV 文本(CRLF 行尾,Excel 兼容;含表头则原样保留在首行) */
export function matrixToCsv(raw: string[][]): string {
  const rows = normalizeMatrix(raw);
  return rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n');
}

/** 矩阵 → JSON 文本。hasHeader=true 时首行做表头;否则生成 col0/col1... */
export function matrixToJson(raw: string[][], opts: { hasHeader?: boolean } = {}): string {
  const rows = normalizeMatrix(raw);
  if (rows.length === 0) return JSON.stringify([]);
  const hasHeader = opts.hasHeader === true;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const keys = hasHeader
    ? rows[0]!
    : Array.from({ length: rows[0]!.length }, (_, i) => `col${i}`);
  const objs = dataRows.map((row) => {
    const o: Record<string, string> = {};
    keys.forEach((k, i) => {
      o[k] = row[i] ?? '';
    });
    return o;
  });
  return JSON.stringify(objs);
}

/** 带表头的数据表(重组层输入,见 recombine.ts) */
export interface DataTable {
  headers: string[];
  rows: string[][];
}

/**
 * 按列名投影:只保留用户要的列(保持 columns 顺序)。表头缺失的列忽略。
 * 无表头或指定列都不存在 → 原表(不破坏数据)。
 */
export function projectColumns(table: DataTable, columns: string[]): DataTable {
  const idx = columns.map((c) => table.headers.indexOf(c)).filter((i) => i >= 0);
  if (idx.length === 0) return table;
  return {
    headers: idx.map((i) => table.headers[i]!),
    rows: table.rows.map((r) => idx.map((i) => r[i] ?? '')),
  };
}
