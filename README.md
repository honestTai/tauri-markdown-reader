# Markdown Reader

Local-first Markdown reader and exporter built with Tauri, React, and TypeScript.

Markdown Reader is designed for people who write long Markdown articles with screenshots, outlines, and delivery files. It focuses on a small desktop workflow: open a Markdown file or folder, read it comfortably, edit the source, manage local images, then export Word/PDF/HTML without asking users to install extra converters.

## Why It Is Different

- Local Markdown files stay as normal files. Images are copied into a sibling `<article>-assets/` folder and inserted as relative Markdown paths.
- Outline navigation is part of the reading surface. Click a heading in the right panel to jump to that section.
- Export is intentionally quiet. Word and PDF are the primary actions; HTML output stays in an advanced section.
- Word/PDF export is bundled in the app. It does not rely on Pandoc, LaTeX, Microsoft Word, or external tools on the user's computer.
- Markdown styles are visible before export. Switching a style updates the reading preview and the exported Word/PDF typography.

## New In v0.1.2

- Added one-click outline navigation.
- Added local image insertion for Markdown editing.
- Added image support in Word and PDF exports.
- Added bundled Chinese PDF font support.
- Added automatic opening after exporting Word, PDF, and HTML files.
- Added Markdown style presets with live preview updates.
- Simplified the export panel so Word/PDF are primary and HTML is secondary.
- Removed the WeChat-width reading tab and kept the interface closer to a clean desktop reader.
- Removed fragile rich-editor loading and switched editing to a stable Markdown source editor.

## 中文摘要

Markdown Reader 是一个本地优先的 Markdown 桌面阅读、编辑和导出工具。它适合写长文、教程、产品说明或带大量截图的 Markdown 文档。

v0.1.2 新增了大纲点击跳转、本地图片插入、Word/PDF 图片导出、导出后自动打开文件，以及 10 多种 Markdown 样式的实时预览。现在导出区只把 Word/PDF 作为主操作，HTML 放到高级输出里，整体更像一个简单清爽的开源桌面工具。

## Features

- Open a Markdown folder or a single Markdown file.
- Scan workflow folders such as `articles/drafts`, `articles/wemd-inbox`, and `articles/approved`.
- Read Markdown in a wide desktop layout.
- Edit Markdown source with save support.
- Insert local images into article-adjacent assets folders.
- Click outline entries to jump to headings.
- Export Word `.docx` with headings, lists, code, styles, and images.
- Export PDF with bundled font support and images.
- Copy Markdown.
- Copy or save reading HTML and WeChat-ready HTML from the advanced export section.
- Automatically open exported files after saving.

## Download

Release builds are published on GitHub Releases:

[Download the latest release](https://github.com/honestTai/tauri-markdown-reader/releases/latest)

Current build targets:

- Windows x64: `.exe` and `.msi`
- macOS Intel: `.app.tar.gz`
- macOS Apple Silicon: `.app.tar.gz`

If the macOS build is not Apple-signed or notarized, the first launch may require right-clicking the app in Finder and choosing "Open".

## Local Development

```bash
npm ci
npm run tauri:dev
```

## Local Build

```bash
npm run tauri:build
```

Local Windows builds require Rust/Cargo and Microsoft C++ Build Tools. Local macOS builds require Rust/Cargo, Xcode Command Line Tools, and a macOS environment.

## Release

Push a `v*` tag to create a GitHub Release:

```bash
git tag v0.1.2
git push origin main v0.1.2
```

The workflow builds Windows installers plus macOS Intel / Apple Silicon `.app` archives, then uploads them to the matching GitHub Release.

## Visibility Notes

If the project has no stars or forks yet, that does not necessarily mean the product idea is weak. For small open-source desktop tools, discovery usually depends on:

- a clear screenshot or GIF in the README;
- an obvious "why this instead of MarkText/Zettlr/Joplin" section;
- release assets that are easy to install;
- topic tags such as `markdown`, `tauri`, `desktop-app`, `pdf-export`, `docx`, `local-first`;
- short examples showing image insertion and Word/PDF export results;
- posts on GitHub, X/Twitter, Reddit, Hacker News, V2EX, or developer communities.

The current differentiator is local-first Markdown writing with asset folders and bundled Word/PDF export. A short demo GIF would likely help more than adding another feature right now.

## License

This project is open-sourced under the MIT License. See [LICENSE](LICENSE).
