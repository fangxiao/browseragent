// 信息重组层(亮点之二,见 docs/design/agent.md §6.3):原始数据 → 按用户意图重组。
// AI 的重组编排由各场景 system 提示词驱动;本层提供确定性数据变换,纯逻辑可单测。
// 依赖方向:ai 层 → domTools 层(extractData 基础函数)。
import { matrixToCsv, normalizeMatrix, type DataTable } from '../domTools/extractData';

/**
 * 多张同构表合并:表头取并集(首次出现顺序),行按统一表头对齐,缺列补空。
 * 用于:多段表格 / 跨页面数据 → 一张大表(对比、汇总)。
 */
export function mergeTables(tables: DataTable[]): DataTable {
  const headers: string[] = [];
  for (const t of tables) {
    for (const h of t.headers) {
      if (!headers.includes(h)) headers.push(h);
    }
  }
  const rows: string[][] = [];
  for (const t of tables) {
    // srcIdx[j] = 合并表第 j 列在该表行中的源列索引(-1 = 该表无此列)
    const srcIdx = headers.map((h) => t.headers.indexOf(h));
    for (const r of t.rows) {
      rows.push(srcIdx.map((j) => (j >= 0 ? (r[j] ?? '') : '')));
    }
  }
  return { headers, rows };
}

/** Markdown 表格分隔行(表头下的 |---|---|) */
const SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** 解析文本中的第一个 Markdown 表格块(含 | 的连续行);返回字符串矩阵,无则 null */
function extractTableMatrix(text: string): string[][] | null {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes('|')) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const block: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes('|')) break;
    block.push(line);
  }
  // 至少 表头 + 分隔行(或 表头 + 数据行)
  if (block.length < 2) return null;
  const body = block.filter((l) => !SEP_RE.test(l));
  if (body.length < 2) return null;
  return body.map((l) =>
    l
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((c) => c.trim()),
  );
}

/**
 * 从文本中提取第一个 Markdown 表格并转 CSV;无表格返回 null。
 * 用于 agent-done 输出:AI 以 Markdown 表格输出重组结果,侧边栏据此提供"下载/复制"。
 */
export function mdTableToCsv(text: string): string | null {
  const matrix = extractTableMatrix(text);
  if (!matrix) return null;
  const rows = normalizeMatrix(matrix);
  if (rows.length < 2) return null;
  return matrixToCsv(rows);
}
