import {
  FileSearch,
  FileText,
  FolderOpen,
  Pin,
  Search,
  SlidersHorizontal,
  Star,
} from 'lucide-react'
import {
  formatArticleCount,
  type Language,
  type UiText,
} from './i18n'
import type {
  ArticleSummary,
  LibraryFilter,
  SearchResult,
  SortMode,
} from './types'

export function LibrarySidebar({
  articles,
  favoriteSet,
  groupedArticles,
  language,
  libraryFilter,
  loading,
  pinnedSet,
  query,
  searchResults,
  selectedPath,
  sortMode,
  text,
  visibleCount,
  workspace,
  onChooseFile,
  onChooseWorkspace,
  onFilterChange,
  onQueryChange,
  onSelectArticle,
  onSortChange,
  onToggleFavorite,
  onTogglePinned,
}: {
  articles: ArticleSummary[]
  favoriteSet: Set<string>
  groupedArticles: Record<string, ArticleSummary[]>
  language: Language
  libraryFilter: LibraryFilter
  loading: boolean
  pinnedSet: Set<string>
  query: string
  searchResults: SearchResult[]
  selectedPath: string
  sortMode: SortMode
  text: UiText
  visibleCount: number
  workspace: string
  onChooseFile: () => void
  onChooseWorkspace: () => void
  onFilterChange: (filter: LibraryFilter) => void
  onQueryChange: (value: string) => void
  onSelectArticle: (path: string) => void
  onSortChange: (sort: SortMode) => void
  onToggleFavorite: (path: string) => void
  onTogglePinned: (path: string) => void
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>{text.documents}</span>
        <small>{loading ? text.loading : formatArticleCount(visibleCount || articles.length, language)}</small>
      </div>
      <label className="search-box">
        <Search size={15} />
        <input placeholder={text.searchPlaceholder} value={query} onChange={(event) => onQueryChange(event.target.value)} />
      </label>
      <div className="library-controls">
        <div className="segmented">
          {([
            ['all', text.allDocuments],
            ['current', text.currentDirectory],
            ['favorites', text.favorites],
            ['pinned', text.pinned],
            ['recent', text.recentFiles],
          ] as const).map(([value, label]) => (
            <button key={value} className={libraryFilter === value ? 'selected' : ''} onClick={() => onFilterChange(value)}>
              {label}
            </button>
          ))}
        </div>
        <label className="select-field">
          <SlidersHorizontal size={14} />
          <select value={sortMode} onChange={(event) => onSortChange(event.target.value as SortMode)}>
            <option value="updated">{text.sortUpdated}</option>
            <option value="name">{text.sortName}</option>
            <option value="path">{text.sortPath}</option>
          </select>
        </label>
      </div>
      <div className="article-groups">
        {query.trim() && (
          <section className="article-group">
            <div className="group-title">{text.searchResults}</div>
            {searchResults.slice(0, 18).map((result) => (
              <button className={`search-result ${result.path === selectedPath ? 'is-active' : ''}`} key={`${result.path}-${result.line}`} onClick={() => onSelectArticle(result.path)}>
                <FileSearch size={15} />
                <span>{result.title || result.file_name}</span>
                <small>{result.heading || result.relative_path}</small>
                <p>{result.snippet}</p>
              </button>
            ))}
            {searchResults.length === 0 && <div className="empty-mini">{text.noSearchResults}</div>}
          </section>
        )}
        {Object.entries(groupedArticles).map(([group, items]) => (
          <section className="article-group" key={group}>
            <div className="group-title">{group}</div>
            {items.map((article) => (
              <div className={`article-row ${article.path === selectedPath ? 'is-active' : ''}`} key={article.path}>
                <button className="article-main" onClick={() => onSelectArticle(article.path)}>
                  <span>{article.title || article.file_name}</span>
                  <small>{article.relative_path || article.file_name}</small>
                </button>
                <button className={favoriteSet.has(article.path) ? 'row-tool is-active' : 'row-tool'} onClick={() => onToggleFavorite(article.path)} title={favoriteSet.has(article.path) ? text.unfavorite : text.favorite}>
                  <Star size={14} />
                </button>
                <button className={pinnedSet.has(article.path) ? 'row-tool is-active' : 'row-tool'} onClick={() => onTogglePinned(article.path)} title={pinnedSet.has(article.path) ? text.unpin : text.pin}>
                  <Pin size={14} />
                </button>
              </div>
            ))}
          </section>
        ))}
        {articles.length === 0 && (
          <div className="empty-state">
            <FileText size={28} />
            <p>{workspace ? text.noArticlesInPath : text.chooseWorkspaceOrFileFirst}</p>
            <button className="inline-action" onClick={onChooseWorkspace}><FolderOpen size={15} />{text.chooseFolder}</button>
            <button className="inline-action" onClick={onChooseFile}><FileText size={15} />{text.chooseFile}</button>
          </div>
        )}
      </div>
    </aside>
  )
}
