export type ArticleStatus = 'draft' | 'inbox' | 'approved' | 'document'

export interface ArticleSummary {
  path: string
  file_name: string
  title: string
  digest: string
  group: string
  status: ArticleStatus
  updated: number
}

export interface ArticlePayload {
  path: string
  base_dir: string
  content: string
  preview_content: string
}

export type PanelTab = 'outline' | 'exports'

export type ReadMode = 'desktop' | 'source' | 'edit'

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

export interface WechatRenderOptions {
  theme: MarkdownThemeId
  codeStyle: CodeBlockStyleId
}

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

export interface CheckItem {
  level: 'error' | 'warning' | 'info' | 'pass'
  title: string
  detail: string
}
