/**
 * Skill 解析器（阶段 7）
 *
 * 职责：
 *   - 从 Rust 侧 list_skills / load_skill 拿到 skill 描述符
 *   - 把 SkillDescriptor[] 合并进 router 的 SLASH_ALIASES / INTENT_KEYWORDS
 *   - runtime 选定 skill 后，从 descriptor.body 取 systemPrompt 附加
 *
 * 设计要点：
 *   - sidecar 不直接读盘（built-in / user 目录由 Rust 统一管理）
 *   - 通过反向 RPC 调 Rust 的 list_skills / load_skill（tool.call 复用现有通道）
 *   - 解析结果缓存到进程内，每次 agent.run 前刷新（用户可能刚上传新 skill）
 *
 * 与 router.ts 的关系：
 *   router 保留内置 SLASH_ALIASES / INTENT_KEYWORDS 作为兜底；
 *   skill_resolver 在路由前先尝试用用户 skill 的 slash / intentKeywords 匹配。
 */

import type { ToolBackend } from "./types.js";

/** Skill 来源 */
export type SkillSource = "builtIn" | "user";

/** Skill 描述符（对齐 Rust 侧 SkillDescriptor，camelCase） */
export interface SkillDescriptor {
  name: string;
  description: string;
  source: SkillSource;
  profile?: string;
  slash?: string;
  intentKeywords: string[];
  tools: string[];
  /** skill 正文（systemPrompt 附加）。列表接口不返回，load_skill 才有 */
  body?: string;
  path?: string;
  updatedAt?: number;
}

/** 路由命中结果 */
export interface ResolvedSkill {
  /** skill 名（用作 runtime 取 systemPrompt 的 key） */
  name: string;
  /** 命中方式 */
  routedBy: "slash" | "intent" | "forced" | "default" | "override";
  /** 剥离 slash 后的纯文本 */
  text: string;
}

/**
 * 从 Rust 侧拉取所有 skill 列表（不含 body）
 *
 * 通过反向 RPC 调 list_skills。失败时返回空数组（退化为内置路由）。
 */
export async function fetchSkillList(backend: ToolBackend): Promise<SkillDescriptor[]> {
  try {
    const result = await backend.call("__list_skills", {});
    if (!Array.isArray(result)) return [];
    return result as SkillDescriptor[];
  } catch {
    return [];
  }
}

/**
 * 从 Rust 侧拉取单个 skill 完整内容（含 body）
 *
 * runtime 选定 skill 后调这个拿 systemPrompt 正文。
 */
export async function fetchSkillBody(
  backend: ToolBackend,
  name: string,
): Promise<string> {
  try {
    const result = await backend.call("__load_skill", { name });
    const desc = result as SkillDescriptor | undefined;
    return desc?.body ?? "";
  } catch {
    return "";
  }
}

/**
 * 用用户 skill 的 slash / intentKeywords 做路由
 *
 * 优先级：
 *   1. forced（调用方显式指定 skill name）
 *   2. slash 命中（输入以 "/xxx" 开头且匹配某 skill.slash）
 *   3. intent 命中（输入含某 skill.intentKeywords）
 *   4. 返回 null（交给 router.ts 内置兜底）
 *
 * 注意：forced / slash 用 skill name（descriptor.name），
 *       不是 AgentSkill 枚举——runtime 会优先查 skill body。
 */
export function routeByUserSkills(
  input: string,
  skills: SkillDescriptor[],
  forcedSkillName?: string,
): ResolvedSkill | null {
  const trimmed = input.trim();
  const slashMatch = trimmed.match(/^\/(\S+)(?:\s+(.*))?$/s);
  const slash = slashMatch ? "/" + slashMatch[1] : null;
  const text = slashMatch ? (slashMatch[2] ?? "").trim() : trimmed;

  // 1. forced
  if (forcedSkillName) {
    const hit = skills.find((s) => s.name === forcedSkillName);
    if (hit) {
      // 若同时有 slash 且 slash 指向另一个 skill，标记 override
      const slashHit = slash ? skills.find((s) => s.slash === slash) : undefined;
      return {
        name: forcedSkillName,
        routedBy: slashHit && slashHit.name !== forcedSkillName ? "override" : "forced",
        text,
      };
    }
  }

  // 2. slash
  if (slash) {
    const hit = skills.find((s) => s.slash === slash);
    if (hit) {
      return { name: hit.name, routedBy: "slash", text };
    }
  }

  // 3. intent
  const lower = text.toLowerCase();
  for (const s of skills) {
    if (s.intentKeywords.some((k) => lower.includes(k.toLowerCase()))) {
      return { name: s.name, routedBy: "intent", text };
    }
  }

  return null;
}
