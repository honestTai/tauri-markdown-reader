//! Tauri 命令注册
//!
//! 阶段 2：数据模型与持久化层命令
//!   - library: load / save / read_content / write_content
//!   - sessions: list / load / save / archive / delete
//!   - operation_history: load / append / clear
//!   - model_config: load / save / get_api_key / set_api_key / delete_api_key
//!   - longform_memory: load / append / clear
//!
//! 命令层职责：
//!   1. 从 Tauri State 拿 AppPaths / 各 Repository
//!   2. 调用 Repository 方法
//!   3. 把 AppError 序列化返回前端
//!
//! 注意：命令层不做业务逻辑，业务逻辑在 Repository 层

use crate::models::{
    AgentSession, LibraryState, ModelConfiguration, OperationKind, OperationRecord,
};
use crate::store::longform_memory::{DocumentMemory, MemoryFragment};
use crate::store::{
    AppPaths, LibraryRepository, LongformMemoryRepository, ModelConfigRepository,
    OperationHistoryRepository, SessionRepository,
};
use crate::store::{AppError, AppResult};
use crate::index::{IndexRepository, IndexStats, SearchHit};
use crate::models::agent::{DraftMode, ResolvedDraft};
use crate::store::drafts::{
    self, EditorSelection, SearchReplaceBlock,
};
use std::sync::Mutex;
// ============ 辅助：从 State 获取 repository ============

/// 获取 LibraryRepository（每次新建，内部无状态）
fn library_repo(state: &tauri::State<AppState>) -> LibraryRepository {
    LibraryRepository::new(state.paths.clone())
}

fn session_repo(state: &tauri::State<AppState>) -> SessionRepository {
    SessionRepository::new(state.paths.clone())
}

fn operation_repo(state: &tauri::State<AppState>) -> OperationHistoryRepository {
    OperationHistoryRepository::new(state.paths.clone())
}

fn model_config_repo(state: &tauri::State<AppState>) -> ModelConfigRepository {
    ModelConfigRepository::new(state.paths.clone())
}

fn memory_repo(state: &tauri::State<AppState>) -> LongformMemoryRepository {
    LongformMemoryRepository::new(state.paths.clone())
}

// ============ Library 命令 ============

#[tauri::command]
pub fn load_library_state(state: tauri::State<AppState>) -> AppResult<LibraryState> {
    library_repo(&state).load()
}

#[tauri::command]
pub fn save_library_state(state: tauri::State<AppState>, library: LibraryState) -> AppResult<()> {
    library_repo(&state).save(&library)
}

#[tauri::command]
pub fn read_document_content(
    state: tauri::State<AppState>,
    library: LibraryState,
    doc_id: String,
) -> AppResult<String> {
    library_repo(&state).read_document_content(&library, &doc_id)
}

#[tauri::command]
pub fn write_document_content(
    state: tauri::State<AppState>,
    mut library: LibraryState,
    doc_id: String,
    content: String,
) -> AppResult<LibraryState> {
    library_repo(&state).write_document_content(&mut library, &doc_id, &content)?;
    // 返回更新后的 library（前端拿到新 updated_at）
    Ok(library)
}

// ============ Sessions 命令 ============

#[tauri::command]
pub fn list_agent_sessions(state: tauri::State<AppState>) -> AppResult<Vec<AgentSession>> {
    session_repo(&state).list()
}

#[tauri::command]
pub fn load_agent_session(
    state: tauri::State<AppState>,
    session_id: String,
) -> AppResult<AgentSession> {
    session_repo(&state).load(&session_id)
}

#[tauri::command]
pub fn save_agent_session(state: tauri::State<AppState>, session: AgentSession) -> AppResult<()> {
    session_repo(&state).save(&session)
}

#[tauri::command]
pub fn archive_agent_session(
    state: tauri::State<AppState>,
    session_id: String,
) -> AppResult<()> {
    session_repo(&state).archive(&session_id)
}

#[tauri::command]
pub fn delete_agent_session(
    state: tauri::State<AppState>,
    session_id: String,
) -> AppResult<()> {
    session_repo(&state).delete(&session_id)
}

// ============ Operation History 命令 ============

#[tauri::command]
pub fn load_operation_history(
    state: tauri::State<AppState>,
) -> AppResult<Vec<OperationRecord>> {
    operation_repo(&state).load()
}

#[tauri::command]
pub fn append_operation_history(
    state: tauri::State<AppState>,
    kind: OperationKind,
    document_id: Option<String>,
    summary: String,
) -> AppResult<OperationRecord> {
    operation_repo(&state).append(kind, document_id, summary)
}

#[tauri::command]
pub fn clear_operation_history(state: tauri::State<AppState>) -> AppResult<()> {
    operation_repo(&state).clear()
}

// ============ Model Config 命令 ============

#[tauri::command]
pub fn get_model_config(state: tauri::State<AppState>) -> AppResult<ModelConfiguration> {
    model_config_repo(&state).load()
}

#[tauri::command]
pub fn set_model_config(
    state: tauri::State<AppState>,
    config: ModelConfiguration,
) -> AppResult<()> {
    model_config_repo(&state).save(&config)
}

#[tauri::command]
pub fn get_api_key(state: tauri::State<AppState>) -> AppResult<Option<String>> {
    model_config_repo(&state).get_api_key()
}

#[tauri::command]
pub fn set_api_key(state: tauri::State<AppState>, api_key: String) -> AppResult<()> {
    model_config_repo(&state).set_api_key(&api_key)
}

#[tauri::command]
pub fn delete_api_key(state: tauri::State<AppState>) -> AppResult<()> {
    model_config_repo(&state).delete_api_key()
}

// ============ Longform Memory 命令 ============

#[tauri::command]
pub fn load_longform_memory(
    state: tauri::State<AppState>,
    document_id: String,
) -> AppResult<DocumentMemory> {
    memory_repo(&state).load(&document_id)
}

#[tauri::command]
pub fn append_longform_memory(
    state: tauri::State<AppState>,
    document_id: String,
    fragment: MemoryFragment,
) -> AppResult<()> {
    memory_repo(&state).append_fragment(&document_id, fragment)
}

#[tauri::command]
pub fn clear_longform_memory(
    state: tauri::State<AppState>,
    document_id: String,
) -> AppResult<()> {
    memory_repo(&state).clear(&document_id)
}

// ============ Index 命令（阶段 3） ============

/// 构建或刷新一个文档的索引
///
/// 调用方（前端或 sidecar）传入文档 id、标题（可选）、正文内容，
/// 命令层负责打开索引库、写库。返回是否实际重新分块。
#[tauri::command]
pub fn build_index(
    state: tauri::State<AppState>,
    document_id: String,
    title: Option<String>,
    content: String,
    updated_at: i64,
) -> AppResult<bool> {
    let repo = IndexRepository::open(&state.paths)?;
    repo.upsert_document(&document_id, title.as_deref(), &content, updated_at)
}

/// 批量构建索引（前端扫描工作区后调用）
#[tauri::command]
pub fn build_index_batch(
    state: tauri::State<AppState>,
    items: Vec<IndexBuildItem>,
) -> AppResult<IndexBuildBatchResult> {
    let repo = IndexRepository::open(&state.paths)?;
    let mut rebuilt = 0usize;
    let mut skipped = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for item in items {
        match repo.upsert_document(
            &item.document_id,
            item.title.as_deref(),
            &item.content,
            item.updated_at,
        ) {
            Ok(true) => rebuilt += 1,
            Ok(false) => skipped += 1,
            Err(e) => errors.push(format!("{}: {e}", item.document_id)),
        }
    }
    Ok(IndexBuildBatchResult {
        rebuilt,
        skipped,
        errors,
    })
}

/// 单个构建项
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexBuildItem {
    pub document_id: String,
    pub title: Option<String>,
    pub content: String,
    pub updated_at: i64,
}

/// 批量构建结果
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexBuildBatchResult {
    pub rebuilt: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

/// 跨文档分块检索
#[tauri::command]
pub fn search_index(
    state: tauri::State<AppState>,
    query: String,
    limit: Option<usize>,
) -> AppResult<Vec<SearchHit>> {
    let repo = IndexRepository::open(&state.paths)?;
    repo.search(&query, limit.unwrap_or(50))
}

/// 读单个分块全文
#[tauri::command]
pub fn read_index_chunk(
    state: tauri::State<AppState>,
    chunk_id: String,
) -> AppResult<Option<String>> {
    let repo = IndexRepository::open(&state.paths)?;
    let chunk = repo.read_chunk(&chunk_id)?;
    Ok(chunk.map(|c| {
        let mut s = String::new();
        if let Some(h) = c.heading {
            s.push_str(&format!("# {h}\n\n"));
        }
        s.push_str(&c.text);
        s
    }))
}

/// 文档索引统计
#[tauri::command]
pub fn index_stats(
    state: tauri::State<AppState>,
    document_id: String,
) -> AppResult<Option<IndexStats>> {
    let repo = IndexRepository::open(&state.paths)?;
    repo.stats(&document_id)
}

/// 列出所有已索引文档 id
#[tauri::command]
pub fn list_indexed_documents(state: tauri::State<AppState>) -> AppResult<Vec<String>> {
    let repo = IndexRepository::open(&state.paths)?;
    repo.list_documents()
}

/// 删除一个文档的索引
#[tauri::command]
pub fn delete_indexed_document(
    state: tauri::State<AppState>,
    document_id: String,
) -> AppResult<()> {
    let repo = IndexRepository::open(&state.paths)?;
    repo.delete_document(&document_id)
}

// ============ Agent 命令（阶段 4 Part 2） ============

/// agent.run 参数（前端 → Rust → sidecar）
///
/// Rust 侧负责：
///   1. 从 AppState 取 model config + API key，塞进 params
///   2. 生成 runId（前端也可传）
///   3. 转发到 sidecar，立即返回 accepted
///   4. 后续 agent.event notification 通过 Tauri event `agent://event` 推到前端
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunArgs {
    /// 前端可指定 runId（用于本地状态匹配）；不传则 Rust 生成
    #[serde(default)]
    pub run_id: Option<String>,
    pub session_id: String,
    pub input: String,
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    pub forced_skill: Option<String>,
    #[serde(default)]
    pub document_id: Option<String>,
}

/// agent.run 返回
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunAccepted {
    pub run_id: String,
    pub accepted: bool,
}

/// 发起一次 Agent run
///
/// 流程：
///   1. 从 AppState 读 model config + API key
///   2. 构造 sidecar 的 agent.run 请求
///   3. 通过 SidecarBus 写入 sidecar（不等响应，agent.run 立即返回 accepted）
///   4. 后续 agent.event 通知由 stdout reader 线程转发到前端 Tauri event
#[tauri::command]
pub async fn agent_run(
    state: tauri::State<'_, AppState>,
    sidecar_state: tauri::State<'_, crate::sidecar::SidecarState>,
    args: AgentRunArgs,
) -> Result<AgentRunAccepted, String> {
    // 1. 读 model config + api key
    let mc_repo = ModelConfigRepository::new(state.paths.clone());
    let config = mc_repo.load().map_err(|e| e.to_string())?;
    let api_key = mc_repo.get_api_key().map_err(|e| e.to_string())?.unwrap_or_default();

    // 2. 生成 / 复用 runId
    let run_id = args.run_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // 3. 取 sidecar bus
    let bus = {
        let guard = sidecar_state
            .0
            .lock()
            .map_err(|_| "sidecar 状态锁中毒".to_string())?;
        guard
            .as_ref()
            .ok_or("sidecar 未启动")?
            .bus()
    };

    // 4. 构造 sidecar 请求
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": run_id,
        "method": "agent.run",
        "params": {
            "runId": run_id,
            "sessionId": args.session_id,
            "input": args.input,
            "profile": args.profile,
            "forcedSkill": args.forced_skill,
            "documentId": args.document_id,
            "modelConfig": config,
            "apiKey": api_key,
        }
    });

    // 5. 发送（agent.run 立即返回 accepted；流式结果走 notification）
    let resp = bus.request(&request).await.map_err(|e| e.to_string())?;

    // 6. 检查 sidecar 是否 accepted
    let accepted = resp
        .get("result")
        .and_then(|r| r.get("accepted"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    Ok(AgentRunAccepted { run_id, accepted })
}

/// agent.cancel 参数
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCancelArgs {
    pub run_id: String,
}

/// 取消进行中的 Agent run
#[tauri::command]
pub async fn agent_cancel(
    sidecar_state: tauri::State<'_, crate::sidecar::SidecarState>,
    args: AgentCancelArgs,
) -> Result<bool, String> {
    let bus = {
        let guard = sidecar_state
            .0
            .lock()
            .map_err(|_| "sidecar 状态锁中毒".to_string())?;
        guard.as_ref().ok_or("sidecar 未启动")?.bus()
    };
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": format!("cancel-{}", args.run_id),
        "method": "agent.cancel",
        "params": { "runId": args.run_id }
    });
    let resp = bus.request(&request).await.map_err(|e| e.to_string())?;
    let cancelled = resp
        .get("result")
        .and_then(|r| r.get("cancelled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Ok(cancelled)
}

// ============ Agent 草稿命令（阶段 5） ============

/// propose_agent_draft 入参（前端 → Rust）
///
/// 前端拿到 tool_result 里的 draftId 后，用这个命令重新取 ResolvedDraft 做 diff 预览。
/// 也可以不经过 tool.call，由前端直接构造草稿（例如本地"重写全文"按钮）。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeAgentDraftArgs {
    pub draft_id: String,
}

/// 取一条已暂存的 ResolvedDraft（前端预览 diff 用）
#[tauri::command]
pub fn propose_agent_draft(
    _state: tauri::State<AppState>,
    args: ProposeAgentDraftArgs,
) -> AppResult<ResolvedDraft> {
    drafts::get_draft(&args.draft_id)?
        .ok_or_else(|| AppError::NotFound(format!("草稿 {} 不存在", args.draft_id)))
}

/// apply_agent_draft 返回
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyDraftResult {
    /// 是否应用成功
    pub applied: bool,
    /// 模式
    pub mode: DraftMode,
    /// 涉及的文档 id（Create 模式下是新文档 id）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    /// Create 模式下新文档的相对路径
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// 备份的版本 id（WholeDocument / SelectedText / SearchReplace 模式下有值）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_version_id: Option<String>,
}

/// 应用一条草稿（用户确认后调用）
///
/// 流程：
///   1. take_staged 取出 StagedDraft（一次性，避免重复 apply）
///   2. 校验 can_apply（missingSearches 非空则拒绝）
///   3. WholeDocument / SelectedText / SearchReplace：
///      - backup_to_version 备份当前内容到 .flowmark/versions
///      - write_document_content 写入新内容
///   4. Create：create_document 新建文档
///   5. 返回 ApplyDraftResult
#[tauri::command]
pub fn apply_agent_draft(
    state: tauri::State<AppState>,
    draft_id: String,
) -> AppResult<ApplyDraftResult> {
    let staged = drafts::take_staged(&draft_id)?
        .ok_or_else(|| AppError::NotFound(format!("草稿 {draft_id} 不存在")))?;
    let resolved = staged.resolved.clone();

    if !resolved.can_apply {
        // 重新塞回 registry，让用户可以修改后再试
        let mut s = staged;
        s.created_at = crate::store::library::chrono_now_millis();
        s.resolved = resolved.clone();
        drafts::stage_draft(s)?;
        return Err(AppError::InvalidArgument(format!(
            "草稿无法应用：{} 个 SEARCH 块未命中",
            resolved.missing_searches.len()
        )));
    }

    let lib_repo = LibraryRepository::new(state.paths.clone());
    match resolved.mode {
        DraftMode::WholeDocument | DraftMode::SelectedText | DraftMode::SearchReplace => {
            let doc_id = resolved
                .document_id
                .clone()
                .ok_or_else(|| AppError::InvalidArgument("草稿缺少 documentId".into()))?;

            let mut lib = lib_repo.load()?;
            // 备份当前内容
            let backup_note = resolved
                .note
                .clone()
                .unwrap_or_else(|| "Agent 写回前自动备份".to_string());
            let version = lib_repo.backup_to_version(&mut lib, &doc_id, Some(backup_note))?;

            // 写入新内容
            lib_repo.write_document_content(&mut lib, &doc_id, &resolved.content)?;
            // write_document_content 改了 updated_at，落盘
            lib_repo.save(&lib)?;

            Ok(ApplyDraftResult {
                applied: true,
                mode: resolved.mode,
                document_id: Some(doc_id),
                path: None,
                backup_version_id: Some(version.id),
            })
        }
        DraftMode::Create => {
            let title = resolved
                .title
                .clone()
                .ok_or_else(|| AppError::InvalidArgument("Create 草稿缺少 title".into()))?;
            let mut lib = lib_repo.load()?;
            let doc = lib_repo.create_document(&mut lib, &title, &resolved.content)?;
            Ok(ApplyDraftResult {
                applied: true,
                mode: DraftMode::Create,
                document_id: Some(doc.id),
                path: Some(doc.path),
                backup_version_id: None,
            })
        }
    }
}

/// discard_agent_draft 返回
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardDraftResult {
    pub discarded: bool,
}

/// 丢弃一条草稿（用户取消应用时调用）
#[tauri::command]
pub fn discard_agent_draft(
    _state: tauri::State<AppState>,
    draft_id: String,
) -> AppResult<DiscardDraftResult> {
    let ok = drafts::discard_draft(&draft_id)?;
    Ok(DiscardDraftResult { discarded: ok })
}

// ============ 反向 tool.call 派发（sidecar → Rust） ============

/// 派发一次 tool.call 到本地实现
///
/// 由 SidecarBus 在 stdout reader 线程里调用，
/// 根据 tool 名路由到对应的 Rust 仓储方法。
pub fn dispatch_tool_call(
    paths: &AppPaths,
    tool: &str,
    args: serde_json::Value,
) -> AppResult<serde_json::Value> {
    match tool {
        "document_search" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidArgument("document_search 缺少 query".into()))?
                .to_string();
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize)
                .unwrap_or(10);
            let repo = IndexRepository::open(paths)?;
            let hits = repo.search(&query, limit)?;
            Ok(serde_json::json!({ "hits": hits }))
        }
        "document_read" => {
            let chunk_id = args
                .get("chunkId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidArgument("document_read 缺少 chunkId".into()))?
                .to_string();
            let repo = IndexRepository::open(paths)?;
            let chunk = repo.read_chunk(&chunk_id)?;
            Ok(serde_json::json!({ "chunk": chunk }))
        }
        "document_index" => {
            let document_id = args
                .get("documentId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidArgument("document_index 缺少 documentId".into()))?
                .to_string();
            let title = args
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidArgument("document_index 缺少 content".into()))?
                .to_string();
            let updated_at = args
                .get("updatedAt")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| AppError::InvalidArgument("document_index 缺少 updatedAt".into()))?;
            let repo = IndexRepository::open(paths)?;
            let rebuilt = repo.upsert_document(&document_id, title.as_deref(), &content, updated_at)?;
            Ok(serde_json::json!({ "rebuilt": rebuilt }))
        }
        "document_propose_replace" => {
            // 阶段 5：解析 SEARCH/REPLACE 草稿并暂存，返回带 canApply / missingSearches 的元数据
            let document_id = args
                .get("documentId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidArgument("document_propose_replace 缺少 documentId".into()))?
                .to_string();
            let blocks_arg = args
                .get("blocks")
                .and_then(|v| v.as_array())
                .ok_or_else(|| AppError::InvalidArgument("document_propose_replace 缺少 blocks 数组".into()))?;
            let mut blocks: Vec<SearchReplaceBlock> = Vec::with_capacity(blocks_arg.len());
            for (i, b) in blocks_arg.iter().enumerate() {
                let search = b
                    .get("search")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::InvalidArgument(format!("blocks[{i}] 缺少 search")))?;
                let replace = b
                    .get("replace")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::InvalidArgument(format!("blocks[{i}] 缺少 replace")))?;
                blocks.push(SearchReplaceBlock {
                    search: search.to_string(),
                    replace: replace.to_string(),
                });
            }
            let selection = args
                .get("selectionText")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| EditorSelection { replacing_selection: Some(s.to_string()) });
            let note = args
                .get("note")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            // 读当前文档内容（用于解析 SEARCH/REPLACE）
            let lib_repo = LibraryRepository::new(paths.clone());
            let lib = lib_repo.load()?;
            let current = lib_repo.read_document_content(&lib, &document_id)?;

            let (resolved, staged) = drafts::resolve_replace_draft(
                &document_id,
                &current,
                blocks,
                selection,
                note,
            )?;
            let draft_id = resolved.id.clone();
            let can_apply = resolved.can_apply;
            let missing = resolved.missing_searches.clone();
            let mode = resolved.mode;
            let replacement_count = resolved.replacement_count;
            drafts::stage_draft(staged)?;

            Ok(serde_json::json!({
                "draftId": draft_id,
                "documentId": document_id,
                "mode": mode,
                "canApply": can_apply,
                "missingSearches": missing,
                "replacementCount": replacement_count,
            }))
        }
        "document_propose_create" => {
            // 阶段 5：解析创建草稿并暂存
            let title = args
                .get("title")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidArgument("document_propose_create 缺少 title".into()))?
                .to_string();
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidArgument("document_propose_create 缺少 content".into()))?
                .to_string();
            let note = args
                .get("note")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let (resolved, staged) = drafts::resolve_create_draft(&title, content, note)?;
            let draft_id = resolved.id.clone();
            let can_apply = resolved.can_apply;
            let mode = resolved.mode;
            drafts::stage_draft(staged)?;

            Ok(serde_json::json!({
                "draftId": draft_id,
                "mode": mode,
                "title": title,
                "canApply": can_apply,
            }))
        }
        other => Err(AppError::InvalidArgument(format!("未知工具: {other}"))),
    }
}

// 让 AppError 抑制未使用警告（阶段 4 会用 AppError 直接）
#[allow(dead_code)]
fn _suppress_unused_mutex() -> Mutex<()> {
    Mutex::new(())
}

// ============ AppState 定义 ============

/// 应用全局状态
///
/// 持有 AppPaths，各命令按需派生 Repository
/// （Repository 无状态，每次 new 成本极低）
pub struct AppState {
    pub paths: AppPaths,
}

impl AppState {
    /// 生产环境：从系统目录初始化，并确保子目录存在
    pub fn system() -> AppResult<Self> {
        let paths = AppPaths::system()?;
        paths.ensure_dirs()?;
        Ok(Self { paths })
    }
}

// 让 AppError 能被 Tauri 命令直接返回（已在 store/error.rs impl Serialize）
// 这里只是提醒：AppResult<T> 的 T 需要 Serialize，AppError 已实现 Serialize
#[allow(unused_imports)]
use crate::store::AppResult as _AppResultAlias;

// 抑制未使用警告（阶段 4 会用 AppError 直接）
#[allow(dead_code)]
fn _suppress_unused() -> AppError {
    AppError::NotFound("placeholder".into())
}
