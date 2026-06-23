//! 操作历史仓储
//!
//! 对齐 iOS OperationHistoryStore：
//!   - operation_history.json：所有操作记录（追加写）
//!   - 保留最近 N 条（默认 1000），超出自动裁剪

use crate::models::{OperationKind, OperationRecord};
use crate::store::app_paths::AppPaths;
use crate::store::error::AppResult;
use crate::store::json_store;
use crate::store::library::chrono_now_millis;

/// 默认最多保留的操作记录条数
const DEFAULT_MAX_RECORDS: usize = 1000;

pub struct OperationHistoryRepository {
    paths: AppPaths,
    max_records: usize,
}

impl OperationHistoryRepository {
    pub fn new(paths: AppPaths) -> Self {
        Self {
            paths,
            max_records: DEFAULT_MAX_RECORDS,
        }
    }

    /// 自定义上限（测试用）
    #[cfg(test)]
    pub fn with_max_records(paths: AppPaths, max: usize) -> Self {
        Self {
            paths,
            max_records: max,
        }
    }

    /// 加载全部操作记录（按时间倒序）
    pub fn load(&self) -> AppResult<Vec<OperationRecord>> {
        let mut records: Vec<OperationRecord> =
            json_store::load_json(&self.paths.operation_history_json())?
                .unwrap_or_default();
        // 倒序：最新在前
        records.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        Ok(records)
    }

    /// 追加一条操作记录
    ///
    /// 超过上限时裁剪掉最旧的记录
    pub fn append(
        &self,
        kind: OperationKind,
        document_id: Option<String>,
        summary: String,
    ) -> AppResult<OperationRecord> {
        let record = OperationRecord {
            id: new_uuid_v4(),
            kind,
            document_id,
            summary,
            timestamp: chrono_now_millis(),
        };

        let mut records = self.load()?;
        // 头插（最新在前）
        records.insert(0, record.clone());

        // 裁剪
        if records.len() > self.max_records {
            records.truncate(self.max_records);
        }

        json_store::save_json(&self.paths.operation_history_json(), &records)?;
        Ok(record)
    }

    /// 清空历史
    pub fn clear(&self) -> AppResult<()> {
        let empty: Vec<OperationRecord> = Vec::new();
        json_store::save_json(&self.paths.operation_history_json(), &empty)
    }
}

/// 生成 UUID v4
///
/// 阶段 2 不引入 uuid crate，用一个简单的随机实现：
/// 用 SystemTime + 进程 id + 计数器混合，碰撞概率对本地单机足够
/// 后续阶段 4 引入 uuid crate 后替换
pub fn new_uuid_v4() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let ts = chrono_now_millis() as u64;
    let pid = std::process::id() as u64;
    let cnt = COUNTER.fetch_add(1, Ordering::Relaxed);

    // 拼成 8-4-4-4-12 格式（不是严格 UUID v4，但唯一性够用）
    format!("{ts:012x}-{pid:04x}-{cnt:04x}-{cnt:08x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_repo(tmp: &tempfile::TempDir) -> OperationHistoryRepository {
        OperationHistoryRepository::new(AppPaths::new(tmp.path().to_path_buf()))
    }

    #[test]
    fn 空历史返回空数组() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        assert!(repo.load().unwrap().is_empty());
    }

    #[test]
    fn 追加后按倒序加载() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        repo.append(OperationKind::Edited, Some("d1".into()), "第一次".into())
            .unwrap();
        // 保证时间戳递增
        std::thread::sleep(std::time::Duration::from_millis(2));
        repo.append(OperationKind::RanAgent, None, "第二次".into())
            .unwrap();

        let records = repo.load().unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].summary, "第二次");
        assert_eq!(records[1].summary, "第一次");
    }

    #[test]
    fn 超过上限自动裁剪() {
        let tmp = tempdir().unwrap();
        let repo = OperationHistoryRepository::with_max_records(
            AppPaths::new(tmp.path().to_path_buf()),
            3,
        );
        for i in 0..5 {
            repo.append(OperationKind::Edited, None, format!("op{i}")).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let records = repo.load().unwrap();
        assert_eq!(records.len(), 3);
        // 保留最新 3 条：op4, op3, op2
        assert_eq!(records[0].summary, "op4");
        assert_eq!(records[2].summary, "op2");
    }

    #[test]
    fn 清空后为空() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        repo.append(OperationKind::Edited, None, "x".into()).unwrap();
        repo.clear().unwrap();
        assert!(repo.load().unwrap().is_empty());
    }
}
