//! 模型配置仓储
//!
//! 对齐 iOS ModelConfigurationStore：
//!   - endpoint / model / timeout / context_window 存 model_config.json
//!   - API key 存 Windows Credential Manager（见 credentials.rs）
//!
//! 分离原因：API key 是敏感凭据，不能落明文 JSON

use crate::models::ModelConfiguration;
use crate::store::app_paths::AppPaths;
use crate::store::credentials::CredentialStore;
use crate::store::error::AppResult;
use crate::store::json_store;

/// 模型配置的 API key 在 Credential Manager 里的服务名
const CRED_SERVICE: &str = "flowmark.openai_api_key";

pub struct ModelConfigRepository {
    paths: AppPaths,
    credentials: CredentialStore,
}

impl ModelConfigRepository {
    pub fn new(paths: AppPaths) -> Self {
        Self {
            credentials: CredentialStore::new(CRED_SERVICE),
            paths,
        }
    }

    /// 加载模型配置（不含 API key）
    ///
    /// 文件不存在时返回默认值
    pub fn load(&self) -> AppResult<ModelConfiguration> {
        Ok(
            json_store::load_json::<ModelConfiguration>(&self.paths.model_config_json())?
                .unwrap_or_default(),
        )
    }

    /// 保存模型配置（不含 API key）
    pub fn save(&self, config: &ModelConfiguration) -> AppResult<()> {
        json_store::save_json(&self.paths.model_config_json(), config)
    }

    /// 读取 API key（从 Credential Manager）
    pub fn get_api_key(&self) -> AppResult<Option<String>> {
        self.credentials.get_password()
    }

    /// 设置 API key（写 Credential Manager）
    pub fn set_api_key(&self, key: &str) -> AppResult<()> {
        self.credentials.set_password(key)
    }

    /// 删除 API key
    pub fn delete_api_key(&self) -> AppResult<()> {
        self.credentials.delete_password()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn 默认配置() {
        let tmp = tempdir().unwrap();
        let repo = ModelConfigRepository::new(AppPaths::new(tmp.path().to_path_buf()));
        let config = repo.load().unwrap();
        assert_eq!(config.timeout_secs, 60);
        assert_eq!(config.context_window, 16384);
        assert!(config.endpoint.is_empty());
    }

    #[test]
    fn 保存后能读回() {
        let tmp = tempdir().unwrap();
        let repo = ModelConfigRepository::new(AppPaths::new(tmp.path().to_path_buf()));
        let config = ModelConfiguration {
            endpoint: "https://api.deepseek.com/v1".into(),
            model: "deepseek-chat".into(),
            timeout_secs: 30,
            context_window: 32768,
        };
        repo.save(&config).unwrap();
        let loaded = repo.load().unwrap();
        assert_eq!(loaded.endpoint, "https://api.deepseek.com/v1");
        assert_eq!(loaded.model, "deepseek-chat");
        assert_eq!(loaded.timeout_secs, 30);
        assert_eq!(loaded.context_window, 32768);
    }
}
