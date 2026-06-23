/**
 * Agent 模块入口
 *
 * 对外暴露：
 *   - route / LAUNCH_SKILLS / stripSlashPrefix（路由）
 *   - createGateway / isPreviewMode / PreviewGateway / RemoteGateway（网关）
 *   - runAgent / MAX_STEPS（运行时）
 *   - 类型
 */

export {
  route,
  stripSlashPrefix,
  LAUNCH_SKILLS,
} from "./router.js";
export type { RouteResult } from "./router.js";

export {
  createGateway,
  isPreviewMode,
  PreviewGateway,
  RemoteGateway,
} from "./gateway.js";
export type { Gateway, GatewayEvent } from "./gateway.js";

export { runAgent, MAX_STEPS } from "./runtime.js";
export type { RunContext } from "./runtime.js";

export type {
  AgentSkill,
  AgentRoutedBy,
  AgentProfile,
  AgentMessage,
  AgentMessageRole,
  AgentSource,
  AgentRunParams,
  AgentEvent,
  AgentCancelParams,
  ToolCallRequest,
  ModelConfiguration,
} from "./types.js";
