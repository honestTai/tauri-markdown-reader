# Markdown Reader v0.3.0

V3 focuses on import, export, image handling, and a stable GUI + CLI workflow.

## Highlights

- PDF to Markdown draft import.
- DOCX to Markdown draft import with headings, lists, tables, and images where possible.
- DOCX images are exported into editable `.assets` folders.
- Edit mode supports local image insertion, dropped images, and pasted screenshots.
- Drag folders, Markdown, PDF, DOCX, or image files into the app.
- Export Word, PDF, reading HTML, Markdown, plain text, and copied HTML.
- GUI installs include `md-reader.exe` for system terminals, Codex, and other Agent tools.
- New README GIF covering basic operation, import, and export.

## Note About Terminal

The experimental embedded terminal was removed in V3. The backend input path worked, but cursor rendering in the Tauri WebView2/xterm chain was not reliable enough for a production UI. Future Agent/V4 integration should call the external CLI first.

## Windows Assets

- `Markdown Reader_0.3.0_x64-setup.exe`
- `Markdown Reader_0.3.0_x64_en-US.msi`

## Verification

- `pnpm run lint`
- `pnpm run build`
- `cargo test`
- `pnpm run tauri:build`
