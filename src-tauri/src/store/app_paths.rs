//! 应用数据目录定位
//!
//! 对齐 iOS 的 UserDefaults / App Group 容器：
//!   - Windows: %APPDATA%\flowmark\
//!   - macOS（虽然不做）: ~/Library/Application Support/flowmark/
//!   - Linux: ~/.local/share/flowmark/
//!
//! 子目录结构：
//!   flowmark/
//!     library.json
//!     model_config.json
//!     operation_history.json
//!     agent/
//!       sessions.json
//!       threads/<session_id>.json
//!     memory/<doc_id>.json
//!     index.db

use crate::store::error::{AppError, AppResult};
use std::path::PathBuf;

/// 应用数据目录路径集合
///
/// 用 struct 封装便于依赖注入：
///   - 生产环境：从系统目录派生
///   - 测试环境：传入临时目录
#[derive(Debug, Clone)]
pub struct AppPaths {
    root: PathBuf,
}

impl AppPaths {
    /// 从系统默认目录创建（生产用）
    pub fn system() -> AppResult<Self> {
        let root = dirs_next::data_dir()
            .ok_or_else(|| AppError::Path("无法定位系统数据目录".into()))?
            .join("flowmark");
        Ok(Self { root })
    }

    /// 从指定根目录创建（测试用）
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// 根目录
    pub fn root(&self) -> &PathBuf {
        &self.root
    }

    /// library.json 路径
    pub fn library_json(&self) -> PathBuf {
        self.root.join("library.json")
    }

    /// model_config.json 路径
    pub fn model_config_json(&self) -> PathBuf {
        self.root.join("model_config.json")
    }

    /// operation_history.json 路径
    pub fn operation_history_json(&self) -> PathBuf {
        self.root.join("operation_history.json")
    }

    /// agent 子目录
    pub fn agent_dir(&self) -> PathBuf {
        self.root.join("agent")
    }

    /// sessions.json（会话列表+元数据）
    pub fn sessions_json(&self) -> PathBuf {
        self.agent_dir().join("sessions.json")
    }

    /// threads 子目录（单会话消息流）
    pub fn threads_dir(&self) -> PathBuf {
        self.agent_dir().join("threads")
    }

    /// 单会话消息流文件
    pub fn thread_json(&self, session_id: &str) -> PathBuf {
        self.threads_dir().join(format!("{session_id}.json"))
    }

    /// memory 子目录（长文档记忆）
    pub fn memory_dir(&self) -> PathBuf {
        self.root.join("memory")
    }

    /// 单文档记忆文件
    pub fn memory_json(&self, document_id: &str) -> PathBuf {
        self.memory_dir().join(format!("{document_id}.json"))
    }

    /// SQLite 索引数据库路径
    pub fn index_db(&self) -> PathBuf {
        self.root.join("index.db")
    }

    /// 工作区内的版本快照目录（相对工作区根，对齐 iOS .flowmark/versions/）
    ///
    /// 注意：这是相对路径字符串（<workspace_root>/.flowmark/versions），
    /// apply_agent_draft 会拼绝对路径再 create_dir_all。
    /// 不放在 AppData 下，因为版本快照属于"工作区数据"，要随工作区走。
    pub fn versions_rel_dir() -> &'static str {
        ".flowmark/versions"
    }

    /// 确保所有子目录存在（启动时调用一次）
    pub fn ensure_dirs(&self) -> AppResult<()> {
        for dir in [
            &self.root,
            &self.agent_dir(),
            &self.threads_dir(),
            &self.memory_dir(),
        ] {
            if !dir.exists() {
                std::fs::create_dir_all(dir)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 路径派生正确() {
        let p = AppPaths::new(PathBuf::from("/tmp/flowmark-test"));
        assert_eq!(p.library_json(), PathBuf::from("/tmp/flowmark-test/library.json"));
        assert_eq!(p.sessions_json(), PathBuf::from("/tmp/flowmark-test/agent/sessions.json"));
        assert_eq!(p.thread_json("abc"), PathBuf::from("/tmp/flowmark-test/agent/threads/abc.json"));
        assert_eq!(p.memory_json("doc1"), PathBuf::from("/tmp/flowmark-test/memory/doc1.json"));
        assert_eq!(p.index_db(), PathBuf::from("/tmp/flowmark-test/index.db"));
    }
}
