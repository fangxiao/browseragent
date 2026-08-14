// 通用页面/文档内容类型(原平台适配层,去飞书化后通用化)
// v2:通用浏览器智能体,不再有"平台"概念;提取任意页面的文档化内容。
export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'listItem'
  | 'todo'
  | 'table'
  | 'quote'
  | 'code'
  | 'divider'
  | 'image'
  | 'callout'
  | 'unknown';

export interface Block {
  type: BlockType;
  /** 纯文本内容 */
  text: string;
  /** heading: 1-6;listItem: 缩进级别 0+ */
  level?: number;
  /** 有序列表 */
  ordered?: boolean;
  /** todo 勾选状态 */
  checked?: boolean;
  /** 表格单元格矩阵(不含表头特殊处理,整体按行存储) */
  cells?: string[][];
  /** 图片等资源 URL */
  src?: string;
}

export interface DocContent {
  title: string;
  docId: string;
  url: string;
  blocks: Block[];
  /** 序列化后的 Markdown */
  markdown: string;
  blockCount: number;
  /** 非空白字符总数(供 token 估算/UI 展示) */
  textLength: number;
  /** 0-1,提取覆盖率诊断(DOM 变更预警用) */
  extractionRate: number;
  /** 降级/警告信息 */
  warnings: string[];
}
