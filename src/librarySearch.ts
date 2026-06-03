import { displayGroupName, type Language } from './i18n'
import type {
  ArticlePayload,
  ArticleSummary,
  LibraryFilter,
  SearchResult,
  SortMode,
} from './types'

const demoUpdated = Math.floor(Date.now() / 1000)

const demoArticle: ArticleSummary = {
  path: 'demo.md',
  file_name: 'demo.md',
  title: 'Markdown Reader V2 示例',
  digest: '本地阅读、全文搜索、收藏和导出放进同一个资料浏览工作台。',
  group: '示例',
  status: 'document',
  updated: demoUpdated,
  relative_path: 'demo.md',
}

const demoSearchArticle: ArticleSummary = {
  path: 'guides/search.md',
  file_name: 'search.md',
  title: '全文搜索和快速打开',
  digest: '演示文件名、标题、正文命中以及最近文件跳转。',
  group: '文档',
  status: 'document',
  updated: demoUpdated - 7200,
  relative_path: 'guides/search.md',
}

const demoExportArticle: ArticleSummary = {
  path: 'notes/export.md',
  file_name: 'export.md',
  title: '复制与导出检查',
  digest: '演示复制 Markdown、纯文本、阅读 HTML 和导出动作。',
  group: '文档',
  status: 'document',
  updated: demoUpdated - 14400,
  relative_path: 'notes/export.md',
}

const demoPayload: ArticlePayload = {
  path: demoArticle.path,
  base_dir: '',
  missing_images: [],
  content: `---
title: Markdown Reader V2 示例
digest: 本地阅读、全文搜索、收藏和导出放进同一个资料浏览工作台。
---

## 阅读器定位

Markdown Reader V2 面向本地文档、项目 README、PRD、排障记录和技术方案。它优先解决快速回到上次工作区、搜索正文内容、沿着大纲阅读长文和轻量修改的问题。

## 全文搜索

搜索 SQL、Tauri、产品方案这类关键词时，结果不只看文件名，也会读取 Markdown 正文、frontmatter 和标题，并展示命中片段。

## 图片和代码

![系统预览](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwSxQgAAAABJRU5ErkJggg==)

\`\`\`ts
const result = await searchWorkspace('SQL')
await openDocument(result.path)
\`\`\`

## 轻编辑

编辑模式保留 Markdown 源码、保存快捷键、保存前备份和本地图片插入。阅读器的主心智仍然是看文档，不把编辑器做重。
`,
  preview_content: '',
}
demoPayload.preview_content = demoPayload.content

const demoSearchPayload: ArticlePayload = {
  path: demoSearchArticle.path,
  base_dir: '',
  missing_images: [],
  content: `---
title: 全文搜索和快速打开
digest: 演示文件名、标题、正文命中以及最近文件跳转。
---

## 搜索覆盖范围

搜索会同时覆盖文件名、标题、摘要和 Markdown 正文。比如输入 Tauri、SQL、PRD 或快速打开，都应该能看到命中片段。

## 快速打开

快速打开优先展示置顶、收藏、最近文件，然后再展示普通文档。这个顺序可以帮助用户回到正在读的资料。

## 最近文件

打开过的文档会进入最近文件。刷新页面或重启应用后，仍然应该保留最近列表和上一次打开的文档。
`,
  preview_content: '',
}
demoSearchPayload.preview_content = demoSearchPayload.content

const demoExportPayload: ArticlePayload = {
  path: demoExportArticle.path,
  base_dir: '',
  missing_images: [{ alt: 'missing', src: 'assets/missing.png', resolved_path: 'notes/assets/missing.png' }],
  content: `---
title: 复制与导出检查
digest: 演示复制 Markdown、纯文本、阅读 HTML 和导出动作。
---

## 复制动作

右侧操作面板提供 Markdown、纯文本和阅读 HTML 复制。浏览器预览模式下，保存 HTML 会提示只支持复制。

## 导出动作

Word 和 PDF 在浏览器预览模式下会下载文件；在 Tauri 桌面应用里会保存到本地导出目录并打开。

## 图片状态

![missing](assets/missing.png)

这篇文档故意保留一个缺失图片路径，用来验证右侧资源检查。
`,
  preview_content: '',
}
demoExportPayload.preview_content = demoExportPayload.content

export const demoArticles = [demoArticle, demoSearchArticle, demoExportArticle]
export const demoDefaultPayload = demoPayload

export const demoPayloads: Record<string, ArticlePayload> = {
  [demoPayload.path]: demoPayload,
  [demoSearchPayload.path]: demoSearchPayload,
  [demoExportPayload.path]: demoExportPayload,
}

export function getVisibleArticles({
  articles,
  favoriteSet,
  libraryFilter,
  pinnedSet,
  query,
  recentFileSet,
  selectedArticle,
  sortMode,
}: {
  articles: ArticleSummary[]
  favoriteSet: Set<string>
  libraryFilter: LibraryFilter
  pinnedSet: Set<string>
  query: string
  recentFileSet: Set<string>
  selectedArticle?: ArticleSummary
  sortMode: SortMode
}) {
  const normalizedQuery = query.trim().toLowerCase()
  const selectedDir = selectedArticle?.relative_path.includes('/')
    ? selectedArticle.relative_path.split('/').slice(0, -1).join('/')
    : ''
  const filtered = articles.filter((article) => {
    if (libraryFilter === 'favorites' && !favoriteSet.has(article.path)) return false
    if (libraryFilter === 'pinned' && !pinnedSet.has(article.path)) return false
    if (libraryFilter === 'recent' && !recentFileSet.has(article.path)) return false
    if (libraryFilter === 'current') {
      const articleDir = article.relative_path.includes('/')
        ? article.relative_path.split('/').slice(0, -1).join('/')
        : ''
      if (articleDir !== selectedDir) return false
    }
    if (!normalizedQuery) return true
    return `${article.title} ${article.file_name} ${article.relative_path}`.toLowerCase().includes(normalizedQuery)
  })

  return [...filtered].sort((a, b) => {
    const pinnedDelta = Number(pinnedSet.has(b.path)) - Number(pinnedSet.has(a.path))
    if (pinnedDelta) return pinnedDelta
    if (sortMode === 'name') return a.file_name.localeCompare(b.file_name, 'zh-CN')
    if (sortMode === 'path') return a.relative_path.localeCompare(b.relative_path, 'zh-CN')
    return b.updated - a.updated
  })
}

export function groupArticlesByDisplayName(
  articles: ArticleSummary[],
  pinnedSet: Set<string>,
  language: Language,
  pinnedLabel: string,
) {
  return articles.reduce<Record<string, ArticleSummary[]>>((acc, article) => {
    const group = pinnedSet.has(article.path) ? pinnedLabel : displayGroupName(article.group, language)
    acc[group] = acc[group] || []
    acc[group].push(article)
    return acc
  }, {})
}

export function searchDemoArticles(query: string, language: Language): SearchResult[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []
  return demoArticles
    .map((article) => {
      const payload = demoPayloads[article.path]
      const haystack = `${article.title} ${article.file_name} ${article.relative_path} ${article.digest} ${payload?.content || ''}`.toLowerCase()
      if (!haystack.includes(normalizedQuery)) return null
      const titleHit = article.title.toLowerCase().includes(normalizedQuery)
      const fileHit = article.file_name.toLowerCase().includes(normalizedQuery)
      return {
        path: article.path,
        file_name: article.file_name,
        title: article.title,
        relative_path: article.relative_path,
        heading: displayGroupName(article.group, language),
        snippet: makeClientSnippet(payload?.content || article.digest || article.title, normalizedQuery),
        line: 1,
        score: 1 + (titleHit ? 4 : 0) + (fileHit ? 3 : 0),
      }
    })
    .filter((result): result is SearchResult => Boolean(result))
    .sort((a, b) => b.score - a.score || a.relative_path.localeCompare(b.relative_path, 'zh-CN'))
}

export function uniqueArticles(items: ArticleSummary[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.path)) return false
    seen.add(item.path)
    return true
  })
}

export function highlightHtml(html: string, term: string) {
  if (!term) return html
  const escaped = escapeRegExp(term)
  if (!escaped) return html
  const pattern = new RegExp(`(${escaped})`, 'gi')
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') ? part : part.replace(pattern, '<mark>$1</mark>')))
    .join('')
}

export function extractImageSources(markdown: string) {
  return [...markdown.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map((match) => match[1])
    .filter((src) => !src.startsWith('data:image/'))
}

function makeClientSnippet(content: string, query: string) {
  const lower = content.toLowerCase()
  const index = lower.indexOf(query)
  if (index < 0) return content.slice(0, 120)
  return content.slice(Math.max(0, index - 42), index + 84).replace(/\s+/g, ' ')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
