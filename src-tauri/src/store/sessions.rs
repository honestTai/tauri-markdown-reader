//! Agent 会话仓储
//!
//! 对齐 iOS AgentSession 持久化：
//!   - sessions.json：会话列表（元数据，不含消息）
//!   - threads/<session_id>.json：单会话完整消息流
//!
//! 拆分原因：sessions.json 保持小，列表加载快；消息流按需加载

use crate::models::AgentSession;
use crate::store::app_paths::AppPaths;
use crate::store::error::{AppError, AppResult};
use crate::store::json_store;
use crate::store::library::chrono_now_millis;

/// 会话仓储
pub struct SessionRepository {
    paths: AppPaths,
}

impl SessionRepository {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
    }

    /// 暴露 paths 供测试用（生产代码不应依赖）
    #[cfg(test)]
    pub(crate) fn paths(&self) -> &AppPaths {
        &self.paths
    }

    /// 加载所有会话元数据（不含消息流）
    ///
    /// archived = true 的也返回，由调用方过滤
    pub fn list(&self) -> AppResult<Vec<AgentSession>> {
        match json_store::load_json::<Vec<AgentSession>>(&self.paths.sessions_json())? {
            Some(sessions) => Ok(sessions),
            None => Ok(Vec::new()),
        }
    }

    /// 加载单个会话完整消息流
    pub fn load(&self, session_id: &str) -> AppResult<AgentSession> {
        let path = self.paths.thread_json(session_id);
        match json_store::load_json::<AgentSession>(&path)? {
            Some(s) => Ok(s),
            None => Err(AppError::NotFound(format!("会话 {session_id}"))),
        }
    }

    /// 保存会话（同时写 sessions.json 列表项 + threads/<id>.json 完整消息）
    pub fn save(&self, session: &AgentSession) -> AppResult<()> {
        // 1. 写完整消息流
        json_store::save_json(&self.paths.thread_json(&session.id), session)?;

        // 2. 更新 sessions.json 列表（替换同 id 的项，或新增）
        let mut list = self.list()?;
        if let Some(existing) = list.iter_mut().find(|s| s.id == session.id) {
            *existing = session.clone();
        } else {
            list.push(session.clone());
        }
        json_store::save_json(&self.paths.sessions_json(), &list)?;
        Ok(())
    }

    /// 归档会话（标记 archived = true）
    pub fn archive(&self, session_id: &str) -> AppResult<()> {
        let mut session = self.load(session_id)?;
        session.archived = true;
        session.updated_at = chrono_now_millis();
        self.save(&session)
    }

    /// 删除会话（列表项 + 消息流文件）
    pub fn delete(&self, session_id: &str) -> AppResult<()> {
        let mut list = self.list()?;
        list.retain(|s| s.id != session_id);
        json_store::save_json(&self.paths.sessions_json(), &list)?;

        let thread_path = self.paths.thread_json(session_id);
        if thread_path.exists() {
            std::fs::remove_file(&thread_path)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AgentMessage, AgentMessageRole};
    use tempfile::tempdir;

    fn make_repo(tmp: &tempfile::TempDir) -> SessionRepository {
        let paths = AppPaths::new(tmp.path().to_path_buf());
        paths.ensure_dirs().unwrap();
        SessionRepository::new(paths)
    }

    fn make_session(id: &str) -> AgentSession {
        AgentSession {
            id: id.into(),
            title: "测试会话".into(),
            document_id: None,
            messages: vec![AgentMessage {
                id: "m1".into(),
                role: AgentMessageRole::User,
                content: "你好".into(),
                tool_calls: vec![],
                skill: None,
                routed_by: None,
                sources: vec![],
                timestamp: 1000,
            }],
            created_at: 1000,
            updated_at: 1000,
            archived: false,
        }
    }

    #[test]
    fn 保存并加载会话() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        let s = make_session("s1");
        repo.save(&s).unwrap();

        let loaded = repo.load("s1").unwrap();
        assert_eq!(loaded.title, "测试会话");
        assert_eq!(loaded.messages.len(), 1);
    }

    #[test]
    fn 列表包含所有会话() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        repo.save(&make_session("s1")).unwrap();
        repo.save(&make_session("s2")).unwrap();

        let list = repo.list().unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn 归档标记生效() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        repo.save(&make_session("s1")).unwrap();
        repo.archive("s1").unwrap();

        let loaded = repo.load("s1").unwrap();
        assert!(loaded.archived);
    }

    #[test]
    fn 删除会话清理文件() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        repo.save(&make_session("s1")).unwrap();
        assert!(repo.paths().thread_json("s1").exists());

        repo.delete("s1").unwrap();
        assert!(!repo.paths().thread_json("s1").exists());
        assert!(repo.list().unwrap().is_empty());
    }

    #[test]
    fn 重复保存更新而非追加() {
        let tmp = tempdir().unwrap();
        let repo = make_repo(&tmp);
        repo.save(&make_session("s1")).unwrap();
        repo.save(&make_session("s1")).unwrap();
        assert_eq!(repo.list().unwrap().len(), 1);
    }
}
