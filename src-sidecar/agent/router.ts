/**
 * Agent 路由器
 *
 * 对齐 iOS FlowMarkApp/Services/AgentRouter.swift（纯函数）：
 *   - stripSlashPrefix：剥离 "/xxx" 前缀
 *   - slash 别名 → 意图关键词 → Profile 默认 skill
 *   - forced / override 优先于推断
 *
 * 路由是纯函数，无 I/O，便于 vitest 单测镜像 iOS AgentRouterTests。
 */

import type { AgentSkill, AgentRoutedBy, AgentProfile } from "./types.js";

/** slash 命令别名 → skill 映射（对齐 iOS slashCommands 字典） */
const SLASH_ALIASES: Record<string, AgentSkill> = {
  // chat
  "/chat": "chat",
  "/问": "chat",
  "/ask": "ask",
  "/understand": "understand",
  // academic
  "/academic": "academic",
  "/学术": "academic",
  "/paper": "paperAnnotation",
  // novel
  "/novel": "novel",
  "/小说": "novel",
  // html / presentation
  "/html": "htmlAuthor",
  "/presentation": "presentation",
  "/slides": "presentation",
  // others
  "/translate": "translate",
  "/翻译": "translate",
  "/mindmap": "mindmap",
  "/compare": "compare",
  "/organize": "organize",
  "/review": "review",
  "/followups": "followups",
  "/deliverable": "deliverable",
  "/plantuml": "plantUml",
  "/wechat": "wechatFormat",
  "/autoimage": "autoImage",
  "/autoformula": "autoFormula",
  "/distill": "distillSkill",
};

/** 意图关键词 → skill（对齐 iOS intentKeywords） */
const INTENT_KEYWORDS: Array<{ keywords: string[]; skill: AgentSkill }> = [
  { keywords: ["翻译", "translate", "translation"], skill: "translate" },
  { keywords: ["论文", "paper", "academic", "学术", "参考文献", "citation"], skill: "academic" },
  { keywords: ["小说", "novel", "故事", "叙事", "角色"], skill: "novel" },
  { keywords: ["ppt", "presentation", "slides", "演示", "汇报"], skill: "presentation" },
  { keywords: ["html", "网页", "web"], skill: "htmlAuthor" },
  { keywords: ["思维导图", "mindmap", "大纲"], skill: "mindmap" },
  { keywords: ["对比", "compare", "比较"], skill: "compare" },
  { keywords: ["整理", "organize", "归类"], skill: "organize" },
  { keywords: ["审阅", "review", "审查", "review"], skill: "review" },
  { keywords: ["plantuml", "时序图", "类图"], skill: "plantUml" },
  { keywords: ["公众号", "wechat", "微信"], skill: "wechatFormat" },
];

/** launchSkills：UI 默认展示的 skill 列表（对齐 iOS launchSkills） */
export const LAUNCH_SKILLS: AgentSkill[] = [
  "chat",
  "academic",
  "novel",
  "htmlAuthor",
  "presentation",
  "compare",
];

/** Profile → 默认 skill（对齐 iOS profileDefaultSkill） */
const PROFILE_DEFAULT: Record<AgentProfile, AgentSkill> = {
  general: "chat",
  academic: "academic",
  novel: "novel",
  html: "htmlAuthor",
};

/** 剥离 slash 前缀，返回 (无前缀文本, slash 命令名或 null) */
export function stripSlashPrefix(
  input: string,
): { text: string; slash: string | null } {
  const trimmed = input.trim();
  // 第一个空白分隔："/cmd rest..."
  const m = trimmed.match(/^\/(\S+)(?:\s+(.*))?$/s);
  if (!m) return { text: trimmed, slash: null };
  const slash = "/" + m[1];
  const rest = (m[2] ?? "").trim();
  return { text: rest, slash };
}

/** 路由结果 */
export interface RouteResult {
  skill: AgentSkill;
  routedBy: AgentRoutedBy;
  /** 剥离 slash 后的纯文本，供 LLM 使用 */
  text: string;
}

/**
 * 路由主函数（对齐 iOS AgentRouter.route）
 *
 * 优先级：
 *   1. forced（调用方显式指定 skill）
 *   2. slash（输入以 "/xxx" 开头且别名命中）
 *   3. intent（输入含关键词）
 *   4. default（profile 默认）
 *
 * override：当 forced 与 slash 同时存在且 forced 不同于 slash 推断时，
 * 用 forced 覆盖，routedBy = "override"
 */
export function route(
  input: string,
  profile: AgentProfile = "general",
  forced?: AgentSkill,
): RouteResult {
  const { text, slash } = stripSlashPrefix(input);

  // 1. slash 命中
  let slashSkill: AgentSkill | null = null;
  if (slash && SLASH_ALIASES[slash]) {
    slashSkill = SLASH_ALIASES[slash];
  }

  // 2. forced 优先
  if (forced) {
    if (slashSkill && slashSkill !== forced) {
      return { skill: forced, routedBy: "override", text };
    }
    return { skill: forced, routedBy: "forced", text };
  }

  // 3. slash
  if (slashSkill) {
    return { skill: slashSkill, routedBy: "slash", text };
  }

  // 4. intent 关键词
  const lower = text.toLowerCase();
  for (const rule of INTENT_KEYWORDS) {
    if (rule.keywords.some((k) => lower.includes(k.toLowerCase()))) {
      return { skill: rule.skill, routedBy: "intent", text };
    }
  }

  // 5. profile 默认
  return { skill: PROFILE_DEFAULT[profile], routedBy: "default", text };
}
