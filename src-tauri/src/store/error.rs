//! 统一应用错误类型
//!
//! 所有 store 层和命令层的错误都归一到这里，
//! 避免错误类型爆炸，也方便 Tauri 命令统一序列化到前端。

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON 序列化/反序列化错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("凭据存储错误: {0}")]
    Credential(String),

    #[error("数据未找到: {0}")]
    NotFound(String),

    #[error("参数非法: {0}")]
    InvalidArgument(String),

    #[error("文件系统路径错误: {0}")]
    Path(String),

    #[error("sidecar 通信错误: {0}")]
    Sidecar(String),
}

pub type AppResult<T> = Result<T, AppError>;

/// Tauri 命令返回错误时，把 AppError 转成字符串
/// （Tauri 要求 command 错误实现 Serialize）
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
