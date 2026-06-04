# Changelog

## Unreleased

### Added

- Added a running demo GIF for README and promotional use.
- Added bilingual README files with Chinese / English language switching.
- Added bilingual promotion copy for launch sharing.
- Added CI coverage for frontend lint/build/audit and Rust fmt/clippy/test.
- Added a Chinese promotion note with short launch copy and asset references.

### Changed

- Split the React app into focused reader, library, quick-open, export, i18n, and search modules.
- Refreshed README content to match the latest Markdown library, search, export, security, and CI capabilities.
- Hardened Markdown rendering with DOMPurify and restored a restrictive Tauri CSP.
- Scoped Tauri file commands to registered Markdown workspaces.

## v0.2.0 - 2026-06-03

### Added

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
