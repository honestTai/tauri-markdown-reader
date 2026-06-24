/**
 * 前端共享的 sidecar 模块入口镜像
 *
 * 避免前端直接 import sidecar 的 TS(那会带 LangChain 重依赖)。
 * 这里手抄一份 LAUNCH_SKILLS(与 src-sidecar/agent/router.ts 保持同步)。
 *
 * 阶段 6.1 的 AgentPane 用它渲染 skill 选择条。
 */
import type { AgentSkill } from "./types/index.js";

export const LAUNCH_SKILLS: AgentSkill[] = [
  "chat",
  "academic",
  "novel",
  "htmlAuthor",
  "presentation",
  "compare",
];
