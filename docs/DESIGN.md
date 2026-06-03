# Markdown Reader V2 Design Notes

The V2 interface keeps the three-column workbench but changes the product center of gravity to reading and retrieval.

## Layout

- Top bar: workspace picker, library/panel toggles, focus mode, open folder, open file, quick open, refresh, back to top, save.
- Left library: search, filters, sorting, pinned documents, favorites, recent documents, and relative paths.
- Center reader: reading, source, and edit modes.
- Right panel: outline, document statistics, image status, copy/export actions, and settings.

## Interaction

- Search uses a single input for quick library filtering and full-text search.
- Full-text results show document title, path context, heading context, and a snippet.
- Focus mode hides the library; the outline can stay visible based on the setting.
- Rendered images open in a larger preview when clicked.
- Switching documents while dirty asks for confirmation.

## Visual Direction

- Quiet document-tool layout, not a landing page.
- Light gray app background and white reading surfaces.
- Thin borders, 8px-or-less radii, compact controls, and high scan density.
- Icon buttons for repeated actions.
- Text should stay inside buttons and list rows across desktop and mobile widths.
