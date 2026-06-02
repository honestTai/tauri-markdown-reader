# Changelog

## v0.1.3 - 2026-06-02

### Added

- Chinese / English UI switching for operation buttons, panels, style labels, and common notices.
- Public README screenshots for both Chinese and English UI.
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
- Removed the WeChat-width reading tab to keep the app focused on desktop reading.
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
