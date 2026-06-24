//! 文档库仓储
//!
//! 对齐 iOS DocumentLibrary 的持久化职责：
//!   - 加载/保存 library.json
//!   - 文档元数据 CRUD
//!   - 版本快照管理
//!   - 阶段 5：apply_agent_draft 写回（含备份到 .flowmark/versions）

use crate::models::{DocumentVersion, LibraryState, MarkdownDocument};
use crate::store::app_paths::AppPaths;
use crate::store::error::{AppError, AppResult};
use crate::store::json_store;
use std::path::PathBuf;
use uuid::Uuid;

/// 文档库仓储
pub struct LibraryRepository {
    paths: AppPaths,
}

impl LibraryRepository {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
    }

    /// 加载 library.json，文件不存在时返回默认状态
    pub fn load(&self) -> AppResult<LibraryState> {
        match json_store::load_json::<LibraryState>(&self.paths.library_json())? {
            Some(state) => Ok(state),
            None => Ok(LibraryState::default()),
        }
    }

    /// 保存 library.json
    pub fn save(&self, state: &LibraryState) -> AppResult<()> {
        json_store::save_json(&self.paths.library_json(), state)
    }

    /// 读取文档正文（从工作区文件系统）
    ///
    /// 文档正文存在文件系统而非 JSON 里（见 MarkdownDocument 注释）
    pub fn read_document_content(&self, state: &LibraryState, doc_id: &str) -> AppResult<String> {
        let doc = state
            .documents
            .iter()
            .find(|d| d.id == doc_id)
            .ok_or_else(|| AppError::NotFound(format!("文档 {doc_id}")))?;

        let abs = PathBuf::from(&state.workspace_root).join(&doc.path);
        Ok(std::fs::read_to_string(&abs)?)
    }

    /// 写入文档正文（更新文件 + 更新 updated_at）
    ///
    /// 注意：这里不写版本备份，版本备份由阶段 5 的 apply_agent_draft 负责
    pub fn write_document_content(
        &self,
        state: &mut LibraryState,
        doc_id: &str,
        content: &str,
    ) -> AppResult<()> {
        let doc = state
            .documents
            .iter_mut()
            .find(|d| d.id == doc_id)
            .ok_or_else(|| AppError::NotFound(format!("文档 {doc_id}")))?;

        let abs = PathBuf::from(&state.workspace_root).join(&doc.path);
        if let Some(parent) = abs.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)?;
            }
        }
        std::fs::write(&abs, content)?;
        doc.updated_at = chrono_now_millis();
        Ok(())
    }

    /// 找到指定文档的元数据（不可变借用）
    pub fn find_document<'a>(&self, state: &'a LibraryState, doc_id: &str) -> Option<&'a MarkdownDocument> {
        state.documents.iter().find(|d| d.id == doc_id)
    }

    /// 文档正文绝对路径
    pub fn document_abs_path(state: &LibraryState, doc_id: &str) -> AppResult<PathBuf> {
        let doc = state
            .documents
            .iter()
            .find(|d| d.id == doc_id)
            .ok_or_else(|| AppError::NotFound(format!("文档 {doc_id}")))?;
        Ok(PathBuf::from(&state.workspace_root).join(&doc.path))
    }

    /// 把当前文档内容备份到 .flowmark/versions/<doc_id>.<ts>.md，
    /// 并把 DocumentVersion 元数据追加到 library.json
    ///
    /// 对齐 iOS DocumentLibrary.backupVersion：应用 Agent 草稿前必须先备份
    pub fn backup_to_version(
        &self,
        state: &mut LibraryState,
        doc_id: &str,
        note: Option<String>,
    ) -> AppResult<DocumentVersion> {
        let abs = Self::document_abs_path(state, doc_id)?;
        let current_content = if abs.exists() {
            std::fs::read_to_string(&abs)?
        } else {
            String::new()
        };

        let ts = chrono_now_millis();
        let version_id = Uuid::new_v4().to_string();
        let rel_dir = AppPaths::versions_rel_dir();
        let rel_path = format!("{rel_dir}/{doc_id}.{ts}.md");
        let abs_version = PathBuf::from(&state.workspace_root).join(&rel_path);

        if let Some(parent) = abs_version.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)?;
            }
        }
        std::fs::write(&abs_version, &current_content)?;

        let version = DocumentVersion {
            id: version_id,
            document_id: doc_id.to_string(),
            timestamp: ts,
            note,
            path: rel_path,
        };
        state.versions.push(version.clone());
        // 持久化 library.json（versions 元数据落盘）
        self.save(state)?;
        Ok(version)
    }

    /// 新建文档（用于 Create 草稿应用）
    ///
    /// 路径用 <workspace_root>/<sanitized_title>.md，简单去重；若冲突追加时间戳
    pub fn create_document(
        &self,
        state: &mut LibraryState,
        title: &str,
        content: &str,
    ) -> AppResult<MarkdownDocument> {
        let ts = chrono_now_millis();
        let safe_name = sanitize_filename(title);
        let mut rel_path = format!("{safe_name}.md");
        let mut abs = PathBuf::from(&state.workspace_root).join(&rel_path);
        if abs.exists() {
            rel_path = format!("{safe_name}.{ts}.md");
            abs = PathBuf::from(&state.workspace_root).join(&rel_path);
        }
        if let Some(parent) = abs.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)?;
            }
        }
        std::fs::write(&abs, content)?;

        let doc = MarkdownDocument {
            id: Uuid::new_v4().to_string(),
            title: title.to_string(),
            path: rel_path,
            starred: false,
            pinned: false,
            locked: false,
            created_at: ts,
            updated_at: ts,
            fingerprint: None,
        };
        state.documents.push(doc.clone());
        self.save(state)?;
        Ok(doc)
    }
}

/// 把标题转成文件名安全的字符串（对齐 iOS 简单去空格 / 斜杠策略）
fn sanitize_filename(title: &str) -> String {
    let mut s: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    s = s.trim().trim_matches('.').to_string();
    if s.is_empty() {
        "untitled".to_string()
    } else if s.len() > 80 {
        // 截断但按 char 边界
        s.chars().take(80).collect()
    } else {
        s
    }
}

/// 获取当前 Unix 毫秒时间戳
///
/// 用 SystemTime 而非 chrono，避免引入额外依赖（阶段 2 不需要 chrono）
pub fn chrono_now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::MarkdownDocument;
    use tempfile::tempdir;

    fn make_repo(tmp: &tempfile::TempDir) -> LibraryRepository {
        LibraryRepository::new(AppPaths::new(tmp.path().to_path_buf()))
    }

    #[test]
    fn 空目录加载返回默认状态() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        let state = repo.load().unwrap();
        assert!(state.documents.is_empty());
        assert!(state.first_launch);
    }

    #[test]
    fn 保存后能读回() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        let mut state = LibraryState::default();
        state.workspace_root = tmp.path().to_string_lossy().to_string();
        state.documents.push(MarkdownDocument {
            id: "doc1".into(),
            title: "测试".into(),
            path: "test.md".into(),
            starred: false,
            pinned: false,
            locked: false,
            created_at: 1000,
            updated_at: 1000,
            fingerprint: None,
        });
        repo.save(&state).unwrap();
        let loaded = repo.load().unwrap();
        assert_eq!(loaded.documents.len(), 1);
        assert_eq!(loaded.documents[0].title, "测试");
    }

    #[test]
    fn 读写文档正文() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        let mut state = LibraryState::default();
        state.workspace_root = tmp.path().to_string_lossy().to_string();
        state.documents.push(MarkdownDocument {
            id: "doc1".into(),
            title: "测试".into(),
            path: "sub/test.md".into(),
            starred: false,
            pinned: false,
            locked: false,
            created_at: 1000,
            updated_at: 1000,
            fingerprint: None,
        });
        repo.write_document_content(&mut state, "doc1", "# 你好").unwrap();
        let content = repo.read_document_content(&state, "doc1").unwrap();
        assert_eq!(content, "# 你好");
        // 父目录应自动创建
        assert!(tmp.path().join("sub/test.md").exists());
    }

    #[test]
    fn 读不存在的文档报错() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        let state = LibraryState::default();
        let r = repo.read_document_content(&state, "nope");
        assert!(matches!(r, Err(AppError::NotFound(_))));
    }

    fn make_state_with_doc(tmp: &tempfile::TempDir, doc_id: &str, path: &str, content: &str) -> LibraryState {
        let mut state = LibraryState::default();
        state.workspace_root = tmp.path().to_string_lossy().to_string();
        state.documents.push(MarkdownDocument {
            id: doc_id.into(),
            title: "测试".into(),
            path: path.into(),
            starred: false,
            pinned: false,
            locked: false,
            created_at: 1000,
            updated_at: 1000,
            fingerprint: None,
        });
        let abs = tmp.path().join(path);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&abs, content).unwrap();
        state
    }

    #[test]
    fn backup_to_version_备份当前内容() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        let mut state = make_state_with_doc(&tmp, "doc1", "a.md", "原内容");
        let v = repo.backup_to_version(&mut state, "doc1", Some("备份".into())).unwrap();
        assert_eq!(v.document_id, "doc1");
        assert!(v.path.starts_with(".flowmark/versions/doc1."));
        // 备份文件存在且内容是原文
        let abs = tmp.path().join(&v.path);
        assert_eq!(std::fs::read_to_string(&abs).unwrap(), "原内容");
        // library.json 里 versions 字段有一条
        assert_eq!(state.versions.len(), 1);
        // 持久化后能读回
        let loaded = repo.load().unwrap();
        assert_eq!(loaded.versions.len(), 1);
    }

    #[test]
    fn create_document_新建并落盘() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        let mut state = LibraryState::default();
        state.workspace_root = tmp.path().to_string_lossy().to_string();
        let doc = repo.create_document(&mut state, "新文档/标题", "正文").unwrap();
        assert_eq!(doc.title, "新文档/标题");
        // 文件名已做安全处理
        assert!(doc.path.ends_with(".md"));
        assert!(!doc.path.contains('/'));
        // 文件存在
        let abs = tmp.path().join(&doc.path);
        assert_eq!(std::fs::read_to_string(&abs).unwrap(), "正文");
        // library.json 里有这条
        let loaded = repo.load().unwrap();
        assert_eq!(loaded.documents.len(), 1);
    }

    #[test]
    fn sanitize_filename_替换非法字符() {
        assert_eq!(sanitize_filename("a/b:c"), "a_b_c");
        assert_eq!(sanitize_filename("  "), "untitled");
        assert_eq!(sanitize_filename(".隐藏"), "隐藏");
    }
}
