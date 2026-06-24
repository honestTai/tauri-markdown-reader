# FlowMark Windows 版迁移计划

> 源项目：`C:\Users\hones\Desktop\project\flowmark-ios`（SwiftUI，iOS + macOS，纯客户端单机）
> 目标项目：`C:\Users\hones\Desktop\project\tauri-markdown-reader`（Tauri 2 + React 19 + Rust + Node Sidecar）
> 目标分支：`flowmark/windows-rewrite`（已清空旧代码，仅保留本文档作为规格）
> 产物：**Windows-only** 的 FlowMark 桌面版，对齐 iOS/Mac 功能集，从零重写
> 生成日期：2026-06-23（v2：全量重写 + LangChain Agent + Windows-only）

---

## 〇、定位与关键决策

### 源项目（flowmark-ios）是什么

纯客户端、单机的 SwiftUI 应用（iOS App + Mac App + iOS Share Extension 三个 target）：

- **没有** FlowMark 自建服务器
- **没有** 订阅 / StoreKit / 会员校验
- **没有** 公告远端拉取（`AnnouncementStore.AnnouncementConfiguration` 恒为 `.missing`）
- 所有文档内容、Agent 会话历史、本地索引、操作历史都只留在设备本地
- 唯一对外网络：用户自己在 Settings 里配置的 OpenAI 兼容 chat completions 端点

### 目标项目现状（v2：已清空）

- `flowmark/windows-rewrite` 分支已 force push，工作区**完全清空**，仅保留本迁移文档
- 旧 Tauri/Rust/React 代码已全部删除，**不从 git 历史捞回任何旧文件作参考**
- 本地 `.git` 历史与远程 `main`（9ac8277）作为回滚点保留，但**新代码不从那里抄**
- 所有 Tauri 骨架、CI、`agent_router.rs`、CSP、Windows 签名配置一律**从零重写**

### 迁移定位（关键决策，v2 更新）

用户明确："现在的代码全部不要了"+"全部重新写"+"Agent 部分用 LangChain"+"Windows 只做 Windows"。

理解为：

- **从一张白纸按本文档重写**，不沿用任何旧实现（避免旧代码误导/幻觉）
- **Agent 部分用 LangChain（`langchain.js`）实现**，跑在 Node sidecar 进程里
  - 理由：Mac/iOS 没有成熟的 LangChain 生态所以手撸 `RemoteLLMGateway` + `ClientAgentRuntime`；Windows 侧有 LangChain，省掉手撸 tool-call 循环最易出幻觉的部分
  - 调研依据（GitHub 搜索 2026-06-23）：
    - `langchain-ai/langchainjs` 17.8k★，TypeScript，官方维护，活跃（2026-06-23 仍有提交）
    - Tauri + Node sidecar 模式有多个先例：`synle/tauri-desktop-node-sidecar-template`、`marti-1/tauri-sidecar-node-example`、`qQAQq-bot/Job-Sync`（26★，Tauri+Vue+Node sidecar Windows 桌面）
    - sidecar 通信模式成熟：Tauri `tauri-plugin-shell` + `externalBin`，或 Rust `std::process::Command` + stdio JSON-RPC
- **Windows-only**：`bundle.targets: ["msi", "nsis"]`，不配 macOS，砍掉所有 macOS 专属代码
- **架构**：Tauri Rust（壳 + 文件系统 + 持久化 + 索引）+ Node Sidecar（LangChain Agent）+ React 19（UI）
- **真正要迁的是 FlowMark iOS/Mac 的产品形态**：Agent skill 体系、本地索引、长文档记忆、操作历史、Mac 写回流程、模型配置 UI、7 语言本地化、PlantUML 渲染、纯客户端定位

---

## 一、调研结论：要迁什么

### 1.1 源项目（flowmark-ios）能力清单

| 模块 | iOS/Mac 实现 | 职责 |
|---|---|---|
| 文档库 | `DocumentLibrary` | 增删改、收藏、选中、激活、版本（`DocumentVersion`）、模板、剪贴板/导入新建；UserDefaults 持久化；首启注入样例 |
| 阅读/编辑 | `ReaderView` + `MarkdownPreview` + `MarkdownRenderNormalizer` | 分页渲染、Mermaid/PlantUML 围栏规整、KaTeX、代码高亮、callout |
| Agent 路由 | `AgentRouter` | slash 别名 → 意图关键词 → Profile 默认 skill，纯函数；`stripSlashPrefix` |
| Agent 会话 | `AgentSession` + `ConfiguredAgentGateway` + `RemoteLLMGateway` | 消息历史、归档会话、取消、流式；OpenAI 兼容 chat completions，流式 + tool-call 循环；未配置时回退 `PreviewAgentGateway`（确定性本地预览，不联网） |
| 本地工具运行时 | `ClientAgentRuntime` | `document.index/search/read/propose_replace/propose_create`，最多 6 步，只读 + 提议草稿 |
| 本地索引 | `ClientDocumentIndex` + `ClientDocumentIndexStore` | SQLite，按内容指纹缓存分块 |
| 长文档记忆 | `LongformMemoryStore` | 按文档/profile/route 维度片段 |
| 操作历史 | `OperationHistoryStore` | imported/openedExternal/edited/ranAgent/previewedHTML/savedAgentOutput/deletedDocument |
| 模型配置 | `ModelConfigurationStore` | 端点/模型 UserDefaults，API key Keychain |
| 导出 | `DocumentExportService` | `.md/.html/.pdf`（`DocumentExportKind`） |
| Mac 写回 | `MacAgentDraftResolver` | SEARCH/REPLACE 块 / 选区替换 / 整文档，落回编辑器并保留版本历史 |
| 本地化 | 7 语言 `.lproj/Localizable.strings` | en/zh-Hans/zh-Hant/ja/ko/de/fr，每个 497 行 |
| PlantUML | `PlantUMLRenderURL` | zlib deflate + PlantUML 字母表编码成 plantuml.com png URL |
| Share Extension | `FlowMarkShareExtension` | App Group 共享导入收件箱 |

### 1.2 目标项目架构（v2：从零重写）

三进程架构：

```
┌──────────────────────────────────────────────────────────┐
│  Tauri 主进程（Rust，flowmark.exe）                       │
│  - 窗口/CSP/命令注册                                      │
│  - 文件系统（工作区扫描、读写、版本备份）                  │
│  - 持久化（library.json / sessions.json / operation_history.json）
│  - SQLite 索引（rusqlite）                                │
│  - API key 存储（Windows Credential Manager via `keyring`）│
│  - 启动/管理 Node sidecar（stdio JSON-RPC）               │
└───────────────┬──────────────────────────┬──────────────┘
                │ Tauri IPC (invoke)      │ stdio JSON-RPC
                ▼                          ▼
┌──────────────────────────┐  ┌──────────────────────────────┐
│  React 19 前端（WebView） │  │  Node Sidecar（flowmark-agent）│
│  - 三栏工作区 UI          │  │  - LangChain.js Agent          │
│  - Markdown 渲染          │  │  - ChatOpenAI（OpenAI 兼容）    │
│  - 调 Rust 命令            │  │  - Tools（index/search/read/    │
│  - Agent 事件流（Rust 转发）│  │    propose_replace/create）    │
└──────────────────────────┘  │  - 最多 6 步 tool-call 循环     │
                              │  - Preview 回退（未配置时）      │
                              └──────────────────────────────┘
```

**职责边界**：

- Rust：所有文件 I/O、持久化、索引、凭据存储、sidecar 进程管理
- Node Sidecar：所有 LangChain 调用、LLM 流式、tool-call 循环、Agent 路由逻辑
- React：纯 UI + 调 Rust 命令；Agent 流式事件由 Rust 从 sidecar 转发到前端

**不沿用任何旧代码**，所有文件从零创建。

---

## 二、Windows 版迁移计划（分 7 个阶段）

### 阶段 0：分支与基线（已完成）

- [x] 新分支 `flowmark/windows-rewrite` from `main`（9ac8277）
- [x] 工作区全部清空，仅保留本迁移文档（commit `d32d2e2`）
- [x] force push 到 `origin/flowmark/windows-rewrite`，`main` 保留作回滚点
- [x] 旧 stash `wip-before-flowmark-windows-rewrite` 保留

---

### 阶段 1：项目骨架（Tauri + Node Sidecar + React，从零）

**目标**：从空仓库搭起 Tauri 2 + React 19 + Node sidecar 三进程骨架，Windows-only。

**目录结构**：

```
tauri-markdown-reader/
├── docs/FLOWMARK_WINDOWS_MIGRATION_PLAN.md   # 本文档
├── package.json                               # 根 monorepo（pnpm workspace）
├── pnpm-workspace.yaml
├── .gitignore
├── .github/workflows/ci.yml                   # Windows 矩阵 CI
├── src/                                       # React 前端
│   ├── main.tsx
│   ├── App.tsx
│   └── ...
├── src-tauri/                                 # Tauri Rust 主进程
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/default.json
│   ├── icons/                                 # 临时占位图标，后续替换 FlowMark 品牌
│   └── src/
│       ├── main.rs
│       └── lib.rs                             # 命令注册 + sidecar 启动
├── src-sidecar/                               # Node sidecar（LangChain Agent）
│   ├── package.json
│   ├── tsconfig.json
│   ├── server.ts                              # stdio JSON-RPC 入口
│   └── agent/                                 # LangChain 实现
└── scripts/
    └── build-sidecar.cjs                      # 把 src-sidecar 打成单文件 cjs 给 Tauri bundle
```

**改动清单**：

- `src-tauri/tauri.conf.json`（从零写）：
  - `productName`: `FlowMark`
  - `mainBinaryName`: `flowmark`
  - `identifier`: `local.flowmark.windows`
  - `bundle.targets`: `["msi", "nsis"]`（Windows-only）
  - `bundle.externalBin`: `["binaries/flowmark-agent"]`（Node sidecar，打包时由 `scripts/build-sidecar.cjs` 产出）
  - `app.security.csp`: 严格 CSP（只允许 self + Tauri 协议；对外网请求走 sidecar，前端不发外网）
  - 窗口标题 `FlowMark`，最小尺寸 1120×740（对齐 Mac `MacWritingWorkspace`）
- `src-tauri/Cargo.toml`（从零写）：
  - `name`: `flowmark-windows`
  - 依赖：`tauri` 2、`tauri-plugin-shell` 2、`serde`、`serde_json`、`rusqlite`、`keyring`、`sha2`、`tokio`
- `src-tauri/src/lib.rs`（从零写）：
  - `tauri::Builder` 注册命令、启动 sidecar
  - sidecar 启动模式参考 `synle/tauri-desktop-node-sidecar-template`：`std::process::Command` spawn `node resources/flowmark-agent.cjs`，stdin/stdout JSON-RPC，stderr 日志；Windows 加 `CREATE_NO_WINDOW`
  - dev 模式下不 spawn 打包版，直接连 `node src-sidecar/server.ts`（或 vite-node 热重载）
- `package.json`（根，从零写）：
  - `name`: `flowmark-windows`
  - `version`: `1.0.0`（对齐 iOS）
  - scripts: `dev` / `build` / `tauri:dev` / `tauri:build` / `build:sidecar`
- `src-sidecar/package.json`（从零写）：
  - 依赖：`langchain`、`@langchain/openai`、`@langchain/core`、`zod`
  - 入口：`server.ts`，stdio JSON-RPC
- React 19 + Vite 前端骨架（从零写 `vite.config.ts`、`tsconfig.json`、`src/main.tsx`、`src/App.tsx`）

**验收**：
- `pnpm tauri:dev` 能启动 Tauri 窗口 + Node sidecar
- Rust 能通过 stdio 收到 sidecar 的 `{ "jsonrpc": "2.0", "method": "ping" }` 响应
- 窗口标题为 FlowMark
- `cargo test` 通过（基础 smoke test）
- CI（`.github/workflows/ci.yml`）在 Windows runner 上能跑 `cargo build` + `pnpm build`

---

### 阶段 2：数据模型与持久化层（Rust 侧）

**目标**：对齐 iOS 的 `MarkdownDocument` / `DocumentVersion` / `AgentMessage` / `AgentSession` 等数据模型与本地持久化。

**存储映射**：

| iOS | Windows (Rust) | 存储 |
|---|---|---|
| `DocumentLibrary` (UserDefaults) | `library_state.json` + 工作区文件直接读写 | AppData `flowmark/library.json` |
| `DocumentVersion` 历史 | `.flowmark/versions/<doc>.<ts>.md` | 工作区内隐藏目录 |
| `AgentSession` 消息/归档会话 | `flowmark/agent/sessions.json` + `threads/*.json` | AppData |
| `LongformMemoryStore` | `flowmark/memory/<doc>.json` | AppData |
| `OperationHistoryStore` | `flowmark/operation_history.json` | AppData |
| `ModelConfigurationStore` (Keychain) | Windows Credential Manager（`keyring` crate） | 系统凭据库 |
| `ClientDocumentIndexStore` (SQLite) | `rusqlite` `flowmark/index.db` | AppData |

**Rust 命令新增**（从零实现）：

- `load_library_state` / `save_library_state`
- `list_document_versions` / `restore_document_version`
- `load_agent_sessions` / `save_agent_session` / `archive_agent_session`
- `load_operation_history` / `save_operation_history`
- `load_longform_memory` / `save_longform_memory`
- `get_model_config` / `set_model_config`（API key 走 `keyring`，不落盘）
- `list_agent_skills` / `save_agent_skill`

**测试**：`cargo test` 覆盖序列化/反序列化、版本备份恢复、会话归档。

---

### 阶段 3：本地索引（SQLite 分块）

**目标**：对齐 iOS `ClientDocumentIndex` / `ClientDocumentIndexStore`，加速大库检索。

**Schema**：

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  title TEXT,
  headings_json TEXT,
  chunk_count INTEGER,
  updated_at INTEGER
);
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  ordinal INTEGER,
  heading TEXT,
  text TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id)
);
CREATE INDEX idx_chunks_document ON chunks(document_id);
```

**要点**：

- 指纹用 SHA-256 内容哈希（`sha2` crate），未变更直接复用缓存
- 分块策略：按标题层级 + 段落，对齐 iOS `ClientDocumentIndex`
- 命令：
  - `build_index(paths)` — 构建/刷新索引
  - `search_index(query, limit)` — 跨文档分块检索
  - `read_chunk(chunk_id)` — 读单个分块
  - `index_stats(document_id)` — 分块数/标题/命中
- `search_workspace`（文件名/标题/正文片段）与 `search_index`（语义分块）分开

**测试**：`cargo test` 覆盖指纹缓存命中、分块边界、中英文混合检索。

---

### 阶段 4：Agent 核心（LangChain.js + Node Sidecar）

**目标**：对齐 iOS Agent 全链路，但用 LangChain 实现，跑在 Node sidecar 里。Rust 侧只负责转发 JSON-RPC + 取消 + 持久化。

#### 4.0 Sidecar JSON-RPC 协议

Rust ↔ Node 之间用 stdio 上的 JSON-RPC 2.0 通信：

- 请求（Rust → Node）：`{ "jsonrpc": "2.0", "id": "<run_id>", "method": "agent.run", "params": { ... } }`
- 响应流（Node → Rust）：多条 `notification`，method 为 `agent.event`，params 含 `{ type: "metadata|delta|tool_call|tool_result|done|error", ... }`
- 取消（Rust → Node）：`{ "jsonrpc": "2.0", "method": "agent.cancel", "params": { "run_id": "..." } }`
- Rust 收到 sidecar 事件后，通过 Tauri event 转发到前端

#### 4.1 路由（`src-sidecar/agent/router.ts`）

从零用 TS 重写 iOS `AgentRouter`（纯函数）：

- `stripSlashPrefix` / slash 别名 → 意图关键词 → Profile 默认 skill
- 补齐 iOS `AgentSkill` 全部 case：
  - `chat / understand / ask / academic / plantUML / paperAnnotation / novel / presentation / wechatFormat / autoImage / autoFormula / translate / mindmap / compare / htmlAuthor / organize / deliverable / review / followups / distillSkill`
- `launchSkills`: `[chat, academic, novel, htmlAuthor, presentation, compare]`
- `mappedTask` 映射
- Profile 默认 skill：general→chat, academic→academic, novel→novel, html→htmlAuthor

**测试**：Vitest 覆盖路由（slash/intent/default/forced/override）。

#### 4.2 网关（`src-sidecar/agent/gateway.ts`，LangChain 实现）

- 读 `ModelConfiguration`（Rust 通过 JSON-RPC `config.get` 提供，API key 不进 sidecar 日志）：
  - 未配置 → `PreviewAgentGateway`（确定性本地预览，对齐 iOS `PreviewAgentGateway.content(for:...)`，不联网，纯 TS 函数）
  - 已配置 → `@langchain/openai` 的 `ChatOpenAI`，`streaming: true`，OpenAI 兼容端点（openai / deepseek / glm / custom）
- 流式：LangChain `stream()` 产出 chunk，逐条包成 `agent.event { type: "delta" }` 发回 Rust
- 端点示例：openai / deepseek / glm / custom

#### 4.3 本地工具运行时（`src-sidecar/agent/runtime.ts`，LangChain Tools）

用 LangChain `Tool` 接口实现 iOS `ClientAgentRuntime` 的等价物：

- `document_index` — 调 Rust `build_index`/`index_stats`（通过 JSON-RPC `tool.call` 转发到 Rust）
- `document_search` — 调 Rust `search_index`
- `document_read` — 调 Rust `read_chunk` / `read_document`
- `document_propose_replace` — 生成草稿，不写文件
- `document_propose_create` — 生成草稿，不写文件

要点：

- 最多 6 步（对齐 iOS `maxSteps = 6`），用 LangChain `AgentExecutor` 的 `maxIterations`
- 工具只读 + 提议草稿，**绝不直接写文件**（写文件走阶段 5 的 `apply_agent_draft`，Rust 侧执行）
- `runtimePrompt` 对齐 iOS `ClientAgentRuntime.runtimePrompt`
- LangChain `AgentExecutor` 自动处理 tool-call 循环；每步工具调用 → `tool_call` 事件 → 工具结果 → `tool_result` 事件 → 模型决定下一步或最终回答

#### 4.4 取消与隔离

- 取消：Rust 侧维护 `CANCELLED_RUNS` set，收到前端 cancel → 发 `agent.cancel` JSON-RPC → sidecar 中止 LangChain 迭代（`AbortController`）
- 会话隔离：每个 `run_id` 独立 sidecar 会话状态；取消时清理，不留空 assistant 消息；归档会话可恢复

**测试**：
- Vitest：路由、preview 网关确定性输出、tool-call 循环（mock LLM）
- `cargo test`：JSON-RPC 转发、取消清理

---

### 阶段 5：写回流程（Rust 侧 `resolve_agent_draft`）

**目标**：对齐 iOS Mac 端 `MacAgentDraftResolver`，Agent 编辑提议落回文档并保留版本历史。

**Rust 实现** `resolve_agent_draft(message, target_document, editor_selection)` → `ResolvedDraft`：

```rust
struct ResolvedDraft {
    content: String,
    mode: DraftMode,        // WholeDocument | SelectedText | SearchReplace(count)
    missing_searches: Vec<String>,
}
```

**三种模式**（对齐 iOS）：

- `wholeDocument` — 整文档替换
- `selectedText` — 选区替换（对齐 `editorSelection.replacingSelection`）
- `searchReplace(replacement_count)` — SEARCH/REPLACE 块（对齐 `applySearchReplaceBlocks`）

**应用流程**：

1. `propose_agent_draft` — 解析草稿，返回 `ResolvedDraft` + diff 预览
2. UI 弹窗预览 diff，用户确认
3. `apply_agent_draft(draft_id)` — 应用前先备份当前内容到 `.flowmark/versions/<doc>.<ts>.md`，再写文件
4. `discard_agent_draft(draft_id)` — 丢弃草稿

**要点**：

- 应用前必须用户确认（UI 弹窗预览 diff）
- 应用时先备份，再覆盖——对齐 Mac"保留版本历史 + 用户确认"
- `missing_searches` 非空时 `canApply = false`，提示用户 SEARCH 块未命中

**测试**：`cargo test` 覆盖三种模式解析、SEARCH 块命中/未命中、选区替换边界、备份写入。

**实现状态（阶段 5 完成）**：

- `src-tauri/src/models/agent.rs`：新增 `DraftMode` / `ResolvedDraft` / `StagedDraft` 模型
- `src-tauri/src/store/drafts.rs`：进程级 `StagedDraftRegistry` + 纯函数解析（`apply_search_replace_blocks` / `resolve_replace_draft` / `resolve_whole_document_draft` / `resolve_create_draft`）+ `stage_draft` / `get_draft` / `take_staged` / `discard_draft`
- `src-tauri/src/store/library.rs`：新增 `backup_to_version`（备份到 `.flowmark/versions/<doc>.<ts>.md` + 元数据落 library.json）/ `create_document` / `find_document` / `document_abs_path`
- `src-tauri/src/store/app_paths.rs`：新增 `versions_rel_dir()` 常量
- `src-tauri/src/commands.rs`：
  - `dispatch_tool_call` 的 `document_propose_replace` / `document_propose_create` 从占位换成真实草稿解析 + 暂存，返回 `{ draftId, canApply, missingSearches, mode, replacementCount }`
  - 新增 Tauri 命令 `propose_agent_draft` / `apply_agent_draft` / `discard_agent_draft`
  - `apply_agent_draft` 流程：`take_staged` → 校验 `can_apply` → `backup_to_version` → `write_document_content`（Create 模式走 `create_document`）
- `src-tauri/src/lib.rs`：注册三个新命令
- `src-sidecar/agent/tools.ts`：`document_propose_replace` 增加 `selectionText` 可选字段（驱动 selectedText 模式），描述更新为返回 `{ draftId, canApply, missingSearches, mode }`
- `src/types/index.ts`：新增 `DraftMode` / `ResolvedDraft` / `ProposeAgentDraftArgs` / `ApplyDraftResult` / `DiscardDraftResult`
- 测试：`cargo test` 62 passing（含 drafts.rs 9 个、library.rs 3 个新增）/ `vitest` 51 passing（含 selectionText 透传）/ `tsc --noEmit` 干净

---

### 阶段 6：前端 UI（React）对齐 Mac 工作区

**目标**：对齐 `FlowMarkMac/Views/`，重构前端为三栏工作区。

#### 6.1 主窗口（`MacWritingWorkspace` → `App.tsx`）

三栏布局：

- **左侧** `MacDocumentSidebar` → 工作区树 + 收藏/置顶/Agent 选中过滤
- **中间** `MacEditorPane` → 编辑 + 预览（实时预览 / 分屏）
- **右侧** `MacAgentPane` → Agent 会话 + planner steps + sources + 草稿预览

#### 6.2 Agent 面板（`MacAgentPane`）

- 消息流（user / assistant）
- 路由标签（`AgentRoutedBy`: forced / slash / intent / default / override）
- sources（命中文档片段）
- planner steps（`MacAgentPlannerStepsView`）
- 操作按钮：copy / save-to-library / retry-as-chat / 停止
- skill 选择（`AgentSkill.launchSkills`）
- 草稿预览（对接阶段 5 写回流程）

#### 6.3 本地知识搜索（`MacLocalKnowledgeSearchView`）

- 独立面板，调 `search_index`
- 显示命中分块 + 跳转原文

#### 6.4 设置（`SettingsView`）

- 模型配置：endpoint / model / api key（key 走 Credential Manager，不落盘明文）
- 语言切换
- Markdown 指南
- 本地知识库管理（重建索引 / 查看统计）

#### 6.5 本地化（7 语言）

- iOS 7 语言 → 前端 `i18n.ts` 扩展到 7 语言（en / zh-Hans / zh-Hant / ja / ko / de / fr）
- key 命名沿用 iOS 前缀：`agent.* / library.* / reader.* / settings.* / history.* / tab.* / localSearch.*`
- 现有 zh / en 两语言为基础，补齐其余 5 种

#### 6.6 Markdown 渲染

- 从零写 `markdown.ts`（marked + marked-katex + marked-highlight + mermaid）
- PlantUML 渲染（对齐 `PlantUMLRenderURL`）：
  - zlib deflate + PlantUML 字母表编码 → plantuml.com png URL
  - 纯前端 JS 实现，`pako` 做 deflate
- 预览规整（对齐 `MarkdownRenderNormalizer`）：
  - 去 markdown 包裹围栏
  - 修 Mermaid/PlantUML 围栏
  - 裸 PlantUML 收拢成围栏块
  - `markdown.ts` 里加 `normalizeRenderContent`

---

### 阶段 7：导出、PlantUML、收尾

#### 7.1 导出

- 从零实现 Word/PDF/HTML 导出（Rust 侧，对齐 iOS `DocumentExportKind`）
- 补"复制 Markdown / 纯文本 / HTML"

#### 7.2 PlantUML

- 前端渲染（见阶段 6.6）

#### 7.3 隐私边界（对齐 iOS）

- API key 只进 Credential Manager
- 文档内容、Agent 历史、索引、操作历史不离开设备
- 只有用户主动发起 Agent 时才把 prompt+上下文发到用户自配端点（请求由 sidecar 发出，不由前端发出）
- CSP 严格，前端不发外网请求

#### 7.4 测试

- `cargo test`（Rust 单测：持久化/索引/写回解析/JSON-RPC 转发）
- Vitest（前端 + sidecar：路由镜像 / normalizer / PlantUML 编码 / LangChain 工具 mock）
- CI 在 `.github/workflows/` Windows 矩阵跑 `cargo test` + `pnpm test` + `pnpm build`

#### 7.5 发版

- `tauri build` + GitHub Actions（Windows runner）
- 产物：`flowmark-windows-x.x.x-x64.msi` / `.exe`
- 版本号对齐 iOS（`1.0.0` + build）
- sidecar 打包：`scripts/build-sidecar.cjs` 用 esbuild 把 `src-sidecar` 打成单文件 `flowmark-agent.cjs`，Tauri `externalBin` 引用；运行时依赖系统 Node（CI 文档说明需装 Node 20+），或后续 PR 探讨 bundle Node runtime

---

## 三、阶段排期建议（按 PR 粒度）

| PR | 阶段 | 内容 | 风险 | 预估工作量 |
|---|---|---|---|---|
| #1 | 1 | Tauri + Node sidecar + React 骨架从零搭建 + Windows CI | 中（sidecar 通信） | 中 |
| #2 | 2 | 数据模型/持久化层 Rust 命令 + 单测 | 低 | 中 |
| #3 | 3 | SQLite 分块索引 + 命令 + 单测 | 中（schema 设计） | 中 |
| #4 | 4 | LangChain Agent（router + gateway + tools + JSON-RPC）+ Vitest | 高（LangChain + 流式） | 大 |
| #5 | 5 | 写回流程（draft resolver + 版本备份 + 确认 UI） | 中 | 中 |
| #6 | 6 | 前端三栏工作区重构 + Agent 面板 + 本地知识搜索 | 高（UI 量大） | 大 |
| #7 | 6 | 7 语言本地化 + PlantUML 渲染 + normalizer | 中 | 中 |
| #8 | 7 | 导出对齐 + 隐私审计 + Windows CI 完善 + 发版 | 低 | 中 |

---

## 四、已确认的决策（v2）

1. **是否保留 main 上现有 Tauri 骨架**：✅ **不保留**，全部从零重写，不从 git 历史捞旧文件
2. **平台范围**：✅ **Windows-only**（`bundle.targets: ["msi", "nsis"]`），不做 macOS
3. **API key 存储**：✅ Windows Credential Manager（`keyring` crate）
4. **Agent 实现方式**：✅ **LangChain.js**（`langchain` + `@langchain/openai`），跑在 Node sidecar 进程，Rust 通过 stdio JSON-RPC 通信
5. **本地化范围**：iOS 7 语言全迁（en / zh-Hans / zh-Hant / ja / ko / de / fr）
6. **第一个 PR 从阶段 1 起步**：搭三进程骨架

---

## 五、源项目参考文件索引

迁移时按此索引对照 iOS 源码：

### Models（`FlowMarkApp/Models/`）

- `MarkdownDocument.swift` — 文档模型 + `DocumentVersion` 版本历史
- `AgentModels.swift` — `AgentScope / AgentTask / AgentProfile / AgentSkill / AgentRoute / AgentRequest / AgentResponse / AgentMessage / AgentSource / LLMProvider`
- `AgentContextTier.swift` — 上下文层级
- `AppLanguage.swift` — 7 语言枚举
- `DocumentTemplate.swift` — 文档模板

### Services（`FlowMarkApp/Services/`）

- `LLMGateway.swift` — `protocol LLMGateway` + `PreviewAgentGateway` + `AgentSession`（~1589 行起）
- `ConfiguredAgentGateway.swift` — 配置就绪用 Remote，否则 Preview 回退
- `RemoteLLMGateway.swift` — OpenAI 兼容流式 + tool-call
- `AgentRouter.swift` — 纯函数路由
- `ClientAgentRuntime.swift` — 本地工具循环（maxSteps=6）
- `ClientDocumentIndex.swift` / `ClientDocumentIndexStore.swift` — SQLite 分块索引
- `DocumentLibrary.swift` — 文档库 + 版本 + 模板
- `DocumentImportService.swift` / `DocumentExportService.swift` — 导入导出
- `MarkdownRenderNormalizer.swift` — 预览规整
- `PlantUMLRenderURL.swift` — PlantUML 编码
- `ModelConfigurationStore.swift` — 端点/模型 + Keychain
- `LongformMemoryStore.swift` — 长文档记忆
- `OperationHistoryStore.swift` — 操作历史
- `AnnouncementStore.swift` — 公告（当前 `.missing`，不迁）

### Mac 专属（`FlowMarkMac/`）

- `App/FlowMarkMacApp.swift` — Mac 入口
- `Views/MacWritingWorkspace.swift` — 主窗口三栏布局
- `Views/MacDocumentSidebar.swift` — 左侧文档树
- `Views/MacEditorPane.swift` — 中间编辑器
- `Views/MacAgentPane.swift` — 右侧 Agent 面板
- `Views/MacAgentPlannerStepsView.swift` — planner 步骤
- `Views/MacLocalKnowledgeSearchView.swift` — 本地知识搜索
- `Support/MacAgentDraftResolver.swift` — 写回草稿解析
- `Support/MacEditorTextSelection.swift` — 选区
- `Support/MacWorkspaceCommand.swift` — 工作区命令

### 测试（`Tests/`）

- `AgentRouterTests.swift` — 路由
- `AgentSessionTests.swift` — 会话隔离
- `LocalAgentGatewayTests.swift` — 本地预览网关
- `RemoteLLMGatewayTests.swift` — 远端网关
- `ClientDocumentIndexStoreTests.swift` — 索引
- `MarkdownPreviewParserTests.swift` — 预览解析
- `DocumentExportServiceTests.swift` / `DocumentImportServiceTests.swift` — 导入导出
- `OperationHistoryStoreTests.swift` — 操作历史
- `AnnouncementStoreTests.swift` — 公告（不迁）

---

## 六、本地化 key 命名约定（沿用 iOS 前缀）

| 前缀 | 用途 |
|---|---|
| `agent.*` | Agent 面板相关 |
| `library.*` | 文档库 |
| `reader.*` | 阅读器 |
| `settings.*` | 设置 |
| `history.*` | 操作历史 |
| `tab.*` | Tab 标签 |
| `announcement.*` | 公告（不迁） |
| `localSearch.*` | 本地知识搜索 |

改 key 必须 7 个语言文件同步改（前端 `i18n.ts` 里每个语言一个对象）。

---

## 七、隐私与禁止事项（对齐 iOS skill）

- API key 只进 Credential Manager，不落盘明文，不打日志
- 文档内容、Agent 历史、索引、操作历史不离开设备
- 只有用户主动发起 Agent 时才把 prompt + 上下文发到用户自配端点
- **不要** 引入 FlowMark 自建服务器 / 订阅 / StoreKit / 会员校验
- **不要** 把 `local.flowmark.*` 占位 bundle id 当生产值发布（自建者替换成自己的 team / id）
- **不要** 为"恢复服务端/订阅"写代码，除非用户明确要求改变 client-only 定位

---

## 八、Git 信息

- 源项目分支：`main`（flowmark-ios）
- 目标项目分支：`flowmark/windows-rewrite`（tauri-markdown-reader）
- 目标项目远程：`origin` (github.com/honestTai/tauri-markdown-reader)
- 旧 WIP 备份：`git stash list` 中的 `wip-before-flowmark-windows-rewrite`

提交信息风格：英文祈使句，简洁（对齐 iOS 仓库：`Make FlowMark client-only agent app`、`Bump FlowMark TestFlight build to 20`）。
