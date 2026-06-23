/**
 * Gateway 单元测试
 *
 * PreviewGateway 是纯函数，可直接验证输出确定性。
 * RemoteGateway 涉及网络，不在此测（留给 e2e）。
 */
import { describe, it, expect } from "vitest";
import {
  PreviewGateway,
  isPreviewMode,
  createGateway,
} from "../agent/gateway.js";
import type { ModelConfiguration } from "../agent/types.js";

function makeConfig(over: Partial<ModelConfiguration> = {}): ModelConfiguration {
  return {
    endpoint: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    timeoutSecs: 60,
    contextWindow: 16384,
    ...over,
  };
}

describe("isPreviewMode", () => {
  it("无配置 → preview", () => {
    expect(isPreviewMode(undefined, undefined)).toBe(true);
  });

  it("无 api key → preview", () => {
    expect(isPreviewMode(makeConfig(), "")).toBe(true);
    expect(isPreviewMode(makeConfig(), undefined)).toBe(true);
  });

  it("无 endpoint 或 model → preview", () => {
    expect(isPreviewMode(makeConfig({ endpoint: "" }), "k")).toBe(true);
    expect(isPreviewMode(makeConfig({ model: "" }), "k")).toBe(true);
  });

  it("配置齐全 → 非 preview", () => {
    expect(isPreviewMode(makeConfig(), "sk-xxx")).toBe(false);
  });
});

describe("createGateway", () => {
  it("配置齐全返回 RemoteGateway", () => {
    const g = createGateway(makeConfig(), "sk-xxx");
    expect(g.constructor.name).toBe("RemoteGateway");
  });

  it("配置缺失返回 PreviewGateway", () => {
    const g = createGateway(undefined, undefined);
    expect(g.constructor.name).toBe("PreviewGateway");
  });
});

describe("PreviewGateway.stream", () => {
  it("产出 delta + done 事件", async () => {
    const gw = new PreviewGateway();
    const events = [];
    for await (const ev of gw.stream("hello", "sys")) {
      events.push(ev);
    }
    const types = events.map((e) => e.type);
    expect(types).toContain("delta");
    expect(types[types.length - 1]).toBe("done");
  });

  it("delta 内容包含 Preview 标记", async () => {
    const gw = new PreviewGateway();
    let full = "";
    for await (const ev of gw.stream("用户输入", "sys")) {
      if (ev.type === "delta") full += ev.text;
    }
    expect(full).toContain("[Preview 模式]");
    expect(full).toContain("用户输入");
  });

  it("输入超长时 delta 含省略号", async () => {
    const gw = new PreviewGateway();
    const long = "a".repeat(200);
    let full = "";
    for await (const ev of gw.stream(long, "sys")) {
      if (ev.type === "delta") full += ev.text;
    }
    expect(full).toContain("…");
  });

  it("done.fullText 等于所有 delta 拼接", async () => {
    const gw = new PreviewGateway();
    let concat = "";
    let doneText = "";
    for await (const ev of gw.stream("x", "y")) {
      if (ev.type === "delta") concat += ev.text;
      if (ev.type === "done") doneText = ev.fullText;
    }
    expect(concat).toBe(doneText);
  });
});
