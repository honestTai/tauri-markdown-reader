# Markdown Reader

[中文](README.md) | **English**

Local-first desktop Markdown reader and document library built with Tauri, React, and TypeScript.

Markdown Reader is for reading project documents, PRDs, README files, meeting notes, troubleshooting records, and personal knowledge bases. Open a Markdown folder or a single `.md` file, then turn scattered files into a searchable, pinnable, exportable local document library.

It is not a cloud note-taking platform or an IDE replacement. It is a calm desktop reading workbench: files stay local, body text is searchable, outlines are clickable, reading positions are restored, and light editing plus Word/PDF/HTML export are always close by.

## Demo

![Markdown Reader running demo](docs/assets/markdown-reader-demo.gif)

## Latest Capabilities

- Local document library: open a folder or a single Markdown file, recursively scan regular document folders, and ignore build directories.
- Full-text search: search filenames, titles, frontmatter, body text, and snippets, then open matched documents directly.
- Quick open: a dedicated quick-open flow isolated from sidebar search for fast document jumps.
- Reading experience: three-column workbench, right-side outline, word count, reading time, image resource status, and per-document scroll memory.
- Favorites and pinned documents: stored in app state without changing source Markdown files.
- Focus mode: hide the library and optionally keep the right outline panel.
- Light editing: source editing, unsaved-change prompts, save-before backup, local image insertion, and live preview.
- Multiple exports: Word `.docx`, PDF, Markdown, plain text, and reading HTML.
- Chinese and English UI: switch the application interface between Chinese and English.
- Security hardening: Markdown rendering is sanitized with DOMPurify, Tauri uses a restrictive CSP, and file commands are scoped to registered Markdown workspaces.
- Automated checks: CI covers frontend lint/build/audit and Rust fmt/clippy/test.

## Screenshots

### Chinese UI

![Markdown Reader Chinese UI](docs/assets/markdown-reader-zh.png)

### English UI

![Markdown Reader English UI](docs/assets/markdown-reader-en.png)

## Use Cases

- Manage project README files, PRDs, technical plans, and changelogs.
- Read meeting notes, troubleshooting logs, retrospectives, and delivery documents.
- Browse Markdown documentation in a code repository without opening an IDE.
- Turn a local Markdown knowledge base into a searchable desktop library.
- Export Markdown content to Word, PDF, or reading HTML.

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
pnpm install
pnpm run tauri:dev
```

## Local Build

```bash
pnpm run tauri:build
```

Local Windows builds require Rust/Cargo and Microsoft C++ Build Tools. Local macOS builds require Rust/Cargo, Xcode Command Line Tools, and a macOS environment.

## Release

Push a `v*` tag to create a GitHub Release:

```bash
git tag v0.2.0
git push origin main v0.2.0
```

The workflow builds Windows installers plus macOS Intel / Apple Silicon `.app` archives, then uploads them to the matching GitHub Release.

## Promotion Assets

Chinese launch copy and asset references are in [docs/PROMOTION.md](docs/PROMOTION.md).

## License

This project is open-sourced under the MIT License. See [LICENSE](LICENSE).
