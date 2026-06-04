# Markdown Reader

**中文** | [English](README.en.md)

[![Release](https://img.shields.io/github/v/release/honestTai/tauri-markdown-reader?label=release)](https://github.com/honestTai/tauri-markdown-reader/releases/latest)
[![License](https://img.shields.io/github/license/honestTai/tauri-markdown-reader)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/Tauri-2.x-24c8db)](https://tauri.app/)

不用打开 IDE 的本地项目 Markdown 文档库。

Markdown Reader 适合阅读项目里的 PRD、README、技术方案、会议记录、排障笔记和个人知识库。你可以打开一个 Markdown 目录或单个 `.md` 文件，把零散文档整理成可搜索、可收藏、可置顶、可导出的本地资料库。

它不是又一个 Markdown 编辑器，也不是云端笔记平台。它更像一个安静的桌面阅读工作台：文件留在本地，正文可以全文搜索，大纲可以快速跳转，阅读位置可以自动恢复，轻量编辑和 Word/PDF/HTML 导出也都放在手边。

## 运行演示

![Markdown Reader 运行演示](docs/assets/markdown-reader-demo.gif)

## 最新能力

- 本地文档库：打开目录或单个 Markdown 文件，递归扫描常规文档目录，并自动忽略构建目录。
- 全文搜索：覆盖文件名、标题、frontmatter、正文和片段预览，搜索结果可直接打开命中文档。
- 快速打开：独立于侧栏搜索的 quick open，适合在大量文档中快速跳转。
- 阅读体验：三栏工作台、右侧大纲、字数统计、阅读时间、图片资源状态和每篇文档的滚动位置记忆。
- 收藏和置顶：状态保存在应用数据中，不会修改原 Markdown 文件。
- 专注模式：可隐藏文档库，并按设置保留或隐藏右侧大纲。
- 轻量编辑：支持源码编辑、未保存提示、保存前备份、本地图片插入和自动预览。
- 多格式导出：支持 Word `.docx`、PDF、Markdown、纯文本和阅读 HTML。
- 中英文界面：应用内可在中文和英文 UI 之间切换。
- 安全加固：Markdown 渲染经过 DOMPurify 净化，Tauri 使用严格 CSP，文件命令限制在已注册 Markdown 工作区内。
- 自动检查：CI 覆盖前端 lint/build/audit，以及 Rust fmt/clippy/test。

## 为什么不是 Typora / Obsidian / VS Code

这些工具都很好，但 Markdown Reader 解决的是另一个问题：

- Typora 更适合专注写作，Markdown Reader 更适合把一个项目目录当资料库阅读和检索。
- Obsidian 更适合个人知识库和双链笔记，Markdown Reader 更适合直接打开现有代码仓库、交付目录或文档目录。
- VS Code 更适合开发，Markdown Reader 更适合不用进入 IDE 就快速阅读 PRD、README、排障记录和技术方案。
- Markdown Reader 的核心不是“写一篇 Markdown”，而是“快速找到、读懂、复用和导出一堆已有 Markdown 文档”。

## 截图

### 中文界面

![Markdown Reader 中文界面](docs/assets/markdown-reader-zh.png)

### 英文界面

![Markdown Reader 英文界面](docs/assets/markdown-reader-en.png)

## 适合场景

- 管理项目 README、PRD、技术方案和版本说明。
- 阅读会议记录、排障记录、复盘文档和交付材料。
- 在不打开 IDE 的情况下浏览代码仓库里的 Markdown 文档。
- 把本地 Markdown 知识库整理成可检索的桌面资料库。
- 将 Markdown 内容快速导出为 Word、PDF 或阅读 HTML。

## 适合谁

- 程序员：快速查 README、设计文档、排障记录和代码仓库里的 Markdown 资料。
- 产品经理：集中阅读 PRD、需求说明、会议记录和交付文档。
- 技术写作者：管理本地 Markdown 草稿，并导出 Word、PDF 或 HTML。
- 团队负责人：把项目文档目录当成本地资料库浏览，不被 IDE 和代码细节打断。

## 下载

发布包会上传到 GitHub Releases：

[下载最新版本](https://github.com/honestTai/tauri-markdown-reader/releases/latest)

当前构建目标：

- Windows x64：`.exe` 和 `.msi`
- macOS Intel：`.app.tar.gz`
- macOS Apple Silicon：`.app.tar.gz`

如果 macOS 构建未经过 Apple 签名或公证，首次启动时可能需要在 Finder 中右键应用并选择“打开”。

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
git tag v0.2.0
git push origin main v0.2.0
```

工作流会构建 Windows 安装包和 macOS Intel / Apple Silicon `.app` 归档，并上传到对应的 GitHub Release。

## 宣传素材

中文宣传文案和素材路径见 [docs/PROMOTION.md](docs/PROMOTION.md)。

## License

本项目基于 MIT License 开源，详见 [LICENSE](LICENSE)。
