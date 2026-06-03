# Markdown Reader V2 PRD

Markdown Reader V2 is a local Markdown reading and document-retrieval workstation.

## Product Goal

- Make local Markdown folders feel like a small document library.
- Restore the last workspace, document, mode, and reading position on startup.
- Search filenames, titles, frontmatter, and body text.
- Keep reading first; editing and exporting are supporting actions.
- Store app metadata locally without modifying user Markdown files.

## V2 Scope

- Recent workspaces and recent files.
- Full-text search with snippets and direct document open.
- Per-document reading position memory.
- Favorites and pinned documents.
- Sortable and filterable document list with relative paths.
- Focus reading mode with optional outline.
- Light Markdown source editing with unsaved prompts and save-before backups.
- Local image insertion, missing-image status, and large image preview.
- Word/PDF export, Markdown copy, plain-text copy, and reading HTML output.
- Settings for default workspace, default read mode, default export style, startup restore, scroll memory, focus outline, and language.

## Information Architecture

- Left: document library, search, filters, favorites, pinned docs, recent docs.
- Center: reading, source, and edit modes.
- Right: outline, document information, image status, copy/export actions, settings.

## Storage

Reader state is saved in the app config directory as `reader-state-v2.json`.

The saved state includes:

- Recent workspaces.
- Recent files.
- Favorites.
- Pinned files.
- Reading positions.
- Last workspace and file.
- User settings.

Markdown documents are not changed when a document is favorited or pinned.
