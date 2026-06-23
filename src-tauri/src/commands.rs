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
