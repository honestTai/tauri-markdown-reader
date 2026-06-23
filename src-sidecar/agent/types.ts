/**
 * Agent 模块共享类型
 *
 * 对齐 src/types/index.ts 的前端类型与 Rust 侧 models/agent.rs，
 * 保持 sidecar 内部使用的命名与 camelCase 序列化输出一致。
 */

/** Agent 技能（对齐 iOS AgentSkill 全部 case） */
export type AgentSkill =
  | "chat" | "understand" | "ask" | "academic" | "plantUml"
  | "paperAnnotation" | "novel" | "presentation" | "wechatFormat"
  | "autoImage" | "autoFormula" | "translate" | "mindmap" | "compare"
  | "htmlAuthor" | "organize" | "deliverable" | "review" | "followups"
  | "distillSkill";

/** Agent 路由来源 */
export type AgentRoutedBy =
  | "forced" | "slash" | "intent" | "default" | "override";

/** Agent profile（决定默认 skill 与系统提示词模板） */
export type AgentProfile = "general" | "academic" | "novel" | "html";

/** Agent 消息角色 */
export type AgentMessageRole = "user" | "assistant" | "tool" | "system";

/** 工具调用记录 */
export interface ToolCall {
  name: string;
  arguments: unknown;
  result?: unknown;
}

/** Agent 命中的文档片段 */
export interface AgentSource {
  documentId: string;
  chunkId?: string;
  heading?: string;
  snippet: string;
  score: number;
}

/** Agent 消息 */
export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  toolCalls?: ToolCall[];
  skill?: AgentSkill;
  routedBy?: AgentRoutedBy;
  sources?: AgentSource[];
  timestamp: number;
}

/** 模型配置（从 Rust 侧 get_model_config 取得） */
export interface ModelConfiguration {
  endpoint: string;
  model: string;
  timeoutSecs: number;
  contextWindow: number;
}

/**
 * agent.run 请求参数（Rust → sidecar 的 JSON-RPC params）
 */
export interface AgentRunParams {
  runId: string;
  sessionId: string;
  /** 用户输入 */
  input: string;
  /** 当前 profile，默认 general */
  profile?: AgentProfile;
  /** 强制 skill（用户在 UI 显式选择时） */
  forcedSkill?: AgentSkill;
  /** 关联的文档 id（可空，影响工具调用上下文） */
  documentId?: string;
  /** 历史消息（不含本次 input） */
  history?: AgentMessage[];
  /** 模型配置（Rust 侧填充，避免 sidecar 读盘） */
  modelConfig: ModelConfiguration;
  /** API key（Rust 侧从 Credential Manager 取出后传入，不落 sidecar 日志） */
  apiKey: string;
}

/**
 * agent.event notification 的 params 载荷
 *
 * type 含义：
 *   - metadata：路由结果（skill / routedBy）
 *   - delta：流式 token 增量
 *   - tool_call：工具被调用
 *   - tool_result：工具返回
 *   - done：本次 run 结束（含最终消息）
 *   - error：错误（含可显示消息）
 */
export type AgentEvent =
  | { type: "metadata"; runId: string; skill: AgentSkill; routedBy: AgentRoutedBy }
  | { type: "delta"; runId: string; text: string }
  | { type: "tool_call"; runId: string; tool: string; args: unknown }
  | { type: "tool_result"; runId: string; tool: string; result: unknown }
  | { type: "done"; runId: string; finalText: string; sources: AgentSource[] }
  | { type: "error"; runId: string; message: string };

/** agent.cancel 请求参数 */
export interface AgentCancelParams {
  runId: string;
}

/**
 * tool.call 请求参数（sidecar → Rust 的反向调用）
 *
 * sidecar 通过 RpcTransport 发送，Rust 侧读到后执行并回响应。
 * 当前阶段 4 实现的 tool 名：
 *   - document_search
 *   - document_read
 *   - document_index
 *   - document_propose_replace
 *   - document_propose_create
 */
export interface ToolCallRequest {
  tool: string;
  args: unknown;
}

/** 反向 RPC 句柄：sidecar 调用 Rust 侧工具 */
export interface ToolBackend {
  /** 发起一次 tool.call，阻塞直到 Rust 返回结果或错误 */
  call(name: string, args: unknown): Promise<unknown>;
}
