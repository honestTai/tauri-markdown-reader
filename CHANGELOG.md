# Changelog

## v0.3.0 - 2026-06-04

### Added

- PDF to Markdown draft import.
- DOCX to Markdown draft import with heading, list, table, and image extraction.
- DOCX image export into adjacent `.assets` folders.
- Clipboard screenshot/image paste in edit mode.
- Drag-and-drop handling for folders, Markdown files, PDF files, DOCX files, and images.
- Built-in usage help with Chinese and English copy.
- Keyboard shortcuts for open, save, quick open, search focus, mode switching, image insertion, and PDF/DOCX import.
- Bundled the `md-reader` CLI sidecar (`md-reader.exe` on Windows) for GUI installs and local Agent workflows.
- New README demo GIF covering basic operation, import, and export.
- Hacker News Show HN submission draft.

### Changed

- Rewrote Chinese and English README files for the V3 positioning.
- Updated help copy around CLI-first Agent integration.
- Added export loading states.
- Kept the V3 application focused on a stable GUI plus external CLI instead of an embedded terminal.

### Removed

- Removed the experimental embedded xterm/PTY terminal after WebView2 cursor rendering proved unreliable.
- Removed `@xterm/*` frontend dependencies and `portable-pty` from the Tauri backend.

## v0.2.0 - 2026-06-04

### Added

- Running demo GIF for README and promotional use.
- Bilingual README files with Chinese / English language switching.
- Bilingual promotion copy for launch sharing.
- CI coverage for frontend lint/build/audit and Rust fmt/clippy/test.
- Chinese promotion note with short launch copy and asset references.
- Recent workspace and recent file persistence.
- Startup restore for the last workspace, document, read mode, focus mode, and scroll position.
- Full-text Markdown search with snippets and direct result opening.
- Favorites and pinned documents stored in local app state.
- Document list filters and sorting by updated time, filename, or path.
- Per-document scroll memory and one-click back to top.
- Focus reading mode with configurable outline visibility.
- Settings panel for default workspace, default mode, export style, restore behavior, scroll memory, focus outline, and language.
- Missing-image detection, image path copying, and large rendered-image preview.
- Plain-text copy and reading HTML copy/save actions.
- Save-before backup for Markdown edits.

### Changed

- Refined README and promotion copy around the "local project Markdown document library" positioning.
- Split the React app into focused reader, library, quick-open, export, i18n, and search modules.
- Refreshed README content to match the latest Markdown library, search, export, security, and CI capabilities.
- Hardened Markdown rendering with DOMPurify and restored a restrictive Tauri CSP.
- Scoped Tauri file commands to registered Markdown workspaces.
- Reworked the app around a local document-library reader model.
- Replaced the right export-first panel with navigation, document actions, and settings.
- Reduced editing to a supporting light-editing mode.
- Updated docs to match the V2 reader direction.

### Removed

- Legacy platform-output UI and copy.
- Platform-specific HTML actions and document checks.

## v0.1.3 - 2026-06-02

### Added

- Chinese / English UI switching for operation buttons, panels, style labels, and common notices.
- README screenshots for both Chinese and English UI.
- English names for all Markdown style presets.

### Changed

- Refined the language switcher into a compact toolbar control instead of a large segmented button.
- Reworked the README opening sections to make the local-first Word/PDF export value clearer for new visitors.

## v0.1.2 - 2026-06-02

### Added

- Clickable outline navigation for jumping to headings in the reader.
- Local image insertion in the Markdown editor.
- Article-adjacent `<article>-assets/` folders for copied image assets.
- Image rendering in Word and PDF exports.
- Bundled Chinese font loading for PDF export.
- Automatic opening after exporting Word, PDF, or HTML files.
- Markdown style presets that update the reading preview and export typography.

### Changed

- Simplified the export panel: Word/PDF are primary, HTML output is secondary.
- Removed the narrow secondary reading tab to keep the app focused on desktop reading.
- Replaced the fragile rich editor path with a stable Markdown source editor.
- Renamed the export style selector to "Markdown style" to match what it controls.

### Fixed

- Fixed Tauri export parameter mapping for binary Word/PDF saves.
- Fixed local image preview for edited Markdown before saving.
- Avoided relying on user-installed fonts or external document converters for PDF/Word export.

## v0.1.1

- Fixed rich editor code block rendering.

## v0.1.0

- Packaged the first desktop release.
