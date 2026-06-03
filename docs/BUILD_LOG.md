# Build Log

## 2026-06-03 V2 Reader Implementation

- Reframed the app as a local Markdown reader and document library.
- Added local reader state storage for recent workspaces, recent files, favorites, pinned documents, reading positions, focus mode, and settings.
- Added full-text search across Markdown filenames, titles, frontmatter, and body text.
- Added snippets, heading context, and direct document opening from search results.
- Added document list filters, relative paths, and sorting controls.
- Added startup restore for the last workspace and document.
- Added per-document scroll memory and a back-to-top action.
- Added configurable focus mode with optional outline.
- Added settings for default workspace, default read mode, default export style, startup restore, scroll memory, focus outline, and language.
- Added save-before backup for Markdown edits.
- Added missing-image detection, path copying, and large image preview.
- Kept Word, PDF, Markdown copy, plain-text copy, and reading HTML output.
- Removed legacy platform-output UI and checks from the V2 product surface.
