/**
 * Tools 单元测试
 *
 * 验证 createAgentTools 产出的 5 个工具：
 *   - 名字对齐 iOS ClientAgentRuntime
 *   - schema 必填字段正确
 *   - 调用时把参数透传给 backend.call，返回 JSON.stringify(result)
 */
import { describe, it, expect, vi, type Mock } from "vitest";
import { createAgentTools, TOOL_NAMES } from "../agent/tools.js";
import type { ToolBackend } from "../agent/types.js";

function makeBackend(): ToolBackend & { calls: Mock } {
  const calls = vi.fn().mockResolvedValue({ ok: true });
  return { calls, call: calls } as unknown as ToolBackend & { calls: Mock };
}

describe("TOOL_NAMES", () => {
  it("对齐 iOS ClientAgentRuntime 的 5 个工具", () => {
    expect(TOOL_NAMES).toEqual([
      "document_search",
      "document_read",
      "document_index",
      "document_propose_replace",
      "document_propose_create",
    ]);
  });
});

describe("createAgentTools", () => {
  it("返回 5 个工具，名字与 TOOL_NAMES 一致", () => {
    const backend = makeBackend();
    const tools = createAgentTools(backend);
    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("document_search 透传 query/limit 到 backend", async () => {
    const backend = makeBackend();
    const tools = createAgentTools(backend);
    const search = tools.find((t) => t.name === "document_search")!;
    const out = await search.invoke({ query: "react", limit: 5 });
    expect(backend.calls).toHaveBeenCalledWith("document_search", {
      query: "react",
      limit: 5,
    });
    expect(out).toBe(JSON.stringify({ ok: true }));
  });

  it("document_search limit 缺省时传 10", async () => {
    const backend = makeBackend();
    const tools = createAgentTools(backend);
    const search = tools.find((t) => t.name === "document_search")!;
    await search.invoke({ query: "x" });
    expect(backend.calls).toHaveBeenCalledWith("document_search", {
      query: "x",
      limit: 10,
    });
  });

  it("document_read 透传 chunkId", async () => {
    const backend = makeBackend();
    const tools = createAgentTools(backend);
    const read = tools.find((t) => t.name === "document_read")!;
    await read.invoke({ chunkId: "doc1-0" });
    expect(backend.calls).toHaveBeenCalledWith("document_read", {
      chunkId: "doc1-0",
    });
  });

  it("document_index 透传全部字段", async () => {
    const backend = makeBackend();
    const tools = createAgentTools(backend);
    const index = tools.find((t) => t.name === "document_index")!;
    await index.invoke({
      documentId: "d1",
      title: "T",
      content: "# Hi",
      updatedAt: 1000,
    });
    expect(backend.calls).toHaveBeenCalledWith("document_index", {
      documentId: "d1",
      title: "T",
      content: "# Hi",
      updatedAt: 1000,
    });
  });

  it("document_propose_replace 透传 blocks", async () => {
    const backend = makeBackend();
    const tools = createAgentTools(backend);
    const prop = tools.find((t) => t.name === "document_propose_replace")!;
    await prop.invoke({
      documentId: "d1",
      blocks: [{ search: "a", replace: "b" }],
    });
    expect(backend.calls).toHaveBeenCalledWith("document_propose_replace", {
      documentId: "d1",
      blocks: [{ search: "a", replace: "b" }],
      note: undefined,
    });
  });

  it("document_propose_create 透传 title/content", async () => {
    const backend = makeBackend();
    const tools = createAgentTools(backend);
    const prop = tools.find((t) => t.name === "document_propose_create")!;
    await prop.invoke({ title: "New", content: "body" });
    expect(backend.calls).toHaveBeenCalledWith("document_propose_create", {
      title: "New",
      content: "body",
      note: undefined,
    });
  });
});
