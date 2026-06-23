//! SQLite 索引存储（Repository）
//!
//! 对齐 iOS ClientDocumentIndex + ClientDocumentIndexStore：
//!   - upsert_document: 文档指纹缓存命中则跳过分块
//!   - search: 跨文档分块检索（当前用 LIKE 子串匹配，阶段 4 由 agent 调用）
//!   - read_chunk: 读单个分块
//!   - stats: 分块数 / 标题列表
//!
//! 后续可升级到 FTS5 做全文检索；当前阶段 3 保持 LIKE，简单稳定。

use crate::index::chunker::{chunk_markdown, Chunk};
use crate::index::fingerprint::fingerprint;
use crate::index::schema;
use crate::store::app_paths::AppPaths;
use crate::store::error::{AppError, AppResult};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// 索引单例句柄
///
/// 用 Mutex 包 Connection，保证 Rust 侧单线程访问 SQLite
pub struct IndexRepository {
    conn: Mutex<Connection>,
}

/// 检索命中
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub chunk_id: String,
    pub document_id: String,
    pub heading: Option<String>,
    pub snippet: String,
    #[serde(default)]
    pub score: f32,
}

/// 文档索引统计
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub document_id: String,
    pub fingerprint: String,
    pub title: Option<String>,
    pub chunk_count: usize,
    pub headings: Vec<String>,
    pub updated_at: i64,
}

impl IndexRepository {
    /// 从 AppPaths 打开/创建索引数据库
    pub fn open(paths: &AppPaths) -> AppResult<Self> {
        let conn = Connection::open(paths.index_db())
            .map_err(|e| AppError::Sidecar(format!("打开索引数据库失败: {e}")))?;
        schema::ensure_schema(&conn)?;
        let _ = conn.execute("PRAGMA foreign_keys = ON", []);
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 从指定路径打开（测试用）
    #[cfg(test)]
    pub fn open_path(db_path: &std::path::Path) -> AppResult<Self> {
        let conn = Connection::open(db_path)
            .map_err(|e| AppError::Sidecar(format!("打开索引数据库失败: {e}")))?;
        schema::ensure_schema(&conn)?;
        let _ = conn.execute("PRAGMA foreign_keys = ON", []);
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 构建/刷新一个文档的索引
    ///
    /// 返回是否实际重新分块（指纹命中则跳过，返回 false）
    pub fn upsert_document(
        &self,
        document_id: &str,
        title: Option<&str>,
        content: &str,
        updated_at: i64,
    ) -> AppResult<bool> {
        let fp = fingerprint(content);
        let conn = self.conn.lock().map_err(|e| AppError::Sidecar(e.to_string()))?;

        let existing_fp: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM documents WHERE id = ?1",
                rusqlite::params![document_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten();
        if existing_fp.as_deref() == Some(fp.as_str()) {
            conn.execute(
                "UPDATE documents SET title = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![title, updated_at, document_id],
            )
            .map_err(|e| AppError::Sidecar(e.to_string()))?;
            return Ok(false);
        }

        let chunks = chunk_markdown(content);
        let headings: Vec<String> = chunks
            .iter()
            .filter_map(|c| c.heading.clone())
            .collect();
        let headings_json = serde_json::to_string(&headings)?;

        conn.execute(
            "DELETE FROM chunks WHERE document_id = ?1",
            rusqlite::params![document_id],
        )
        .map_err(|e| AppError::Sidecar(e.to_string()))?;
        conn.execute(
            "DELETE FROM documents WHERE id = ?1",
            rusqlite::params![document_id],
        )
        .map_err(|e| AppError::Sidecar(e.to_string()))?;

        conn.execute(
            "INSERT INTO documents (id, fingerprint, title, headings_json, chunk_count, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                document_id,
                fp,
                title,
                headings_json,
                chunks.len() as i64,
                updated_at,
            ],
        )
        .map_err(|e| AppError::Sidecar(e.to_string()))?;

        for (ordinal, c) in chunks.iter().enumerate() {
            let chunk_id = format!("{document_id}-{ordinal}");
            conn.execute(
                "INSERT INTO chunks (id, document_id, ordinal, heading, text)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    chunk_id,
                    document_id,
                    ordinal as i64,
                    c.heading,
                    c.text,
                ],
            )
            .map_err(|e| AppError::Sidecar(e.to_string()))?;
        }
        Ok(true)
    }

    /// 跨文档分块检索
    ///
    /// 当前实现：LIKE 子串匹配，按 document_id + ordinal 排序
    pub fn search(&self, query: &str, limit: usize) -> AppResult<Vec<SearchHit>> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().map_err(|e| AppError::Sidecar(e.to_string()))?;
        let like = format!("%{query}%");
        let mut stmt = conn
            .prepare(
                "SELECT c.id, c.document_id, c.heading, c.text
                 FROM chunks c
                 WHERE c.text LIKE ?1 OR c.heading LIKE ?1
                 ORDER BY c.document_id, c.ordinal
                 LIMIT ?2",
            )
            .map_err(|e| AppError::Sidecar(e.to_string()))?;
        let rows = stmt
            .query_map(rusqlite::params![like, limit as i64], |r| {
                let text: String = r.get(3)?;
                Ok(SearchHit {
                    chunk_id: r.get(0)?,
                    document_id: r.get(1)?,
                    heading: r.get(2)?,
                    snippet: truncate(&text, 200),
                    score: 1.0,
                })
            })
            .map_err(|e| AppError::Sidecar(e.to_string()))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| AppError::Sidecar(e.to_string()))?);
        }
        Ok(out)
    }

    /// 读单个分块全文
    pub fn read_chunk(&self, chunk_id: &str) -> AppResult<Option<Chunk>> {
        let conn = self.conn.lock().map_err(|e| AppError::Sidecar(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT heading, text FROM chunks WHERE id = ?1")
            .map_err(|e| AppError::Sidecar(e.to_string()))?;
        let row = stmt
            .query_row(rusqlite::params![chunk_id], |r| {
                let heading: Option<String> = r.get(0)?;
                let text: String = r.get(1)?;
                Ok(Chunk { heading, text })
            })
            .ok();
        Ok(row)
    }

    /// 文档索引统计
    pub fn stats(&self, document_id: &str) -> AppResult<Option<IndexStats>> {
        let conn = self.conn.lock().map_err(|e| AppError::Sidecar(e.to_string()))?;
        let row = conn
            .query_row(
                "SELECT id, fingerprint, title, headings_json, chunk_count, updated_at
                 FROM documents WHERE id = ?1",
                rusqlite::params![document_id],
                |r| {
                    let headings_json: Option<String> = r.get(3)?;
                    let headings: Vec<String> = headings_json
                        .as_deref()
                        .and_then(|s| serde_json::from_str(s).ok())
                        .unwrap_or_default();
                    Ok(IndexStats {
                        document_id: r.get(0)?,
                        fingerprint: r.get(1)?,
                        title: r.get(2)?,
                        chunk_count: r.get::<_, i64>(4)? as usize,
                        headings,
                        updated_at: r.get(5)?,
                    })
                },
            )
            .ok();
        Ok(row)
    }

    /// 删除一个文档的索引（文档被删除时调用）
    pub fn delete_document(&self, document_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|e| AppError::Sidecar(e.to_string()))?;
        conn.execute(
            "DELETE FROM chunks WHERE document_id = ?1",
            rusqlite::params![document_id],
        )
        .map_err(|e| AppError::Sidecar(e.to_string()))?;
        conn.execute(
            "DELETE FROM documents WHERE id = ?1",
            rusqlite::params![document_id],
        )
        .map_err(|e| AppError::Sidecar(e.to_string()))?;
        Ok(())
    }

    /// 列出所有已索引文档 id
    pub fn list_documents(&self) -> AppResult<Vec<String>> {
        let conn = self.conn.lock().map_err(|e| AppError::Sidecar(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT id FROM documents ORDER BY updated_at DESC")
            .map_err(|e| AppError::Sidecar(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| AppError::Sidecar(e.to_string()))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| AppError::Sidecar(e.to_string()))?);
        }
        Ok(out)
    }
}

/// 截取文本前 max 字符（按 char 边界），超出加省略号
fn truncate(text: &str, max: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max {
        return text.to_string();
    }
    let mut s: String = chars.into_iter().take(max).collect();
    s.push('\u{2026}');
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn open_repo() -> (tempfile::TempDir, IndexRepository) {
        let dir = tempdir().unwrap();
        let repo = IndexRepository::open_path(&dir.path().join("index.db")).unwrap();
        (dir, repo)
    }

    #[test]
    fn upsert_and_stats() {
        let (_dir, repo) = open_repo();
        let content = "# 标题一\n内容 A\n## 标题二\n内容 B";
        let rebuilt = repo
            .upsert_document("doc1", Some("测试文档"), content, 1000)
            .unwrap();
        assert!(rebuilt);

        let stats = repo.stats("doc1").unwrap().unwrap();
        assert_eq!(stats.document_id, "doc1");
        assert_eq!(stats.title.as_deref(), Some("测试文档"));
        assert_eq!(stats.chunk_count, 2);
        assert!(stats.headings.contains(&"标题一".to_string()));
        assert!(stats.headings.contains(&"标题二".to_string()));
    }

    #[test]
    fn fingerprint_cache_skips_rechunk() {
        let (_dir, repo) = open_repo();
        let content = "# 标题\n内容";
        let first = repo.upsert_document("doc1", None, content, 1000).unwrap();
        assert!(first);

        let second = repo.upsert_document("doc1", Some("新标题"), content, 2000).unwrap();
        assert!(!second);

        let stats = repo.stats("doc1").unwrap().unwrap();
        assert_eq!(stats.title.as_deref(), Some("新标题"));
        assert_eq!(stats.updated_at, 2000);
    }

    #[test]
    fn content_change_triggers_rechunk() {
        let (_dir, repo) = open_repo();
        repo.upsert_document("doc1", None, "# 标题\n内容A", 1000).unwrap();
        let rebuilt = repo.upsert_document("doc1", None, "# 标题\n内容A\n内容B", 2000).unwrap();
        assert!(rebuilt);

        let stats = repo.stats("doc1").unwrap().unwrap();
        assert_eq!(stats.updated_at, 2000);
    }

    #[test]
    fn search_by_substring() {
        let (_dir, repo) = open_repo();
        repo.upsert_document("doc1", None, "# Rust\nRust 是一门系统编程语言", 1000).unwrap();
        repo.upsert_document("doc2", None, "# Python\nPython 是脚本语言", 1000).unwrap();

        let hits = repo.search("Rust", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].document_id, "doc1");
        assert_eq!(hits[0].heading.as_deref(), Some("Rust"));
    }

    #[test]
    fn search_empty_query_returns_empty() {
        let (_dir, repo) = open_repo();
        repo.upsert_document("doc1", None, "# 标题\n内容", 1000).unwrap();
        assert!(repo.search("", 10).unwrap().is_empty());
        assert!(repo.search("   ", 10).unwrap().is_empty());
    }

    #[test]
    fn search_limit() {
        let (_dir, repo) = open_repo();
        for i in 0..10 {
            repo.upsert_document(&format!("doc{i}"), None, &format!("# 章节\n关键字 内容{i}"), 1000).unwrap();
        }
        let hits = repo.search("关键字", 3).unwrap();
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn read_chunk_full_text() {
        let (_dir, repo) = open_repo();
        let content = "# 标题\n这是完整的块内容";
        repo.upsert_document("doc1", None, content, 1000).unwrap();
        let hits = repo.search("完整", 10).unwrap();
        assert!(!hits.is_empty());
        let chunk_id = &hits[0].chunk_id;
        let chunk = repo.read_chunk(chunk_id).unwrap().unwrap();
        assert!(chunk.text.contains("完整的块内容"));
    }

    #[test]
    fn delete_document_removes_chunks() {
        let (_dir, repo) = open_repo();
        repo.upsert_document("doc1", None, "# 标题\n内容", 1000).unwrap();
        assert!(repo.stats("doc1").unwrap().is_some());

        repo.delete_document("doc1").unwrap();
        assert!(repo.stats("doc1").unwrap().is_none());
        assert!(repo.search("内容", 10).unwrap().is_empty());
    }

    #[test]
    fn list_documents_ordered_by_updated() {
        let (_dir, repo) = open_repo();
        repo.upsert_document("doc1", None, "# A\nx", 1000).unwrap();
        repo.upsert_document("doc2", None, "# B\ny", 2000).unwrap();
        repo.upsert_document("doc3", None, "# C\nz", 1500).unwrap();

        let list = repo.list_documents().unwrap();
        assert_eq!(list, vec!["doc2", "doc3", "doc1"]);
    }

    #[test]
    fn chinese_content_searchable() {
        let (_dir, repo) = open_repo();
        let content = "# 第一章\n张三走进森林，遇见了一只狐狸。\n## 第二章\n狐狸开口说话。";
        repo.upsert_document("doc1", None, content, 1000).unwrap();
        let hits = repo.search("狐狸", 10).unwrap();
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn truncate_handles_multibyte() {
        let s = "你好世界这是一段比较长的中文文本";
        let t = truncate(s, 5);
        assert!(t.ends_with('\u{2026}'));
        assert_eq!(t.chars().count(), 6);
    }
}
