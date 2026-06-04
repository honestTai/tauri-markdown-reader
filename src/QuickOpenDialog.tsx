import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Search } from 'lucide-react'
import { displayGroupName, type Language, type UiText } from './i18n'
import { uniqueArticles } from './librarySearch'
import type { ArticleSummary, SearchResult } from './types'

export function QuickOpenDialog({
  articles,
  favoriteSet,
  language,
  pinnedSet,
  recentFiles,
  searchResults,
  text,
  onClose,
  onQueryChange,
  onSelect,
}: {
  articles: ArticleSummary[]
  favoriteSet: Set<string>
  language: Language
  pinnedSet: Set<string>
  recentFiles: string[]
  searchResults: SearchResult[]
  text: UiText
  onClose: () => void
  onQueryChange: (value: string) => void
  onSelect: (path: string) => void
}) {
  const [filter, setFilter] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const articleByPath = useMemo(() => new Map(articles.map((article) => [article.path, article])), [articles])
  const filtered = useMemo(() => {
    const target = filter.trim().toLowerCase()
    if (target) {
      const fromSearch = searchResults.map((result) => articleByPath.get(result.path)).filter(Boolean) as ArticleSummary[]
      const localMatches = articles.filter((article) => `${article.title} ${article.file_name} ${article.relative_path}`.toLowerCase().includes(target))
      return uniqueArticles([...fromSearch, ...localMatches]).slice(0, 16)
    }
    const favorites = articles.filter((article) => favoriteSet.has(article.path))
    const pinned = articles.filter((article) => pinnedSet.has(article.path))
    const recents = recentFiles.map((path) => articleByPath.get(path)).filter(Boolean) as ArticleSummary[]
    return uniqueArticles([...pinned, ...favorites, ...recents, ...articles]).slice(0, 16)
  }, [articleByPath, articles, favoriteSet, filter, pinnedSet, recentFiles, searchResults])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    onQueryChange(filter)
  }, [filter, onQueryChange])

  return (
    <div className="quick-open-backdrop" onMouseDown={onClose}>
      <section className="quick-open" onMouseDown={(event) => event.stopPropagation()}>
        <div className="quick-open-input">
          <Search size={17} />
          <input
            ref={inputRef}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'Enter' && filtered[0]) onSelect(filtered[0].path)
            }}
            placeholder={text.searchPlaceholder}
          />
        </div>
        <div className="quick-open-list">
          {filtered.map((article) => (
            <button key={article.path} onClick={() => onSelect(article.path)}>
              <FileText size={16} />
              <span>{article.title || article.file_name}</span>
              <small>{article.relative_path || displayGroupName(article.group, language)}</small>
            </button>
          ))}
          {filtered.length === 0 && <div className="empty-mini">{text.noMatches}</div>}
        </div>
      </section>
    </div>
  )
}
