//! 文档库仓储
//!
//! 对齐 iOS DocumentLibrary 的持久化职责：
//!   - 加载/保存 library.json
//!   - 文档元数据 CRUD
//!   - 版本快照管理

use crate::models::LibraryState;
use crate::store::app_paths::AppPaths;
use crate::store::error::{AppError, AppResult};
use crate::store::json_store;
use std::path::PathBuf;

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
}
