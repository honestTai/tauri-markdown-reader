# Markdown Reader

**中文** | [English](README.en.md)

本地优先的桌面 Markdown 阅读器和文档资料库，使用 Tauri、React 和 TypeScript 构建。

Markdown Reader 适合阅读项目文档、PRD、README、会议记录、排障笔记和个人知识库。你可以打开一个 Markdown 目录或单个 `.md` 文件，把零散文档整理成可搜索、可收藏、可置顶、可导出的本地资料库。

它不是一个云端笔记平台，也不是 IDE 的替代品。它更像一个安静的桌面阅读工作台：文件留在本地，正文可以全文搜索，大纲可以快速跳转，阅读位置可以自动恢复，轻量编辑和 Word/PDF/HTML 导出也都放在手边。

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
