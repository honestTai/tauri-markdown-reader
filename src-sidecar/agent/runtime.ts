/**
 * Agent 运行时
 *
 * 对齐 iOS ClientAgentRuntime：
 *   - 最多 6 步 tool-call 循环
 *   - 工具只读 + 提议草稿（绝不直接写文件）
 *   - 每步工具调用 → tool_call 事件 → 工具结果 → tool_result 事件
 *
 * 阶段 4 Part 2：真正接入 LangChain bindTools 的流式 tool-call 循环。
 *   1. 路由 → 选系统提示词
 *   2. gateway.streamWithTools() 流式生成
 *      - 文本 delta → emit delta
 *      - 模型产出 tool_calls → emit tool_call → 通过 ToolBackend 反向调 Rust → emit tool_result
 *      - 把工具结果作为 tool 消息塞回下一轮
 *   3. 若 finishReason === "tool_calls"，进入下一轮（最多 MAX_STEPS）
 *   4. done 时 emit done（含最终文本 + sources）
 *
 * Preview 模式下 gateway 不产出 tool_calls，直接走一轮就 done，
 * 事件流契约与 Part 1 完全一致。
 */

import type { ToolAwareGateway, GatewayChunkEvent } from "./gateway.js";
import type {
  AgentEvent,
  AgentProfile,
  AgentRunParams,
  AgentSource,
  AgentSkill,
  ToolBackend,
} from "./types.js";
import { route } from "./router.js";
import { createAgentTools } from "./tools.js";
import { fetchSkillList, fetchSkillBody, routeByUserSkills } from "./skill_resolver.js";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

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
  gateway: ToolAwareGateway;
  /** 事件回调（每条 AgentEvent 透传给 Rust） */
  emit: (ev: AgentEvent) => void;
  /** 取消信号 */
  signal: AbortSignal;
  /** 工具后端（sidecar→Rust 反向 RPC） */
  backend: ToolBackend;
}

/** 对话历史中的单条消息（runtime 内部表示） */
interface LoopMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: AIMessageChunk["tool_calls"];
}

/**
 * 执行一次 Agent run
 *
 * 流程：
 *   1. 路由（route） → emit metadata
 *   2. 选 system prompt
 *   3. 循环（最多 MAX_STEPS）：
 *      a. gateway.streamWithTools() → 逐 delta emit
 *      b. 收到 tool_calls → emit tool_call → 调 backend → emit tool_result
 *      c. 把 assistant + tool 结果塞回下一轮 messages
 *      d. 若本轮无 tool_calls 或 finishReason !== "tool_calls"，跳出
 *   4. done 时 emit done（含最终文本 + sources）
 *
 * 取消：signal.aborted 时立即停止迭代，不发 done。
 */
export async function runAgent(ctx: RunContext): Promise<void> {
  const { params, gateway, emit, signal, backend } = ctx;
  const profile = params.profile ?? "general";

  // 0. 拉取用户 skill 列表（阶段 7）
  //    失败 / 空都退化为内置路由
  const userSkills = await fetchSkillList(backend);

  // 1. 路由：先试用户 skill，再退化到内置 router
  //    forcedSkill 在阶段 7 既可能是内置 AgentSkill，也可能是用户 skill name
  //    用户 skill 命中时，skill 字段返回用户 skill name（runtime 会从 body 取 prompt）
  let skill: string = params.forcedSkill ?? "chat";
  let routedBy: "forced" | "slash" | "intent" | "default" | "override" = "default";
  let text = params.input;

  const userHit = routeByUserSkills(params.input, userSkills, params.forcedSkill);
  if (userHit) {
    skill = userHit.name;
    routedBy = userHit.routedBy;
    text = userHit.text;
  } else {
    // 退化到内置 router（forcedSkill 传枚举值）
    const r = route(params.input, profile, params.forcedSkill);
    skill = r.skill;
    routedBy = r.routedBy;
    text = r.text;
  }

  emit({
    type: "metadata",
    runId: params.runId,
    skill: skill as AgentSkill,
    routedBy,
  });

  // 2. 系统 prompt：
  //    - 若命中用户 skill，从 body 取 systemPrompt（fetchSkillBody）
  //    - 否则用内置 SYSTEM_PROMPTS + SKILL_PROMPTS
  let systemPrompt: string;
  const userSkill = userSkills.find((s) => s.name === skill);
  if (userSkill) {
    const body = await fetchSkillBody(backend, skill);
    const sysBase = SYSTEM_PROMPTS[profile];
    systemPrompt = body ? `${sysBase}\n\n${body}` : sysBase;
  } else {
    const skillExtra = SKILL_PROMPTS[skill as AgentSkill] ?? "";
    const sysBase = SYSTEM_PROMPTS[profile];
    systemPrompt = skillExtra ? `${sysBase}\n\n${skillExtra}` : sysBase;
  }

  // 3. 构造 tools + 初始消息
  //    若用户 skill 声明了 tools 白名单，按白名单过滤
  let tools: StructuredToolInterface[] = createAgentTools(backend);
  if (userSkill && userSkill.tools.length > 0) {
    const allow = new Set(userSkill.tools);
    tools = tools.filter((t) => allow.has(t.name));
  }
  const messages: LoopMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: text },
  ];

  let finalText = "";
  const sources: AgentSource[] = [];

  // 4. tool-call 循环
  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) return;

    let stepText = "";
    let stepToolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> = [];
    let finishReason: string | undefined;
    let errored: string | null = null;

    try {
      for await (const ev of gateway.streamWithTools(messages, tools, signal)) {
        if (signal.aborted) return;
        const ge = ev as GatewayChunkEvent;
        if (ge.type === "delta") {
          stepText += ge.text;
          emit({ type: "delta", runId: params.runId, text: ge.text });
        } else if (ge.type === "tool_calls") {
          stepToolCalls = ge.toolCalls;
        } else if (ge.type === "done") {
          finishReason = ge.finishReason;
        } else if (ge.type === "error") {
          errored = ge.message;
        }
      }
    } catch (e) {
      errored = (e as Error).message ?? String(e);
    }

    if (errored) {
      emit({ type: "error", runId: params.runId, message: errored });
      return;
    }

    // 累积本轮文本到最终输出（多轮 tool-call 循环的文本拼接）
    if (stepText) {
      finalText += stepText;
    }

    // 5. 没有工具调用 → 收尾
    if (stepToolCalls.length === 0) {
      break;
    }

    // 6. 把 assistant 消息（含 tool_calls）塞回历史
    const assistantToolCalls: AIMessageChunk["tool_calls"] = stepToolCalls.map((tc, idx) => ({
      name: tc.name,
      args: tc.args,
      id: tc.id ?? `call_${params.runId}_${step}_${idx}`,
      type: "tool_call" as const,
    }));
    messages.push({
      role: "assistant",
      content: stepText,
      tool_calls: assistantToolCalls,
    });

    // 7. 逐个执行工具，emit tool_call / tool_result，把结果作为 tool 消息塞回
    for (let i = 0; i < stepToolCalls.length; i++) {
      const tc = stepToolCalls[i];
      const callId = assistantToolCalls[i]!.id!;

      emit({
        type: "tool_call",
        runId: params.runId,
        tool: tc.name,
        args: tc.args,
      });

      let result: unknown;
      try {
        if (signal.aborted) return;
        result = await backend.call(tc.name, tc.args);
      } catch (e) {
        result = { error: (e as Error).message ?? String(e) };
      }

      emit({
        type: "tool_result",
        runId: params.runId,
        tool: tc.name,
        result,
      });

      messages.push({
        role: "tool",
        content: typeof result === "string" ? result : JSON.stringify(result),
        tool_call_id: callId,
      });

      // 从 document_search 结果里抽 sources（用于最终 done 事件）
      if (tc.name === "document_search") {
        collectSources(result, sources);
      }
    }

    // finishReason 不是 tool_calls 说明模型已经不再要工具了，但保险起见继续循环
    // （多数 OpenAI 兼容端点在 tool_calls 时返回 finishReason="tool_calls"）
    if (finishReason && finishReason !== "tool_calls") {
      break;
    }
  }

  if (signal.aborted) return;

  // 8. done
  emit({ type: "done", runId: params.runId, finalText, sources });
}

/** 从 document_search 的结果里提取 sources（去重） */
function collectSources(result: unknown, out: AgentSource[]): void {
  if (!result || typeof result !== "object") return;
  const hits = (result as { hits?: unknown[] }).hits;
  if (!Array.isArray(hits)) return;
  for (const h of hits) {
    if (!h || typeof h !== "object") continue;
    const hit = h as Record<string, unknown>;
    out.push({
      documentId: String(hit.documentId ?? ""),
      chunkId: hit.chunkId ? String(hit.chunkId) : undefined,
      heading: hit.heading ? String(hit.heading) : undefined,
      snippet: String(hit.snippet ?? ""),
      score: typeof hit.score === "number" ? hit.score : 0,
    });
  }
}
