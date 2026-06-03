export type ArticleStatus = 'document'

export interface ArticleSummary {
  path: string
  file_name: string
  title: string
  digest: string
  group: string
  status: ArticleStatus
  updated: number
  relative_path: string
}

export interface ArticlePayload {
  path: string
  base_dir: string
  content: string
  preview_content: string
  missing_images: MissingImage[]
}

export type PanelTab = 'outline' | 'actions' | 'settings'

export type ReadMode = 'desktop' | 'source' | 'edit'

export type SortMode = 'updated' | 'name' | 'path'

export type LibraryFilter = 'all' | 'current' | 'favorites' | 'pinned' | 'recent'

export type MarkdownThemeId = 'green' | 'ink' | 'warm'

export type CodeBlockStyleId = 'border' | 'mac' | 'plain'

export type WordStyleId =
  | 'codex'
  | 'clean'
  | 'serif'
  | 'song'
  | 'hei'
  | 'yahei'
  | 'kai'
  | 'mono'
  | 'report'
  | 'book'
  | 'compact'
  | 'presentation'

export interface ParsedArticle {
  title: string
  digest: string
  body: string
}

export interface OutlineItem {
  id: string
  level: number
  text: string
}

export interface ArticleStats {
  words: number
  headings: number
  images: number
  codeBlocks: number
  readingMinutes: number
}

export interface MissingImage {
  alt: string
  src: string
  resolved_path: string
}

export interface SearchResult {
  path: string
  file_name: string
  title: string
  relative_path: string
  heading: string
  snippet: string
  line: number
  score: number
}

export interface ReaderSettings {
  default_workspace: string
  default_read_mode: ReadMode
  default_export_style: WordStyleId
  restore_last_document: boolean
  remember_scroll_position: boolean
  focus_keep_outline: boolean
  language: 'zh' | 'en'
}

export interface ReaderState {
  recent_workspaces: string[]
  recent_files: string[]
  favorites: string[]
  pinned: string[]
  reading_positions: Record<string, number>
  last_workspace: string
  last_file: string
  last_read_mode: ReadMode
  focus_mode: boolean
  settings: ReaderSettings
}

export interface CheckItem {
  level: 'error' | 'warning' | 'info' | 'pass'
  title: string
  detail: string
}
