import { describe, expect, it } from 'vitest';
import { buildTree, matchElement, findElementsByQuery } from '../../src/utils/domTools/elementTree';
import type { ElementInfo } from '../../src/utils/domTools/elementTree';

function el(partial: Partial<ElementInfo>): ElementInfo {
  return {
    tag: 'div',
    role: '',
    type: '',
    label: '',
    text: '',
    selectable: '',
    children: [],
    depth: 0,
    ...partial,
  };
}

describe('elementTree(语义元素树,挖掘核心)', () => {
  it('buildTree:超过 maxDepth 的子树折叠为计数', () => {
    // main(d0) > div(d1) > button(d2):maxDepth=1 时 div 达到上限,button 折叠
    const deep: ElementInfo = el({
      tag: 'main',
      depth: 0,
      children: [
        el({ tag: 'div', depth: 1, children: [el({ tag: 'button', depth: 2, text: '提交' })] }),
      ],
    });
    const tree = buildTree([deep], 1, 10);
    expect(tree[0]!.children[0]!.folded).toBe(1);
    expect(tree[0]!.children[0]!.children).toEqual([]);
  });

  it('buildTree:maxChildren 超出时折叠多余子节点', () => {
    const wide = el({ tag: 'ul', children: Array.from({ length: 25 }, (_, i) => el({ tag: 'li', text: `项${i}` })) });
    const tree = buildTree([wide], 4, 10);
    expect(tree[0]!.folded).toBe(15);
  });

  it('matchElement:按 role/text/type/placeholder/keyword 匹配', () => {
    const btn = el({ tag: 'button', role: 'button', text: '提交订单', selectable: 'button' });
    expect(matchElement(btn, { text: '提交' })).toBe(true);
    expect(matchElement(btn, { role: 'button' })).toBe(true);
    expect(matchElement(btn, { keyword: '订单' })).toBe(true);
    expect(matchElement(btn, { text: '删除' })).toBe(false);

    // 表单字段:DOM 收集端将 placeholder/name 映射为 label
    const input = el({ tag: 'input', type: 'email', label: '邮箱', selectable: 'input' });
    expect(matchElement(input, { type: 'email' })).toBe(true);
    expect(matchElement(input, { text: '邮箱' })).toBe(true);
    expect(matchElement(input, { keyword: '邮箱' })).toBe(true);
  });

  it('findElementsByQuery:过滤并限量返回', () => {
    const all = [
      el({ tag: 'button', role: 'button', text: '提交' }),
      el({ tag: 'button', role: 'button', text: '取消' }),
      el({ tag: 'input', type: 'text', label: '姓名' }),
    ];
    const found = findElementsByQuery(all, { role: 'button' });
    expect(found.length).toBe(2);
    expect(findElementsByQuery(all, { text: '姓名' }).length).toBe(1);
    expect(findElementsByQuery(all, { role: 'button' }, 1).length).toBe(1);
  });
});
