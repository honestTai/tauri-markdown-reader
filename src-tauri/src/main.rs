#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
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
    relative_path: String,
}

#[derive(Debug, Serialize)]
struct ArticlePayload {
    path: String,
    base_dir: String,
    content: String,
    preview_content: String,
    missing_images: Vec<MissingImage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MissingImage {
    alt: String,
    src: String,
    resolved_path: String,
}

#[derive(Debug, Serialize)]
struct SearchResult {
    path: String,
    file_name: String,
    title: String,
    relative_path: String,
    heading: String,
    snippet: String,
    line: usize,
    score: usize,
}

#[derive(Debug, Deserialize)]
struct SaveArticleRequest {
    path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveBinaryExportRequest {
    article_path: String,
    content_base64: String,
    extension: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewMarkdownRequest {
    article_path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InsertImageAssetRequest {
    article_path: String,
    image_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchWorkspaceRequest {
    workspace: String,
    query: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InsertImageAssetResponse {
    markdown: String,
    relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReaderSettings {
    default_workspace: String,
    default_read_mode: String,
    default_export_style: String,
    restore_last_document: bool,
    remember_scroll_position: bool,
    focus_keep_outline: bool,
    language: String,
}

impl Default for ReaderSettings {
    fn default() -> Self {
        Self {
            default_workspace: String::new(),
            default_read_mode: "desktop".to_string(),
            default_export_style: "codex".to_string(),
            restore_last_document: true,
            remember_scroll_position: true,
            focus_keep_outline: true,
            language: "zh".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReaderState {
    recent_workspaces: Vec<String>,
    recent_files: Vec<String>,
    favorites: Vec<String>,
    pinned: Vec<String>,
    reading_positions: HashMap<String, f64>,
    last_workspace: String,
    last_file: String,
    focus_mode: bool,
    settings: ReaderSettings,
}

impl Default for ReaderState {
    fn default() -> Self {
        Self {
            recent_workspaces: Vec::new(),
            recent_files: Vec::new(),
            favorites: Vec::new(),
            pinned: Vec::new(),
            reading_positions: HashMap::new(),
            last_workspace: String::new(),
            last_file: String::new(),
            focus_mode: false,
            settings: ReaderSettings::default(),
        }
    }
}

#[tauri::command]
fn initial_open_path() -> Option<String> {
    initial_open_path_from_args(std::env::args())
}

#[tauri::command]
fn scan_workspace(workspace: String) -> Result<Vec<ArticleSummary>, String> {
    let input = PathBuf::from(workspace);
    if input.is_file() {
        if !is_markdown_file(&input) {
            return Err("请选择 Markdown 文件。".to_string());
        }
        let parent = input
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法识别 Markdown 文件所在目录".to_string())?;
        return scan_workspace(parent.to_string_lossy().to_string());
    }

    let root = input;
    let mut articles = Vec::new();
    collect_markdown_files(&root, "文档", "document", true, &root, &mut articles)?;

    articles.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(articles)
}

#[tauri::command]
fn search_workspace(request: SearchWorkspaceRequest) -> Result<Vec<SearchResult>, String> {
    let query = request.query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let articles = scan_workspace(request.workspace)?;
    let mut results = Vec::new();
    for article in articles {
        let path = PathBuf::from(&article.path);
        let raw = fs::read_to_string(&path).unwrap_or_default();
        let lower_title = article.title.to_lowercase();
        let lower_file = article.file_name.to_lowercase();
        let lower_raw = raw.to_lowercase();
        if !lower_title.contains(&query) && !lower_file.contains(&query) && !lower_raw.contains(&query) {
            continue;
        }

        let mut heading = String::new();
        let mut best_line = 1;
        let mut snippet = String::new();
        for (index, line) in raw.lines().enumerate() {
            let trimmed = line.trim();
            if let Some(next_heading) = trimmed.strip_prefix('#') {
                heading = next_heading.trim_start_matches('#').trim().to_string();
            }
            if trimmed.to_lowercase().contains(&query) {
                best_line = index + 1;
                snippet = make_snippet(trimmed, &query);
                break;
            }
        }

        if snippet.is_empty() {
            snippet = if lower_title.contains(&query) {
                article.title.clone()
            } else {
                article.file_name.clone()
            };
        }

        let mut score = 1;
        if lower_title.contains(&query) {
            score += 4;
        }
        if lower_file.contains(&query) {
            score += 3;
        }

        results.push(SearchResult {
            path: article.path,
            file_name: article.file_name,
            title: article.title,
            relative_path: article.relative_path,
            heading,
            snippet,
            line: best_line,
            score,
        });
    }

    results.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.relative_path.cmp(&b.relative_path)));
    results.truncate(80);
    Ok(results)
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
    let missing_images = find_missing_images(&content, &base_dir)?;

    Ok(ArticlePayload {
        path,
        base_dir: base_dir.to_string_lossy().to_string(),
        content,
        preview_content,
        missing_images,
    })
}

#[tauri::command]
fn save_article(request: SaveArticleRequest) -> Result<ArticlePayload, String> {
    let article_path = PathBuf::from(&request.path);
    backup_article(&article_path)?;
    fs::write(&article_path, request.content).map_err(to_err)?;
    read_article(request.path)
}

#[tauri::command]
fn load_reader_state() -> Result<ReaderState, String> {
    let path = reader_state_path()?;
    if !path.exists() {
        return Ok(ReaderState::default());
    }
    let raw = fs::read_to_string(path).map_err(to_err)?;
    let mut state = serde_json::from_str::<ReaderState>(&raw).unwrap_or_default();
    trim_reader_state(&mut state);
    Ok(state)
}

#[tauri::command]
fn save_reader_state(mut state: ReaderState) -> Result<(), String> {
    trim_reader_state(&mut state);
    let path = reader_state_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(to_err)?;
    }
    let raw = serde_json::to_string_pretty(&state).map_err(to_err)?;
    fs::write(path, raw).map_err(to_err)
}

#[tauri::command]
fn preview_markdown_content(request: PreviewMarkdownRequest) -> Result<String, String> {
    let article_path = PathBuf::from(&request.article_path);
    let base_dir = article_path
        .parent()
        .ok_or_else(|| "无法识别文章目录".to_string())?
        .to_path_buf();
    inline_local_images(&request.content, &base_dir)
}

#[tauri::command]
fn insert_image_asset(request: InsertImageAssetRequest) -> Result<InsertImageAssetResponse, String> {
    let article = PathBuf::from(&request.article_path);
    if !is_markdown_file(&article) {
        return Err("请先打开一个 Markdown 文件。".to_string());
    }

    let source = PathBuf::from(&request.image_path);
    if !source.is_file() {
        return Err("请选择有效的图片文件。".to_string());
    }

    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .ok_or_else(|| "图片文件缺少扩展名。".to_string())?;
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg") {
        return Err("仅支持 png、jpg、jpeg、gif、webp、svg 图片。".to_string());
    }

    let article_parent = article
        .parent()
        .ok_or_else(|| "无法识别文章目录".to_string())?;
    let article_stem = article
        .file_stem()
        .and_then(|name| name.to_str())
        .map(sanitize_asset_segment)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "article".to_string());
    let assets_dir_name = format!("{article_stem}-assets");
    let assets_dir = article_parent.join(&assets_dir_name);
    fs::create_dir_all(&assets_dir).map_err(to_err)?;

    let image_stem = source
        .file_stem()
        .and_then(|name| name.to_str())
        .map(sanitize_asset_segment)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "image".to_string());
    let alt = source
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("image")
        .to_string();
    let mut file_name = format!("{image_stem}.{extension}");
    let mut output = assets_dir.join(&file_name);
    let mut index = 1;
    while output.exists() {
        file_name = format!("{image_stem}-{index}.{extension}");
        output = assets_dir.join(&file_name);
        index += 1;
    }

    fs::copy(&source, &output).map_err(to_err)?;
    let relative_path = format!("{assets_dir_name}/{file_name}");
    Ok(InsertImageAssetResponse {
        markdown: format!("![{alt}]({relative_path})"),
        relative_path,
    })
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
fn save_reading_html(article_path: String, html: String) -> Result<String, String> {
    let article = PathBuf::from(article_path);
    let slug = article
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "无法识别文章 slug".to_string())?;
    let root = workspace_root_for_article(&article)?;
    let output = root
        .join("exports")
        .join("reading-html")
        .join(format!("{slug}.html"));
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(to_err)?;
    }
    fs::write(&output, html).map_err(to_err)?;
    open_path(&output)?;
    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<String, String> {
    let bytes = fs::read(PathBuf::from(path)).map_err(to_err)?;
    Ok(general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn save_binary_export(request: SaveBinaryExportRequest) -> Result<String, String> {
    let extension = request
        .extension
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if !["docx", "pdf"].contains(&extension.as_str()) {
        return Err("暂不支持该导出格式。".to_string());
    }

    let article = PathBuf::from(request.article_path);
    let slug = article
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "无法识别文章 slug".to_string())?;
    let root = workspace_root_for_article(&article)?;
    let folder = match extension.as_str() {
        "pdf" => "pdf",
        _ => "word",
    };
    let output = root
        .join("exports")
        .join(folder)
        .join(format!("{slug}.{extension}"));
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(to_err)?;
    }
    let bytes = general_purpose::STANDARD
        .decode(request.content_base64)
        .map_err(to_err)?;
    fs::write(&output, bytes).map_err(to_err)?;
    open_path(&output)?;
    Ok(output.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            initial_open_path,
            scan_workspace,
            search_workspace,
            read_article,
            save_article,
            load_reader_state,
            save_reader_state,
            preview_markdown_content,
            insert_image_asset,
            append_build_log,
            save_reading_html,
            read_binary_file,
            save_binary_export
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

fn find_missing_images(raw: &str, base_dir: &Path) -> Result<Vec<MissingImage>, String> {
    let image_re = Regex::new(r#"!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#).map_err(to_err)?;
    let mut missing = Vec::new();
    for caps in image_re.captures_iter(raw) {
        let alt = caps.get(1).map(|m| m.as_str()).unwrap_or_default().to_string();
        let src = caps.get(2).map(|m| m.as_str()).unwrap_or_default().to_string();
        if src.starts_with("data:image/") || src.starts_with("http://") || src.starts_with("https://") {
            continue;
        }
        let image_path = base_dir.join(src.replace('/', std::path::MAIN_SEPARATOR_STR));
        if !image_path.exists() {
            missing.push(MissingImage {
                alt,
                src,
                resolved_path: image_path.to_string_lossy().to_string(),
            });
        }
    }
    Ok(missing)
}

fn backup_article(article_path: &Path) -> Result<(), String> {
    if !article_path.exists() {
        return Ok(());
    }
    let Some(parent) = article_path.parent() else {
        return Ok(());
    };
    let backup_dir = parent.join(".reader-backups");
    fs::create_dir_all(&backup_dir).map_err(to_err)?;
    let stem = article_path
        .file_stem()
        .and_then(|name| name.to_str())
        .map(sanitize_asset_segment)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "document".to_string());
    let extension = article_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("md");
    let timestamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(to_err)?
        .as_secs();
    let backup = backup_dir.join(format!("{stem}-{timestamp}.{extension}"));
    fs::copy(article_path, backup).map_err(to_err)?;
    Ok(())
}

fn reader_state_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or_else(|| "无法识别应用配置目录".to_string())?;
    Ok(base.join("Markdown Reader").join("reader-state-v2.json"))
}

fn trim_reader_state(state: &mut ReaderState) {
    dedupe_trim(&mut state.recent_workspaces, 20);
    dedupe_trim(&mut state.recent_files, 50);
    dedupe_trim(&mut state.favorites, 500);
    dedupe_trim(&mut state.pinned, 500);
    let known_files: HashSet<String> = state
        .recent_files
        .iter()
        .chain(state.favorites.iter())
        .chain(state.pinned.iter())
        .cloned()
        .collect();
    state.reading_positions.retain(|path, _| known_files.contains(path) || Path::new(path).exists());
}

fn dedupe_trim(values: &mut Vec<String>, max: usize) {
    let mut seen = HashSet::new();
    values.retain(|value| {
        let clean = value.trim();
        !clean.is_empty() && seen.insert(clean.to_string())
    });
    values.truncate(max);
}

fn make_snippet(line: &str, query: &str) -> String {
    let lower = line.to_lowercase();
    let Some(index) = lower.find(query) else {
        return line.chars().take(120).collect();
    };
    let start = lower[..index].chars().count().saturating_sub(42);
    let end = start + 126;
    let mut snippet: String = line.chars().skip(start).take(end - start).collect();
    if start > 0 {
        snippet = format!("...{snippet}");
    }
    if line.chars().count() > end {
        snippet.push_str("...");
    }
    snippet
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

fn initial_open_path_from_args<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    args.into_iter().skip(1).find_map(|arg| {
        let path = PathBuf::from(arg.as_ref());
        if path.is_file() && is_markdown_file(&path) {
            Some(path.to_string_lossy().to_string())
        } else {
            None
        }
    })
}

fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let status = {
        let target = path.to_string_lossy().to_string();
        Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(target)
            .status()
            .map_err(to_err)?
    };

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(path).status().map_err(to_err)?;

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(path).status().map_err(to_err)?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("文件已生成，但打开失败：{}", path.to_string_lossy()))
    }
}

fn to_err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

fn collect_markdown_files(
    dir: &Path,
    group: &str,
    status: &str,
    recursive: bool,
    root: &Path,
    articles: &mut Vec<ArticleSummary>,
) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(to_err)? {
        let entry = entry.map_err(to_err)?;
        let path = entry.path();
        if path.is_dir() && recursive && should_enter_dir(&path) {
            collect_markdown_files(&path, group, status, recursive, root, articles)?;
            continue;
        }
        if !is_markdown_file(&path) {
            continue;
        }
        articles.push(summarize_markdown_file(&path, group, status, root)?);
    }
    Ok(())
}

fn summarize_markdown_file(path: &Path, group: &str, status: &str, root: &Path) -> Result<ArticleSummary, String> {
    let raw = fs::read_to_string(path).unwrap_or_default();
    let (title, digest) = parse_frontmatter(&raw);
    let metadata = fs::metadata(path).map_err(to_err)?;
    let updated = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_default();

    let relative_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");

    Ok(ArticleSummary {
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
        relative_path,
    })
}

fn is_markdown_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "markdown" | "mdown")
    )
}

fn should_enter_dir(path: &Path) -> bool {
    let ignored = [".git", "node_modules", "target", "dist", "dist-ssr"];
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| !ignored.contains(&name))
        .unwrap_or(true)
}

fn sanitize_asset_segment(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut last_was_dash = false;
    for ch in value.chars() {
        let next = if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch > '\u{7f}' {
            Some(ch)
        } else if ch.is_whitespace() || ch == '.' {
            Some('-')
        } else {
            None
        };
        if let Some(ch) = next {
            if ch == '-' {
                if last_was_dash {
                    continue;
                }
                last_was_dash = true;
            } else {
                last_was_dash = false;
            }
            output.push(ch);
        }
    }
    output.trim_matches('-').to_string()
}

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
    fn scans_markdown_workspace_recursively() {
        let root = fixture_root();
        let articles = scan_workspace(root.to_string_lossy().to_string()).expect("scan workspace");
        assert!(!articles.is_empty(), "default workspace should contain markdown articles");
        assert!(
            articles.iter().all(|article| article.status == "document"),
            "V2 scans folders as a generic document library"
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
            "selecting a nested markdown folder should scan that folder directly"
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

    #[test]
    fn opens_single_markdown_file_as_workspace() {
        let root = std::env::temp_dir().join("tauri-reader-single-md");
        fs::create_dir_all(&root).expect("create single root");
        let article_path = root.join("single.md");
        let sibling_path = root.join("sibling.md");
        fs::write(&article_path, "---\ntitle: 单文件\n---\n\n正文").expect("write single");
        fs::write(&sibling_path, "---\ntitle: 同目录\n---\n\n正文").expect("write sibling");

        let articles =
            scan_workspace(article_path.to_string_lossy().to_string()).expect("scan single file");

        assert_eq!(articles.len(), 2);
        assert!(articles.iter().all(|article| article.status == "document"));
        assert!(articles.iter().any(|article| article.title == "单文件"));
        assert!(articles.iter().any(|article| article.title == "同目录"));
    }

    #[test]
    fn detects_markdown_path_from_launch_args() {
        let root = std::env::temp_dir().join(format!(
            "tauri-reader-launch-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create launch root");
        let article_path = root.join("launch.md");
        let image_path = root.join("cover.png");
        fs::write(&article_path, "# Launch").expect("write launch article");
        fs::write(&image_path, [0x89, 0x50, 0x4e, 0x47]).expect("write launch image");

        let detected = initial_open_path_from_args([
            "reader.exe".to_string(),
            image_path.to_string_lossy().to_string(),
            article_path.to_string_lossy().to_string(),
        ]);

        assert_eq!(detected, Some(article_path.to_string_lossy().to_string()));
    }

    #[test]
    fn inserts_image_asset_next_to_article() {
        let root = std::env::temp_dir().join(format!(
            "tauri-reader-image-insert-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create root");
        let article_path = root.join("note.md");
        let image_path = root.join("source image.png");
        fs::write(&article_path, "# Note").expect("write article");
        fs::write(&image_path, [0x89, 0x50, 0x4e, 0x47]).expect("write image");

        let inserted = insert_image_asset(InsertImageAssetRequest {
            article_path: article_path.to_string_lossy().to_string(),
            image_path: image_path.to_string_lossy().to_string(),
        })
        .expect("insert image");

        assert_eq!(inserted.relative_path, "note-assets/source-image.png");
        assert_eq!(inserted.markdown, "![source image](note-assets/source-image.png)");
        assert!(root.join("note-assets").join("source-image.png").exists());
    }

    #[test]
    fn previews_edited_markdown_with_local_images_inlined() {
        let root = std::env::temp_dir().join(format!(
            "tauri-reader-preview-images-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        let assets = root.join("note-assets");
        fs::create_dir_all(&assets).expect("create assets");
        let article_path = root.join("note.md");
        fs::write(&article_path, "# Note").expect("write article");
        fs::write(assets.join("image.png"), [0x89, 0x50, 0x4e, 0x47]).expect("write image");

        let preview = preview_markdown_content(PreviewMarkdownRequest {
            article_path: article_path.to_string_lossy().to_string(),
            content: "![image](note-assets/image.png)".to_string(),
        })
        .expect("preview markdown");

        assert!(preview.contains("data:image/png;base64,"));
    }
}
