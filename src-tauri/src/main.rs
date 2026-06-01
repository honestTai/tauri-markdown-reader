#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

#[derive(Debug, Serialize)]
struct ArticleSummary {
    path: String,
    file_name: String,
    title: String,
    digest: String,
    group: String,
    status: String,
    updated: u64,
}

#[derive(Debug, Serialize)]
struct ArticlePayload {
    path: String,
    base_dir: String,
    content: String,
    preview_content: String,
}

#[derive(Debug, Deserialize)]
struct SaveArticleRequest {
    path: String,
    content: String,
}

#[tauri::command]
fn scan_workspace(workspace: String) -> Result<Vec<ArticleSummary>, String> {
    let root = normalize_workspace_root(PathBuf::from(workspace));
    let groups = [
        ("articles/drafts", "草稿", "draft"),
        ("articles/wemd-inbox", "WeMD 审稿", "inbox"),
        ("articles/approved", "已确认稿", "approved"),
    ];

    let mut articles = Vec::new();
    for (relative, group, status) in groups {
        let dir = root.join(relative);
        if !dir.exists() {
            continue;
        }
        collect_markdown_files(&dir, group, status, false, &mut articles)?;
    }

    if articles.is_empty() {
        collect_markdown_files(&root, "文档", "document", true, &mut articles)?;
    }

    articles.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(articles)
}

#[tauri::command]
fn read_article(path: String) -> Result<ArticlePayload, String> {
    let article_path = PathBuf::from(&path);
    let content = fs::read_to_string(&article_path).map_err(to_err)?;
    let base_dir = article_path
        .parent()
        .ok_or_else(|| "无法识别文章目录".to_string())?
        .to_path_buf();
    let preview_content = inline_local_images(&content, &base_dir)?;

    Ok(ArticlePayload {
        path,
        base_dir: base_dir.to_string_lossy().to_string(),
        content,
        preview_content,
    })
}

#[tauri::command]
fn save_article(request: SaveArticleRequest) -> Result<ArticlePayload, String> {
    let article_path = PathBuf::from(&request.path);
    fs::write(&article_path, request.content).map_err(to_err)?;
    read_article(request.path)
}

#[tauri::command]
fn append_build_log(entry: String) -> Result<(), String> {
    let log_path = project_root().join("docs").join("BUILD_LOG.md");
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).map_err(to_err)?;
    }
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(to_err)?
        .write_all(format!("\n{}\n", entry).as_bytes())
        .map_err(to_err)?;
    Ok(())
}

#[tauri::command]
fn save_wechat_html(article_path: String, html: String) -> Result<String, String> {
    let article = PathBuf::from(article_path);
    let slug = article
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "无法识别文章 slug".to_string())?;
    let root = workspace_root_for_article(&article)?;
    let output = if root.join("articles").exists() {
        root.join("articles")
            .join("approved-html")
            .join(format!("{slug}.html"))
    } else {
        root.join("exports")
            .join("wechat-html")
            .join(format!("{slug}.html"))
    };
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(to_err)?;
    }
    fs::write(&output, html).map_err(to_err)?;
    Ok(output.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_workspace,
            read_article,
            save_article,
            append_build_log,
            save_wechat_html
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn parse_frontmatter(raw: &str) -> (String, String) {
    let normalized = raw.trim_start_matches('\u{feff}');
    if !normalized.starts_with("---") {
        return (String::new(), String::new());
    }
    let mut lines = normalized.lines();
    lines.next();
    let mut title = String::new();
    let mut digest = String::new();
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix("title:") {
            title = clean_yaml_value(value);
        }
        if let Some(value) = line.strip_prefix("digest:") {
            digest = clean_yaml_value(value);
        }
    }
    (title, digest)
}

fn clean_yaml_value(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn inline_local_images(raw: &str, base_dir: &Path) -> Result<String, String> {
    let image_re = Regex::new(r#"!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#).map_err(to_err)?;
    let replaced = image_re.replace_all(raw, |caps: &Captures| {
        let full = caps.get(0).map(|m| m.as_str()).unwrap_or_default();
        let alt = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
        let src = caps.get(2).map(|m| m.as_str()).unwrap_or_default();
        if src.starts_with("data:image/") || src.starts_with("http://") || src.starts_with("https://") {
            return full.to_string();
        }
        let image_path = base_dir.join(src.replace('/', std::path::MAIN_SEPARATOR_STR));
        match fs::read(&image_path) {
            Ok(bytes) => {
                let mime = mime_type_for(&bytes, &image_path);
                let encoded = general_purpose::STANDARD.encode(bytes);
                format!("![{alt}](data:{mime};base64,{encoded})")
            }
            Err(_) => full.to_string(),
        }
    });
    Ok(replaced.into_owned())
}

fn mime_type_for(bytes: &[u8], path: &Path) -> &'static str {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return "image/jpeg";
    }
    if bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47]) {
        return "image/png";
    }
    if bytes.starts_with(&[0x47, 0x49, 0x46]) {
        return "image/gif";
    }
    if bytes.starts_with(&[0x52, 0x49, 0x46, 0x46]) {
        return "image/webp";
    }
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or_default() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    }
}

fn workspace_root_for_article(article: &Path) -> Result<PathBuf, String> {
    let mut current = article.parent();
    while let Some(path) = current {
        if path.file_name().and_then(|name| name.to_str()) == Some("articles") {
            return path
                .parent()
                .map(Path::to_path_buf)
                .ok_or_else(|| "无法识别文章工作区".to_string());
        }
        current = path.parent();
    }
    article
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "无法识别文章工作区".to_string())
}

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .to_path_buf()
}

fn to_err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

fn normalize_workspace_root(input: PathBuf) -> PathBuf {
    if input.join("articles").exists() {
        return input;
    }
    if input.file_name().and_then(|name| name.to_str()) == Some("articles") {
        if let Some(parent) = input.parent() {
            return parent.to_path_buf();
        }
    }
    let article_subdirs = ["drafts", "wemd-inbox", "approved"];
    if input
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| article_subdirs.contains(&name))
        .unwrap_or(false)
    {
        if let Some(articles_dir) = input.parent() {
            if articles_dir.file_name().and_then(|name| name.to_str()) == Some("articles") {
                if let Some(root) = articles_dir.parent() {
                    return root.to_path_buf();
                }
            }
        }
    }
    input
}

fn collect_markdown_files(
    dir: &Path,
    group: &str,
    status: &str,
    recursive: bool,
    articles: &mut Vec<ArticleSummary>,
) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(to_err)? {
        let entry = entry.map_err(to_err)?;
        let path = entry.path();
        if path.is_dir() && recursive && should_enter_dir(&path) {
            collect_markdown_files(&path, group, status, recursive, articles)?;
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let raw = fs::read_to_string(&path).unwrap_or_default();
        let (title, digest) = parse_frontmatter(&raw);
        let metadata = fs::metadata(&path).map_err(to_err)?;
        let updated = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or_default();

        articles.push(ArticleSummary {
            path: path.to_string_lossy().to_string(),
            file_name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string(),
            title: if title.is_empty() {
                path.file_stem()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_string()
            } else {
                title
            },
            digest,
            group: group.to_string(),
            status: status.to_string(),
            updated,
        });
    }
    Ok(())
}

fn should_enter_dir(path: &Path) -> bool {
    let ignored = [".git", "node_modules", "target", "dist", "dist-ssr"];
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| !ignored.contains(&name))
        .unwrap_or(true)
}

use std::io::Write;

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture_root() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("tauri-reader-test-{suffix}"));
        fs::create_dir_all(root.join("articles").join("drafts")).expect("create drafts");
        fs::create_dir_all(root.join("articles").join("approved")).expect("create approved");
        fs::write(
            root.join("articles").join("drafts").join("sample.md"),
            "---\ntitle: 示例文章\ndigest: 用于测试。\n---\n\n## 小节\n\n正文",
        )
        .expect("write sample");
        root
    }

    #[test]
    fn scans_workflow_article_workspace() {
        let root = fixture_root();
        let articles = scan_workspace(root.to_string_lossy().to_string()).expect("scan workspace");
        assert!(!articles.is_empty(), "default workspace should contain markdown articles");
        assert!(
            articles.iter().any(|article| article.status == "draft")
                || articles.iter().any(|article| article.status == "approved")
                || articles.iter().any(|article| article.status == "inbox"),
            "articles should be classified by workflow status"
        );
    }

    #[test]
    fn reads_first_article() {
        let root = fixture_root();
        let articles = scan_workspace(root.to_string_lossy().to_string()).expect("scan workspace");
        let first = articles.first().expect("at least one article");
        let payload = read_article(first.path.clone()).expect("read article");
        assert!(!payload.content.trim().is_empty(), "article content should not be empty");
        assert!(
            !payload.preview_content.trim().is_empty(),
            "preview content should not be empty"
        );
    }

    #[test]
    fn accepts_articles_subdirectory_as_workspace_input() {
        let root = fixture_root();
        let drafts_dir = root.join("articles").join("drafts").to_string_lossy().to_string();
        let articles = scan_workspace(drafts_dir).expect("scan drafts dir");
        assert!(
            !articles.is_empty(),
            "selecting articles/drafts should still resolve the workflow root"
        );
    }

    #[test]
    fn scans_generic_markdown_folder_and_saves_article() {
        let root = std::env::temp_dir().join("tauri-reader-generic-md");
        fs::create_dir_all(&root).expect("create generic root");
        let article_path = root.join("note.md");
        fs::write(&article_path, "---\ntitle: 普通文档\n---\n\n正文").expect("write note");
        let articles = scan_workspace(root.to_string_lossy().to_string()).expect("scan generic");
        assert_eq!(articles[0].status, "document");

        let payload = save_article(SaveArticleRequest {
            path: article_path.to_string_lossy().to_string(),
            content: "---\ntitle: 已编辑\n---\n\n新正文".to_string(),
        })
        .expect("save article");
        assert!(payload.content.contains("新正文"));
    }
}
