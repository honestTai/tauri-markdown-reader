//! JSON 文件读写工具函数
//!
//! 所有持久化的 JSON 文件都走这里，统一处理：
//!   - 原子写入（先写临时文件再 rename，避免半写损坏）
//!   - 文件不存在时返回 None
//!   - UTF-8 编码
//!
//! 用自由函数而非 trait，避免调用处要指定 impl 类型的样板代码

use crate::store::error::{AppError, AppResult};
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;

/// 从 JSON 文件加载，文件不存在时返回 None
pub fn load_json<T: DeserializeOwned>(path: &Path) -> AppResult<Option<T>> {
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path)?;
    let value: T = serde_json::from_str(&text)?;
    Ok(Some(value))
}

/// 原子写入 JSON 文件
///
/// 策略：先写到 `<path>.tmp`，再 rename 到目标路径
/// 保证即使进程崩溃也不会留下半写文件
pub fn save_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    // 确保父目录存在
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(value)?;
    std::fs::write(&tmp, text)?;

    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::Io(e)
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use tempfile::tempdir;

    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct Data {
        name: String,
        count: u32,
    }

    #[test]
    fn 文件不存在时返回_none() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("no.json");
        let r: Option<Data> = load_json(&path).unwrap();
        assert!(r.is_none());
    }

    #[test]
    fn 写入后能读回() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.json");
        let d = Data { name: "测试".into(), count: 42 };
        save_json(&path, &d).unwrap();
        let r: Data = load_json(&path).unwrap().unwrap();
        assert_eq!(r, d);
    }

    #[test]
    fn 原子写入不留临时文件() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("x.json");
        save_json(&path, &Data { name: "x".into(), count: 1 }).unwrap();
        assert!(!dir.path().join("x.json.tmp").exists());
    }

    #[test]
    fn 父目录不存在时自动创建() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("a/b/c.json");
        save_json(&path, &Data { name: "x".into(), count: 1 }).unwrap();
        assert!(path.exists());
    }
}
