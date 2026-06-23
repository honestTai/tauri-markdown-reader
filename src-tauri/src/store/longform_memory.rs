//! 长文档记忆仓储
//!
//! 对齐 iOS LongformMemoryStore：
//!   - 按文档/profile/route 维度存储记忆片段
//!   - 持久化到 memory/<doc_id>.json

use crate::store::app_paths::AppPaths;
use crate::store::error::AppResult;
use crate::store::json_store;
use serde::{Deserialize, Serialize};

/// 单条记忆片段
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFragment {
    /// 片段 id
    pub id: String,
    /// 记忆内容
    pub content: String,
    /// 关联的 profile（general / academic / novel / html）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    /// 关联的 route（slash 命令名）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    /// 创建时间（Unix 毫秒）
    pub created_at: i64,
}

/// 单文档的全部记忆
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMemory {
    pub document_id: String,
    pub fragments: Vec<MemoryFragment>,
}

pub struct LongformMemoryRepository {
    paths: AppPaths,
}

impl LongformMemoryRepository {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
    }

    /// 加载文档记忆，文件不存在时返回空
    pub fn load(&self, document_id: &str) -> AppResult<DocumentMemory> {
        Ok(
            json_store::load_json::<DocumentMemory>(&self.paths.memory_json(document_id))?
                .unwrap_or(DocumentMemory {
                    document_id: document_id.into(),
                    fragments: vec![],
                }),
        )
    }

    /// 保存文档记忆
    pub fn save(&self, memory: &DocumentMemory) -> AppResult<()> {
        json_store::save_json(&self.paths.memory_json(&memory.document_id), memory)
    }

    /// 追加一条记忆片段
    pub fn append_fragment(&self, document_id: &str, fragment: MemoryFragment) -> AppResult<()> {
        let mut memory = self.load(document_id)?;
        memory.fragments.push(fragment);
        self.save(&memory)
    }

    /// 清空文档记忆
    pub fn clear(&self, document_id: &str) -> AppResult<()> {
        let memory = DocumentMemory {
            document_id: document_id.into(),
            fragments: vec![],
        };
        self.save(&memory)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::library::chrono_now_millis;
    use tempfile::tempdir;

    fn make_fragment(content: &str) -> MemoryFragment {
        MemoryFragment {
            id: format!("f-{}", chrono_now_millis()),
            content: content.into(),
            profile: Some("general".into()),
            route: None,
            created_at: chrono_now_millis(),
        }
    }

    #[test]
    fn 空记忆返回空数组() {
        let tmp = tempdir().unwrap();
        let repo = LongformMemoryRepository::new(AppPaths::new(tmp.path().to_path_buf()));
        let mem = repo.load("doc1").unwrap();
        assert_eq!(mem.document_id, "doc1");
        assert!(mem.fragments.is_empty());
    }

    #[test]
    fn 追加片段后能读回() {
        let tmp = tempdir().unwrap();
        let repo = LongformMemoryRepository::new(AppPaths::new(tmp.path().to_path_buf()));
        repo.append_fragment("doc1", make_fragment("片段一")).unwrap();
        repo.append_fragment("doc1", make_fragment("片段二")).unwrap();

        let mem = repo.load("doc1").unwrap();
        assert_eq!(mem.fragments.len(), 2);
    }

    #[test]
    fn 清空后为空() {
        let tmp = tempdir().unwrap();
        let repo = LongformMemoryRepository::new(AppPaths::new(tmp.path().to_path_buf()));
        repo.append_fragment("doc1", make_fragment("x")).unwrap();
        repo.clear("doc1").unwrap();
        assert!(repo.load("doc1").unwrap().fragments.is_empty());
    }
}
