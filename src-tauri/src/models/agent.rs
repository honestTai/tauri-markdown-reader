//! Agent 相关模型
//!
//! 对齐 iOS：
//!   - FlowMarkApp/Models/AgentModels.swift
//!   - FlowMarkApp/Models/AgentContextTier.swift
//!
//! 这里的模型用于持久化（sessions.json / threads/*.json）和前后端通信。
//! Agent 路由与运行时的业务逻辑在 sidecar（LangChain）侧，
//! Rust 只负责持久化和转发。

use serde::{Deserialize, Serialize};

/// Agent 技能（对齐 iOS AgentSkill 全部 case）
///
/// 路由阶段由 sidecar 的 router.ts 决定最终 skill，
/// Rust 侧只持久化用户选择 / 历史记录，不解释 skill 语义。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AgentSkill {
    Chat,
    Understand,
    Ask,
    Academic,
    PlantUml,
    PaperAnnotation,
    Novel,
    Presentation,
    WechatFormat,
    AutoImage,
    AutoFormula,
    Translate,
    Mindmap,
    Compare,
    HtmlAuthor,
    Organize,
    Deliverable,
    Review,
    Followups,
    DistillSkill,
}

/// Agent 路由来源（对齐 iOS AgentRoutedBy）
///
/// 记录一次 Agent 调用是被哪种方式路由到当前 skill 的，
/// 用于 UI 显示路由标签
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentRoutedBy {
    /// 用户显式指定 skill
    Forced,
    /// 用户输入了 slash 命令
    Slash,
    /// 根据输入意图关键词推断
    Intent,
    /// Profile 默认 skill
    Default,
    /// 用户覆盖了路由结果
    Override,
}

/// Agent 消息角色（对齐 iOS AgentMessage）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentMessageRole {
    User,
    Assistant,
    /// 工具调用结果（对齐 iOS tool result 消息）
    Tool,
    /// 系统消息
    System,
}

/// Agent 消息（对齐 iOS AgentMessage）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    /// 消息 id（UUID v4）
    pub id: String,
    /// 角色
    pub role: AgentMessageRole,
    /// 消息内容
    pub content: String,
    /// 该消息触发的工具调用（assistant 消息可能有）
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub tool_calls: Vec<ToolCall>,
    /// 该消息对应的 skill（路由结果）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill: Option<AgentSkill>,
    /// 路由来源
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routed_by: Option<AgentRoutedBy>,
    /// 命中的文档片段（sources）
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub sources: Vec<AgentSource>,
    /// 时间戳（Unix 毫秒）
    pub timestamp: i64,
}

/// 工具调用记录（对齐 iOS tool_call 事件）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    /// 工具名（document_search / document_read / ...）
    pub name: String,
    /// 调用参数（JSON）
    pub arguments: serde_json::Value,
    /// 调用结果（JSON），未完成时为 None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
}

/// Agent 命中的文档片段（对齐 iOS AgentSource）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSource {
    /// 命中的文档 id
    pub document_id: String,
    /// 命中的 chunk id（来自索引）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_id: Option<String>,
    /// 命中的标题
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    /// 命中的文本片段
    pub snippet: String,
    /// 相关性分数（0.0 ~ 1.0）
    #[serde(default)]
    pub score: f32,
}

/// Agent 会话（对齐 iOS AgentSession）
///
/// 一次完整的对话，可能包含多条 AgentMessage。
/// 持久化到 AppData/flowmark/agent/sessions.json + threads/<session_id>.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    /// 会话 id（UUID v4）
    pub id: String,
    /// 会话标题（首条用户消息截断）
    pub title: String,
    /// 关联的文档 id（会话上下文锚点）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    /// 消息列表
    pub messages: Vec<AgentMessage>,
    /// 创建时间（Unix 毫秒）
    pub created_at: i64,
    /// 最后更新时间（Unix 毫秒）
    pub updated_at: i64,
    /// 是否已归档（归档后不再显示在活跃会话列表）
    #[serde(default)]
    pub archived: bool,
}

/// 模型配置（对齐 iOS ModelConfigurationStore）
///
/// 端点/模型存在 AppData/flowmark/model_config.json，
/// API key 单独存 Windows Credential Manager（见 store/credentials.rs）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfiguration {
    /// OpenAI 兼容端点 base URL，如 "https://api.openai.com/v1"
    pub endpoint: String,
    /// 模型名，如 "gpt-4o-mini" / "deepseek-chat"
    pub model: String,
    /// 请求超时（秒）
    #[serde(default = "default_timeout")]
    pub timeout_secs: u32,
    /// 上下文窗口 token 数（用于阶段 4 的上下文裁剪）
    #[serde(default = "default_context_window")]
    pub context_window: u32,
}

fn default_timeout() -> u32 {
    60
}

fn default_context_window() -> u32 {
    16_384
}

impl Default for ModelConfiguration {
    fn default() -> Self {
        Self {
            endpoint: String::new(),
            model: String::new(),
            timeout_secs: default_timeout(),
            context_window: default_context_window(),
        }
    }
}

/// Agent 上下文层级（对齐 iOS AgentContextTier）
///
/// 用于阶段 4 决定往 LLM 塞多少上下文
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentContextTier {
    /// 最小：只塞当前消息
    Minimal,
    /// 标准：当前消息 + 最近几轮对话
    Standard,
    /// 扩展：加入命中的文档片段
    Extended,
    /// 完整：加入长文档记忆
    Full,
}
