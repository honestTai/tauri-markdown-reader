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

export type PanelTab = 'wechat' | 'checks'

export type ReadMode = 'desktop' | 'wechat' | 'source' | 'edit'

export type FocusPreviewMode = 'desktop' | 'wechat'

export interface ParsedArticle {
  title: string
  digest: string
  body: string
}

export interface CheckItem {
  level: 'error' | 'warning' | 'info' | 'pass'
  title: string
  detail: string
}
