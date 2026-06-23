//! 操作历史模型
//!
//! 对齐 iOS FlowMarkApp/Services/OperationHistoryStore.swift
//! 记录用户在 App 内的所有关键操作，用于"操作历史"面板和审计。

use serde::{Deserialize, Serialize};

/// 操作类型（对齐 iOS OperationHistoryStore.OperationKind）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OperationKind {
    /// 导入文档
    Imported,
    /// 打开外部文档
    OpenedExternal,
    /// 编辑文档
    Edited,
    /// 运行 Agent
    RanAgent,
    /// 预览 HTML artifact
    PreviewedHtml,
    /// 保存 Agent 输出到文档库
    SavedAgentOutput,
    /// 删除文档
    DeletedDocument,
}

/// 单条操作记录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRecord {
    /// 记录 id（UUID v4）
    pub id: String,
    /// 操作类型
    pub kind: OperationKind,
    /// 关联的文档 id（可能为空，如纯 Agent 调用不绑文档）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    /// 操作摘要（显示用）
    pub summary: String,
    /// 时间戳（Unix 毫秒）
    pub timestamp: i64,
}
