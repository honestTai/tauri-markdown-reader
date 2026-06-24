//! 持久化存储层
//!
//! 职责：
//!   - 定位 AppData 目录
//!   - JSON 文件的读写（library / sessions / operation_history / model_config / longform_memory）
//!   - API key 的 Windows Credential Manager 存取
//!
//! 设计模式：
//!   - 仓储模式（Repository）：每个 store 模块封装一类数据的持久化细节
//!   - 依赖注入：所有 store 依赖 `AppPaths`，便于测试时替换目录
//!   - 错误统一用 AppError，避免每层各自定义错误类型

pub mod app_paths;
pub mod credentials;
pub mod drafts;
pub mod error;
pub mod json_store;
pub mod library;
pub mod operation_history;
pub mod sessions;
pub mod model_config;
pub mod longform_memory;
pub mod skills;

pub use app_paths::AppPaths;
pub use error::{AppError, AppResult};
pub use library::LibraryRepository;
pub use operation_history::OperationHistoryRepository;
pub use sessions::SessionRepository;
pub use model_config::ModelConfigRepository;
pub use longform_memory::LongformMemoryRepository;
pub use skills::SkillRepository;
