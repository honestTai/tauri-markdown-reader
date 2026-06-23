/**
 * LLM 网关
 *
 * 对齐 iOS LLMGateway + PreviewAgentGateway + RemoteLLMGateway：
 *   - 未配置模型或无 API key → PreviewGateway（确定性本地预览，不联网）
 *   - 已配置 → ChatOpenAI（OpenAI 兼容端点，streaming）
 *
 * 策略模式：Gateway 抽象，子类实现 stream()/invoke()。
 * 这样 PreviewGateway 与 RemoteGateway 对 runtime 层等价。
 */

import { ChatOpenAI } from "@langchain/openai";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ModelConfiguration } from "./types.js";

/** 网关流式事件（对齐 iOS LLMStreamEvent） */
export type GatewayEvent =
  | { type: "delta"; text: string }
  | { type: "done"; fullText: string }
  | { type: "error"; message: string };

/** 流式 chunk（带 tool_calls） */
export type GatewayChunkEvent =
  | { type: "delta"; text: string }
  | { type: "tool_calls"; toolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> }
  | { type: "done"; fullText: string; finishReason?: string }
  | { type: "error"; message: string };

/** 网关抽象 */
export interface Gateway {
  /** 流式生成，逐 token 回调 */
  stream(
    prompt: string,
    systemPrompt: string,
    signal?: AbortSignal,
  ): AsyncIterable<GatewayEvent>;
}

/** 带工具的流式网关（阶段 4 Part 2 新增） */
export interface ToolAwareGateway extends Gateway {
  /**
   * 流式生成，同时支持 tool_calls。
   * - 若模型在流中产出 tool_calls，累积后一次性 emit `tool_calls` 事件
   * - 文本 chunk 仍逐条 emit `delta`
   * - 流结束 emit `done`（含 finishReason，模型可据此判断是否要继续工具循环）
   */
  streamWithTools(
    messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; tool_calls?: AIMessageChunk["tool_calls"] }>,
    tools: StructuredToolInterface[],
    signal?: AbortSignal,
  ): AsyncIterable<GatewayChunkEvent>;
}

/** 把 StructuredTool[] 转成 LangChain 的 ToolDefinition（bindTools 用，预留） */
// function toToolDefinitions(tools: StructuredToolInterface[]): ToolDefinition[] {
//   return tools.map((t) => ({
//     type: "function" as const,
//     function: {
//       name: t.name,
//       description: t.description ?? "",
//       schema: t.schema,
//     },
//   }));
// }

/** 判断是否需要走 Preview 回退 */
export function isPreviewMode(
  config: ModelConfiguration | undefined,
  apiKey: string | undefined,
): boolean {
  if (!config) return true;
  if (!apiKey || apiKey.trim() === "") return true;
  if (!config.endpoint || !config.model) return true;
  return false;
}

/**
 * Preview Gateway（确定性本地预览）
 *
 * 对齐 iOS PreviewAgentGateway.content(for:...)：
 *   - 不联网，纯函数
 *   - 输出固定模板，提示用户去 Settings 配置模型
 *
 * 在 tool-call 模式下，PreviewGateway 不会产出 tool_calls，
 * runtime 会直接进入 done（保持现有事件流契约）。
 */
export class PreviewGateway implements ToolAwareGateway {
  async *stream(
    prompt: string,
    systemPrompt: string,
    _signal?: AbortSignal,
  ): AsyncIterable<GatewayEvent> {
    const lines = [
      `**[Preview 模式]** 已收到输入：${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}`,
      "",
      "当前未配置模型端点或 API key，已回退到本地预览。",
      "请在「设置 → 模型配置」中填写 OpenAI 兼容端点（如 https://api.openai.com/v1）、模型名与 API key 后再发起 Agent 调用。",
      "",
      `system prompt 长度：${systemPrompt.length}`,
    ];
    let full = "";
    for (const line of lines) {
      const chunk = line + "\n";
      full += chunk;
      yield { type: "delta", text: chunk };
    }
    yield { type: "done", fullText: full };
  }

  async *streamWithTools(
    messages: Array<{ role: string; content: string }>,
    _tools: StructuredToolInterface[],
    _signal?: AbortSignal,
  ): AsyncIterable<GatewayChunkEvent> {
    // Preview 模式忽略 tools，把首条 user 消息当 prompt 走预览模板
    const userMsg = messages.find((m) => m.role === "user");
    const prompt = userMsg?.content ?? "";
    const lines = [
      `**[Preview 模式]** 已收到输入：${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}`,
      "",
      "当前未配置模型端点或 API key，已回退到本地预览。工具调用功能需要在「设置 → 模型配置」中配置可用端点后才会启用。",
    ];
    let full = "";
    for (const line of lines) {
      const chunk = line + "\n";
      full += chunk;
      yield { type: "delta", text: chunk };
    }
    yield { type: "done", fullText: full, finishReason: "stop" };
  }
}

/**
 * Remote Gateway（OpenAI 兼容）
 *
 * 用 @langchain/openai 的 ChatOpenAI，streaming=true，
 * 支持 openai / deepseek / glm / 自定义端点（baseURL + model）。
 */
export class RemoteGateway implements ToolAwareGateway {
  private readonly config: ModelConfiguration;
  private readonly apiKey: string;

  constructor(config: ModelConfiguration, apiKey: string) {
    this.config = config;
    this.apiKey = apiKey;
  }

  async *stream(
    prompt: string,
    systemPrompt: string,
    signal?: AbortSignal,
  ): AsyncIterable<GatewayEvent> {
    const model = new ChatOpenAI({
      openAIApiKey: this.apiKey,
      configuration: { baseURL: this.config.endpoint },
      modelName: this.config.model,
      streaming: true,
      temperature: 0.7,
      timeout: this.config.timeoutSecs * 1000,
    });

    try {
      const stream = await model.stream(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        { signal },
      );
      let full = "";
      for await (const chunk of stream) {
        const text = typeof chunk.content === "string" ? chunk.content : "";
        if (text) {
          full += text;
          yield { type: "delta", text };
        }
      }
      yield { type: "done", fullText: full };
    } catch (e) {
      yield { type: "error", message: (e as Error).message ?? String(e) };
    }
  }

  async *streamWithTools(
    messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; tool_calls?: AIMessageChunk["tool_calls"] }>,
    tools: StructuredToolInterface[],
    signal?: AbortSignal,
  ): AsyncIterable<GatewayChunkEvent> {
    const model = new ChatOpenAI({
      openAIApiKey: this.apiKey,
      configuration: { baseURL: this.config.endpoint },
      modelName: this.config.model,
      streaming: true,
      temperature: 0.7,
      timeout: this.config.timeoutSecs * 1000,
    });
    const bound = model.bindTools(tools);

    // 把消息转成 LangChain 消息格式
    const lcMessages = messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
      }
      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: "assistant",
          content: m.content,
          tool_calls: m.tool_calls,
        };
      }
      return { role: m.role, content: m.content };
    });

    try {
      const stream = await bound.stream(lcMessages, { signal });
      let full = "";
      // 累积 tool_call_chunks，最后一次性 emit（避免半截 JSON）
      const toolCallAccumulator = new Map<number, { name?: string; args: string; id?: string }>();
      let finishReason: string | undefined;

      for await (const chunk of stream) {
        // 文本 delta
        const text = typeof chunk.content === "string" ? chunk.content : "";
        if (text) {
          full += text;
          yield { type: "delta", text };
        }
        // tool_call chunks
        if (chunk.tool_call_chunks && chunk.tool_call_chunks.length > 0) {
          for (const tc of chunk.tool_call_chunks) {
            const idx = tc.index ?? 0;
            const acc = toolCallAccumulator.get(idx) ?? { name: undefined, args: "", id: undefined };
            if (tc.name) acc.name = tc.name;
            if (typeof tc.args === "string") acc.args += tc.args;
            if (tc.id) acc.id = tc.id;
            toolCallAccumulator.set(idx, acc);
          }
        }
        // response_metadata 里的 finish_reason
        if (
          !finishReason &&
          chunk.response_metadata &&
          typeof chunk.response_metadata.finish_reason === "string"
        ) {
          finishReason = chunk.response_metadata.finish_reason;
        }
      }

      // 流结束：若有累积的 tool_calls，先 emit
      if (toolCallAccumulator.size > 0) {
        const toolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> = [];
        const sortedIdx = Array.from(toolCallAccumulator.keys()).sort((a, b) => a - b);
        for (const idx of sortedIdx) {
          const acc = toolCallAccumulator.get(idx)!;
          if (!acc.name) continue;
          let args: Record<string, unknown> = {};
          if (acc.args) {
            try {
              args = JSON.parse(acc.args) as Record<string, unknown>;
            } catch {
              args = { _raw: acc.args };
            }
          }
          toolCalls.push({ name: acc.name, args, id: acc.id });
        }
        if (toolCalls.length > 0) {
          yield { type: "tool_calls", toolCalls };
        }
      }

      yield { type: "done", fullText: full, finishReason: finishReason ?? "stop" };
    } catch (e) {
      yield { type: "error", message: (e as Error).message ?? String(e) };
    }
  }
}

/**
 * 工厂：根据配置自动选择 Preview 或 Remote
 *
 * 返回类型统一为 ToolAwareGateway，runtime 可以无差别调 streamWithTools。
 */
export function createGateway(
  config: ModelConfiguration | undefined,
  apiKey: string | undefined,
): ToolAwareGateway {
  if (isPreviewMode(config, apiKey)) {
    return new PreviewGateway();
  }
  return new RemoteGateway(config!, apiKey!);
}
