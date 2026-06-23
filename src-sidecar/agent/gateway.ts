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
import type { ModelConfiguration } from "./types.js";

/** 网关流式事件（对齐 iOS LLMStreamEvent） */
export type GatewayEvent =
  | { type: "delta"; text: string }
  | { type: "done"; fullText: string }
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
 */
export class PreviewGateway implements Gateway {
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
}

/**
 * Remote Gateway（OpenAI 兼容）
 *
 * 用 @langchain/openai 的 ChatOpenAI，streaming=true，
 * 支持 openai / deepseek / glm / 自定义端点（baseURL + model）。
 */
export class RemoteGateway implements Gateway {
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
}

/**
 * 工厂：根据配置自动选择 Preview 或 Remote
 */
export function createGateway(
  config: ModelConfiguration | undefined,
  apiKey: string | undefined,
): Gateway {
  if (isPreviewMode(config, apiKey)) {
    return new PreviewGateway();
  }
  return new RemoteGateway(config!, apiKey!);
}
