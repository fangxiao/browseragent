// DomToolExecutor 装配:注册表(元数据) + actions(DOM 实现)。
// content 侧使用;background 只消费元数据(toLlmTools/validateArgs)。
// evaluate 默认禁用,由 options 开关控制(传入 enabled 才挂载)。
import type { DomToolExecutor, ToolResult, ToolSpec } from './types';
import { getTool, validateArgs } from './toolRegistry';
import { actions } from './actions';

const EXEC_MAP: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
  getPageInfo: actions.getPageInfo,
  getPagePerformance: actions.getPagePerformance,
  readPage: actions.readPage,
  findElements: actions.findElements,
  clickElement: actions.clickElement,
  typeInto: actions.typeInto,
  scrollTo: actions.scrollTo,
  waitFor: actions.waitFor,
  sleep: actions.sleep,
  extractData: actions.extractData,
  navigate: actions.navigate,
  getArticleOutline: actions.getArticleOutline,
  highlightAndScrollTo: actions.highlightAndScrollTo,
  writeWechatDraft: actions.writeWechatDraft,
  exportDocMarkdown: actions.exportDocMarkdown,
  evaluate: actions.evaluate,
};

export function createDomExecutor(opts: { allowEvaluate?: boolean } = {}): DomToolExecutor {
  const specs: ToolSpec[] = [];
  for (const name of Object.keys(EXEC_MAP)) {
    const meta = getTool(name);
    if (!meta) continue;
    if (name === 'evaluate' && !opts.allowEvaluate) continue; // 默认禁用
    specs.push({ ...meta, execute: EXEC_MAP[name]! });
  }

  return {
    list: () => specs,
    async execute(name, args) {
      const spec = specs.find((s) => s.name === name);
      if (!spec) {
        return {
          ok: false,
          error: name === 'evaluate' ? '在页面上运行代码的功能未开启' : `未知工具:${name}`,
        };
      }
      if (!validateArgs(spec, args)) {
        return { ok: false, error: `参数不完整,必填:${(spec.required ?? []).join(', ')}` };
      }
      try {
        return await spec.execute(args);
      } catch (err) {
        return { ok: false, error: `${name} 执行失败:${(err as Error).message}` };
      }
    },
  };
}
