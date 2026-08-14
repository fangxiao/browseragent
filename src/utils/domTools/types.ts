// v2 通用 DOM 工具层类型。见 docs/design/agent.md §4
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema(参数,供 function calling) */
  inputSchema: Record<string, unknown>;
  /** 是否可能触发敏感/破坏性动作(见 safety.ts) */
  sensitive?: boolean;
  /** 必填参数名(用于校验) */
  required?: string[];
  /** content 侧执行函数;返回 JSON 可序列化结果 */
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/** 供 LLM function calling 的工具 schema(provider 请求体用) */
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  /** 结构化结果(回填 LLM) */
  data?: unknown;
  /** 失败原因(回填 LLM 重试) */
  error?: string;
}

export interface DomToolExecutor {
  /** 执行工具;返回结构化结果 */
  execute(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  /** 可用的工具清单(供 LLM schema) */
  list(): ToolSpec[];
}
