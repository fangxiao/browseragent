// 表单填充纯函数(select 选项定位等)。不依赖 DOM,便于单测。
// actions.typeInto 调用;见 docs/design/agent.md §6(表单场景 S2)。

export interface SelectOption {
  value: string;
  text: string;
}

/**
 * 在 select 的 options 中定位目标 option 索引(供 typeInto 选择):
 * value 精确 → text 精确 → 相互包含(容错)。找不到返回 -1。
 */
export function findOptionIndex(options: SelectOption[], target: string): number {
  const t = (target ?? '').trim();
  if (!t || options.length === 0) return -1;
  const byValue = options.findIndex((o) => o.value.trim() === t);
  if (byValue >= 0) return byValue;
  const byText = options.findIndex((o) => o.text.trim() === t);
  if (byText >= 0) return byText;
  return options.findIndex((o) => o.text.includes(t) || t.includes(o.text));
}
