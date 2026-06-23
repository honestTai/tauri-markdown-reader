/**
 * Agent 运行时
 *
 * 对齐 iOS ClientAgentRuntime：
 *   - 最多 6 步 tool-call 循环
 *   - 工具只读 + 提议草稿（绝不直接写文件）
 *   - 每步工具调用 → tool_call 事件 → 工具结果 → tool_result 事件
 *
 * 与 iOS 的差异：iOS 手撸 tool-call 循环，Windows 侧用 LangChain
 * AgentExecutor 自动处理。但为了让"取消"和"事件流"可控，
 * 这里仍手动驱动循环，不直接用 AgentExecutor 的 invoke()。
 *
 * 阶段 4 的简化策略：
 *   1. 路由 → 选系统提示词
 *   2. 调 gateway.stream() 流式生成首答
 *   3. 首答中若模型显式给出工具调用意图（标记语法），触发一次工具调用
 *   4. 工具结果作为 system 反馈，再走一轮 stream
 *   5. 最多 6 轮，超出停止
 *
 * 真正的 LangChain tool-call 集成留给阶段 4 后续 PR（需要 LLM 支持
 * function calling 且 @langchain/openai 的 bindTools 流式稳定）。
 * 这里先保证：路由 → preview/remote 流式 → 事件流转发 这条主干可用。
 */

import type { Gateway, GatewayEvent } from "./gateway.js";
import type {
  AgentEvent,
  AgentProfile,
  AgentRunParams,
  AgentSource,
  AgentSkill,
} from "./types.js";
import { route } from "./router.js";

/** 最多工具循环步数（对齐 iOS maxSteps = 6） */
export const MAX_STEPS = 6;

/** Profile → 系统提示词模板（对齐 iOS ClientAgentRuntime.runtimePrompt） */
const SYSTEM_PROMPTS: Record<AgentProfile, string> = {
  general:
    "你是 FlowMark 的通用写作助手。根据用户输入给出清晰、结构化的回答。如果需要参考文档内容，请显式说明。",
  academic:
    "你是 FlowMark 的学术写作助手。回答时注重引用准确、逻辑严谨，可使用 Markdown 表格与列表。",
  novel:
    "你是 FlowMark的小说创作助手。注重角色塑造、情节推进与场景描写。",
  html:
    "你是 FlowMark 的 HTML 作者助手。输出干净的 HTML5，必要时内联 CSS，避免外部依赖。",
};

/** skill → 附加提示词（对齐 iOS skill prompts） */
const SKILL_PROMPTS: Partial<Record<AgentSkill, string>> = {
  chat: "以对话方式回答。",
  academic: "用学术风格组织答案，必要时给出参考文献占位。",
  novel: "以小说叙事风格输出，可分章节。",
  htmlAuthor: "输出 HTML 文档，结构清晰、语义化。",
  presentation: "输出可作 PPT 大纲的 Markdown，按幻灯片分段。",
  translate: "翻译用户输入，保持术语一致。",
  mindmap: "输出 Markdown 思维导图（用缩进列表表达层级）。",
  compare: "输出对比表格。",
  review: "逐条审阅输入内容并给出修改建议。",
  plantUml: "输出 PlantUML 代码块。",
};

/** 运行时单个 run 的上下文 */
export interface RunContext {
  params: AgentRunParams;
  gateway: Gateway;
  /** 事件回调（每条 AgentEvent 透传给 Rust） */
  emit: (ev: AgentEvent) => void;
  /** 取消信号 */
  signal: AbortSignal;
  /** 工具调用钩子（侧车→Rust 反向 RPC，阶段 4 后续 PR 接入） */
  callTool?: (name: string, args: unknown) => Promise<unknown>;
}

/**
 * 执行一次 Agent run
 *
 * 流程：
 *   1. 路由（route） → emit metadata
 *   2. 选 system prompt
 *   3. gateway.stream() → 逐 delta emit
 *   4. done 时 emit done（含 sources，目前空）
 *
 * 取消：signal.aborted 时立即停止迭代，不发 done。
 */
export async function runAgent(ctx: RunContext): Promise<void> {
  const { params, gateway, emit, signal } = ctx;
  const profile = params.profile ?? "general";

  // 1. 路由
  const r = route(params.input, profile, params.forcedSkill);
  emit({
    type: "metadata",
    runId: params.runId,
    skill: r.skill,
    routedBy: r.routedBy,
  });

  // 2. 系统 prompt
  const skillExtra = SKILL_PROMPTS[r.skill] ?? "";
  const sysBase = SYSTEM_PROMPTS[profile];
  const systemPrompt = skillExtra ? `${sysBase}\n\n${skillExtra}` : sysBase;

  // 3. 流式
  let fullText = "";
  try {
    for await (const ev of gateway.stream(r.text, systemPrompt, signal)) {
      if (signal.aborted) return;
      const ge = ev as GatewayEvent;
      if (ge.type === "delta") {
        fullText += ge.text;
        emit({ type: "delta", runId: params.runId, text: ge.text });
      } else if (ge.type === "error") {
        emit({ type: "error", runId: params.runId, message: ge.message });
        return;
      }
      // done 在循环外处理
    }
  } catch (e) {
    emit({
      type: "error",
      runId: params.runId,
      message: (e as Error).message ?? String(e),
    });
    return;
  }

  if (signal.aborted) return;

  // 4. done
  const sources: AgentSource[] = [];
  emit({ type: "done", runId: params.runId, finalText: fullText, sources });
}
