/**
 * Runtime 单元测试
 *
 * 用 PreviewGateway（确定性、不联网）验证 runAgent 的事件流：
 *   - 首条事件是 metadata（含 skill + routedBy）
 *   - 中间若干 delta
 *   - 末条是 done（finalText 非空）
 */
import { describe, it, expect } from "vitest";
import { runAgent, MAX_STEPS } from "../agent/runtime.js";
import { PreviewGateway } from "../agent/gateway.js";
import type {
  AgentEvent,
  AgentRunParams,
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
    });
    // 取消时不应该 emit done
    const hasDone = events.some((e) => e.type === "done");
    expect(hasDone).toBe(false);
  });
});

describe("MAX_STEPS", () => {
  it("对齐 iOS maxSteps = 6", () => {
    expect(MAX_STEPS).toBe(6);
  });
});
