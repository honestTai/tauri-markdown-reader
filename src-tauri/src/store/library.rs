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

    /// 列出指定文档的所有版本快照（按时间倒序）
    ///
    /// 对齐 iOS DocumentLibrary.versions(for:)，供前端"版本历史"面板展示
    pub fn list_versions(&self, state: &LibraryState, doc_id: &str) -> Vec<DocumentVersion> {
        let mut versions: Vec<DocumentVersion> = state
            .versions
            .iter()
            .filter(|v| v.document_id == doc_id)
            .cloned()
            .collect();
        versions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        versions
    }

    /// 读取某个版本快照的正文
    pub fn read_version_content(
        &self,
        state: &LibraryState,
        version_id: &str,
    ) -> AppResult<String> {
        let v = state
            .versions
            .iter()
            .find(|v| v.id == version_id)
            .ok_or_else(|| AppError::NotFound(format!("版本 {version_id}")))?;
        let abs = PathBuf::from(&state.workspace_root).join(&v.path);
        Ok(std::fs::read_to_string(&abs)?)
    }

    /// 把指定版本恢复为文档当前内容（恢复前自动备份当前内容）
    ///
    /// 对齐 iOS restoreVersion：先 backup_to_version 备份"当前"内容，
    /// 再把版本快照内容写到文档文件，并更新 updated_at。
    pub fn restore_version(
        &self,
        state: &mut LibraryState,
        doc_id: &str,
        version_id: &str,
    ) -> AppResult<DocumentVersion> {
        let content = self.read_version_content(state, version_id)?;
        let backup = self.backup_to_version(state, doc_id, Some("恢复版本前自动备份".into()))?;
        self.write_document_content(state, doc_id, &content)?;
        self.save(state)?;
        Ok(backup)
    }

    /// 删除文档（删除文件 + 移除元数据 + 删除索引由调用方处理）
    ///
    /// 返回被删除的文档元数据。版本快照不删（保留历史）。
    pub fn delete_document(
        &self,
        state: &mut LibraryState,
        doc_id: &str,
    ) -> AppResult<MarkdownDocument> {
        let idx = state
            .documents
            .iter()
            .position(|d| d.id == doc_id)
            .ok_or_else(|| AppError::NotFound(format!("文档 {doc_id}")))?;
        let doc = state.documents.remove(idx);
        let abs = PathBuf::from(&state.workspace_root).join(&doc.path);
        if abs.exists() {
            std::fs::remove_file(&abs)?;
        }
        if state.active_document_id.as_deref() == Some(doc_id) {
            state.active_document_id = None;
        }
        self.save(state)?;
        Ok(doc)
    }

    /// 把工作区根目录写入 library.json（首次选择工作区时调用）
    ///
    /// 若目录不存在则尝试创建。返回更新后的 state（不原地改）。
    pub fn set_workspace_root(
        &self,
        state: &mut LibraryState,
        root: String,
    ) -> AppResult<()> {
        let p = PathBuf::from(&root);
        if !p.exists() {
            std::fs::create_dir_all(&p)?;
        }
        state.workspace_root = root;
        state.first_launch = false;
        self.save(state)
    }

    /// 扫描工作区下的所有 .md 文件，返回相对路径列表（用于首次导入 / 重建文档库）
    ///
    /// 跳过 .flowmark / .git / node_modules 等隐藏目录
    pub fn scan_workspace(workspace_root: &str) -> AppResult<Vec<String>> {
        let root = PathBuf::from(workspace_root);
        if !root.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        walk_markdown(&root, &root, &mut out)?;
        out.sort();
        Ok(out)
    }

    /// 把指定工作区文件导入文档库（去重：路径已存在则更新 title）
    pub fn import_file(
        &self,
        state: &mut LibraryState,
        rel_path: &str,
        title: Option<&str>,
    ) -> AppResult<MarkdownDocument> {
        let abs = PathBuf::from(&state.workspace_root).join(rel_path);
        if !abs.exists() {
            return Err(AppError::NotFound(format!("文件 {rel_path}")));
        }
        if let Some(existing) = state
            .documents
            .iter_mut()
            .find(|d| d.path == rel_path)
        {
            if let Some(t) = title {
                existing.title = t.to_string();
            }
            existing.updated_at = chrono_now_millis();
            let doc = existing.clone();
            self.save(state)?;
            return Ok(doc);
        }
        let ts = chrono_now_millis();
        let title = title
            .map(|s| s.to_string())
            .unwrap_or_else(|| title_from_path(rel_path));
        let doc = MarkdownDocument {
            id: Uuid::new_v4().to_string(),
            title,
            path: rel_path.to_string(),
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

/// 递归扫描目录下的 .md 文件，把相对路径收集到 out
///
/// 跳过任何以 '.' 开头的目录（.flowmark / .git 等）以及 node_modules
fn walk_markdown(root: &std::path::Path, dir: &std::path::Path, out: &mut Vec<String>) -> AppResult<()> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if path.is_dir() {
            if name_str.starts_with('.') || name_str == "node_modules" {
                continue;
            }
            walk_markdown(root, &path, out)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(rel) = path.strip_prefix(root) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    Ok(())
}

/// 从相对路径派生文档标题（取文件名，去扩展名）
fn title_from_path(rel_path: &str) -> String {
    let p = std::path::Path::new(rel_path);
    p.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Untitled".to_string())
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

    #[test]
    fn list_versions_按时间倒序() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        let mut state = make_state_with_doc(&tmp, "doc1", "a.md", "x");
        repo.backup_to_version(&mut state, "doc1", Some("v1".into())).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        repo.backup_to_version(&mut state, "doc1", Some("v2".into())).unwrap();

        let list = repo.list_versions(&state, "doc1");
        assert_eq!(list.len(), 2);
        assert!(list[0].timestamp >= list[1].timestamp);
    }

    #[test]
    fn restore_version_先备份再写回() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        let mut state = make_state_with_doc(&tmp, "doc1", "a.md", "原始内容");
        let v1 = repo.backup_to_version(&mut state, "doc1", Some("v1".into())).unwrap();
        repo.write_document_content(&mut state, "doc1", "被修改").unwrap();
        repo.save(&state).unwrap();

        // 恢复到 v1
        let backup = repo.restore_version(&mut state, "doc1", &v1.id).unwrap();
        // 当前内容应该回到"原始内容"
        let cur = repo.read_document_content(&state, "doc1").unwrap();
        assert_eq!(cur, "原始内容");
        // 应该多出一条恢复前备份（内容是被修改后的）
        let backup_content = repo.read_version_content(&state, &backup.id).unwrap();
        assert_eq!(backup_content, "被修改");
    }

    #[test]
    fn delete_document_移除元数据与文件() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        let mut state = make_state_with_doc(&tmp, "doc1", "a.md", "x");
        let removed = repo.delete_document(&mut state, "doc1").unwrap();
        assert_eq!(removed.id, "doc1");
        assert!(state.documents.is_empty());
        assert!(!tmp.path().join("a.md").exists());
    }

    #[test]
    fn scan_workspace_收集_md_跳过隐藏目录() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        std::fs::write(root.join("a.md"), "# A").unwrap();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/b.md"), "# B").unwrap();
        std::fs::create_dir_all(root.join(".flowmark/versions")).unwrap();
        std::fs::write(root.join(".flowmark/versions/x.md"), "x").unwrap();
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        std::fs::write(root.join("node_modules/c.md"), "x").unwrap();

        let list = LibraryRepository::scan_workspace(&root.to_string_lossy()).unwrap();
        assert!(list.contains(&"a.md".to_string()));
        assert!(list.contains(&"sub/b.md".to_string()));
        assert!(!list.iter().any(|p| p.starts_with(".flowmark")));
        assert!(!list.iter().any(|p| p.starts_with("node_modules")));
    }

    #[test]
    fn import_file_去重() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        let mut state = LibraryState::default();
        state.workspace_root = tmp.path().to_string_lossy().to_string();
        std::fs::write(tmp.path().join("note.md"), "# 笔记").unwrap();

        let doc1 = repo.import_file(&mut state, "note.md", Some("笔记")).unwrap();
        let doc2 = repo.import_file(&mut state, "note.md", Some("新标题")).unwrap();
        assert_eq!(doc1.id, doc2.id);
        assert_eq!(doc2.title, "新标题");
        assert_eq!(state.documents.len(), 1);
    }

    #[test]
    fn set_workspace_root_创建目录() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        let mut state = LibraryState::default();
        let new_dir = tmp.path().join("workspace");
        repo.set_workspace_root(&mut state, new_dir.to_string_lossy().to_string()).unwrap();
        assert!(new_dir.exists());
        assert!(!state.first_launch);
    }

    #[test]
    fn title_from_path_去扩展名() {
        assert_eq!(title_from_path("notes/foo.md"), "foo");
        assert_eq!(title_from_path("bar.md"), "bar");
    }
}
