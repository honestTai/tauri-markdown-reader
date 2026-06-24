//! Skill 仓储
//!
//! 阶段 7：管理用户上传 / 内置的 Agent skill
//!
//! 职责：
//!   - 扫描 built-in + user skills 目录，解析 frontmatter 产出 SkillDescriptor
//!   - 写入用户 skill（文件级 / 文件夹级）
//!   - 删除用户 skill（内置不可删）
//!   - 读取单个 skill 完整内容（含 body，供 sidecar 路由用）
//!
//! frontmatter 解析采用最小实现（YAML 子集），避免引入 yaml 依赖：
//!   - 只支持 key: value 与 key: [a, b, c] 两种形式
//!   - value 不带引号；带引号时剥离首尾引号
//!   - 复杂嵌套结构不支持（skill frontmatter 不需要）

use crate::models::{SkillDescriptor, SkillFrontmatter, SkillSource};
use crate::store::app_paths::AppPaths;
use crate::store::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// Skill 仓储
pub struct SkillRepository {
    paths: AppPaths,
}

/// 内置 skill 资源目录（release 模式下需要注入 resource_dir）
fn built_in_dir(resource_dir: Option<&Path>) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("built-in-skills")
    } else if let Some(r) = resource_dir {
        r.join("resources").join("built-in-skills")
    } else {
        PathBuf::from("resources/built-in-skills")
    }
}

impl SkillRepository {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
    }

    /// 用户 skill 目录（AppData/skills/）
    pub fn user_dir(&self) -> PathBuf {
        self.paths.skills_dir()
    }

    /// 列出所有 skill（built-in + user），去重（user 同名覆盖 built-in）
    ///
    /// 返回的 SkillDescriptor 不含 body（列表展示用）。
    pub fn list(
        &self,
        resource_dir: Option<&Path>,
    ) -> AppResult<Vec<SkillDescriptor>> {
        let mut out: Vec<SkillDescriptor> = Vec::new();
        let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();

        let user_dir = self.user_dir();
        if user_dir.exists() {
            self.scan_dir(&user_dir, SkillSource::User, &mut out, &mut seen_names)?;
        }
        let bi_dir = built_in_dir(resource_dir);
        if bi_dir.exists() {
            self.scan_dir(&bi_dir, SkillSource::BuiltIn, &mut out, &mut seen_names)?;
        }

        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    /// 扫描单个目录下的 skill：
    ///   - 子目录 <name>/skill.md → 一个 skill
    ///   - 单文件 <name>.md → 一个 skill
    fn scan_dir(
        &self,
        dir: &Path,
        source: SkillSource,
        out: &mut Vec<SkillDescriptor>,
        seen: &mut std::collections::HashSet<String>,
    ) -> AppResult<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let ft = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            // 先算好 stem（path 后面会被 move 进 md_path）
            let stem_from_path = if ft.is_dir() {
                path.file_name().and_then(|s| s.to_str()).map(|s| s.to_string())
            } else {
                path.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string())
            };
            let md_path = if ft.is_dir() {
                let p = path.join("skill.md");
                if p.exists() { p } else { continue }
            } else if ft.is_file() {
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    path
                } else {
                    continue;
                }
            } else {
                continue;
            };

            let raw = match std::fs::read_to_string(&md_path) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let (fm, _body) = parse_frontmatter(&raw);
            let name = if !fm.name.is_empty() {
                fm.name.clone()
            } else {
                stem_from_path.unwrap_or_else(|| "skill".to_string())
            };

            if seen.contains(&name) {
                continue;
            }
            seen.insert(name.clone());

            out.push(SkillDescriptor {
                name,
                description: fm.description,
                source,
                profile: fm.profile,
                slash: fm.slash,
                intent_keywords: fm.intent_keywords,
                tools: fm.tools,
                body: String::new(),
                path: Some(md_path.to_string_lossy().to_string()),
                updated_at: file_mtime_millis(&md_path),
            });
        }
        Ok(())
    }

    /// 读取单个 skill 的完整 body（frontmatter 之后的正文）
    pub fn load_body(&self, name: &str, resource_dir: Option<&Path>) -> AppResult<String> {
        let path = self.resolve_skill_path(name, resource_dir)?;
        let raw = std::fs::read_to_string(&path)?;
        let (_fm, body) = parse_frontmatter(&raw);
        Ok(body)
    }

    /// 读取单个 skill 完整描述符（含 body）
    pub fn load(&self, name: &str, resource_dir: Option<&Path>) -> AppResult<SkillDescriptor> {
        let path = self.resolve_skill_path(name, resource_dir)?;
        let raw = std::fs::read_to_string(&path)?;
        let (fm, body) = parse_frontmatter(&raw);
        let resolved_name = if !fm.name.is_empty() {
            fm.name.clone()
        } else {
            name.to_string()
        };
        Ok(SkillDescriptor {
            name: resolved_name,
            description: fm.description,
            source: self.classify_source(&path, resource_dir),
            profile: fm.profile,
            slash: fm.slash,
            intent_keywords: fm.intent_keywords,
            tools: fm.tools,
            body,
            path: Some(path.to_string_lossy().to_string()),
            updated_at: file_mtime_millis(&path),
        })
    }

    /// 写入用户 skill（单文件形式）
    pub fn save_user_skill(&self, name: &str, content: &str) -> AppResult<SkillDescriptor> {
        let safe = sanitize_skill_name(name);
        let dir = self.user_dir();
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{safe}.md"));
        std::fs::write(&path, content)?;
        self.load_by_path(&path, SkillSource::User)
    }

    /// 导入用户 skill 文件（复制到 AppData/skills/）
    pub fn import_skill_file(&self, src: &str) -> AppResult<SkillDescriptor> {
        let src_path = PathBuf::from(src);
        if !src_path.exists() {
            return Err(AppError::NotFound(format!("skill 文件 {src}")));
        }
        let raw = std::fs::read_to_string(&src_path)?;
        let (fm, _body) = parse_frontmatter(&raw);
        let name = if !fm.name.is_empty() {
            fm.name.clone()
        } else {
            src_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("imported")
                .to_string()
        };
        let safe = sanitize_skill_name(&name);
        let dir = self.user_dir();
        std::fs::create_dir_all(&dir)?;
        let dest = dir.join(format!("{safe}.md"));
        std::fs::copy(&src_path, &dest)?;
        self.load_by_path(&dest, SkillSource::User)
    }

    /// 导入用户 skill 文件夹（复制整个目录到 AppData/skills/<name>/）
    pub fn import_skill_folder(&self, src: &str) -> AppResult<SkillDescriptor> {
        let src_dir = PathBuf::from(src);
        if !src_dir.is_dir() {
            return Err(AppError::InvalidArgument(format!(
                "skill 文件夹不存在或不是目录: {src}"
            )));
        }
        let skill_md = src_dir.join("skill.md");
        if !skill_md.exists() {
            return Err(AppError::InvalidArgument(format!(
                "skill 文件夹缺少 skill.md: {src}"
            )));
        }
        let raw = std::fs::read_to_string(&skill_md)?;
        let (fm, _body) = parse_frontmatter(&raw);
        let name = if !fm.name.is_empty() {
            fm.name.clone()
        } else {
            src_dir
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("imported")
                .to_string()
        };
        let safe = sanitize_skill_name(&name);
        let dest_dir = self.user_dir().join(&safe);
        if dest_dir.exists() {
            std::fs::remove_dir_all(&dest_dir)?;
        }
        std::fs::create_dir_all(&dest_dir)?;
        copy_dir_recursive(&src_dir, &dest_dir)?;
        let final_md = dest_dir.join("skill.md");
        self.load_by_path(&final_md, SkillSource::User)
    }

    /// 删除用户 skill（按 name）。内置 skill 不可删。
    pub fn delete_user_skill(&self, name: &str) -> AppResult<()> {
        let safe = sanitize_skill_name(name);
        let user_dir = self.user_dir();
        let dir_candidate = user_dir.join(&safe);
        if dir_candidate.is_dir() {
            std::fs::remove_dir_all(&dir_candidate)?;
            return Ok(());
        }
        let file_candidate = user_dir.join(format!("{safe}.md"));
        if file_candidate.is_file() {
            std::fs::remove_file(&file_candidate)?;
            return Ok(());
        }
        Err(AppError::NotFound(format!(
            "用户 skill {name} 不存在（内置 skill 不可删除）"
        )))
    }

    // ============ 内部辅助 ============

    fn resolve_skill_path(&self, name: &str, resource_dir: Option<&Path>) -> AppResult<PathBuf> {
        let safe = sanitize_skill_name(name);
        let candidates = [
            self.user_dir().join(&safe).join("skill.md"),
            self.user_dir().join(format!("{safe}.md")),
            built_in_dir(resource_dir).join(&safe).join("skill.md"),
            built_in_dir(resource_dir).join(format!("{safe}.md")),
        ];
        for c in &candidates {
            if c.exists() {
                return Ok(c.clone());
            }
        }
        Err(AppError::NotFound(format!("skill {name} 不存在")))
    }

    fn classify_source(&self, path: &Path, resource_dir: Option<&Path>) -> SkillSource {
        let user_dir = self.user_dir();
        if path.starts_with(&user_dir) {
            return SkillSource::User;
        }
        let bi = built_in_dir(resource_dir);
        if path.starts_with(&bi) {
            return SkillSource::BuiltIn;
        }
        SkillSource::User
    }

    fn load_by_path(&self, path: &Path, source: SkillSource) -> AppResult<SkillDescriptor> {
        let raw = std::fs::read_to_string(path)?;
        let (fm, body) = parse_frontmatter(&raw);
        let name = if !fm.name.is_empty() {
            fm.name.clone()
        } else {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("skill")
                .to_string()
        };
        Ok(SkillDescriptor {
            name,
            description: fm.description,
            source,
            profile: fm.profile,
            slash: fm.slash,
            intent_keywords: fm.intent_keywords,
            tools: fm.tools,
            body,
            path: Some(path.to_string_lossy().to_string()),
            updated_at: file_mtime_millis(path),
        })
    }
}

// ============ frontmatter 解析（YAML 子集）============

/// 把 "---\n...frontmatter...\n---\nbody" 切成 (frontmatter, body)
pub fn parse_frontmatter(raw: &str) -> (SkillFrontmatter, String) {
    let mut fm = SkillFrontmatter::default();
    let trimmed = raw.trim_start_matches('\u{feff}');
    if !trimmed.starts_with("---") {
        return (fm, raw.to_string());
    }
    let after_first = &trimmed[3..];
    let rest = after_first.trim_start_matches(['\r', '\n']);
    let end = match rest.find("\n---") {
        Some(i) => i,
        None => return (fm, raw.to_string()),
    };
    let fm_text = &rest[..end];
    let body_start = end + 4;
    let body = if rest.len() > body_start {
        rest[body_start..].trim_start_matches(['\r', '\n']).to_string()
    } else {
        String::new()
    };

    for line in fm_text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, val) = match line.split_once(':') {
            Some((k, v)) => (k.trim(), v.trim()),
            None => continue,
        };
        let val = strip_quotes(val);
        match key {
            "name" => fm.name = val.to_string(),
            "description" => fm.description = val.to_string(),
            "profile" => fm.profile = if val.is_empty() { None } else { Some(val.to_string()) },
            "slash" => fm.slash = if val.is_empty() { None } else { Some(val.to_string()) },
            "intentKeywords" | "intent_keywords" => {
                fm.intent_keywords = parse_string_list(val);
            }
            "tools" => fm.tools = parse_string_list(val),
            _ => {}
        }
    }
    (fm, body)
}

fn strip_quotes(s: &str) -> &str {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
    {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

fn parse_string_list(s: &str) -> Vec<String> {
    let s = s.trim();
    let inner = if s.starts_with('[') && s.ends_with(']') {
        &s[1..s.len() - 1]
    } else {
        s
    };
    inner
        .split(',')
        .map(|p| strip_quotes(p.trim()).to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

fn sanitize_skill_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() {
        "skill".to_string()
    } else {
        s
    }
}

fn file_mtime_millis(path: &Path) -> i64 {
    use std::time::SystemTime;
    match std::fs::metadata(path).and_then(|m| m.modified()) {
        Ok(t) => t
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
        Err(_) => 0,
    }
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if ft.is_file() {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_解析基础() {
        let raw = "---\nname: paper\ndescription: 论文写作\nslash: /paper\nintentKeywords: [论文, paper]\ntools: [document_search, document_read]\n---\n你是论文助手。";
        let (fm, body) = parse_frontmatter(raw);
        assert_eq!(fm.name, "paper");
        assert_eq!(fm.description, "论文写作");
        assert_eq!(fm.slash.as_deref(), Some("/paper"));
        assert_eq!(fm.intent_keywords, vec!["论文", "paper"]);
        assert_eq!(fm.tools, vec!["document_search", "document_read"]);
        assert_eq!(body, "你是论文助手。");
    }

    #[test]
    fn frontmatter_无_frontmatter() {
        let raw = "纯正文，没有 frontmatter";
        let (fm, body) = parse_frontmatter(raw);
        assert!(fm.name.is_empty());
        assert_eq!(body, raw);
    }

    #[test]
    fn parse_string_list_带引号() {
        assert_eq!(parse_string_list("[\"a\", 'b', c]"), vec!["a", "b", "c"]);
        assert_eq!(parse_string_list("a, b, c"), vec!["a", "b", "c"]);
        assert_eq!(parse_string_list("[]"), Vec::<String>::new());
    }

    #[test]
    fn sanitize_替换非法字符() {
        assert_eq!(sanitize_skill_name("my paper!"), "my_paper_");
        assert_eq!(sanitize_skill_name("ok-1_2"), "ok-1_2");
        assert_eq!(sanitize_skill_name(""), "skill");
    }
}
