#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
    time::UNIX_EPOCH,
};
use zip::ZipArchive;

static WORKSPACE_ROOTS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

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
struct ImportPdfRequest {
    pdf_path: String,
    workspace: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportPdfResponse {
    markdown_path: String,
    workspace: String,
    page_count: usize,
    char_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportDocxRequest {
    docx_path: String,
    workspace: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportDocxResponse {
    markdown_path: String,
    workspace: String,
    paragraph_count: usize,
    table_count: usize,
    image_count: usize,
    char_count: usize,
}

#[derive(Debug, Default)]
struct StructuredDocx {
    blocks: Vec<DocxBlock>,
    styles: HashMap<String, DocxStyle>,
    numbering: DocxNumbering,
    images: HashMap<String, String>,
    paragraph_count: usize,
    table_count: usize,
    image_count: usize,
}

#[derive(Debug)]
enum DocxBlock {
    Paragraph(DocxParagraph),
    Table(Vec<Vec<Vec<DocxParagraph>>>),
}

#[derive(Debug, Default, Clone)]
struct DocxParagraph {
    runs: Vec<DocxRun>,
    style_id: Option<String>,
    num_id: Option<String>,
    numbering_level: Option<usize>,
    alignment: Option<String>,
}

#[derive(Debug, Default, Clone)]
struct DocxRun {
    text: String,
    bold: bool,
    italic: bool,
    image_rid: Option<String>,
}

#[derive(Debug, Default)]
struct DocxStyle {
    name: String,
    based_on: Option<String>,
    outline_level: Option<usize>,
}

#[derive(Debug, Default)]
struct DocxNumbering {
    num_to_abstract: HashMap<String, String>,
    levels: HashMap<(String, usize), DocxNumberFormat>,
}

#[derive(Debug)]
struct ConvertedDocx {
    markdown: String,
    paragraph_count: usize,
    table_count: usize,
    image_count: usize,
}

#[derive(Debug)]
struct DocxImageExport {
    assets_dir: PathBuf,
    relative_dir: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DocxNumberFormat {
    Bullet,
    Numbered,
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
struct RunConsoleCommandRequest {
    tool: String,
    args: String,
    cwd: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunConsoleCommandResponse {
    command: String,
    cwd: String,
    status: Option<i32>,
    stdout: String,
    stderr: String,
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
struct InsertImageAssetBytesRequest {
    article_path: String,
    file_name: String,
    mime_type: String,
    content_base64: String,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DroppedPathInfo {
    path: String,
    parent: String,
    kind: String,
    extension: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliConvertOutput {
    input_path: String,
    output_path: String,
    assets_dir: Option<String>,
    document_type: String,
    paragraph_count: usize,
    table_count: usize,
    page_count: usize,
    image_count: usize,
    char_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliInspectOutput {
    input_path: String,
    document_type: String,
    paragraph_count: usize,
    table_count: usize,
    page_count: usize,
    image_count: usize,
    char_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliReadOutput {
    path: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
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
#[serde(default)]
struct ReaderState {
    recent_workspaces: Vec<String>,
    recent_files: Vec<String>,
    favorites: Vec<String>,
    pinned: Vec<String>,
    reading_positions: HashMap<String, f64>,
    last_workspace: String,
    last_file: String,
    last_read_mode: String,
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
            last_read_mode: "desktop".to_string(),
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
    let input = fs::canonicalize(PathBuf::from(workspace)).map_err(to_err)?;
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
    register_workspace_root(&root)?;
    let mut articles = Vec::new();
    collect_markdown_files(&root, "文档", "document", true, &root, &mut articles)?;

    articles.sort_by_key(|article| std::cmp::Reverse(article.updated));
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
        if !lower_title.contains(&query)
            && !lower_file.contains(&query)
            && !lower_raw.contains(&query)
        {
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

    results.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.relative_path.cmp(&b.relative_path))
    });
    results.truncate(80);
    Ok(results)
}

#[tauri::command]
fn read_article(path: String) -> Result<ArticlePayload, String> {
    let article_path = scoped_markdown_path(&path)?;
    let content = fs::read_to_string(&article_path).map_err(to_err)?;
    let base_dir = article_path
        .parent()
        .ok_or_else(|| "无法识别文章目录".to_string())?
        .to_path_buf();
    let preview_content = inline_local_images(&content, &base_dir)?;
    let missing_images = find_missing_images(&content, &base_dir)?;

    Ok(ArticlePayload {
        path: article_path.to_string_lossy().to_string(),
        base_dir: base_dir.to_string_lossy().to_string(),
        content,
        preview_content,
        missing_images,
    })
}

#[tauri::command]
fn save_article(request: SaveArticleRequest) -> Result<ArticlePayload, String> {
    let article_path = scoped_markdown_path(&request.path)?;
    backup_article(&article_path)?;
    fs::write(&article_path, request.content).map_err(to_err)?;
    read_article(article_path.to_string_lossy().to_string())
}

#[tauri::command]
fn import_pdf_as_markdown(request: ImportPdfRequest) -> Result<ImportPdfResponse, String> {
    let pdf_path = fs::canonicalize(PathBuf::from(request.pdf_path)).map_err(to_err)?;
    if !pdf_path.is_file() || !is_pdf_file(&pdf_path) {
        return Err("请选择有效的 PDF 文件。".to_string());
    }

    let workspace_root = resolve_import_workspace(&request.workspace, &pdf_path)?;
    register_workspace_root(&workspace_root)?;
    let pages = pdf_extract::extract_text_by_pages(&pdf_path).map_err(to_err)?;
    let text_chars = pages
        .iter()
        .flat_map(|page| page.chars())
        .filter(|ch| !ch.is_whitespace())
        .count();
    if text_chars < 20 {
        return Err("这个 PDF 没有提取到足够文字，可能是扫描件或图片型 PDF，暂不支持自动转 Markdown。".to_string());
    }
    let markdown = pdf_pages_to_markdown(&pdf_path, &pages)?;

    let output_dir = workspace_root.join("imports").join("pdf");
    fs::create_dir_all(&output_dir).map_err(to_err)?;
    let stem = pdf_path
        .file_stem()
        .and_then(|name| name.to_str())
        .map(sanitize_asset_segment)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "pdf-draft".to_string());
    let output = unique_markdown_path(&output_dir, &stem);
    fs::write(&output, markdown).map_err(to_err)?;

    Ok(ImportPdfResponse {
        markdown_path: output.to_string_lossy().to_string(),
        workspace: workspace_root.to_string_lossy().to_string(),
        page_count: pages.len(),
        char_count: text_chars,
    })
}

#[tauri::command]
fn import_docx_as_markdown(request: ImportDocxRequest) -> Result<ImportDocxResponse, String> {
    let docx_path = fs::canonicalize(PathBuf::from(request.docx_path)).map_err(to_err)?;
    if !docx_path.is_file() || !is_docx_file(&docx_path) {
        return Err("请选择有效的 DOCX 文件。".to_string());
    }

    let stem = docx_path
        .file_stem()
        .and_then(|name| name.to_str())
        .map(sanitize_asset_segment)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "docx-draft".to_string());
    let workspace_root = resolve_import_workspace(&request.workspace, &docx_path)?;
    register_workspace_root(&workspace_root)?;
    let output_dir = workspace_root.join("imports").join("docx");
    fs::create_dir_all(&output_dir).map_err(to_err)?;
    let output = unique_markdown_path(&output_dir, &stem);
    let asset_stem = output
        .file_stem()
        .and_then(|name| name.to_str())
        .map(sanitize_asset_segment)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| stem.clone());
    let assets_dir_name = format!("{asset_stem}.assets");
    let converted = convert_docx_to_markdown_with_assets(
        &docx_path,
        Some(DocxImageExport {
            assets_dir: output_dir.join(&assets_dir_name),
            relative_dir: assets_dir_name,
        }),
    )?;
    let text_chars = converted
        .markdown
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .count();
    if text_chars < 20 {
        return Err("这个 DOCX 没有提取到足够文字，暂不支持自动转 Markdown。".to_string());
    }
    fs::write(&output, converted.markdown).map_err(to_err)?;

    Ok(ImportDocxResponse {
        markdown_path: output.to_string_lossy().to_string(),
        workspace: workspace_root.to_string_lossy().to_string(),
        paragraph_count: converted.paragraph_count,
        table_count: converted.table_count,
        image_count: converted.image_count,
        char_count: text_chars,
    })
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
    let article_path = scoped_markdown_path(&request.article_path)?;
    let base_dir = article_path
        .parent()
        .ok_or_else(|| "无法识别文章目录".to_string())?
        .to_path_buf();
    inline_local_images(&request.content, &base_dir)
}

#[tauri::command]
fn insert_image_asset(
    request: InsertImageAssetRequest,
) -> Result<InsertImageAssetResponse, String> {
    let article = scoped_markdown_path(&request.article_path)?;

    let source = PathBuf::from(&request.image_path);
    if !source.is_file() {
        return Err("请选择有效的图片文件。".to_string());
    }
    let bytes = fs::read(&source).map_err(to_err)?;
    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image.png");
    insert_image_asset_from_bytes(&article, file_name, &bytes)
}

#[tauri::command]
fn insert_image_asset_bytes(
    request: InsertImageAssetBytesRequest,
) -> Result<InsertImageAssetResponse, String> {
    let article = scoped_markdown_path(&request.article_path)?;
    let extension = image_extension_from_file_or_mime(&request.file_name, &request.mime_type)?;
    let stem = request
        .file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(&request.file_name);
    let file_name = if stem.trim().is_empty() {
        format!("pasted-image.{extension}")
    } else {
        format!("{stem}.{extension}")
    };
    let bytes = general_purpose::STANDARD
        .decode(request.content_base64)
        .map_err(to_err)?;
    insert_image_asset_from_bytes(&article, &file_name, &bytes)
}

#[tauri::command]
fn describe_dropped_path(path: String) -> Result<DroppedPathInfo, String> {
    let resolved = fs::canonicalize(PathBuf::from(path)).map_err(to_err)?;
    let kind = if resolved.is_dir() {
        "directory"
    } else if resolved.is_file() {
        "file"
    } else {
        "unknown"
    };
    let extension = resolved
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();

    Ok(DroppedPathInfo {
        path: resolved.to_string_lossy().to_string(),
        parent: resolved
            .parent()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        kind: kind.to_string(),
        extension,
    })
}

fn insert_image_asset_from_bytes(
    article: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<InsertImageAssetResponse, String> {
    let extension = image_extension_from_file_or_mime(file_name, "")?;

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

    let image_stem = Path::new(file_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .map(sanitize_asset_segment)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| timestamped_asset_stem("image"));
    let alt = Path::new(file_name)
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

    fs::write(&output, bytes).map_err(to_err)?;
    let relative_path = format!("{assets_dir_name}/{file_name}");
    Ok(InsertImageAssetResponse {
        markdown: format!("![{alt}]({relative_path})"),
        relative_path,
    })
}

#[tauri::command]
fn save_reading_html(article_path: String, html: String) -> Result<String, String> {
    let article = scoped_markdown_path(&article_path)?;
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
    open_path(&output);
    Ok(output.to_string_lossy().to_string())
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

    let article = scoped_markdown_path(&request.article_path)?;
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
    open_path(&output);
    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
fn run_console_command(request: RunConsoleCommandRequest) -> Result<RunConsoleCommandResponse, String> {
    let tool = request.tool.trim();
    let executable = resolve_console_tool(tool)?;
    let args = split_console_args(&request.args)?;
    let cwd = if request.cwd.trim().is_empty() {
        std::env::current_dir().map_err(to_err)?
    } else {
        fs::canonicalize(PathBuf::from(request.cwd.trim())).map_err(to_err)?
    };
    if !cwd.is_dir() {
        return Err("控制台工作目录无效。".to_string());
    }

    let output = Command::new(&executable)
        .args(&args)
        .current_dir(&cwd)
        .output()
        .map_err(to_err)?;
    let command = std::iter::once(tool.to_string())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");
    Ok(RunConsoleCommandResponse {
        command,
        cwd: cwd.to_string_lossy().to_string(),
        status: output.status.code(),
        stdout: truncate_console_output(&String::from_utf8_lossy(&output.stdout)),
        stderr: truncate_console_output(&String::from_utf8_lossy(&output.stderr)),
    })
}

pub fn run_cli<I, S>(args: I) -> i32
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut args = args.into_iter().map(Into::into).collect::<Vec<_>>();
    if !args.is_empty() {
        args.remove(0);
    }
    match run_cli_inner(&args) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

fn run_cli_inner(args: &[String]) -> Result<(), String> {
    let Some(command) = args.first().map(String::as_str) else {
        print_cli_help();
        return Ok(());
    };
    if matches!(command, "-h" | "--help" | "help") {
        print_cli_help();
        return Ok(());
    }

    match command {
        "convert" => cli_convert(args),
        "inspect" => cli_inspect(args),
        "search" => cli_search(args),
        "read" => cli_read(args),
        _ => Err(format!("未知 CLI 命令：{command}\n\n运行 md-reader --help 查看用法。")),
    }
}

fn cli_convert(args: &[String]) -> Result<(), String> {
    let input = args
        .get(1)
        .ok_or_else(|| "用法：md-reader convert <input.pdf|input.docx> --to md --out <path> [--json]".to_string())?;
    let json = cli_has_flag(args, "--json");
    let to = cli_option(args, "--to").unwrap_or_else(|| "md".to_string());
    if to != "md" {
        return Err("当前 CLI 仅支持 --to md。".to_string());
    }
    let input_path = fs::canonicalize(PathBuf::from(input)).map_err(to_err)?;
    let output_arg = cli_option(args, "--out").unwrap_or_else(|| ".".to_string());
    let output_path = resolve_cli_markdown_output(&input_path, &PathBuf::from(output_arg))?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(to_err)?;
    }

    let mut assets_dir = None;
    let result = if is_pdf_file(&input_path) {
        let pages = pdf_extract::extract_text_by_pages(&input_path).map_err(to_err)?;
        let markdown = pdf_pages_to_markdown(&input_path, &pages)?;
        let char_count = markdown.chars().filter(|ch| !ch.is_whitespace()).count();
        fs::write(&output_path, markdown).map_err(to_err)?;
        CliConvertOutput {
            input_path: input_path.to_string_lossy().to_string(),
            output_path: output_path.to_string_lossy().to_string(),
            assets_dir: None,
            document_type: "pdf".to_string(),
            paragraph_count: 0,
            table_count: 0,
            page_count: pages.len(),
            image_count: 0,
            char_count,
        }
    } else if is_docx_file(&input_path) {
        let asset_stem = output_path
            .file_stem()
            .and_then(|name| name.to_str())
            .map(sanitize_asset_segment)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "docx-draft".to_string());
        let assets_dir_name = format!("{asset_stem}.assets");
        let output_parent = output_path
            .parent()
            .ok_or_else(|| "无法识别输出目录。".to_string())?;
        let export = DocxImageExport {
            assets_dir: output_parent.join(&assets_dir_name),
            relative_dir: assets_dir_name,
        };
        let converted = convert_docx_to_markdown_with_assets(&input_path, Some(export))?;
        let char_count = converted.markdown.chars().filter(|ch| !ch.is_whitespace()).count();
        fs::write(&output_path, converted.markdown).map_err(to_err)?;
        assets_dir = Some(output_parent.join(format!("{asset_stem}.assets")));
        CliConvertOutput {
            input_path: input_path.to_string_lossy().to_string(),
            output_path: output_path.to_string_lossy().to_string(),
            assets_dir: assets_dir
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            document_type: "docx".to_string(),
            paragraph_count: converted.paragraph_count,
            table_count: converted.table_count,
            page_count: 0,
            image_count: converted.image_count,
            char_count,
        }
    } else {
        return Err("仅支持 PDF 或 DOCX 转 Markdown。".to_string());
    };

    if json {
        println!("{}", serde_json::to_string_pretty(&result).map_err(to_err)?);
    } else {
        println!("Markdown 已生成：{}", result.output_path);
        if let Some(path) = assets_dir {
            println!("图片目录：{}", path.to_string_lossy());
        }
    }
    Ok(())
}

fn cli_inspect(args: &[String]) -> Result<(), String> {
    let input = args
        .get(1)
        .ok_or_else(|| "用法：md-reader inspect <input.pdf|input.docx> [--json]".to_string())?;
    let json = cli_has_flag(args, "--json");
    let input_path = fs::canonicalize(PathBuf::from(input)).map_err(to_err)?;
    let result = if is_pdf_file(&input_path) {
        let pages = pdf_extract::extract_text_by_pages(&input_path).map_err(to_err)?;
        CliInspectOutput {
            input_path: input_path.to_string_lossy().to_string(),
            document_type: "pdf".to_string(),
            paragraph_count: 0,
            table_count: 0,
            page_count: pages.len(),
            image_count: 0,
            char_count: pages
                .iter()
                .flat_map(|page| page.chars())
                .filter(|ch| !ch.is_whitespace())
                .count(),
        }
    } else if is_docx_file(&input_path) {
        let converted = convert_docx_to_markdown(&input_path)?;
        CliInspectOutput {
            input_path: input_path.to_string_lossy().to_string(),
            document_type: "docx".to_string(),
            paragraph_count: converted.paragraph_count,
            table_count: converted.table_count,
            page_count: 0,
            image_count: converted.image_count,
            char_count: converted.markdown.chars().filter(|ch| !ch.is_whitespace()).count(),
        }
    } else {
        return Err("仅支持检查 PDF 或 DOCX。".to_string());
    };

    if json {
        println!("{}", serde_json::to_string_pretty(&result).map_err(to_err)?);
    } else {
        println!("{:?}", result);
    }
    Ok(())
}

fn cli_search(args: &[String]) -> Result<(), String> {
    let workspace = args
        .get(1)
        .ok_or_else(|| "用法：md-reader search <workspace> --query <text> [--json]".to_string())?;
    let query = cli_option(args, "--query")
        .or_else(|| cli_option(args, "-q"))
        .ok_or_else(|| "缺少 --query。".to_string())?;
    let json = cli_has_flag(args, "--json");
    let results = search_workspace(SearchWorkspaceRequest {
        workspace: workspace.to_string(),
        query,
    })?;
    if json {
        println!("{}", serde_json::to_string_pretty(&results).map_err(to_err)?);
    } else {
        for result in results {
            println!("{}:{} {}", result.relative_path, result.line, result.snippet);
        }
    }
    Ok(())
}

fn cli_read(args: &[String]) -> Result<(), String> {
    let input = args
        .get(1)
        .ok_or_else(|| "用法：md-reader read <article.md> [--json]".to_string())?;
    let json = cli_has_flag(args, "--json");
    let path = fs::canonicalize(PathBuf::from(input)).map_err(to_err)?;
    if !is_markdown_file(&path) {
        return Err("read 命令仅支持 Markdown 文件。".to_string());
    }
    let content = fs::read_to_string(&path).map_err(to_err)?;
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&CliReadOutput {
                path: path.to_string_lossy().to_string(),
                content
            })
            .map_err(to_err)?
        );
    } else {
        print!("{content}");
    }
    Ok(())
}

fn cli_option(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find_map(|window| (window[0] == name).then(|| window[1].clone()))
}

fn cli_has_flag(args: &[String], name: &str) -> bool {
    args.iter().any(|arg| arg == name)
}

fn resolve_console_tool(tool: &str) -> Result<PathBuf, String> {
    match tool {
        "md-reader" => {
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|path| path.parent().map(Path::to_path_buf));
            if let Some(path) = exe_dir
                .as_ref()
                .map(|dir| dir.join("md-reader.exe"))
                .filter(|path| path.exists())
            {
                return Ok(path);
            }
            Ok(PathBuf::from("md-reader"))
        }
        "codex" | "claude" | "cc" => Ok(PathBuf::from(tool)),
        _ => Err("仅支持 md-reader、codex、claude、cc。".to_string()),
    }
}

fn split_console_args(raw: &str) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for ch in raw.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            continue;
        }
        if ch.is_whitespace() {
            if !current.is_empty() {
                args.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(ch);
    }

    if quote.is_some() {
        return Err("命令参数里的引号没有闭合。".to_string());
    }
    if escaped {
        current.push('\\');
    }
    if !current.is_empty() {
        args.push(current);
    }
    Ok(args)
}

fn truncate_console_output(value: &str) -> String {
    const MAX_CHARS: usize = 60_000;
    if value.chars().count() <= MAX_CHARS {
        return value.to_string();
    }
    let mut output = value.chars().take(MAX_CHARS).collect::<String>();
    output.push_str("\n\n[output truncated]");
    output
}

fn resolve_cli_markdown_output(input_path: &Path, output: &Path) -> Result<PathBuf, String> {
    let stem = input_path
        .file_stem()
        .and_then(|name| name.to_str())
        .map(sanitize_asset_segment)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "document".to_string());
    if output.extension().and_then(|ext| ext.to_str()) == Some("md") {
        return Ok(output.to_path_buf());
    }
    Ok(output.join(format!("{stem}.md")))
}

fn print_cli_help() {
    println!(
        "Markdown Reader CLI\n\n\
Usage:\n\
  md-reader convert <input.pdf|input.docx> --to md --out <path> [--json]\n\
  md-reader inspect <input.pdf|input.docx> [--json]\n\
  md-reader search <workspace> --query <text> [--json]\n\
  md-reader read <article.md> [--json]\n"
    );
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
            import_pdf_as_markdown,
            import_docx_as_markdown,
            load_reader_state,
            save_reader_state,
            preview_markdown_content,
            insert_image_asset,
            insert_image_asset_bytes,
            describe_dropped_path,
            save_reading_html,
            save_binary_export,
            run_console_command
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
        if src.starts_with("data:image/")
            || src.starts_with("http://")
            || src.starts_with("https://")
        {
            return full.to_string();
        }
        let Ok(image_path) = scoped_related_path(base_dir, src, true) else {
            return full.to_string();
        };
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
        let alt = caps
            .get(1)
            .map(|m| m.as_str())
            .unwrap_or_default()
            .to_string();
        let src = caps
            .get(2)
            .map(|m| m.as_str())
            .unwrap_or_default()
            .to_string();
        if src.starts_with("data:image/")
            || src.starts_with("http://")
            || src.starts_with("https://")
        {
            continue;
        }
        let image_path = scoped_related_path(base_dir, &src, false)?;
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

fn workspace_registry() -> &'static Mutex<HashSet<PathBuf>> {
    WORKSPACE_ROOTS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn register_workspace_root(root: &Path) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(to_err)?;
    if !root.is_dir() {
        return Err("请选择 Markdown 文件夹。".to_string());
    }
    workspace_registry().lock().map_err(to_err)?.insert(root);
    Ok(())
}

fn scoped_markdown_path(path: &str) -> Result<PathBuf, String> {
    let article_path = scoped_existing_file(path)?;
    if !is_markdown_file(&article_path) {
        return Err("请先打开一个 Markdown 文件。".to_string());
    }
    Ok(article_path)
}

fn resolve_import_workspace(workspace: &str, pdf_path: &Path) -> Result<PathBuf, String> {
    let trimmed = workspace.trim();
    if trimmed.is_empty() {
        return pdf_path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法识别 PDF 文件所在目录。".to_string());
    }

    let input = fs::canonicalize(PathBuf::from(trimmed)).map_err(to_err)?;
    if input.is_dir() {
        Ok(input)
    } else if input.is_file() {
        input
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法识别当前工作区目录。".to_string())
    } else {
        Err("请选择有效的 Markdown 工作区。".to_string())
    }
}

fn scoped_existing_file(path: &str) -> Result<PathBuf, String> {
    let file_path = fs::canonicalize(PathBuf::from(path)).map_err(to_err)?;
    if !file_path.is_file() {
        return Err("请选择有效文件。".to_string());
    }
    ensure_path_in_registered_workspace(&file_path)?;
    Ok(file_path)
}

fn ensure_path_in_registered_workspace(path: &Path) -> Result<PathBuf, String> {
    let canonical = if path.exists() {
        fs::canonicalize(path).map_err(to_err)?
    } else {
        normalize_path(path)
    };
    let roots = workspace_registry().lock().map_err(to_err)?;
    roots
        .iter()
        .filter(|root| canonical.starts_with(root))
        .max_by_key(|root| root.components().count())
        .cloned()
        .ok_or_else(|| "路径不在当前已打开的 Markdown 工作区内。".to_string())
}

fn scoped_related_path(base_dir: &Path, src: &str, must_exist: bool) -> Result<PathBuf, String> {
    if src.starts_with("data:image/") || src.starts_with("http://") || src.starts_with("https://") {
        return Err("远程或 data 图片不需要本地解析。".to_string());
    }
    let relative = Path::new(src);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::Prefix(_) | std::path::Component::RootDir
            )
        })
    {
        return Err("图片路径必须是当前文档内的相对路径。".to_string());
    }
    let base_dir = fs::canonicalize(base_dir).map_err(to_err)?;
    ensure_path_in_registered_workspace(&base_dir)?;
    let normalized =
        normalize_path(&base_dir.join(src.replace('/', std::path::MAIN_SEPARATOR_STR)));
    ensure_path_in_registered_workspace(&normalized)?;
    if must_exist {
        let existing = fs::canonicalize(&normalized).map_err(to_err)?;
        ensure_path_in_registered_workspace(&existing)?;
        Ok(existing)
    } else {
        Ok(normalized)
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn trim_reader_state(state: &mut ReaderState) {
    if !matches!(
        state.settings.default_read_mode.as_str(),
        "desktop" | "source" | "edit"
    ) {
        state.settings.default_read_mode = "desktop".to_string();
    }
    if !matches!(state.last_read_mode.as_str(), "desktop" | "source" | "edit") {
        state.last_read_mode = state.settings.default_read_mode.clone();
    }
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
    state
        .reading_positions
        .retain(|path, _| known_files.contains(path) || Path::new(path).exists());
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
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    }
}

fn workspace_root_for_article(article: &Path) -> Result<PathBuf, String> {
    ensure_path_in_registered_workspace(article)
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

fn open_path(path: &Path) {
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(path).status();

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(path).status();

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(path).status();

    match status {
        Ok(status) if status.success() => {}
        Ok(status) => eprintln!(
            "文件已生成，但打开失败：{} ({status})",
            path.to_string_lossy()
        ),
        Err(error) => eprintln!(
            "文件已生成，但打开失败：{} ({error})",
            path.to_string_lossy()
        ),
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

fn summarize_markdown_file(
    path: &Path,
    group: &str,
    status: &str,
    root: &Path,
) -> Result<ArticleSummary, String> {
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

fn is_pdf_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("pdf")
    )
}

fn is_docx_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("docx")
    )
}

fn unique_markdown_path(output_dir: &Path, stem: &str) -> PathBuf {
    let first = output_dir.join(format!("{stem}.md"));
    if !first.exists() {
        return first;
    }

    for index in 2..1000 {
        let candidate = output_dir.join(format!("{stem}-{index}.md"));
        if !candidate.exists() {
            return candidate;
        }
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    output_dir.join(format!("{stem}-{timestamp}.md"))
}

fn image_extension_from_file_or_mime(file_name: &str, mime_type: &str) -> Result<String, String> {
    let from_name = Path::new(file_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    let extension = match from_name.as_deref() {
        Some("jpg" | "jpeg" | "png" | "gif" | "webp" | "svg") => from_name.unwrap(),
        _ => match mime_type.to_ascii_lowercase().as_str() {
            "image/jpeg" | "image/jpg" => "jpg".to_string(),
            "image/png" => "png".to_string(),
            "image/gif" => "gif".to_string(),
            "image/webp" => "webp".to_string(),
            "image/svg+xml" => "svg".to_string(),
            _ => return Err("仅支持 png、jpg、jpeg、gif、webp、svg 图片。".to_string()),
        },
    };
    Ok(extension)
}

fn timestamped_asset_stem(prefix: &str) -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{prefix}-{timestamp}")
}

fn pdf_pages_to_markdown(pdf_path: &Path, pages: &[String]) -> Result<String, String> {
    let title = pdf_path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("PDF Markdown 草稿")
        .trim();
    let source_name = pdf_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("source.pdf");
    let title = if title.is_empty() {
        "PDF Markdown 草稿"
    } else {
        title
    };
    let yaml_title = escape_yaml_value(title);
    let yaml_source = escape_yaml_value(source_name);
    let digest = format!("从 PDF 转换的可编辑 Markdown 草稿，共 {} 页。", pages.len());
    let yaml_digest = escape_yaml_value(&digest);
    let mut markdown = format!(
        "---\ntitle: \"{yaml_title}\"\ndigest: \"{yaml_digest}\"\nsource_pdf: \"{yaml_source}\"\n---\n\n# {title}\n\n> PDF 转 Markdown 草稿。请检查标题、段落和列表结构后再正式使用。\n\n"
    );

    for (index, page) in pages.iter().enumerate() {
        let content = cleanup_pdf_text(page);
        if content.is_empty() {
            continue;
        }
        markdown.push_str(&format!("<!-- page {} -->\n\n", index + 1));
        markdown.push_str(&content);
        markdown.push_str("\n\n");
    }

    Ok(markdown.trim_end().to_string() + "\n")
}

fn docx_document_to_markdown(
    docx_path: &Path,
    document: &docx_lite::Document,
) -> Result<String, String> {
    let title = docx_path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("DOCX Markdown 草稿")
        .trim();
    let source_name = docx_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("source.docx");
    let title = if title.is_empty() {
        "DOCX Markdown 草稿"
    } else {
        title
    };
    let yaml_title = escape_yaml_value(title);
    let yaml_source = escape_yaml_value(source_name);
    let digest = format!(
        "从 DOCX 转换的可编辑 Markdown 草稿，共 {} 段、{} 个表格。",
        document.paragraphs.len(),
        document.tables.len()
    );
    let yaml_digest = escape_yaml_value(&digest);
    let mut markdown = format!(
        "---\ntitle: \"{yaml_title}\"\ndigest: \"{yaml_digest}\"\nsource_docx: \"{yaml_source}\"\n---\n\n# {title}\n\n> DOCX 转 Markdown 草稿。请检查标题、列表和表格结构后再正式使用。\n\n"
    );

    for paragraph in &document.paragraphs {
        if let Some(block) = docx_paragraph_to_markdown(paragraph) {
            markdown.push_str(&block);
            markdown.push_str("\n\n");
        }
    }

    for table in &document.tables {
        if let Some(block) = docx_table_to_markdown(table) {
            markdown.push_str(&block);
            markdown.push_str("\n\n");
        }
    }

    Ok(markdown.trim_end().to_string() + "\n")
}

fn convert_docx_to_markdown(docx_path: &Path) -> Result<ConvertedDocx, String> {
    convert_docx_to_markdown_with_assets(docx_path, None)
}

fn convert_docx_to_markdown_with_assets(
    docx_path: &Path,
    image_export: Option<DocxImageExport>,
) -> Result<ConvertedDocx, String> {
    match parse_structured_docx(docx_path, image_export.as_ref())
        .and_then(|document| structured_docx_to_markdown(docx_path, &document))
    {
        Ok(converted)
            if converted
                .markdown
                .chars()
                .filter(|ch| !ch.is_whitespace())
                .count()
                >= 20 =>
        {
            Ok(converted)
        }
        _ => {
            let document = docx_lite::parse_document_from_path(docx_path).map_err(to_err)?;
            let markdown = docx_document_to_markdown(docx_path, &document)?;
            Ok(ConvertedDocx {
                markdown,
                paragraph_count: document.paragraphs.len(),
                table_count: document.tables.len(),
                image_count: 0,
            })
        }
    }
}

fn parse_structured_docx(
    docx_path: &Path,
    image_export: Option<&DocxImageExport>,
) -> Result<StructuredDocx, String> {
    let file = fs::File::open(docx_path).map_err(to_err)?;
    let mut archive = ZipArchive::new(file).map_err(to_err)?;
    let document_xml = read_docx_entry(&mut archive, "word/document.xml")?;
    let relationships = read_docx_entry(&mut archive, "word/_rels/document.xml.rels")
        .ok()
        .map(|xml| parse_docx_relationships(&xml))
        .transpose()?
        .unwrap_or_default();
    let styles = read_docx_entry(&mut archive, "word/styles.xml")
        .ok()
        .map(|xml| parse_docx_styles(&xml))
        .transpose()?
        .unwrap_or_default();
    let numbering = read_docx_entry(&mut archive, "word/numbering.xml")
        .ok()
        .map(|xml| parse_docx_numbering(&xml))
        .transpose()?
        .unwrap_or_default();
    let images = if let Some(export) = image_export {
        export_docx_images(&mut archive, &relationships, export)?
    } else {
        HashMap::new()
    };
    parse_docx_document_xml(&document_xml, styles, numbering, images)
}

fn read_docx_entry<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    path: &str,
) -> Result<String, String> {
    let mut file = archive.by_name(path).map_err(to_err)?;
    let mut content = String::new();
    file.read_to_string(&mut content).map_err(to_err)?;
    Ok(content)
}

fn parse_docx_relationships(xml: &str) -> Result<HashMap<String, String>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut relationships = HashMap::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(e)) | Ok(Event::Start(e)) if e.name().as_ref() == b"Relationship" => {
                if let (Some(id), Some(target)) =
                    (docx_attr_value(&e, b"Id"), docx_attr_value(&e, b"Target"))
                {
                    relationships.insert(id, target);
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(to_err(error)),
            _ => {}
        }
        buf.clear();
    }

    Ok(relationships)
}

fn export_docx_images<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    relationships: &HashMap<String, String>,
    export: &DocxImageExport,
) -> Result<HashMap<String, String>, String> {
    fs::create_dir_all(&export.assets_dir).map_err(to_err)?;
    let mut exported = HashMap::new();

    for (rid, target) in relationships {
        let normalized_target = target.replace('\\', "/");
        if normalized_target.contains("..") || normalized_target.starts_with("http") {
            continue;
        }
        let archive_path = if normalized_target.starts_with("word/") {
            normalized_target.clone()
        } else {
            format!("word/{}", normalized_target.trim_start_matches('/'))
        };
        if !archive_path.starts_with("word/media/") {
            continue;
        }

        let mut file = match archive.by_name(&archive_path) {
            Ok(file) => file,
            Err(_) => continue,
        };
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(to_err)?;
        let source_name = Path::new(&archive_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image.png");
        let extension = image_extension_from_file_or_mime(source_name, "").unwrap_or_else(|_| "png".to_string());
        let stem = Path::new(source_name)
            .file_stem()
            .and_then(|name| name.to_str())
            .map(sanitize_asset_segment)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| timestamped_asset_stem("docx-image"));
        let mut file_name = format!("{stem}.{extension}");
        let mut output = export.assets_dir.join(&file_name);
        let mut index = 1;
        while output.exists() {
            file_name = format!("{stem}-{index}.{extension}");
            output = export.assets_dir.join(&file_name);
            index += 1;
        }
        fs::write(&output, bytes).map_err(to_err)?;
        exported.insert(rid.clone(), format!("{}/{}", export.relative_dir, file_name));
    }

    Ok(exported)
}

fn structured_docx_to_markdown(
    docx_path: &Path,
    document: &StructuredDocx,
) -> Result<ConvertedDocx, String> {
    let title = docx_path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("DOCX Markdown 草稿")
        .trim();
    let source_name = docx_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("source.docx");
    let title = if title.is_empty() {
        "DOCX Markdown 草稿"
    } else {
        title
    };
    let yaml_title = escape_yaml_value(title);
    let yaml_source = escape_yaml_value(source_name);
    let digest = format!(
        "从 DOCX 转换的可编辑 Markdown 草稿，共 {} 段、{} 个表格。",
        document.paragraph_count, document.table_count
    );
    let yaml_digest = escape_yaml_value(&digest);
    let mut markdown = format!(
        "---\ntitle: \"{yaml_title}\"\ndigest: \"{yaml_digest}\"\nsource_docx: \"{yaml_source}\"\n---\n\n# {title}\n\n> DOCX 转 Markdown 草稿。请检查标题、列表、表格和图片位置后再正式使用。\n\n"
    );

    for block in &document.blocks {
        match block {
            DocxBlock::Paragraph(paragraph) => {
                if let Some(block) = structured_docx_paragraph_to_markdown(paragraph, document) {
                    markdown.push_str(&block);
                    markdown.push_str("\n\n");
                }
            }
            DocxBlock::Table(rows) => {
                if let Some(block) = structured_docx_table_to_markdown(rows, document) {
                    markdown.push_str(&block);
                    markdown.push_str("\n\n");
                }
            }
        }
    }

    Ok(ConvertedDocx {
        markdown: markdown.trim_end().to_string() + "\n",
        paragraph_count: document.paragraph_count,
        table_count: document.table_count,
        image_count: document.image_count,
    })
}

fn parse_docx_document_xml(
    xml: &str,
    styles: HashMap<String, DocxStyle>,
    numbering: DocxNumbering,
    images: HashMap<String, String>,
) -> Result<StructuredDocx, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut document = StructuredDocx {
        blocks: Vec::new(),
        styles,
        numbering,
        image_count: images.len(),
        images,
        paragraph_count: 0,
        table_count: 0,
    };
    let mut table: Option<Vec<Vec<Vec<DocxParagraph>>>> = None;
    let mut row: Option<Vec<Vec<DocxParagraph>>> = None;
    let mut cell: Option<Vec<DocxParagraph>> = None;
    let mut paragraph: Option<DocxParagraph> = None;
    let mut run: Option<DocxRun> = None;
    let mut in_text = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                b"w:tbl" => table = Some(Vec::new()),
                b"w:tr" => row = Some(Vec::new()),
                b"w:tc" => cell = Some(Vec::new()),
                b"w:p" => paragraph = Some(DocxParagraph::default()),
                b"w:r" => run = Some(DocxRun::default()),
                b"w:t" => in_text = true,
                b"w:tab" => push_docx_run_text(&mut run, "\t"),
                b"w:br" => push_docx_run_text(&mut run, "\n"),
                b"w:pStyle" => set_docx_paragraph_style(&mut paragraph, &e),
                b"w:numId" => set_docx_paragraph_num_id(&mut paragraph, &e),
                b"w:ilvl" => set_docx_paragraph_ilvl(&mut paragraph, &e),
                b"w:jc" => set_docx_paragraph_alignment(&mut paragraph, &e),
                b"w:b" => set_docx_run_bold(&mut run, &e),
                b"w:i" => set_docx_run_italic(&mut run, &e),
                b"a:blip" => set_docx_run_image(&mut paragraph, &mut run, &e),
                _ => {}
            },
            Ok(Event::Empty(e)) => match e.name().as_ref() {
                b"w:tab" => push_docx_run_text(&mut run, "\t"),
                b"w:br" => push_docx_run_text(&mut run, "\n"),
                b"w:pStyle" => set_docx_paragraph_style(&mut paragraph, &e),
                b"w:numId" => set_docx_paragraph_num_id(&mut paragraph, &e),
                b"w:ilvl" => set_docx_paragraph_ilvl(&mut paragraph, &e),
                b"w:jc" => set_docx_paragraph_alignment(&mut paragraph, &e),
                b"w:b" => set_docx_run_bold(&mut run, &e),
                b"w:i" => set_docx_run_italic(&mut run, &e),
                b"a:blip" => set_docx_run_image(&mut paragraph, &mut run, &e),
                _ => {}
            },
            Ok(Event::Text(e)) if in_text => {
                let text = e.unescape().map_err(to_err)?.into_owned();
                push_docx_run_text(&mut run, &text);
            }
            Ok(Event::Text(_)) => {}
            Ok(Event::End(e)) => match e.name().as_ref() {
                b"w:t" => in_text = false,
                b"w:r" => {
                    if let (Some(run), Some(paragraph)) = (run.take(), paragraph.as_mut()) {
                        paragraph.runs.push(run);
                    }
                }
                b"w:p" => {
                    if let Some(paragraph) = paragraph.take() {
                        if !paragraph.plain_text().trim().is_empty() || paragraph.has_image() {
                            document.paragraph_count += 1;
                            if let Some(cell) = cell.as_mut() {
                                cell.push(paragraph);
                            } else {
                                document.blocks.push(DocxBlock::Paragraph(paragraph));
                            }
                        }
                    }
                }
                b"w:tc" => {
                    if let (Some(cell), Some(row)) = (cell.take(), row.as_mut()) {
                        row.push(cell);
                    }
                }
                b"w:tr" => {
                    if let (Some(row), Some(table)) = (row.take(), table.as_mut()) {
                        table.push(row);
                    }
                }
                b"w:tbl" => {
                    if let Some(table) = table.take() {
                        if !table.is_empty() {
                            document.table_count += 1;
                            document.blocks.push(DocxBlock::Table(table));
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => return Err(to_err(error)),
            _ => {}
        }
        buf.clear();
    }

    Ok(document)
}

fn parse_docx_styles(xml: &str) -> Result<HashMap<String, DocxStyle>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut styles = HashMap::new();
    let mut current_id: Option<String> = None;
    let mut current = DocxStyle::default();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                b"w:style" => {
                    current_id = docx_attr_value(&e, b"styleId");
                    current = DocxStyle::default();
                }
                b"w:name" => {
                    if let Some(value) = docx_attr_value(&e, b"val") {
                        current.name = value;
                    }
                }
                b"w:basedOn" => current.based_on = docx_attr_value(&e, b"val"),
                b"w:outlineLvl" => {
                    current.outline_level = docx_attr_value(&e, b"val")
                        .and_then(|value| value.parse::<usize>().ok())
                        .map(|level| (level + 2).min(6));
                }
                _ => {}
            },
            Ok(Event::Empty(e)) => match e.name().as_ref() {
                b"w:name" => {
                    if let Some(value) = docx_attr_value(&e, b"val") {
                        current.name = value;
                    }
                }
                b"w:basedOn" => current.based_on = docx_attr_value(&e, b"val"),
                b"w:outlineLvl" => {
                    current.outline_level = docx_attr_value(&e, b"val")
                        .and_then(|value| value.parse::<usize>().ok())
                        .map(|level| (level + 2).min(6));
                }
                _ => {}
            },
            Ok(Event::End(e)) if e.name().as_ref() == b"w:style" => {
                if let Some(style_id) = current_id.take() {
                    styles.insert(style_id, std::mem::take(&mut current));
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(to_err(error)),
            _ => {}
        }
        buf.clear();
    }

    Ok(styles)
}

fn parse_docx_numbering(xml: &str) -> Result<DocxNumbering, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut numbering = DocxNumbering::default();
    let mut current_abstract: Option<String> = None;
    let mut current_level: Option<usize> = None;
    let mut current_num: Option<String> = None;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                b"w:abstractNum" => current_abstract = docx_attr_value(&e, b"abstractNumId"),
                b"w:lvl" => current_level = docx_attr_value(&e, b"ilvl").and_then(|value| value.parse().ok()),
                b"w:numFmt" => {
                    if let (Some(abstract_id), Some(level), Some(value)) = (
                        current_abstract.clone(),
                        current_level,
                        docx_attr_value(&e, b"val"),
                    ) {
                        let format = if value.eq_ignore_ascii_case("bullet") {
                            DocxNumberFormat::Bullet
                        } else {
                            DocxNumberFormat::Numbered
                        };
                        numbering.levels.insert((abstract_id, level), format);
                    }
                }
                b"w:num" => current_num = docx_attr_value(&e, b"numId"),
                b"w:abstractNumId" => {
                    if let (Some(num_id), Some(abstract_id)) =
                        (current_num.clone(), docx_attr_value(&e, b"val"))
                    {
                        numbering.num_to_abstract.insert(num_id, abstract_id);
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(e)) => match e.name().as_ref() {
                b"w:numFmt" => {
                    if let (Some(abstract_id), Some(level), Some(value)) = (
                        current_abstract.clone(),
                        current_level,
                        docx_attr_value(&e, b"val"),
                    ) {
                        let format = if value.eq_ignore_ascii_case("bullet") {
                            DocxNumberFormat::Bullet
                        } else {
                            DocxNumberFormat::Numbered
                        };
                        numbering.levels.insert((abstract_id, level), format);
                    }
                }
                b"w:abstractNumId" => {
                    if let (Some(num_id), Some(abstract_id)) =
                        (current_num.clone(), docx_attr_value(&e, b"val"))
                    {
                        numbering.num_to_abstract.insert(num_id, abstract_id);
                    }
                }
                _ => {}
            },
            Ok(Event::End(e)) => match e.name().as_ref() {
                b"w:abstractNum" => {
                    current_abstract = None;
                    current_level = None;
                }
                b"w:lvl" => current_level = None,
                b"w:num" => current_num = None,
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => return Err(to_err(error)),
            _ => {}
        }
        buf.clear();
    }

    Ok(numbering)
}

impl DocxParagraph {
    fn plain_text(&self) -> String {
        self.runs
            .iter()
            .map(|run| run.text.as_str())
            .collect::<Vec<_>>()
            .join("")
    }

    fn has_image(&self) -> bool {
        self.runs.iter().any(|run| run.image_rid.is_some())
    }

    fn inline_markdown(&self, document: &StructuredDocx) -> String {
        let mut text = String::new();
        for run in &self.runs {
            if let Some(rid) = run.image_rid.as_deref() {
                if let Some(relative_path) = document.images.get(rid) {
                    if !text.is_empty() && !text.ends_with(' ') {
                        text.push(' ');
                    }
                    text.push_str(&format!("![image]({relative_path})"));
                }
            }
            let value = run.text.replace(['\t', '\n'], " ");
            if value.trim().is_empty() {
                text.push_str(&value);
            } else if run.bold && run.italic {
                text.push_str(&format!("***{}***", value.trim()));
            } else if run.bold {
                text.push_str(&format!("**{}**", value.trim()));
            } else if run.italic {
                text.push_str(&format!("*{}*", value.trim()));
            } else {
                text.push_str(&value);
            }
        }
        normalize_docx_text(&text)
    }
}

fn structured_docx_paragraph_to_markdown(
    paragraph: &DocxParagraph,
    document: &StructuredDocx,
) -> Option<String> {
    let text = normalize_docx_text(&paragraph.plain_text());
    if text.is_empty() && !paragraph.has_image() {
        return None;
    }

    let content = paragraph.inline_markdown(document);
    if text.is_empty() {
        return (!content.is_empty()).then_some(content);
    }

    if let Some(level) = structured_docx_heading_level(paragraph, document) {
        return Some(format!("{} {}", "#".repeat(level), normalize_docx_heading_text(&text)));
    }

    if is_probable_docx_toc_line(&text) {
        return Some(format!("- {}", strip_trailing_page_number(&text)));
    }

    if let Some(level) = docx_text_heading_level(&text) {
        return Some(format!("{} {}", "#".repeat(level), normalize_docx_heading_text(&text)));
    }

    if paragraph.num_id.is_some() {
        let level = paragraph.numbering_level.unwrap_or_default();
        let indent = "  ".repeat(level);
        let marker = structured_docx_list_marker(paragraph, document);
        return Some(format!("{indent}{marker} {content}"));
    }

    if paragraph.alignment.as_deref() == Some("center") && text.chars().count() <= 48 {
        return Some(format!("## {}", normalize_docx_heading_text(&text)));
    }
    Some(content)
}

fn structured_docx_heading_level(
    paragraph: &DocxParagraph,
    document: &StructuredDocx,
) -> Option<usize> {
    let style_id = paragraph.style_id.as_deref()?;
    let style = document.styles.get(style_id);
    if let Some(level) = style.and_then(|style| style.outline_level) {
        return Some(level);
    }
    if let Some(level) = docx_heading_level(Some(style_id)) {
        return Some(level);
    }
    if let Some(style) = style {
        if let Some(level) = docx_heading_level(Some(&style.name)) {
            return Some(level);
        }
        if let Some(parent) = style.based_on.as_deref() {
            if let Some(level) = docx_heading_level(Some(parent)) {
                return Some(level);
            }
            if let Some(parent_style) = document.styles.get(parent) {
                if let Some(level) = parent_style.outline_level {
                    return Some(level);
                }
                if let Some(level) = docx_heading_level(Some(&parent_style.name)) {
                    return Some(level);
                }
            }
        }
    }
    None
}

fn structured_docx_list_marker(paragraph: &DocxParagraph, document: &StructuredDocx) -> &'static str {
    let Some(num_id) = paragraph.num_id.as_deref() else {
        return "-";
    };
    let level = paragraph.numbering_level.unwrap_or_default();
    let Some(abstract_id) = document.numbering.num_to_abstract.get(num_id) else {
        return "-";
    };
    match document.numbering.levels.get(&(abstract_id.clone(), level)) {
        Some(DocxNumberFormat::Numbered) => "1.",
        _ => "-",
    }
}

fn structured_docx_table_to_markdown(
    rows: &[Vec<Vec<DocxParagraph>>],
    document: &StructuredDocx,
) -> Option<String> {
    let rows = rows
        .iter()
        .map(|row| {
            row.iter()
                .map(|cell| {
                    cell.iter()
                        .filter_map(|paragraph| {
                            let text = paragraph.inline_markdown(document);
                            if text.is_empty() {
                                None
                            } else {
                                Some(text)
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .collect::<Vec<_>>()
        })
        .filter(|row| row.iter().any(|cell| !cell.trim().is_empty()))
        .collect::<Vec<_>>();

    let max_columns = rows.iter().map(Vec::len).max().unwrap_or_default();
    if rows.is_empty() || max_columns == 0 {
        return None;
    }

    let mut markdown = String::new();
    for (index, row) in rows.iter().enumerate() {
        let cells = (0..max_columns)
            .map(|column| escape_markdown_table_cell(row.get(column).map(String::as_str).unwrap_or("")))
            .collect::<Vec<_>>();
        markdown.push_str("| ");
        markdown.push_str(&cells.join(" | "));
        markdown.push_str(" |\n");
        if index == 0 {
            markdown.push_str("| ");
            markdown.push_str(&vec!["---"; max_columns].join(" | "));
            markdown.push_str(" |\n");
        }
    }

    Some(markdown.trim_end().to_string())
}

fn push_docx_run_text(run: &mut Option<DocxRun>, value: &str) {
    if run.is_none() {
        *run = Some(DocxRun::default());
    }
    if let Some(run) = run.as_mut() {
        run.text.push_str(value);
    }
}

fn set_docx_run_image(
    _paragraph: &mut Option<DocxParagraph>,
    run: &mut Option<DocxRun>,
    element: &BytesStart<'_>,
) {
    let Some(rid) = docx_attr_value(element, b"embed") else {
        return;
    };
    if run.is_none() {
        *run = Some(DocxRun::default());
    }
    if let Some(run) = run.as_mut() {
        run.image_rid = Some(rid);
    }
}

fn set_docx_paragraph_style(paragraph: &mut Option<DocxParagraph>, element: &BytesStart<'_>) {
    if let (Some(paragraph), Some(value)) = (paragraph.as_mut(), docx_attr_value(element, b"val")) {
        paragraph.style_id = Some(value);
    }
}

fn set_docx_paragraph_num_id(paragraph: &mut Option<DocxParagraph>, element: &BytesStart<'_>) {
    if let (Some(paragraph), Some(value)) = (paragraph.as_mut(), docx_attr_value(element, b"val")) {
        paragraph.num_id = Some(value);
    }
}

fn set_docx_paragraph_ilvl(paragraph: &mut Option<DocxParagraph>, element: &BytesStart<'_>) {
    if let (Some(paragraph), Some(value)) = (paragraph.as_mut(), docx_attr_value(element, b"val")) {
        paragraph.numbering_level = value.parse::<usize>().ok();
    }
}

fn set_docx_paragraph_alignment(paragraph: &mut Option<DocxParagraph>, element: &BytesStart<'_>) {
    if let (Some(paragraph), Some(value)) = (paragraph.as_mut(), docx_attr_value(element, b"val")) {
        paragraph.alignment = Some(value);
    }
}

fn set_docx_run_bold(run: &mut Option<DocxRun>, element: &BytesStart<'_>) {
    if docx_boolean_attr_enabled(element) {
        if run.is_none() {
            *run = Some(DocxRun::default());
        }
        if let Some(run) = run.as_mut() {
            run.bold = true;
        }
    }
}

fn set_docx_run_italic(run: &mut Option<DocxRun>, element: &BytesStart<'_>) {
    if docx_boolean_attr_enabled(element) {
        if run.is_none() {
            *run = Some(DocxRun::default());
        }
        if let Some(run) = run.as_mut() {
            run.italic = true;
        }
    }
}

fn docx_boolean_attr_enabled(element: &BytesStart<'_>) -> bool {
    docx_attr_value(element, b"val")
        .map(|value| !matches!(value.as_str(), "0" | "false" | "False"))
        .unwrap_or(true)
}

fn docx_attr_value(element: &BytesStart<'_>, key: &[u8]) -> Option<String> {
    element.attributes().flatten().find_map(|attribute| {
        let attr_key = attribute.key.as_ref();
        let matches_key = attr_key == key
            || attr_key
                .rsplit(|byte| *byte == b':')
                .next()
                .map(|suffix| suffix == key)
                .unwrap_or(false);
        if !matches_key {
            return None;
        }
        std::str::from_utf8(attribute.value.as_ref())
            .ok()
            .map(ToString::to_string)
    })
}

fn docx_paragraph_to_markdown(paragraph: &docx_lite::Paragraph) -> Option<String> {
    let text = normalize_docx_text(&paragraph.to_text());
    if text.is_empty() {
        return None;
    }

    if let Some(level) = docx_heading_level(paragraph.style.as_deref()) {
        return Some(format!("{} {}", "#".repeat(level), normalize_docx_heading_text(&text)));
    }

    if is_probable_docx_toc_line(&text) {
        return Some(format!("- {}", strip_trailing_page_number(&text)));
    }

    if let Some(level) = docx_text_heading_level(&text) {
        return Some(format!("{} {}", "#".repeat(level), normalize_docx_heading_text(&text)));
    }

    if paragraph.numbering_id.is_some() {
        let level = paragraph.numbering_level.unwrap_or_default().max(0) as usize;
        let indent = "  ".repeat(level);
        return Some(format!("{indent}- {text}"));
    }

    Some(text)
}

fn docx_heading_level(style: Option<&str>) -> Option<usize> {
    let style = style?.to_ascii_lowercase();
    if style.contains("heading1") || style.contains("heading 1") || style == "1" {
        Some(2)
    } else if style.contains("heading2") || style.contains("heading 2") || style == "2" {
        Some(3)
    } else if style.contains("heading3") || style.contains("heading 3") || style == "3" {
        Some(4)
    } else if style.contains("heading4") || style.contains("heading 4") || style == "4" {
        Some(5)
    } else {
        None
    }
}

fn docx_text_heading_level(text: &str) -> Option<usize> {
    let value = strip_trailing_page_number(text);
    let lower = value.to_ascii_lowercase();
    if matches!(
        value.as_str(),
        "摘要" | "目录" | "致谢" | "参考文献" | "结论" | "附录"
    ) || matches!(
        lower.as_str(),
        "abstract" | "contents" | "references" | "acknowledgements" | "acknowledgments"
    ) {
        return Some(2);
    }

    if Regex::new(r"^第[一二三四五六七八九十百千万\d]+章")
        .map(|regex| regex.is_match(&value))
        .unwrap_or(false)
    {
        return Some(2);
    }

    let numbered = Regex::new(r"^(\d+(?:\.\d+){1,5})\s*\S")
        .map_err(to_err)
        .ok()?;
    let captures = numbered.captures(&value)?;
    let depth = captures
        .get(1)
        .map(|matched| matched.as_str().matches('.').count() + 1)
        .unwrap_or(1);
    Some((depth + 1).min(6))
}

fn normalize_docx_text(value: &str) -> String {
    let mut text = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if let Ok(regex) = Regex::new(r"^(KeyWords?|Keywords?):\s*") {
        text = regex.replace(&text, "$1: ").to_string();
    }
    text
}

fn normalize_docx_heading_text(value: &str) -> String {
    let mut text = strip_trailing_page_number(value);
    if let Ok(regex) = Regex::new(r"^(第[一二三四五六七八九十百千万\d]+章)(\S)") {
        text = regex.replace(&text, "$1 $2").to_string();
    }
    if let Ok(regex) = Regex::new(r"^(\d+(?:\.\d+)+)(\S)") {
        text = regex.replace(&text, "$1 $2").to_string();
    }
    text
}

fn strip_trailing_page_number(value: &str) -> String {
    let trimmed = value.trim();
    Regex::new(r"^(.+?)[\s　]*(\d{1,3})$")
        .ok()
        .and_then(|regex| {
            regex.captures(trimmed).and_then(|captures| {
                let title = captures.get(1)?.as_str().trim();
                if title.chars().count() >= 2 && !title.ends_with('%') {
                    Some(title.to_string())
                } else {
                    None
                }
            })
        })
        .unwrap_or_else(|| trimmed.to_string())
}

fn is_probable_docx_toc_line(value: &str) -> bool {
    let trimmed = value.trim();
    if !Regex::new(r"\d{1,3}$")
        .map(|regex| regex.is_match(trimmed))
        .unwrap_or(false)
    {
        return false;
    }

    Regex::new(r"^(第[一二三四五六七八九十百千万\d]+章|\d+(?:\.\d+){1,5})")
        .map(|regex| regex.is_match(trimmed))
        .unwrap_or(false)
}

fn docx_table_to_markdown(table: &docx_lite::Table) -> Option<String> {
    let rows = table
        .rows
        .iter()
        .map(|row| {
            row.cells
                .iter()
                .map(|cell| {
                    cell.paragraphs
                        .iter()
                        .map(|paragraph| paragraph.to_text())
                        .filter(|text| !text.trim().is_empty())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .collect::<Vec<_>>()
        })
        .filter(|row| row.iter().any(|cell| !cell.trim().is_empty()))
        .collect::<Vec<_>>();

    let max_columns = rows.iter().map(Vec::len).max().unwrap_or_default();
    if rows.is_empty() || max_columns == 0 {
        return None;
    }

    let mut markdown = String::new();
    for (index, row) in rows.iter().enumerate() {
        let cells = (0..max_columns)
            .map(|column| escape_markdown_table_cell(row.get(column).map(String::as_str).unwrap_or("")))
            .collect::<Vec<_>>();
        markdown.push_str("| ");
        markdown.push_str(&cells.join(" | "));
        markdown.push_str(" |\n");
        if index == 0 {
            markdown.push_str("| ");
            markdown.push_str(&vec!["---"; max_columns].join(" | "));
            markdown.push_str(" |\n");
        }
    }

    Some(markdown.trim_end().to_string())
}

fn escape_markdown_table_cell(value: &str) -> String {
    value
        .replace('|', "\\|")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn cleanup_pdf_text(raw: &str) -> String {
    let normalized = raw.replace('\r', "\n");
    let mut blocks = Vec::new();
    let mut current = String::new();

    for line in normalized.lines() {
        let trimmed = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if trimmed.is_empty() {
            if !current.trim().is_empty() {
                blocks.push(current.trim().to_string());
                current.clear();
            }
            continue;
        }

        if current.is_empty() {
            current.push_str(&trimmed);
            continue;
        }

        if should_join_pdf_line(&current, &trimmed) {
            if current.ends_with('-') && !current.ends_with("--") {
                current.pop();
            } else {
                current.push(' ');
            }
            current.push_str(&trimmed);
        } else {
            blocks.push(current.trim().to_string());
            current.clear();
            current.push_str(&trimmed);
        }
    }

    if !current.trim().is_empty() {
        blocks.push(current.trim().to_string());
    }

    blocks
        .into_iter()
        .map(|block| format_pdf_block(&block))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn should_join_pdf_line(current: &str, next: &str) -> bool {
    if is_probable_heading(current) {
        return false;
    }
    if is_probable_list_item(next) || is_probable_heading(next) {
        return false;
    }
    let Some(last) = current.chars().last() else {
        return false;
    };
    !matches!(last, '。' | '！' | '？' | '.' | '!' | '?' | ':' | '：' | ';' | '；')
}

fn format_pdf_block(block: &str) -> String {
    if is_probable_heading(block) {
        format!("## {block}")
    } else {
        block.to_string()
    }
}

fn is_probable_list_item(value: &str) -> bool {
    Regex::new(r"^(\d+[\.)、]|[A-Za-z][\.)]|[-•●])\s+")
        .map(|regex| regex.is_match(value))
        .unwrap_or(false)
}

fn is_probable_heading(value: &str) -> bool {
    let char_count = value.chars().count();
    if char_count == 0 || char_count > 42 {
        return false;
    }
    if is_probable_list_item(value) {
        return false;
    }
    if value.ends_with('。')
        || value.ends_with('.')
        || value.ends_with(',')
        || value.ends_with('，')
        || value.ends_with(';')
        || value.ends_with('；')
    {
        return false;
    }
    if value.chars().any(|ch| ch > '\u{7f}') {
        return char_count <= 24;
    }

    let words = value.split_whitespace().collect::<Vec<_>>();
    if words.is_empty() || words.len() > 8 {
        return false;
    }
    words.iter().all(|word| {
        word.chars()
            .find(|ch| ch.is_alphanumeric())
            .map(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
            .unwrap_or(false)
    })
}

fn escape_yaml_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn should_enter_dir(path: &Path) -> bool {
    let ignored = [
        ".git",
        ".reader-backups",
        "exports",
        "node_modules",
        "target",
        "dist",
        "dist-ssr",
    ];
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
        assert!(
            !articles.is_empty(),
            "default workspace should contain markdown articles"
        );
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
        assert!(
            !payload.content.trim().is_empty(),
            "article content should not be empty"
        );
        assert!(
            !payload.preview_content.trim().is_empty(),
            "preview content should not be empty"
        );
    }

    #[test]
    fn accepts_articles_subdirectory_as_workspace_input() {
        let root = fixture_root();
        let drafts_dir = root
            .join("articles")
            .join("drafts")
            .to_string_lossy()
            .to_string();
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
    fn formats_pdf_text_as_markdown_draft() {
        let root = fixture_root();
        let pdf_path = root.join("sample.pdf");
        let pages = vec![
            "Section One\nThis is a wrapped\nparagraph.".to_string(),
            "第二节\n这是一段中文内容。".to_string(),
        ];

        let markdown = pdf_pages_to_markdown(&pdf_path, &pages).expect("format markdown");

        assert!(markdown.contains("title: \"sample\""));
        assert!(markdown.contains("<!-- page 1 -->"));
        assert!(markdown.contains("## Section One"));
        assert!(markdown.contains("This is a wrapped paragraph."));
        assert!(markdown.contains("<!-- page 2 -->"));
        assert!(markdown.contains("## 第二节"));
    }

    #[test]
    fn formats_docx_structure_as_markdown_draft() {
        let root = fixture_root();
        let docx_path = root.join("sample.docx");
        let mut document = docx_lite::Document::new();
        let mut heading = docx_lite::Paragraph::new();
        heading.style = Some("Heading1".to_string());
        heading.add_run(docx_lite::Run::new("Section One".to_string()));
        let mut paragraph = docx_lite::Paragraph::new();
        paragraph.add_run(docx_lite::Run::new("Body text".to_string()));
        let mut cell = docx_lite::TableCell::default();
        let mut cell_paragraph = docx_lite::Paragraph::new();
        cell_paragraph.add_run(docx_lite::Run::new("Cell value".to_string()));
        cell.paragraphs.push(cell_paragraph);
        let table = docx_lite::Table {
            rows: vec![docx_lite::TableRow { cells: vec![cell] }],
        };
        document.paragraphs.push(heading);
        document.paragraphs.push(paragraph);
        document.tables.push(table);

        let markdown = docx_document_to_markdown(&docx_path, &document).expect("format docx");

        assert!(markdown.contains("source_docx: \"sample.docx\""));
        assert!(markdown.contains("## Section One"));
        assert!(markdown.contains("Body text"));
        assert!(markdown.contains("| Cell value |"));
        assert!(markdown.contains("| --- |"));
    }

    #[test]
    fn detects_docx_report_headings_without_word_styles() {
        let root = fixture_root();
        let docx_path = root.join("thesis.docx");
        let mut document = docx_lite::Document::new();
        for text in [
            "摘要",
            "Abstract",
            "目录",
            "第1章绪论1",
            "1.1选题背景1",
            "2.1.1 Spring Boot3",
            "正文内容",
        ] {
            let mut paragraph = docx_lite::Paragraph::new();
            paragraph.add_run(docx_lite::Run::new(text.to_string()));
            document.paragraphs.push(paragraph);
        }

        let markdown = docx_document_to_markdown(&docx_path, &document).expect("format docx");

        assert!(markdown.contains("## 摘要"));
        assert!(markdown.contains("## Abstract"));
        assert!(markdown.contains("## 目录"));
        assert!(markdown.contains("- 第1章绪论"));
        assert!(markdown.contains("- 1.1选题背景"));
        assert!(markdown.contains("- 2.1.1 Spring Boot"));
        assert!(markdown.contains("正文内容"));
    }

    #[test]
    fn parses_structured_docx_xml_with_styles_lists_and_tables() {
        use std::io::Write;

        let root = fixture_root();
        let docx_path = root.join("structured.docx");
        let file = fs::File::create(&docx_path).expect("create docx");
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::FileOptions::default();
        zip.start_file("word/document.xml", options).expect("document entry");
        zip.write_all(
            br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Intro</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>List item</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>"#,
        )
        .expect("write document");
        zip.start_file("word/styles.xml", options).expect("styles entry");
        zip.write_all(
            br#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
</w:styles>"#,
        )
        .expect("write styles");
        zip.start_file("word/numbering.xml", options).expect("numbering entry");
        zip.write_all(
            br#"<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
<w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num>
</w:numbering>"#,
        )
        .expect("write numbering");
        zip.finish().expect("finish docx");

        let converted = convert_docx_to_markdown(&docx_path).expect("convert docx");

        let heading_index = converted.markdown.find("## Intro").expect("heading");
        let list_index = converted.markdown.find("1. List item").expect("list");
        let table_index = converted.markdown.find("| A | B |").expect("table");
        assert!(heading_index < list_index);
        assert!(list_index < table_index);
    }

    #[test]
    fn extracts_structured_docx_images_to_assets() {
        use std::io::Write;

        let root = fixture_root();
        let docx_path = root.join("with-image.docx");
        let file = fs::File::create(&docx_path).expect("create docx");
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::FileOptions::default();
        zip.start_file("word/document.xml", options).expect("document entry");
        zip.write_all(
            br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p><w:r><w:t>Intro</w:t></w:r></w:p>
<w:p><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p>
</w:body></w:document>"#,
        )
        .expect("write document");
        zip.start_file("word/_rels/document.xml.rels", options).expect("rels entry");
        zip.write_all(
            br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>"#,
        )
        .expect("write rels");
        zip.start_file("word/media/image1.png", options).expect("image entry");
        zip.write_all(&[0x89, 0x50, 0x4e, 0x47]).expect("write image");
        zip.finish().expect("finish docx");

        let assets_dir = root.join("imports").join("docx").join("with-image.assets");
        let converted = convert_docx_to_markdown_with_assets(
            &docx_path,
            Some(DocxImageExport {
                assets_dir: assets_dir.clone(),
                relative_dir: "with-image.assets".to_string(),
            }),
        )
        .expect("convert docx");

        assert_eq!(converted.image_count, 1);
        assert!(converted.markdown.contains("![image](with-image.assets/image1.png)"));
        assert!(assets_dir.join("image1.png").exists());
    }

    #[test]
    fn imports_without_workspace_use_pdf_parent() {
        let root = fixture_root();
        let pdf_path = root.join("sample.pdf");
        fs::write(&pdf_path, b"not a real pdf").expect("write pdf placeholder");

        let resolved = resolve_import_workspace("", &pdf_path).expect("resolve parent");

        assert_eq!(resolved, root);
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
        scan_workspace(root.to_string_lossy().to_string()).expect("register root");

        let inserted = insert_image_asset(InsertImageAssetRequest {
            article_path: article_path.to_string_lossy().to_string(),
            image_path: image_path.to_string_lossy().to_string(),
        })
        .expect("insert image");

        assert_eq!(inserted.relative_path, "note-assets/source-image.png");
        assert_eq!(
            inserted.markdown,
            "![source image](note-assets/source-image.png)"
        );
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
        scan_workspace(root.to_string_lossy().to_string()).expect("register root");

        let preview = preview_markdown_content(PreviewMarkdownRequest {
            article_path: article_path.to_string_lossy().to_string(),
            content: "![image](note-assets/image.png)".to_string(),
        })
        .expect("preview markdown");

        assert!(preview.contains("data:image/png;base64,"));
    }

    #[test]
    fn uses_registered_workspace_root_for_nested_exports() {
        let root = fixture_root();
        let nested_workspace = root.join("articles").join("drafts");
        let article_path = nested_workspace.join("sample.md");
        scan_workspace(nested_workspace.to_string_lossy().to_string())
            .expect("register nested root");

        let export_root = workspace_root_for_article(&article_path).expect("resolve export root");

        assert_eq!(
            export_root,
            fs::canonicalize(nested_workspace).expect("canonical nested root")
        );
    }

    #[test]
    fn rejects_article_reads_outside_registered_workspace() {
        let root = std::env::temp_dir().join(format!(
            "tauri-reader-scoped-root-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        let outside = std::env::temp_dir().join(format!(
            "tauri-reader-scoped-outside-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create root");
        fs::create_dir_all(&outside).expect("create outside");
        fs::write(root.join("note.md"), "# Note").expect("write note");
        let outside_article = outside.join("outside.md");
        fs::write(&outside_article, "# Outside").expect("write outside");
        scan_workspace(root.to_string_lossy().to_string()).expect("register root");

        let result = read_article(outside_article.to_string_lossy().to_string());

        assert!(
            result.is_err(),
            "unregistered markdown path should be rejected"
        );
    }
}
