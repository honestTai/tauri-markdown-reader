# FlowMark Windows 版迁移计划

> 源项目：`C:\Users\hones\Desktop\project\flowmark-ios`（SwiftUI，iOS + macOS，纯客户端单机）
> 目标项目：`C:\Users\hones\Desktop\project\tauri-markdown-reader`（Tauri 2 + React 19 + Rust）
> 目标分支：`flowmark/windows-rewrite`（已从最新 `main` 拉出，工作树干净）
> 产物：Windows 优先的 FlowMark 桌面版，对齐 iOS/Mac 功能集，用 Tauri/Rust/React 重写实现
> 生成日期：2026-06-23

---

## 〇、定位与关键决策

### 源项目（flowmark-ios）是什么

纯客户端、单机的 SwiftUI 应用（iOS App + Mac App + iOS Share Extension 三个 target）：

- **没有** FlowMark 自建服务器
- **没有** 订阅 / StoreKit / 会员校验
- **没有** 公告远端拉取（`AnnouncementStore.AnnouncementConfiguration` 恒为 `.missing`）
- 所有文档内容、Agent 会话历史、本地索引、操作历史都只留在设备本地
- 唯一对外网络：用户自己在 Settings 里配置的 OpenAI 兼容 chat completions 端点

### 目标项目（tauri-markdown-reader）现状

Tauri 2 + React 19 + Vite + TypeScript，Rust 后端（`src-tauri/src/main.rs` 约 10k 行，41 个 `#[tauri::command]`）。已有：

- 工作区扫描、全文搜索、阅读/编辑
- PDF/DOCX 导入、编辑历史、收藏/置顶/锁定
- Word/PDF/HTML 导出
- `agent_router.rs`（与 iOS 同构）、`run_ai_workflow` 流式、AI 记忆/会话/技能
- HTML artifact 保存、`md-reader` CLI sidecar
- `productName` 已是 `FlowMark`，bundle id `local.markdown.reader`
- 当前平台：Windows + macOS（`bundle.targets: "all"`）

### 迁移定位（关键决策）

用户明确："目标项目的代码都不要了"+"迁移成 windows，新版本的 windows"。

理解为：

- **新分支从 main 起步，旧代码不直接沿用**（原 `codex/private-agent-workflow` 分支的 WIP 已 `git stash` 保留为 `wip-before-flowmark-windows-rewrite`，不会丢）
- 但 main 上已有的 Tauri/Rust/React 骨架（窗口、CSP、命令注册、CLI sidecar 打包、CI）是 Windows 桌面落地的基础设施，**没必要推倒**——推倒会丢失 Windows 打包/签名/WebView2 这些已经趟过坑的部分
- **真正要迁的是 FlowMark iOS/Mac 的产品形态**：Agent skill 体系、本地索引、长文档记忆、操作历史、Mac 写回流程、模型配置 UI、7 语言本地化、PlantUML 渲染、纯客户端定位（用户自配 OpenAI 兼容端点）
- 目标产物：**Windows 优先（可兼 macOS）的 FlowMark 桌面版**，对齐 iOS/Mac 的功能集，但用 Tauri/Rust/React 重写实现

> 如果要"完全清空 main 代码、从零写"，需要用户额外确认；本计划按**保留 Tauri 骨架 + 重写业务层**来规划，性价比最高、风险最低。

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

### 1.2 目标项目（tauri-markdown-reader）可复用部分

- Tauri 2 窗口/CSP/命令注册骨架
- React 19 + Vite 前端
- `agent_router.rs`（与 iOS 同构，需补全 skill case）
- `rusqlite` 依赖（已存在，用于本地索引）
- Word/PDF/HTML 导出链
- `md-reader` CLI sidecar 打包
- GitHub Actions CI

---

## 二、Windows 版迁移计划（分 7 个阶段）

### 阶段 0：分支与基线（已完成）

- [x] 新分支 `flowmark/windows-rewrite` from `main`（9ac8277）
- [x] 旧分支 `codex/private-agent-workflow` 的 WIP 已 stash 保留（`wip-before-flowmark-windows-rewrite`）
- [x] 工作树干净

后续所有 PR 都基于 `flowmark/windows-rewrite`。

---

### 阶段 1：项目标识与骨架重命名

**目标**：把 Tauri 工程标识对齐 FlowMark 品牌，Windows 优先。

**改动清单**：

- `src-tauri/tauri.conf.json`
  - `mainBinaryName`: `tauri-markdown-reader` → `flowmark`
  - `identifier`: `local.markdown.reader` → `local.flowmark.windows`
  - `productName`: 保持 `FlowMark`
  - `bundle.targets`: `"all"` → `["msi", "nsis"]`（Windows 优先，macOS 后续）
- `package.json`
  - `name`: `tauri-markdown-reader` → `flowmark-windows`
  - `version`: 对齐 iOS `1.0.0`
- `src-tauri/Cargo.toml`
  - `name`: `tauri-markdown-reader` → `flowmark-windows`
  - bins 重命名：`tauri-markdown-reader` → `flowmark`，`md-reader` → `flowmark-cli`
- 窗口标题/最小尺寸：对齐 Mac `MacWritingWorkspace`（minWidth 1120×740）；Tauri 当前 1180×720，OK
- 图标：沿用 `src-tauri/icons/`（若需重做 FlowMark 品牌图标，单独 PR）

**验收**：`pnpm tauri:dev` 能启动，窗口标题为 FlowMark，`flowmark.exe` 产物名正确。

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
| `ClientDocumentIndexStore` (SQLite) | `rusqlite`（已依赖）`flowmark/index.db` | AppData |

**Rust 命令新增**：

- `load_library_state` / `save_library_state`
- `list_document_versions` / `restore_document_version`
- `load_agent_sessions` / `save_agent_session` / `archive_agent_session`
- `load_operation_history` / `save_operation_history`
- `load_longform_memory` / `save_longform_memory`
- `get_model_config` / `set_model_config`
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

- 指纹用 SHA-256 内容哈希，未变更直接复用缓存（对齐 iOS `fingerprint`）
- 分块策略：按标题层级 + 段落，对齐 iOS `ClientDocumentIndex`
- 命令：
  - `build_index(paths)` — 构建/刷新索引
  - `search_index(query, limit)` — 跨文档分块检索
  - `read_chunk(chunk_id)` — 读单个分块
  - `index_stats(document_id)` — 分块数/标题/命中
- 把现有 `search_workspace`（全文）和 `search_index`（语义分块）分开：
  - `search_workspace` → 文件名/标题/正文片段（保留现有）
  - `search_index` → 跨文档分块检索（新增，对应 iOS `document.search`）

**测试**：`cargo test` 覆盖指纹缓存命中、分块边界、中文/英文混合检索。

---

### 阶段 4：Agent 核心（路由 + 网关 + 运行时）

**目标**：对齐 iOS Agent 全链路。

#### 4.1 路由（`agent_router.rs`）

- 保留现有 `agent_router.rs`（已与 iOS 同构）
- 补齐 iOS `AgentSkill` 全部 case：
  - `chat / understand / ask / academic / plantUML / paperAnnotation / novel / presentation / wechatFormat / autoImage / autoFormula / translate / mindmap / compare / htmlAuthor / organize / deliverable / review / followups / distillSkill`
- 补齐 `launchSkills`：`[chat, academic, novel, htmlAuthor, presentation, compare]`
- 补齐 `mappedTask` 映射
- 补齐 Profile 默认 skill（general→chat, academic→academic, novel→novel, html→htmlAuthor）

#### 4.2 网关（`run_agent_stream`）

- 读 `ModelConfiguration`：
  - 未配置 → 走 `PreviewAgentGateway`（确定性本地预览，对齐 iOS `PreviewAgentGateway.content(for:...)`，不联网）
  - 已配置 → OpenAI 兼容 chat completions，SSE 流式，tool-call 循环（对齐 `RemoteLLMGateway`）
- 端点示例：openai / deepseek / glm / custom（README 已列）
- 流式事件：`metadata` / `delta` / `tool_call` / `tool_result` / `done` / `error`
- 命令：`run_agent_stream(request)` → 返回 `Stream` 事件流（Tauri event）

#### 4.3 本地工具运行时（`ClientAgentRuntime` 等价物）

Rust 实现 `document.index / search / read / propose_replace / propose_create`：

- 最多 6 步（对齐 iOS `maxSteps = 6`）
- 工具只读 + 提议草稿，**绝不直接写文件**
- `runtimePrompt` 对齐 iOS `ClientAgentRuntime.runtimePrompt`
- 每步工具调用 → 返回 JSON 结果 → 模型决定下一步或最终回答

#### 4.4 取消与隔离

- 取消：沿用 `CANCELLED_AI_RUNS` + `cancel_ai_run(run_id)`
- 会话隔离：对齐 `AgentSessionTests`：
  - 每个 run_id 独立状态
  - 取消时清理，不留空 assistant 消息
  - 归档会话可恢复

**测试**：`cargo test` 覆盖路由（slash/intent/default/forced/override）、preview 网关确定性输出、tool-call 循环、取消清理。

---

### 阶段 5：写回流程（Windows 版 MacAgentDraftResolver）

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

- 沿用 `markdown.ts`（marked + marked-katex + marked-highlight + mermaid）
- 补 PlantUML 渲染（对齐 `PlantUMLRenderURL`）：
  - zlib deflate + PlantUML 字母表编码 → plantuml.com png URL
  - 纯前端 JS 实现即可，`pako` 做 deflate
- 预览规整（对齐 `MarkdownRenderNormalizer`）：
  - 去 markdown 包裹围栏
  - 修 Mermaid/PlantUML 围栏
  - 裸 PlantUML 收拢成围栏块
  - 在 `markdown.ts` 里加 `normalizeRenderContent`

---

### 阶段 7：导出、PlantUML、收尾

#### 7.1 导出

- 沿用现有 Word/PDF/HTML 导出（已对齐 iOS `DocumentExportKind`）
- 补"复制 Markdown / 纯文本 / HTML"

#### 7.2 PlantUML

- 前端渲染（见阶段 6.6）

#### 7.3 隐私边界（对齐 iOS）

- API key 只进 Credential Manager
- 文档内容、Agent 历史、索引、操作历史不离开设备
- 只有用户主动发起 Agent 时才把 prompt+上下文发到用户自配端点
- CSP 已严格，保持

#### 7.4 测试

- iOS 用 `@main enum` 命令行测试
- Windows 侧：
  - `cargo test`（Rust 单测：路由/索引/写回解析）
  - Vitest（前端：路由镜像 / normalizer / PlantUML 编码）
- CI 在 `.github/workflows/` 加 Windows 矩阵

#### 7.5 发版

- 沿用 `tauri build` + GitHub Actions
- 产物：`flowmark-windows-x.x.x-x64.msi` / `.exe`
- 版本号对齐 iOS（`1.0.0` + build）

---

## 三、阶段排期建议（按 PR 粒度）

| PR | 阶段 | 内容 | 风险 | 预估工作量 |
|---|---|---|---|---|
| #1 | 1 + 2 | 重命名 + 数据模型/持久化层 Rust 命令 + 单测 | 低 | 中 |
| #2 | 3 | SQLite 分块索引 + 命令 + 单测 | 中（schema 设计） | 中 |
| #3 | 4 | Agent 网关（OpenAI 兼容流式 + Preview 回退）+ 路由补全 + 本地工具运行时 | 高（流式 + tool-call） | 大 |
| #4 | 5 | 写回流程（draft resolver + 版本备份 + 确认 UI） | 中 | 中 |
| #5 | 6 | 前端三栏工作区重构 + Agent 面板 + 本地知识搜索 | 高（UI 量大） | 大 |
| #6 | 6 | 7 语言本地化 + PlantUML 渲染 + normalizer | 中 | 中 |
| #7 | 7 | 导出对齐 + 隐私审计 + Windows CI + 发版 | 低 | 中 |

---

## 四、需要确认的几点

1. **是否保留 main 上现有 Tauri 骨架**？
   - 建议：保留（省去 Windows 打包/签名/WebView2 重新趟坑），只重写业务层
   - 若要完全清空，换起点

2. **平台范围**：Windows-only，还是 Windows 优先 + 保留 macOS？
   - 建议：Windows-only 配置（`bundle.targets: ["msi", "nsis"]`），macOS 后续再说

3. **API key 存储**：Windows 用 Credential Manager（`keyring` crate），同意？

4. **本地化范围**：iOS 7 语言全迁，还是先 en / zh-Hans / zh-Hant 三语言，其余后补？

5. **第一个 PR 想从哪个阶段开始**？
   - 建议：从阶段 1 + 2（重命名 + 持久化层）起步，落地快、风险低

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
