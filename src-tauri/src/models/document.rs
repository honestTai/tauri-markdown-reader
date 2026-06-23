//! 文档与文档库模型
//!
//! 对齐 iOS：
//!   - FlowMarkApp/Models/MarkdownDocument.swift
//!   - FlowMarkApp/Services/DocumentLibrary.swift
//!   - FlowMarkApp/Models/DocumentTemplate.swift

use serde::{Deserialize, Serialize};

/// Markdown 文档（对齐 iOS MarkdownDocument）
///
/// 与 iOS 的差异：iOS 把正文存在 UserDefaults 里的 Document 对象内，
/// Windows 版改为正文字档存文件系统，library.json 只存元数据，
/// 避免大文档撑爆 JSON。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownDocument {
    /// 文档唯一 id（UUID v4）
    pub id: String,
    /// 文档标题（显示用，可不同于文件名）
    pub title: String,
    /// 工作区内相对路径（相对工作区根），如 "notes/foo.md"
    pub path: String,
    /// 是否收藏
    pub starred: bool,
    /// 是否置顶（置顶的文档在侧栏排在最前）
    pub pinned: bool,
    /// 是否锁定（锁定后 Agent 写回需要二次确认）
    pub locked: bool,
    /// 创建时间（Unix 毫秒）
    pub created_at: i64,
    /// 最后修改时间（Unix 毫秒）
    pub updated_at: i64,
    /// 内容指纹（SHA-256，用于索引缓存判定）
    /// 索引模块会在 build_index 时填充
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
}

/// 文档版本快照（对齐 iOS DocumentVersion）
///
/// 每次 Agent 写回或用户手动保存版本时，把当前内容备份到
/// `.flowmark/versions/<doc_id>.<ts>.md`，元数据留在 library.json。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentVersion {
    /// 版本 id（UUID v4）
    pub id: String,
    /// 所属文档 id
    pub document_id: String,
    /// 版本创建时间（Unix 毫秒）
    pub timestamp: i64,
    /// 版本备注（如 "Agent 写回前自动备份"）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// 版本文件相对路径（相对工作区根），如 ".flowmark/versions/abc.1717123456789.md"
    pub path: String,
}

/// 文档库整体状态（对齐 iOS DocumentLibrary 的持久化部分）
///
/// 序列化到 AppData/flowmark/library.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryState {
    /// 当前激活的工作区根目录（绝对路径）
    pub workspace_root: String,
    /// 所有文档元数据
    pub documents: Vec<MarkdownDocument>,
    /// 所有版本快照
    pub versions: Vec<DocumentVersion>,
    /// 最近激活的文档 id（用于启动时恢复上次打开的文档）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_document_id: Option<String>,
    /// 首次启动标记（用于注入样例文档）
    #[serde(default)]
    pub first_launch: bool,
}

impl Default for LibraryState {
    fn default() -> Self {
        Self {
            workspace_root: String::new(),
            documents: Vec::new(),
            versions: Vec::new(),
            active_document_id: None,
            first_launch: true,
        }
    }
}

/// 文档模板（对齐 iOS DocumentTemplate）
///
/// 用于"从模板新建文档"
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTemplate {
    pub id: String,
    pub name: String,
    pub content: String,
    /// 模板图标（emoji 或图标 key）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}
