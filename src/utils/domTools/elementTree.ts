// 语义元素树 + findElements(挖掘核心,纯逻辑可测)。
// content 侧提供 ElementInfo 数据(DOM 收集薄壳),本模块负责建树/折叠/匹配查询。
// 见 docs/design/agent.md §6.2
export interface ElementInfo {
  tag: string;
  role: string;
  type: string;
  /** 可访问名(aria-label / 可见文本) */
  label: string;
  /** 可见文本摘要 */
  text: string;
  /** 定位提示(供后续 click/type/extract 复用) */
  selectable: string;
  children: ElementInfo[];
  depth: number;
}

export interface TreeNode {
  tag: string;
  role: string;
  type: string;
  label: string;
  text: string;
  selectable: string;
  children: TreeNode[];
  /** 折叠的子节点数(超限时提示) */
  folded?: number;
}

/**
 * 折叠规则:节点达到 maxDepth 后其子节点整体折叠为 folded 计数;
 * 任一节点子节点数超过 maxChildren 时,超出部分折叠为 folded。
 */
export function buildTree(
  nodes: ElementInfo[],
  maxDepth = 4,
  maxChildren = 20,
): TreeNode[] {
  return nodes.slice(0, maxChildren).map((n) => {
    const node: TreeNode = {
      tag: n.tag,
      role: n.role,
      type: n.type,
      label: n.label,
      text: n.text.slice(0, 80),
      selectable: n.selectable,
      children: [],
    };
    const childCount = n.children.length;
    if (n.depth < maxDepth) {
      node.children = buildTree(n.children, maxDepth, maxChildren);
      if (childCount > maxChildren) node.folded = childCount - maxChildren;
    } else if (childCount > 0) {
      node.folded = childCount; // 达到深度上限,整棵子树折叠
    }
    return node;
  });
}

export interface FindQuery {
  role?: string;
  type?: string;
  /** 文本包含(可访问名/可见文本/placeholder) */
  text?: string;
  placeholder?: string;
  keyword?: string;
}

export function matchElement(info: ElementInfo, q: FindQuery): boolean {
  if (q.role && info.role !== q.role) return false;
  if (q.type && info.type !== q.type) return false;
  if (q.placeholder && !info.label.includes(q.placeholder)) return false;
  if (q.text) {
    const hay = `${info.label} ${info.text}`;
    if (!hay.includes(q.text)) return false;
  }
  if (q.keyword) {
    const hay = `${info.label} ${info.text} ${info.selectable} ${info.tag} ${info.type}`;
    if (!hay.includes(q.keyword)) return false;
  }
  return true;
}

export function findElementsByQuery(all: ElementInfo[], q: FindQuery, limit = 30): ElementInfo[] {
  return all.filter((n) => matchElement(n, q)).slice(0, limit);
}
