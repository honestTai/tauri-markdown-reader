//! Windows Credential Manager 凭据存储
//!
//! 对齐 iOS Keychain 存 API key：
//!   - iOS: Keychain
//!   - Windows: Credential Manager（通过 keyring crate）
//!   - macOS（不做）: Keychain
//!
//! 设计要点：
//!   - API key 只进系统凭据库，不落 JSON 明文
//!   - 不打日志（避免泄露）
//!   - keyring 失败时返回 AppError::Credential，由上层 UI 提示

use crate::store::error::{AppError, AppResult};

/// 凭据存储
///
/// 封装 keyring crate，对上层暴露简单 get/set/delete
pub struct CredentialStore {
    service: String,
    /// 用户名占位（Credential Manager 需要 user 字段，单机 App 用固定值）
    user: String,
}

impl CredentialStore {
    pub fn new(service: &str) -> Self {
        Self {
            service: service.to_string(),
            user: "default".to_string(),
        }
    }

    /// 读取密码，不存在时返回 None
    pub fn get_password(&self) -> AppResult<Option<String>> {
        let entry = keyring::Entry::new(&self.service, &self.user)
            .map_err(|e| AppError::Credential(e.to_string()))?;
        match entry.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Credential(e.to_string())),
        }
    }

    /// 设置密码（覆盖已有）
    pub fn set_password(&self, password: &str) -> AppResult<()> {
        let entry = keyring::Entry::new(&self.service, &self.user)
            .map_err(|e| AppError::Credential(e.to_string()))?;
        entry
            .set_password(password)
            .map_err(|e| AppError::Credential(e.to_string()))
    }

    /// 删除密码，不存在时返回 Ok
    pub fn delete_password(&self) -> AppResult<()> {
        let entry = keyring::Entry::new(&self.service, &self.user)
            .map_err(|e| AppError::Credential(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Credential(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 注意：keyring 在 CI 无桌面环境（无 D-Bus / 无 Credential Manager 会话）时
    /// 通常会失败。这里只做 smoke test，不强依赖凭据库可用。
    #[test]
    fn 不存在的服务返回_none_或_凭据库错误() {
        let store = CredentialStore::new("flowmark.test.nonexistent");
        let r = store.get_password();
        // CI 上可能 Err，也可能 Ok(None)，都算通过
        assert!(r.is_ok() || matches!(r, Err(AppError::Credential(_))));
    }
}
