# Markdown Reader / Markdown 本地阅读器

## 中文

Markdown Reader 是一个基于 Tauri、React 和 TypeScript 的本地桌面阅读器，用来在电脑上阅读、编辑和预览 Markdown 文章。它特别适合公众号、小红书或其他长文内容的本地整理流程。

### 功能

- 打开本地 Markdown 文件夹并自动扫描文章。
- 提供电脑阅读、公众号宽度、源码和编辑视图。
- 支持富文本编辑器，异常时会回退到 Markdown 源码编辑。
- 可复制或保存公众号 HTML。
- 自动检查标题、摘要、图片和正文结构。
- GitHub Actions 自动打包 Windows 和 macOS 版本。

### 下载

发布版本会上传到 GitHub Releases：

[下载最新版本](https://github.com/honestTai/tauri-markdown-reader/releases/latest)

当前自动构建目标：

- Windows x64：`.exe` 和 `.msi`
- macOS Intel：`.app.tar.gz`
- macOS Apple Silicon：`.app.tar.gz`

macOS 版本未做 Apple 签名和公证时，首次打开可能需要在 Finder 中右键应用并选择“打开”。

### 本地开发

```bash
npm ci
npm run tauri:dev
```

### 本地构建

```bash
npm run tauri:build
```

Windows 本地构建需要 Rust/Cargo 和 Microsoft C++ Build Tools。macOS 本地构建需要 Rust/Cargo、Xcode Command Line Tools，以及 macOS 系统环境。

### 发布

推送 `v*` 标签会触发 Release：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流会构建 Windows 安装包，以及 macOS Intel / Apple Silicon `.app` 压缩包，并上传到对应 GitHub Release。

## English

Markdown Reader is a local desktop reader built with Tauri, React, and TypeScript. It helps you read, edit, and preview Markdown articles on desktop, especially for WeChat Official Account, Xiaohongshu, and other long-form content workflows.

### Features

- Open a local Markdown folder and scan articles automatically.
- Switch between desktop reading, WeChat-width preview, source, and editing views.
- Use a rich Markdown editor with a source editor fallback.
- Copy or save WeChat-ready HTML.
- Check title, digest, images, and article structure.
- Package Windows and macOS builds automatically with GitHub Actions.

### Download

Release builds are published on GitHub Releases:

[Download the latest release](https://github.com/honestTai/tauri-markdown-reader/releases/latest)

Current build targets:

- Windows x64: `.exe` and `.msi`
- macOS Intel: `.app.tar.gz`
- macOS Apple Silicon: `.app.tar.gz`

If the macOS build is not Apple-signed or notarized, the first launch may require right-clicking the app in Finder and choosing "Open".

### Local Development

```bash
npm ci
npm run tauri:dev
```

### Local Build

```bash
npm run tauri:build
```

Local Windows builds require Rust/Cargo and Microsoft C++ Build Tools. Local macOS builds require Rust/Cargo, Xcode Command Line Tools, and a macOS environment.

### Release

Push a `v*` tag to create a GitHub Release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds Windows installers plus macOS Intel / Apple Silicon `.app` archives, then uploads them to the matching GitHub Release.
