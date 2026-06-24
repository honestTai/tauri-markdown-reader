//! 数据模型层
//!
//! 对齐 iOS FlowMarkApp/Models/ 的核心数据结构。
//! 所有模型派生 Serialize/Deserialize，用于：
//!   1. Rust ↔ 前端的 Tauri 命令参数/返回值
//!   2. 持久化到 AppData 的 JSON 文件
//!
//! 设计原则：
//!   - 模型只描述数据形状，不含业务逻辑（业务逻辑在 store 层）
//!   - 用 Serde 的 rename_all = "camelCase" 对齐 TS/JS 命名习惯
//!   - 必填字段不用 Option，可选字段用 Option<T> + #[serde(skip_serializing_if)]

pub mod agent;
pub mod document;
pub mod operation;
pub mod skill;

pub use agent::*;
pub use document::*;
pub use operation::*;
pub use skill::*;
