/**
 * Agent 工具定义（对齐 iOS ClientAgentRuntime 的 5 个工具）
 *
 * 阶段 4 Part 2：
 *   - 用 LangChain 的 DynamicStructuredTool + zod schema 包装
 *   - 工具实现不直接访问文件系统 / 索引，而是通过 ToolBackend 反向 RPC 调 Rust
 *   - 工具只读 + 提议草稿，绝不直接写文件（写文件走阶段 5 的 apply_agent_draft）
 *
 * 工具清单（对齐 iOS ClientAgentRuntime）：
 *   - document_search   跨文档分块检索（调 Rust search_index）
 *   - document_read     读单个 chunk 全文（调 Rust read_index_chunk）
 *   - document_index    构建/刷新文档索引（调 Rust build_index）
 *   - document_propose_replace  生成 SEARCH/REPLACE 草稿（不写文件）
 *   - document_propose_create   生成新文档草稿（不写文件）
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolBackend } from "./types.js";

/**
 * 构造一组绑定到指定 ToolBackend 的 LangChain 工具
 *
 * backend 由 server.ts 注入：sidecar 通过 stdio 向 Rust 发 tool.call，
 * Rust 执行后把结果回写。这样工具实现与传输层解耦。
 */
export function createAgentTools(backend: ToolBackend): DynamicStructuredTool[] {
  // ============ document_search ============
  const documentSearch = new DynamicStructuredTool({
    name: "document_search",
    description:
      "跨所有已索引的文档进行分块检索。返回匹配的分块列表（含 chunkId / documentId / heading / snippet / score）。" +
      "用户问及某主题、需要找相关内容时调用。query 是检索关键词。",
    schema: z.object({
      query: z.string().describe("检索关键词或短语"),
      limit: z.number().int().positive().max(50).optional().describe("返回结果数上限，默认 10"),
    }),
    func: async ({ query, limit }) => {
      const result = await backend.call("document_search", { query, limit: limit ?? 10 });
      return JSON.stringify(result);
    },
  });

  // ============ document_read ============
  const documentRead = new DynamicStructuredTool({
    name: "document_read",
    description:
      "读取单个分块的完整文本。传入 document_search 返回的 chunkId。" +
      "当需要看某分块完整内容（而非 snippet）时调用。",
    schema: z.object({
      chunkId: z.string().describe("分块 id（来自 document_search 的 chunkId）"),
    }),
    func: async ({ chunkId }) => {
      const result = await backend.call("document_read", { chunkId });
      return JSON.stringify(result);
    },
  });

  // ============ document_index ============
  const documentIndex = new DynamicStructuredTool({
    name: "document_index",
    description:
      "为一个文档构建或刷新本地索引。传入文档 id、标题、正文内容、updatedAt（毫秒）。" +
      "返回是否实际重新分块（指纹命中则跳过）。在对某文档做 search 之前如果还没建索引，先调这个。",
    schema: z.object({
      documentId: z.string().describe("文档 id"),
      title: z.string().optional().describe("文档标题"),
      content: z.string().describe("文档正文（Markdown）"),
      updatedAt: z.number().int().describe("文档最后更新时间戳（毫秒）"),
    }),
    func: async ({ documentId, title, content, updatedAt }) => {
      const result = await backend.call("document_index", {
        documentId,
        title,
        content,
        updatedAt,
      });
      return JSON.stringify(result);
    },
  });

  // ============ document_propose_replace ============
  const documentProposeReplace = new DynamicStructuredTool({
    name: "document_propose_replace",
    description:
      "提议对现有文档做 SEARCH/REPLACE 编辑。不直接写文件，只生成草稿。" +
      "blocks 是若干 {search, replace} 对：search 必须是文档中出现的唯一文本片段，replace 是替换后的内容。" +
      "用户会在 UI 预览 diff 后决定是否应用。返回草稿 id。",
    schema: z.object({
      documentId: z.string().describe("目标文档 id"),
      blocks: z
        .array(
          z.object({
            search: z.string().describe("要被替换的原文片段（必须在文档中唯一匹配）"),
            replace: z.string().describe("替换后的内容"),
          }),
        )
        .min(1)
        .describe("SEARCH/REPLACE 块列表"),
      note: z.string().optional().describe("本次编辑的说明（可选）"),
    }),
    func: async ({ documentId, blocks, note }) => {
      const result = await backend.call("document_propose_replace", {
        documentId,
        blocks,
        note,
      });
      return JSON.stringify(result);
    },
  });

  // ============ document_propose_create ============
  const documentProposeCreate = new DynamicStructuredTool({
    name: "document_propose_create",
    description:
      "提议创建一个新文档。不直接写文件，只生成草稿。" +
      "用户会在 UI 预览后决定是否创建。返回草稿 id。",
    schema: z.object({
      title: z.string().describe("新文档标题"),
      content: z.string().describe("新文档正文（Markdown）"),
      note: z.string().optional().describe("创建说明（可选）"),
    }),
    func: async ({ title, content, note }) => {
      const result = await backend.call("document_propose_create", {
        title,
        content,
        note,
      });
      return JSON.stringify(result);
    },
  });

  return [
    documentSearch,
    documentRead,
    documentIndex,
    documentProposeReplace,
    documentProposeCreate,
  ];
}

/** 工具名列表（用于校验 / 日志） */
export const TOOL_NAMES = [
  "document_search",
  "document_read",
  "document_index",
  "document_propose_replace",
  "document_propose_create",
] as const;
