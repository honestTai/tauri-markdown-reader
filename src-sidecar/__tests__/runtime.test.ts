/**
 * Runtime 单元测试
 *
 * 用 PreviewGateway（确定性、不联网）验证 runAgent 的事件流：
 *   - 首条事件是 metadata（含 skill + routedBy）
 *   - 中间若干 delta
 *   - 末条是 done（finalText 非空）
 *
 * Preview 模式不会产出 tool_calls，所以 backend 不会被调用；
 * 但 RunContext 仍要求传入 backend（mock 一个用于断言）。
 */
import { describe, it, expect, vi, type Mock } from "vitest";
import { runAgent, MAX_STEPS } from "../agent/runtime.js";
import { PreviewGateway } from "../agent/gateway.js";
import type {
  AgentEvent,
  AgentRunParams,
  ToolBackend,
} from "../agent/types.js";

function makeParams(over: Partial<AgentRunParams> = {}): AgentRunParams {
  return {
    runId: "r1",
    sessionId: "s1",
    input: "随便聊聊",
    profile: "general",
    modelConfig: {
      endpoint: "",
      model: "",
      timeoutSecs: 60,
      contextWindow: 16384,
    },
    apiKey: "",
    ...over,
  };
}

/** mock backend：Preview 模式下不应被调用，断言用 */
function makeBackend(): ToolBackend & { calls: Mock } {
  const calls = vi.fn().mockResolvedValue({ ok: true });
  return {
    calls,
    call: calls,
  } as unknown as ToolBackend & { calls: Mock };
}

async function collectEvents(
  params: AgentRunParams,
  signal: AbortSignal,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  await runAgent({
    params,
    gateway: new PreviewGateway(),
    emit: (ev) => events.push(ev),
    signal,
    backend: makeBackend(),
  });
  return events;
}

describe("runAgent - 事件流顺序", () => {
  it("首条是 metadata，末条是 done", async () => {
    const evs = await collectEvents(makeParams(), new AbortController().signal);
    expect(evs[0].type).toBe("metadata");
    expect(evs[evs.length - 1].type).toBe("done");
  });

  it("metadata 含 skill 与 routedBy", async () => {
    const evs = await collectEvents(makeParams(), new AbortController().signal);
    const meta = evs[0];
    if (meta.type !== "metadata") throw new Error("断言失败");
    expect(meta.skill).toBe("chat");
    expect(meta.routedBy).toBe("default");
    expect(meta.runId).toBe("r1");
  });

  it("delta 事件至少一条", async () => {
    const evs = await collectEvents(makeParams(), new AbortController().signal);
    const deltas = evs.filter((e) => e.type === "delta");
    expect(deltas.length).toBeGreaterThan(0);
  });

  it("done.finalText 等于所有 delta 拼接", async () => {
    const evs = await collectEvents(makeParams(), new AbortController().signal);
    let concat = "";
    let doneText = "";
    for (const e of evs) {
      if (e.type === "delta") concat += e.text;
      if (e.type === "done") doneText = e.finalText;
    }
    expect(concat).toBe(doneText);
    expect(doneText.length).toBeGreaterThan(0);
  });
});

describe("runAgent - 路由集成", () => {
  it("/translate 命中 slash skill", async () => {
    const evs = await collectEvents(
      makeParams({ input: "/translate hello" }),
      new AbortController().signal,
    );
    const meta = evs[0];
    if (meta.type !== "metadata") throw new Error("断言失败");
    expect(meta.skill).toBe("translate");
    expect(meta.routedBy).toBe("slash");
  });

  it("forced skill 覆盖路由", async () => {
    const evs = await collectEvents(
      makeParams({ input: "随便聊聊", forcedSkill: "academic" }),
      new AbortController().signal,
    );
    const meta = evs[0];
    if (meta.type !== "metadata") throw new Error("断言失败");
    expect(meta.skill).toBe("academic");
    expect(meta.routedBy).toBe("forced");
  });
});

describe("runAgent - 取消", () => {
  it("signal 已 abort 时不发 done", async () => {
    const ac = new AbortController();
    ac.abort();
    const events: AgentEvent[] = [];
    await runAgent({
      params: makeParams(),
      gateway: new PreviewGateway(),
      emit: (ev) => events.push(ev),
      signal: ac.signal,
      backend: makeBackend(),
    });
    // 取消时不应该 emit done
    const hasDone = events.some((e) => e.type === "done");
    expect(hasDone).toBe(false);
  });
});

describe("runAgent - Preview 不触发工具", () => {
  it("Preview 模式下 backend.call 不被调用", async () => {
    const backend = makeBackend();
    await runAgent({
      params: makeParams(),
      gateway: new PreviewGateway(),
      emit: () => {},
      signal: new AbortController().signal,
      backend,
    });
    expect(backend.calls).not.toHaveBeenCalled();
  });
});

describe("MAX_STEPS", () => {
  it("对齐 iOS maxSteps = 6", () => {
    expect(MAX_STEPS).toBe(6);
  });
});

// ============ 工具调用循环（mock ToolAwareGateway） ============

import type { ToolAwareGateway, GatewayChunkEvent } from "../agent/gateway.js";

/**
 * MockGateway：按脚本依次产出预设的 chunk 序列
 *
 * 每个 step 是一轮 streamWithTools 的输出（一个 GatewayChunkEvent 数组）。
 * 第一次调 streamWithTools 吐 step[0]，第二次吐 step[1]，依此。
 */
class MockGateway implements ToolAwareGateway {
  constructor(private readonly steps: GatewayChunkEvent[][]) {}
  private callIdx = 0;

  async *stream(): AsyncIterable<{ type: "delta"; text: string } | { type: "done"; fullText: string } | { type: "error"; message: string }> {
    // 不该被调（runtime 走 streamWithTools），但接口要求实现
    yield { type: "done", fullText: "" };
  }

  async *streamWithTools(): AsyncIterable<GatewayChunkEvent> {
    const step = this.steps[this.callIdx] ?? [{ type: "done", fullText: "(no more steps)", finishReason: "stop" }];
    this.callIdx++;
    for (const ev of step) yield ev;
  }
}

describe("runAgent - 工具调用循环", () => {
  it("模型产出 tool_calls → 调 backend → emit tool_call/tool_result → 下一轮 done", async () => {
    const backend = makeBackend();
    // 让 backend 对 document_search 返回固定 hits
    backend.calls.mockResolvedValueOnce({
      hits: [
        { documentId: "d1", chunkId: "d1-0", heading: "H", snippet: "S", score: 1 },
      ],
    });

    const gateway = new MockGateway([
      // 第一轮：模型要调 document_search
      [
        { type: "delta", text: "让我搜索一下。" },
        {
          type: "tool_calls",
          toolCalls: [{ name: "document_search", args: { query: "react", limit: 5 }, id: "c1" }],
        },
        { type: "done", fullText: "让我搜索一下。", finishReason: "tool_calls" },
      ],
      // 第二轮：模型拿到结果，给出最终答案
      [
        { type: "delta", text: "找到了相关内容。" },
        { type: "done", fullText: "找到了相关内容。", finishReason: "stop" },
      ],
    ]);

    const events: AgentEvent[] = [];
    await runAgent({
      params: makeParams(),
      gateway,
      emit: (ev) => events.push(ev),
      signal: new AbortController().signal,
      backend,
    });

    // 事件流：metadata → delta → tool_call → tool_result → delta → done
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("metadata");
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_result");
    expect(types[types.length - 1]).toBe("done");

    // backend 被调一次
    expect(backend.calls).toHaveBeenCalledTimes(1);
    expect(backend.calls).toHaveBeenCalledWith("document_search", { query: "react", limit: 5 });

    // done 事件的 sources 来自 document_search 的 hits
    const done = events.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }>;
    expect(done.sources).toHaveLength(1);
    expect(done.sources[0]?.documentId).toBe("d1");
    expect(done.sources[0]?.chunkId).toBe("d1-0");

    // finalText 是两轮 delta 的拼接
    expect(done.finalText).toBe("让我搜索一下。找到了相关内容。");
  });

  it("MAX_STEPS 限制循环次数（避免无限 tool_calls）", async () => {
    const backend = makeBackend();
    // backend 每次都返回空，模型每次都要工具
    backend.calls.mockResolvedValue({ hits: [] });

    // 每一轮模型都要 document_search，永不 stop
    const endlessStep: GatewayChunkEvent[] = [
      {
        type: "tool_calls",
        toolCalls: [{ name: "document_search", args: { query: "x" }, id: "c" }],
      },
      { type: "done", fullText: "", finishReason: "tool_calls" },
    ];
    const gateway = new MockGateway(
      Array.from({ length: 20 }, () => endlessStep),
    );

    const events: AgentEvent[] = [];
    await runAgent({
      params: makeParams(),
      gateway,
      emit: (ev) => events.push(ev),
      signal: new AbortController().signal,
      backend,
    });

    // tool_call 事件最多 MAX_STEPS 次
    const toolCalls = events.filter((e) => e.type === "tool_call");
    expect(toolCalls.length).toBeLessThanOrEqual(MAX_STEPS);

    // 末尾仍要发 done（循环到上限后跳出）
    const last = events[events.length - 1];
    expect(last.type === "done" || last.type === "error").toBe(true);
  });
});
