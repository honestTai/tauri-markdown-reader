# Markdown Reader

**中文** | [English](README.en.md)

[![Release](https://img.shields.io/github/v/release/honestTai/tauri-markdown-reader?label=release)](https://github.com/honestTai/tauri-markdown-reader/releases/latest)
[![License](https://img.shields.io/github/license/honestTai/tauri-markdown-reader)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/Tauri-2.x-24c8db)](https://tauri.app/)

一个本地优先的 Markdown 文档库，用来阅读、整理、导入和导出项目文档。

Markdown Reader 不是云端笔记，也不是重型 IDE。它更像一个桌面文档工作台：打开一个项目目录或单个 Markdown 文件，就能搜索 README、PRD、会议记录、排障笔记、技术方案和交付材料。文件仍然留在本地磁盘上，应用只负责阅读、轻编辑、导入转换和导出。

## 运行演示

![Markdown Reader 运行演示](docs/assets/markdown-reader-demo.gif)

## V3.5 重点

- 打开目录或单个 Markdown 文件，自动递归扫描常见文档目录。
- 全文搜索文件名、标题、frontmatter 和正文片段。
- 快速打开、最近文件、收藏、置顶和每篇文档滚动位置记忆。
- 修复资料库里收藏、置顶等行操作图标在部分环境下不可见的问题。
- 增加文档锁定，锁定后可读但不能误保存、插图或恢复历史。
- 增加编辑历史面板，可预览和恢复保存前备份。
- 阅读、编辑两种主视图；编辑模式就是 Markdown 源码视图，保存前自动备份。
- 编辑器支持选区快捷键，可快速插入加粗、链接、公式、表格、代码块和 Mermaid 图表。
- 技术文档增强渲染：代码高亮、代码复制、KaTeX 公式、Mermaid 图表、GFM 表格和 GitHub 风格 callout。
- 帮助窗口内置 Markdown 指南，点击即可在阅读区打开完整使用手册。
- 本地图片插入、截图粘贴、图片拖入和缺失图片检查。
- PDF 转 Markdown 草稿，适合可复制文本 PDF。
- DOCX 转 Markdown 草稿，尽量保留标题、列表、表格和图片。
- 拖入文件夹、Markdown、PDF、DOCX 或图片时按类型自动处理。
- 导出 Word、PDF、阅读 HTML，也支持复制 Markdown、纯文本和 HTML。
- GUI 安装包内置 `md-reader` CLI（Windows 为 `md-reader.exe`），可被系统终端、Codex 或其他 Agent 调用。
- 中英文界面切换。
- DOMPurify Markdown 净化、严格 CSP 和工作区文件范围限制。

V3 不再保留内置终端。真实终端在 Tauri WebView2/xterm 渲染链上不够稳定，后续 Agent/V4 会优先走外部 CLI。

## 截图

### 中文界面

![Markdown Reader 中文界面](docs/assets/markdown-reader-zh.png)

### 英文界面

![Markdown Reader 英文界面](docs/assets/markdown-reader-en.png)

## 适合场景

- 不打开 IDE，快速阅读项目 README、PRD、技术方案和版本说明。
- 在交付目录里搜索会议记录、排障记录、复盘文档和客户资料。
- 把本地 Markdown 知识库整理成可检索、可收藏、可导出的资料库。
- 阅读带代码、公式、表格和 Mermaid 图表的技术文档。
- 用快捷键快速整理 Markdown 结构，例如公式、表格、代码块、任务列表和图表。
- 把 PDF 或 DOCX 先转成 Markdown 草稿，再继续编辑。
- 把 Markdown 内容交付为 Word、PDF 或阅读 HTML。
- 让 Codex、Claude Code 等工具用 CLI 读取、转换和搜索本地文档。

## 下载

发布包上传到 GitHub Releases：

[下载最新版本](https://github.com/honestTai/tauri-markdown-reader/releases/latest)

当前构建目标：

- Windows x64：NSIS `.exe` 安装包和 `.msi`
- macOS Apple Silicon / M 系列：`.app.tar.gz`

macOS 只发布 Apple Silicon / M 系列版本，不再支持 Intel 版安装包。如果 macOS 构建未经过 Apple 签名或公证，首次启动时可能需要在 Finder 中右键应用并选择“打开”。

## CLI

GUI 安装包会一起放入 `md-reader` CLI（Windows 为 `md-reader.exe`）。也可以在本地构建后直接调用：

```bash
cargo build --manifest-path src-tauri/Cargo.toml --release --bin md-reader
src-tauri/target/release/md-reader list ./docs --json
src-tauri/target/release/md-reader import input.docx --to md --out ./output --json
src-tauri/target/release/md-reader convert input.docx --to md --out ./output --json
src-tauri/target/release/md-reader export ./docs/example.md --to html --out ./exports --json
src-tauri/target/release/md-reader export ./docs/example.md --to txt --out ./exports --json
src-tauri/target/release/md-reader inspect input.pdf --json
src-tauri/target/release/md-reader search ./docs --query "关键词" --json
src-tauri/target/release/md-reader read ./docs/example.md --json
src-tauri/target/release/md-reader save ./docs/example.md --in ./draft.md --json
src-tauri/target/release/md-reader history ./docs/example.md --json
src-tauri/target/release/md-reader history-read ./docs/example.md --history ./docs/.reader-backups/example-xxx.md --json
src-tauri/target/release/md-reader restore ./docs/example.md --history ./docs/.reader-backups/example-xxx.md --json
```

DOCX 转换会把图片输出到 Markdown 同名 `.assets` 目录，方便后续继续编辑或交给本地 Agent 处理。CLI 导出支持 `md`、`txt`、`html`；Word/PDF 富导出仍在 GUI 中完成。`save`、`history`、`restore` 复用 GUI 的保存前版本目录，写入或恢复前会先备份当前内容。

## 本地开发

```bash
pnpm install
pnpm run tauri:dev
```

## 本地构建

```bash
pnpm run tauri:build
```

Windows 本地构建需要 Rust/Cargo 和 Microsoft C++ Build Tools。macOS 本地构建需要 Rust/Cargo、Xcode Command Line Tools 和 macOS 环境。

## 发布

推送 `v*` tag 会创建 GitHub Release：

```bash
git tag v3.5
git push origin main v3.5
```

工作流会构建 Windows 安装包和 macOS Apple Silicon / M 系列 `.app` 归档，并上传到对应 Release。当前 Windows 本地包也会手动上传到 Release assets。

## 宣传素材

中文宣传文案和素材路径见 [docs/PROMOTION.md](docs/PROMOTION.md)。

## License

本项目基于 MIT License 开源，详见 [LICENSE](LICENSE)。
