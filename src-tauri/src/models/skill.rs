//! Agent Skill 模型
//!
//! 阶段 7：用户自定义 skill 体系
//!
//! 设计意图：
//!   - skill 可由用户上传（文件 / 文件夹），落到 AppData/flowmark/skills/
//!   - 内置 skill 随安装包分发，在 resources/built-in-skills/
//!   - skill 用 Markdown + frontmatter 声明（systemPrompt / slash / intentKeywords / tools）
//!   - Rust 侧只负责解析 frontmatter + 持久化元数据，不解释 skill 语义
//!     （语义在 sidecar 的 skill_resolver.ts 里合并进 router）
//!
//! frontmatter 示例：
//!   ---
//!   name: my-paper
//!   description: 论文写作辅助
//!   profile: academic
//!   slash: /paper
//!   intentKeywords: [论文, paper]
//!   tools: [document_search, document_read]
//!   ---
//!   你是论文写作助手……

use serde::{Deserialize, Serialize};

/// Skill 来源（对齐前端展示需要）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SkillSource {
    /// 内置随安装包分发（只读）
    BuiltIn,
    /// 用户上传到 AppData/skills/
    User,
}

/// Skill 描述符
///
/// 对齐 src-sidecar/agent/skill_resolver.ts 的 SkillDescriptor。
/// Rust 侧解析 frontmatter 后产出，前端列表展示 + sidecar 路由消费。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDescriptor {
    /// skill 唯一名（frontmatter name，或文件名去扩展）
    pub name: String,
    /// 一句话描述
    #[serde(default)]
    pub description: String,
    /// 来源
    pub source: SkillSource,
    /// 关联 profile（可选，影响默认 systemPrompt 基底）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    /// slash 命令（如 "/paper"）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slash: Option<String>,
    /// 意图关键词列表
    #[serde(default)]
    pub intent_keywords: Vec<String>,
    /// 允许使用的工具名白名单（空表示继承全部工具）
    #[serde(default)]
    pub tools: Vec<String>,
    /// skill 正文（frontmatter 之后的 Markdown，作为 systemPrompt 附加）
    /// 注意：不内联超长正文，前端只在编辑时取，列表展示用 description
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub body: String,
    /// skill 文件绝对路径（Rust 侧解析时填）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// 最后更新时间（Unix 毫秒）
    #[serde(default)]
    pub updated_at: i64,
}

/// frontmatter 解析结果（name + body 之外的元数据都按字符串数组解析）
#[derive(Debug, Clone, Deserialize, Default)]
pub struct SkillFrontmatter {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    pub slash: Option<String>,
    #[serde(default)]
    pub intent_keywords: Vec<String>,
    #[serde(default)]
    pub tools: Vec<String>,
}
