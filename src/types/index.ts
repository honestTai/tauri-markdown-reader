/**
 * 前端类型定义
 *
 * 对齐 Rust 侧 src-tauri/src/models/ 的数据结构，
 * 命名与 Rust 的 camelCase serde 输出一致
 */

/** Markdown 文档元数据 */
export interface MarkdownDocument {
  id: string;
  title: string;
  path: string;
  starred: boolean;
  pinned: boolean;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
  fingerprint?: string;
}

/** 文档版本快照 */
export interface DocumentVersion {
  id: string;
  documentId: string;
  timestamp: number;
  note?: string;
  path: string;
}

/** 文档库整体状态 */
export interface LibraryState {
  workspaceRoot: string;
  documents: MarkdownDocument[];
  versions: DocumentVersion[];
  activeDocumentId?: string;
  firstLaunch: boolean;
}

/** Agent 技能 */
export type AgentSkill =
  | "chat" | "understand" | "ask" | "academic" | "plantUml"
  | "paperAnnotation" | "novel" | "presentation" | "wechatFormat"
  | "autoImage" | "autoFormula" | "translate" | "mindmap" | "compare"
  | "htmlAuthor" | "organize" | "deliverable" | "review" | "followups"
  | "distillSkill";

/** Agent 路由来源 */
export type AgentRoutedBy = "forced" | "slash" | "intent" | "default" | "override";

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

/** Agent 会话 */
export interface AgentSession {
  id: string;
  title: string;
  documentId?: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}

/** 模型配置 */
export interface ModelConfiguration {
  endpoint: string;
  model: string;
  timeoutSecs: number;
  contextWindow: number;
}

/** 操作类型 */
export type OperationKind =
  | "imported" | "openedExternal" | "edited" | "ranAgent"
  | "previewedHtml" | "savedAgentOutput" | "deletedDocument";

/** 操作记录 */
export interface OperationRecord {
  id: string;
  kind: OperationKind;
  documentId?: string;
  summary: string;
  timestamp: number;
}

/** 记忆片段 */
export interface MemoryFragment {
  id: string;
  content: string;
  profile?: string;
  route?: string;
  createdAt: number;
}

/** 文档记忆 */
export interface DocumentMemory {
  documentId: string;
  fragments: MemoryFragment[];
}
