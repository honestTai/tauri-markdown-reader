//! SQLite 索引 schema 与迁移
//!
//! 对齐 iOS ClientDocumentIndexStore 的 SQLite 表结构：
//!   - documents: 文档元数据 + 指纹
//!   - chunks: 分块（外键关联 documents）
//!
//! 启动时调用 ensure_schema 建表/迁移。

use crate::store::error::{AppError, AppResult};
use rusqlite::Connection;

/// 建表 + 索引（幂等）
///
/// 对应迁移计划阶段 3 的 schema：
/// ```sql
/// CREATE TABLE documents (
///   id TEXT PRIMARY KEY,
///   fingerprint TEXT NOT NULL,
///   title TEXT,
///   headings_json TEXT,
///   chunk_count INTEGER,
///   updated_at INTEGER
/// );
/// CREATE TABLE chunks (
///   id TEXT PRIMARY KEY,
///   document_id TEXT NOT NULL,
///   ordinal INTEGER,
///   heading TEXT,
///   text TEXT,
///   FOREIGN KEY (document_id) REFERENCES documents(id)
/// );
/// CREATE INDEX idx_chunks_document ON chunks(document_id);
/// ```
pub fn ensure_schema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS documents (
            id             TEXT PRIMARY KEY,
            fingerprint    TEXT NOT NULL,
            title          TEXT,
            headings_json  TEXT,
            chunk_count    INTEGER NOT NULL DEFAULT 0,
            updated_at     INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS chunks (
            id            TEXT PRIMARY KEY,
            document_id   TEXT NOT NULL,
            ordinal       INTEGER NOT NULL,
            heading       TEXT,
            text          TEXT NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_ordinal ON chunks(document_id, ordinal);
        ",
    )
    .map_err(|e| AppError::Sidecar(format!("SQLite 建表失败: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn open_test_conn() -> (tempfile::TempDir, Connection) {
        let dir = tempdir().unwrap();
        let conn = Connection::open(dir.path().join("index.db")).unwrap();
        ensure_schema(&conn).unwrap();
        (dir, conn)
    }

    #[test]
    fn ensure_schema_idempotent() {
        let (_dir, conn) = open_test_conn();
        // 再次调用不应报错
        ensure_schema(&conn).unwrap();
    }

    #[test]
    fn tables_created() {
        let (_dir, conn) = open_test_conn();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('documents','chunks')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn indexes_created() {
        let (_dir, conn) = open_test_conn();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name LIKE 'idx_chunks%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(count >= 2);
    }
}
