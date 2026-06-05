# Markdown Reader v3.5

This release focuses on Markdown rendering polish, safer editing, richer CLI workflows, and the GitHub issue #2 icon fix.

## Fixed

- Fixed favorite and pinned document row action icons that could appear invisible in the document library.
- The library row tools now use explicit fixed-size Lucide icons and SVG styling so favorite, pinned, and lock actions remain visible.

## Added

- Syntax-highlighted code blocks with copy buttons.
- KaTeX inline and block formulas.
- Mermaid diagram rendering.
- GFM table styling and GitHub-style callouts.
- Editor shortcuts and selection actions for bold, italic, links, math, tables, code blocks, Mermaid diagrams, quotes, lists, and tasks.
- Built-in Chinese and English Markdown guides opened from the Help window.
- Document locking to prevent accidental save, image insertion, and history restore on protected files.
- Edit history listing, preview, and restore for save-before-backup versions.
- CLI coverage for list, import/convert, export to md/txt/html, inspect, search, read, save with backup, history-read, and restore.

## Changed

- The library and history panels now open as floating panels, keeping the reader canvas cleaner.
- The main document modes are Read and Edit, with Markdown source editing kept as the stable editing surface.
- Search results now highlight matched text and show line numbers.

## Windows Assets

- `Markdown Reader_3.5.0_x64-setup.exe`
- `Markdown Reader_3.5.0_x64_en-US.msi`

## macOS Assets

- Apple Silicon / M-series only: `Markdown-Reader_3.5_macos-apple-silicon.app.tar.gz`
- Intel Mac builds are not shipped.

## Verification

- `pnpm lint`
- `pnpm build`
- `cargo test --all`
- `pnpm run tauri:build`
