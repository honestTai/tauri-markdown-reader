//! 本地索引层
//!
//! 对齐 iOS ClientDocumentIndex + ClientDocumentIndexStore：
//!   - SQLite 存文档分块（按标题层级 + 段落切分）
//!   - SHA-256 内容指纹缓存，未变更直接复用
//!   - 跨文档分块检索（search_index）
//!
//! 与 search_workspace（阶段 6 前端做全文）的区别：
//!   - search_workspace：文件名/标题/正文片段，简单包含匹配
//!   - search_index：跨文档分块检索，返回带相关性分数的 chunk 列表
//!
//! 模块组织：
//!   - schema.rs：DDL + 迁移
//!   - chunker.rs：Markdown 分块策略（纯函数，易测）
//!   - fingerprint.rs：SHA-256 指纹
//!   - store.rs：SQLite 读写（Repository 模式）

pub mod chunker;
pub mod fingerprint;
pub mod schema;
pub mod store;

pub use store::{IndexRepository, IndexStats, SearchHit};
