import { Component, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode, RefObject } from 'react'
import {
  ArrowUp,
  Copy,
  Download,
  FileDown,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Languages,
  ListTree,
  Maximize2,
  Minimize2,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PencilLine,
  Pin,
  RefreshCw,
  Save,
  Settings,
  Search,
  Star,
  X,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import './App.css'
import { downloadBase64File, exportFileName, markdownToPlainText, readBundledPdfFont } from './exportHelpers'
import {
  formatArticleCount,
  formatExportSummary,
  formatImageCount,
  formatReadingMinutes,
  formatWordCount,
  type Language,
  type UiText,
  uiText,
} from './i18n'
import { LibrarySidebar } from './LibrarySidebar'
import {
  demoArticles,
  demoDefaultPayload,
  demoPayloads,
  extractImageSources,
  getVisibleArticles,
  groupArticlesByDisplayName,
  highlightHtml,
  searchDemoArticles,
} from './librarySearch'
import { buildOutline, buildReadingHtml, getArticleStats, markdownToHtml, parseArticle } from './markdown'
import { QuickOpenDialog } from './QuickOpenDialog'
import { defaultReaderState, moveToFront, normalizeState, togglePath } from './readerState'
import { wordStylePresets } from './wordStyles'
import type {
  ArticlePayload,
  ArticleStats,
  ArticleSummary,
  LibraryFilter,
  MissingImage,
  OutlineItem,
  PanelTab,
  ReadMode,
  ReaderSettings,
  ReaderState,
  SearchResult,
  SortMode,
  WordStyleId,
} from './types'

interface InsertImageAssetResponse {
  markdown: string
  relativePath: string
}

function App() {
  const [workspace, setWorkspace] = useState('')
  const [articles, setArticles] = useState<ArticleSummary[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [payload, setPayload] = useState<ArticlePayload | null>(null)
  const [editedContent, setEditedContent] = useState('')
  const [livePreviewContent, setLivePreviewContent] = useState('')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [quickOpenQuery, setQuickOpenQuery] = useState('')
  const [quickOpenSearchResults, setQuickOpenSearchResults] = useState<SearchResult[]>([])
  const [readMode, setReadMode] = useState<ReadMode>('desktop')
  const [panelTab, setPanelTab] = useState<PanelTab>('outline')
  const [sortMode, setSortMode] = useState<SortMode>('updated')
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false)
  const [wordStyle, setWordStyle] = useState<WordStyleId>('codex')
  const [language, setLanguage] = useState<Language>('zh')
  const [readerState, setReaderState] = useState<ReaderState>(defaultReaderState)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [imagePreview, setImagePreview] = useState('')
  const readerStateRef = useRef<ReaderState>(defaultReaderState)
  const text = uiText[language]
  const readerScrollRef = useRef<HTMLElement | null>(null)
  const editorScrollRef = useRef<HTMLDivElement | null>(null)
  const scrollSaveTimer = useRef<number | null>(null)
  const currentContent = payload ? editedContent : ''
  const isDirty = Boolean(payload && editedContent !== payload.content)
  const previewContent = livePreviewContent || (isDirty ? editedContent : payload?.preview_content || '')
  const searchTerm = query.trim()
  const articleStyleClass = `article-style-${wordStyle}`
  const previewParsed = useMemo(() => parseArticle(previewContent), [previewContent])
  const articleHtml = useMemo(
    () => highlightHtml(markdownToHtml(previewParsed.body), searchTerm),
    [previewParsed.body, searchTerm],
  )
  const readingHtml = useMemo(() => buildReadingHtml(previewContent), [previewContent])
  const outline = useMemo(() => buildOutline(currentContent), [currentContent])
  const stats = useMemo(() => getArticleStats(currentContent), [currentContent])
  const selectedArticle = articles.find((article) => article.path === selectedPath)
  const imageSources = useMemo(() => extractImageSources(currentContent), [currentContent])
  const recentFileSet = useMemo(() => new Set(readerState.recent_files), [readerState.recent_files])
  const favoriteSet = useMemo(() => new Set(readerState.favorites), [readerState.favorites])
  const pinnedSet = useMemo(() => new Set(readerState.pinned), [readerState.pinned])
  const visibleArticles = useMemo(
    () => getVisibleArticles({
      articles,
      favoriteSet,
      libraryFilter,
      pinnedSet,
      query: searchTerm,
      recentFileSet,
      selectedArticle,
      sortMode,
    }),
    [articles, favoriteSet, libraryFilter, pinnedSet, recentFileSet, searchTerm, selectedArticle, sortMode],
  )

  const groupedArticles = useMemo(
    () => groupArticlesByDisplayName(visibleArticles, pinnedSet, language, text.pinned),
    [language, pinnedSet, text.pinned, visibleArticles],
  )

  useEffect(() => {
    void bootstrap()
    // The app initializes persisted reader state only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!payload) {
      setLivePreviewContent('')
      return undefined
    }
    if (!isDirty) {
      setLivePreviewContent(payload.preview_content || editedContent)
      return undefined
    }
    if (!isTauri()) {
      setLivePreviewContent(editedContent)
      return undefined
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void invoke<string>('preview_markdown_content', {
        request: {
          articlePath: payload.path,
          content: editedContent,
        },
      })
        .then((nextContent) => {
          if (!cancelled) setLivePreviewContent(nextContent)
        })
        .catch(() => {
          if (!cancelled) setLivePreviewContent(editedContent)
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [editedContent, isDirty, payload])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed || !workspace.trim()) {
      setSearchResults([])
      return undefined
    }
    const timer = window.setTimeout(() => {
      if (!isTauri()) {
        setSearchResults(searchDemoArticles(trimmed, language))
        return
      }
      void invoke<SearchResult[]>('search_workspace', {
        request: { workspace, query: trimmed },
      })
        .then(setSearchResults)
        .catch((error) => setNotice(`${text.loadFailed}: ${String(error)}`))
    }, 220)
    return () => window.clearTimeout(timer)
  }, [language, query, text.loadFailed, workspace])

  useEffect(() => {
    const trimmed = quickOpenQuery.trim()
    if (!isQuickOpenOpen || !trimmed || !workspace.trim()) {
      setQuickOpenSearchResults([])
      return undefined
    }
    const timer = window.setTimeout(() => {
      if (!isTauri()) {
        setQuickOpenSearchResults(searchDemoArticles(trimmed, language))
        return
      }
      void invoke<SearchResult[]>('search_workspace', {
        request: { workspace, query: trimmed },
      })
        .then(setQuickOpenSearchResults)
        .catch((error) => setNotice(`${text.loadFailed}: ${String(error)}`))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [isQuickOpenOpen, language, quickOpenQuery, text.loadFailed, workspace])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'p') {
        event.preventDefault()
        openQuickOpen()
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'f') {
        event.preventDefault()
        setIsSidebarOpen(true)
        window.setTimeout(() => document.querySelector<HTMLInputElement>('.search-box input')?.focus(), 0)
      }
      if ((event.ctrlKey || event.metaKey) && key === 'f') {
        event.preventDefault()
        setIsSidebarOpen(true)
        window.setTimeout(() => document.querySelector<HTMLInputElement>('.search-box input')?.focus(), 0)
      }
      if ((event.ctrlKey || event.metaKey) && key === 'o' && !event.shiftKey) {
        event.preventDefault()
        void chooseMarkdownFile()
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'o') {
        event.preventDefault()
        void chooseWorkspace()
      }
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        void saveMarkdown()
      }
      if ((event.ctrlKey || event.metaKey) && key === 'e') {
        event.preventDefault()
        setReadMode((value) => {
          const nextMode = value === 'edit' ? 'desktop' : 'edit'
          patchState((current) => ({ ...current, last_read_mode: nextMode }))
          return nextMode
        })
      }
      if ((event.ctrlKey || event.metaKey) && key === '.') {
        event.preventDefault()
        toggleFocusMode()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  async function bootstrap() {
    const nextState = applyReaderState(await loadState())
    setLanguage(nextState.settings.language)
    setWordStyle(nextState.settings.default_export_style)
    setReadMode(nextState.last_read_mode || nextState.settings.default_read_mode)
    setIsFocusMode(nextState.focus_mode)

    const launchPath = isTauri() ? await invoke<string | null>('initial_open_path').catch(() => null) : null
    const startupWorkspace = launchPath
      || (nextState.settings.restore_last_document ? nextState.last_workspace : '')
      || nextState.settings.default_workspace

    if (startupWorkspace) {
      setWorkspace(startupWorkspace)
      await loadArticles(startupWorkspace, launchPath || nextState.last_file, nextState)
      return
    }

    if (!isTauri() && new URLSearchParams(window.location.search).get('demo') === '1') {
      setWorkspace('demo')
      setArticles(demoArticles)
      const demoTarget = demoArticles.some((article) => article.path === nextState.last_file)
        ? nextState.last_file
        : demoArticles[0]?.path || ''
      if (demoTarget) await selectArticle(demoTarget)
    }
  }

  async function loadState(): Promise<ReaderState> {
    if (!isTauri()) {
      const raw = window.localStorage.getItem('markdown-reader-state-v2')
      if (!raw) return defaultReaderState
      try {
        return normalizeState(JSON.parse(raw))
      } catch {
        return defaultReaderState
      }
    }
    const loaded = await invoke<ReaderState>('load_reader_state')
    return normalizeState(loaded)
  }

  function applyReaderState(next: ReaderState) {
    const normalized = normalizeState(next)
    readerStateRef.current = normalized
    setReaderState(normalized)
    return normalized
  }

  function persistState(next: ReaderState) {
    const normalized = applyReaderState(next)
    if (!isTauri()) {
      window.localStorage.setItem('markdown-reader-state-v2', JSON.stringify(normalized))
      return normalized
    }
    void invoke('save_reader_state', { state: normalized }).catch((error) => {
      setNotice(`${text.loadFailed}: ${String(error)}`)
    })
    return normalized
  }

  function patchState(updater: (state: ReaderState) => ReaderState) {
    const next = updater(readerStateRef.current)
    return persistState(next)
  }

  async function loadArticles(root = workspace, pathToSelect = selectedPath, state = readerState) {
    if (!root.trim()) {
      setNotice(text.choosePathFirst)
      return
    }
    if (!confirmDiscard()) return
    setLoading(true)
    try {
      const items = isTauri()
        ? await invoke<ArticleSummary[]>('scan_workspace', { workspace: root })
        : demoArticles
      setArticles(items)
      const target = pathToSelect && items.some((item) => item.path === pathToSelect)
        ? pathToSelect
        : items.find((item) => item.path === state.last_file)?.path || items[0]?.path
      patchState((current) => ({
        ...current,
        last_workspace: root,
        recent_workspaces: moveToFront(current.recent_workspaces, root, 20),
      }))
      if (target) {
        await selectArticle(target, false)
      } else {
        setSelectedPath('')
        setPayload(null)
        setEditedContent('')
      }
    } catch (error) {
      setNotice(`${text.loadFailed}: ${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  async function selectArticle(path: string, ask = true) {
    if (ask && !confirmDiscard()) return
    setSelectedPath(path)
    setLoading(true)
    try {
      const nextPayload = isTauri()
        ? await invoke<ArticlePayload>('read_article', { path })
        : demoPayloads[path] || demoDefaultPayload
      setPayload(nextPayload)
      setEditedContent(nextPayload.content)
      const nextState = patchState((current) => ({
        ...current,
        last_file: path,
        recent_files: moveToFront(current.recent_files, path, 50),
      }))
      restoreScroll(path, nextState)
    } catch (error) {
      setNotice(`${text.readFailed}: ${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  async function chooseWorkspace() {
    if (!isTauri()) {
      setNotice(text.browserNoDir)
      return
    }
    const selected = await open({ directory: true, multiple: false, title: text.workspaceDialogTitle })
    if (typeof selected === 'string') {
      setWorkspace(selected)
      await loadArticles(selected, '')
    }
  }

  async function chooseMarkdownFile() {
    if (!isTauri()) {
      setNotice(text.browserNoFile)
      return
    }
    const selected = await open({
      multiple: false,
      title: text.markdownDialogTitle,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown'] }],
    })
    if (typeof selected === 'string') {
      setWorkspace(selected)
      await loadArticles(selected, selected)
    }
  }

  async function saveMarkdown() {
    if (!payload) return
    if (!isDirty) {
      setNotice(text.noUnsavedChanges)
      return
    }
    try {
      if (!isTauri()) {
        const nextPayload = { ...payload, content: editedContent, preview_content: editedContent }
        setPayload(nextPayload)
        setNotice(text.browserDemoUpdated)
        return
      }
      const nextPayload = await invoke<ArticlePayload>('save_article', {
        request: { path: payload.path, content: editedContent },
      })
      setPayload(nextPayload)
      setEditedContent(nextPayload.content)
      setNotice(text.markdownSaved)
      await refreshArticleList(payload.path)
    } catch (error) {
      setNotice(`${text.readFailed}: ${String(error)}`)
    }
  }

  async function refreshArticleList(pathToKeep = selectedPath) {
    if (!workspace.trim()) return
    const items = isTauri()
      ? await invoke<ArticleSummary[]>('scan_workspace', { workspace })
      : demoArticles
    setArticles(items)
    if (pathToKeep && items.some((item) => item.path === pathToKeep)) {
      setSelectedPath(pathToKeep)
    }
  }

  async function copyMarkdown() {
    if (!payload) return
    await navigator.clipboard.writeText(editedContent)
    setNotice(text.copiedMarkdown)
  }

  async function copyPlainText() {
    if (!payload) return
    await navigator.clipboard.writeText(markdownToPlainText(editedContent))
    setNotice(text.copiedPlainText)
  }

  async function copyReadingHtml() {
    if (!payload) return
    await navigator.clipboard.writeText(readingHtml)
    setNotice(text.copiedReadingHtml)
  }

  async function saveReadingHtml() {
    if (!payload) return
    if (!isTauri()) {
      setNotice(text.browserCopyOnlyHtml)
      return
    }
    const output = await invoke<string>('save_reading_html', {
      articlePath: payload.path,
      html: readingHtml,
    })
    setNotice(`${text.generatedOpenedReadingHtml}: ${output}`)
  }

  async function saveWordDocx() {
    if (!payload) return
    setLoading(true)
    try {
      const { markdownToDocxBase64 } = await import('./word')
      const contentBase64 = await markdownToDocxBase64(previewContent, wordStyle)
      if (!isTauri()) {
        downloadBase64File(contentBase64, exportFileName(selectedArticle?.file_name, 'docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        setNotice(text.browserDownloadedWord)
        return
      }
      const output = await invoke<string>('save_binary_export', {
        request: { articlePath: payload.path, contentBase64, extension: 'docx' },
      })
      setNotice(`${text.generatedOpenedWord}: ${output}`)
    } catch (error) {
      setNotice(`${text.wordExportFailed}: ${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  async function savePdf() {
    if (!payload) return
    setLoading(true)
    try {
      const { markdownToPdfBase64 } = await import('./pdf')
      const fontBase64 = await readBundledPdfFont()
      const contentBase64 = await markdownToPdfBase64(previewContent, fontBase64, wordStyle)
      if (!isTauri()) {
        downloadBase64File(contentBase64, exportFileName(selectedArticle?.file_name, 'pdf'), 'application/pdf')
        setNotice(text.browserDownloadedPdf)
        return
      }
      const output = await invoke<string>('save_binary_export', {
        request: { articlePath: payload.path, contentBase64, extension: 'pdf' },
      })
      setNotice(`${text.generatedOpenedPdf}: ${output}`)
    } catch (error) {
      setNotice(`${text.pdfExportFailed}: ${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  async function requestImageMarkdown() {
    if (!payload) {
      setNotice(text.openMarkdownFirst)
      return null
    }
    if (!isTauri()) {
      setNotice(text.browserNoLocalImage)
      return null
    }
    const selected = await open({
      multiple: false,
      title: text.insertImageTitle,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
    })
    if (typeof selected !== 'string') return null
    try {
      const response = await invoke<InsertImageAssetResponse>('insert_image_asset', {
        request: { articlePath: payload.path, imagePath: selected },
      })
      setNotice(`${text.insertedImage}: ${response.relativePath}`)
      return response.markdown
    } catch (error) {
      setNotice(`${text.insertImageFailed}: ${String(error)}`)
      return null
    }
  }

  function confirmDiscard() {
    return !isDirty || window.confirm(text.discardPrompt)
  }

  function restoreScroll(path: string, state = readerState) {
    if (!state.settings.remember_scroll_position) return
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = readerScrollRef.current
        if (target) target.scrollTop = state.reading_positions[path] || 0
      })
    })
  }

  function rememberScroll() {
    if (!selectedPath || !readerStateRef.current.settings.remember_scroll_position) return
    if (scrollSaveTimer.current) window.clearTimeout(scrollSaveTimer.current)
    const scrollTop = readerScrollRef.current?.scrollTop || 0
    scrollSaveTimer.current = window.setTimeout(() => {
      patchState((current) => ({
        ...current,
        reading_positions: {
          ...current.reading_positions,
          [selectedPath]: scrollTop,
        },
      }))
    }, 260)
  }

  function jumpToOutline(item: OutlineItem) {
    changeReadMode('desktop')
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const heading = document.getElementById(item.id)
        if (!heading) return
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
        rememberScroll()
      })
    })
  }

  function backToTop() {
    readerScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    if (selectedPath) {
      patchState((current) => ({
        ...current,
        reading_positions: { ...current.reading_positions, [selectedPath]: 0 },
      }))
    }
  }

  function toggleFocusMode() {
    setIsFocusMode((value) => {
      const next = !value
      if (next) {
        setPanelTab('outline')
      }
      patchState((current) => ({ ...current, focus_mode: next, last_read_mode: next ? 'desktop' : current.last_read_mode }))
      if (next) setReadMode('desktop')
      return next
    })
  }

  function changeReadMode(nextMode: ReadMode) {
    setReadMode(nextMode)
    patchState((current) => ({ ...current, last_read_mode: nextMode }))
  }

  function toggleFavorite(path: string) {
    patchState((current) => ({
      ...current,
      favorites: togglePath(current.favorites, path),
    }))
  }

  function togglePinned(path: string) {
    patchState((current) => ({
      ...current,
      pinned: togglePath(current.pinned, path),
    }))
  }

  function updateSettings(settings: Partial<ReaderSettings>) {
    const nextSettings = { ...readerStateRef.current.settings, ...settings }
    if (settings.language) setLanguage(settings.language)
    if (settings.default_export_style) setWordStyle(settings.default_export_style)
    patchState((current) => ({ ...current, settings: nextSettings }))
  }

  function handleArticleImageClick(event: React.MouseEvent<HTMLElement>) {
    const target = event.target
    if (target instanceof HTMLImageElement && target.src) {
      setImagePreview(target.src)
    }
  }

  function openQuickOpen() {
    setQuickOpenQuery('')
    setQuickOpenSearchResults([])
    setIsQuickOpenOpen(true)
  }

  function closeQuickOpen() {
    setIsQuickOpenOpen(false)
    setQuickOpenQuery('')
    setQuickOpenSearchResults([])
  }

  function changeLibraryFilter(nextFilter: LibraryFilter) {
    setLibraryFilter(nextFilter)
    if (nextFilter !== 'all' && query.trim()) {
      setQuery('')
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <FileText size={19} />
          <div>
            <strong>Markdown Reader</strong>
            <span>{text.brandSubtitle}</span>
          </div>
        </div>
        <label className="workspace-field" title={workspace}>
          <FolderOpen size={16} />
          <input
            list="recent-workspaces"
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void loadArticles(event.currentTarget.value)
            }}
            aria-label={text.workspaceAria}
            placeholder={text.workspacePlaceholder}
          />
          <datalist id="recent-workspaces">
            {readerState.recent_workspaces.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>
        <div className="toolbar">
          <button className="language-button" onClick={() => updateSettings({ language: language === 'zh' ? 'en' : 'zh' })} title={text.switchLanguageTitle} type="button" aria-label={text.languageToggleAria}>
            <Languages size={16} />
            <span>{language === 'zh' ? '中' : 'EN'}</span>
          </button>
          <button className="icon-button" onClick={() => setIsSidebarOpen((value) => !value)} title={isSidebarOpen ? text.collapseDocs : text.expandDocs}>
            {isSidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          <button className="icon-button" onClick={() => setIsRightPanelOpen((value) => !value)} title={isRightPanelOpen ? text.collapsePanel : text.expandPanel}>
            {isRightPanelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
          <button className={`icon-button ${isFocusMode ? 'is-active' : ''}`} onClick={toggleFocusMode} title={isFocusMode ? text.exitFocus : text.focusMode}>
            {isFocusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button className="icon-button" onClick={chooseWorkspace} title={text.openFolder}>
            <FolderOpen size={17} />
          </button>
          <button className="icon-button" onClick={chooseMarkdownFile} title={text.openMarkdownFile}>
            <FileText size={17} />
          </button>
          <button className="icon-button" onClick={openQuickOpen} title={text.quickOpen} disabled={articles.length === 0 && readerState.recent_files.length === 0}>
            <Search size={17} />
          </button>
          <button className="icon-button" onClick={() => loadArticles()} title={text.refresh} disabled={!workspace.trim()}>
            <RefreshCw size={17} />
          </button>
          <button className="icon-button" onClick={backToTop} title={text.top} disabled={!payload}>
            <ArrowUp size={17} />
          </button>
          <button className="command-button" onClick={saveMarkdown} disabled={!isDirty}>
            <Save size={16} />
            {text.saveMarkdown}
          </button>
        </div>
      </header>

      <section className={`workbench ${!isSidebarOpen ? 'sidebar-collapsed' : ''} ${!isRightPanelOpen ? 'panel-collapsed' : ''} ${isFocusMode ? 'focus-mode' : ''}`}>
        {isSidebarOpen && !isFocusMode && (
          <LibrarySidebar
            articles={articles}
            favoriteSet={favoriteSet}
            groupedArticles={groupedArticles}
            language={language}
            libraryFilter={libraryFilter}
            loading={loading}
            pinnedSet={pinnedSet}
            query={query}
            searchResults={searchResults}
            selectedPath={selectedPath}
            sortMode={sortMode}
            text={text}
            visibleCount={visibleArticles.length}
            workspace={workspace}
            onChooseFile={chooseMarkdownFile}
            onChooseWorkspace={chooseWorkspace}
            onFilterChange={changeLibraryFilter}
            onQueryChange={setQuery}
            onSelectArticle={(path) => selectArticle(path)}
            onSortChange={setSortMode}
            onToggleFavorite={toggleFavorite}
            onTogglePinned={togglePinned}
          />
        )}

        <section className={`reader-panel ${isFocusMode ? 'focus-reader' : ''}`}>
          {isFocusMode ? (
            <FocusReader
              articleHtml={articleHtml}
              articleStyleClass={articleStyleClass}
              keepOutline={readerState.settings.focus_keep_outline}
              language={language}
              loading={loading}
              onArticleImageClick={handleArticleImageClick}
              onOutlineSelect={jumpToOutline}
              onScroll={rememberScroll}
              outline={outline}
              payload={payload}
              previewParsed={previewParsed}
              readerScrollRef={readerScrollRef}
              selectedFileName={selectedArticle?.file_name}
              stats={stats}
              text={text}
            />
          ) : (
            <>
              <div className="reader-tabs">
                <button className={readMode === 'desktop' ? 'selected' : ''} onClick={() => changeReadMode('desktop')}>
                  <Monitor size={16} />
                  {text.desktopReading}
                </button>
                <button className={readMode === 'source' ? 'selected' : ''} onClick={() => changeReadMode('source')}>
                  <FileText size={16} />
                  {text.source}
                </button>
                <button className={readMode === 'edit' ? 'selected' : ''} onClick={() => changeReadMode('edit')}>
                  <PencilLine size={16} />
                  {text.edit}
                </button>
                {payload && (
                  <>
                    <button className={`reader-icon ${favoriteSet.has(payload.path) ? 'is-active' : ''}`} onClick={() => toggleFavorite(payload.path)} title={favoriteSet.has(payload.path) ? text.unfavorite : text.favorite}>
                      <Star size={16} />
                    </button>
                    <button className={`reader-icon ${pinnedSet.has(payload.path) ? 'is-active' : ''}`} onClick={() => togglePinned(payload.path)} title={pinnedSet.has(payload.path) ? text.unpin : text.pin}>
                      <Pin size={16} />
                    </button>
                  </>
                )}
                {isDirty && <span className="dirty-badge">{text.unsaved}</span>}
                {payload && (
                  <div className="stats-strip">
                    <span>{formatWordCount(stats.words, language)}</span>
                    <span>{formatReadingMinutes(stats.readingMinutes, language)}</span>
                    <span>{formatImageCount(stats.images, language, true)}</span>
                  </div>
                )}
              </div>
              <article ref={readerScrollRef} className={`reader-canvas ${readMode}`} onScroll={rememberScroll} onClick={handleArticleImageClick}>
                <ReaderContent
                  articleHtml={articleHtml}
                  articleStyleClass={articleStyleClass}
                  loading={loading}
                  onChooseFile={chooseMarkdownFile}
                  onChooseWorkspace={chooseWorkspace}
                  onRequestImageMarkdown={requestImageMarkdown}
                  onSave={saveMarkdown}
                  payload={payload}
                  previewParsed={previewParsed}
                  readMode={readMode}
                  selectedArticle={selectedArticle}
                  text={text}
                  value={editedContent}
                  isDirty={isDirty}
                  onChange={setEditedContent}
                  editorScrollRef={editorScrollRef}
                  workspace={workspace}
                />
              </article>
            </>
          )}
        </section>

        {isRightPanelOpen && !isFocusMode && (
          <aside className="right-panel">
            <div className="panel-tabs">
              <button className="panel-toggle" onClick={() => setIsRightPanelOpen(false)} title={text.collapsePanel}>
                <PanelRightClose size={15} />
              </button>
              <button className={panelTab === 'outline' ? 'selected' : ''} onClick={() => setPanelTab('outline')}>
                {text.outline}
              </button>
              <button className={panelTab === 'actions' ? 'selected' : ''} onClick={() => setPanelTab('actions')}>
                {text.actions}
              </button>
              <button className={panelTab === 'settings' ? 'selected' : ''} onClick={() => setPanelTab('settings')}>
                <Settings size={14} />
              </button>
            </div>
            {panelTab === 'outline' && (
              <OutlinePanel
                imageSources={imageSources}
                language={language}
                missingImages={payload?.missing_images || []}
                onCopyPath={(path) => {
                  void navigator.clipboard.writeText(path)
                  setNotice(text.copiedPath)
                }}
                onSelect={jumpToOutline}
                outline={outline}
                selectedArticle={selectedArticle}
                stats={stats}
                text={text}
              />
            )}
            {panelTab === 'actions' && (
              <ActionPanel
                disabled={!payload}
                language={language}
                onCopyHtml={copyReadingHtml}
                onCopyMarkdown={copyMarkdown}
                onCopyPlainText={copyPlainText}
                onSaveHtml={saveReadingHtml}
                onSavePdf={savePdf}
                onSaveWordDocx={saveWordDocx}
                onWordStyleChange={(value) => {
                  setWordStyle(value)
                  updateSettings({ default_export_style: value })
                }}
                stats={stats}
                text={text}
                wordStyle={wordStyle}
              />
            )}
            {panelTab === 'settings' && (
              <SettingsPanel
                language={language}
                settings={readerState.settings}
                text={text}
                wordStyle={wordStyle}
                onChange={updateSettings}
                onUseCurrentWorkspace={() => {
                  updateSettings({ default_workspace: workspace })
                  setNotice(text.stateSaved)
                }}
              />
            )}
          </aside>
        )}
      </section>

      {isQuickOpenOpen && (
        <QuickOpenDialog
          articles={articles}
          favoriteSet={favoriteSet}
          language={language}
          pinnedSet={pinnedSet}
          recentFiles={readerState.recent_files}
          searchResults={quickOpenSearchResults}
          text={text}
          onClose={closeQuickOpen}
          onQueryChange={setQuickOpenQuery}
          onSelect={(path) => {
            closeQuickOpen()
            void selectArticle(path)
          }}
        />
      )}

      {imagePreview && (
        <button className="image-preview-backdrop" onClick={() => setImagePreview('')}>
          <img src={imagePreview} alt="" />
          <span><X size={18} /></span>
        </button>
      )}

      {notice && <button className="toast" onClick={() => setNotice('')}>{notice}</button>}
    </main>
  )
}

function ReaderContent({
  articleHtml,
  articleStyleClass,
  editorScrollRef,
  isDirty,
  loading,
  onChange,
  onChooseFile,
  onChooseWorkspace,
  onRequestImageMarkdown,
  onSave,
  payload,
  previewParsed,
  readMode,
  selectedArticle,
  text,
  value,
  workspace,
}: {
  articleHtml: string
  articleStyleClass: string
  editorScrollRef: RefObject<HTMLDivElement | null>
  isDirty: boolean
  loading: boolean
  onChange: (value: string) => void
  onChooseFile: () => void
  onChooseWorkspace: () => void
  onRequestImageMarkdown: () => Promise<string | null>
  onSave: () => void
  payload: ArticlePayload | null
  previewParsed: { title: string; digest: string }
  readMode: ReadMode
  selectedArticle?: ArticleSummary
  text: UiText
  value: string
  workspace: string
}) {
  if (loading) return <div className="loading">{text.loading}</div>
  if (!payload) {
    return (
      <div className="empty-reader">
        <FileText size={34} />
        <p>{workspace ? text.chooseLeftDoc : text.chooseMarkdownDoc}</p>
        {!workspace && (
          <div className="empty-actions">
            <button className="command-button" onClick={onChooseWorkspace}><FolderOpen size={16} />{text.chooseFolder}</button>
            <button className="command-button" onClick={onChooseFile}><FileText size={16} />{text.chooseFile}</button>
          </div>
        )}
      </div>
    )
  }
  if (readMode === 'source') return <pre className="source-view">{value}</pre>
  if (readMode === 'edit') {
    return (
      <div className="editor-shell">
        <div className="editor-bar">
          <div>
            <strong>{selectedArticle?.file_name || 'Markdown'}</strong>
            <span>{isDirty ? text.dirty : text.saved}</span>
          </div>
          <button className="command-button" onClick={onSave} disabled={!isDirty}>
            <Save size={16} />
            {text.saveMarkdown}
          </button>
        </div>
        <RichMarkdownEditor
          scrollRef={editorScrollRef}
          value={value}
          onChange={onChange}
          onRequestImageMarkdown={onRequestImageMarkdown}
          onSave={onSave}
          text={text}
        />
      </div>
    )
  }
  return (
    <div className={`article-page ${articleStyleClass}`}>
      <header className="article-title">
        <h1>{previewParsed.title || selectedArticle?.title}</h1>
        {previewParsed.digest && <p>{previewParsed.digest}</p>}
      </header>
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: articleHtml }} />
    </div>
  )
}

function FocusReader({
  articleHtml,
  articleStyleClass,
  keepOutline,
  language,
  loading,
  onArticleImageClick,
  onOutlineSelect,
  onScroll,
  outline,
  payload,
  previewParsed,
  readerScrollRef,
  selectedFileName,
  stats,
  text,
}: {
  articleHtml: string
  articleStyleClass: string
  keepOutline: boolean
  language: Language
  loading: boolean
  onArticleImageClick: (event: React.MouseEvent<HTMLElement>) => void
  onOutlineSelect: (item: OutlineItem) => void
  onScroll: () => void
  outline: OutlineItem[]
  payload: ArticlePayload | null
  previewParsed: { title: string; digest: string }
  readerScrollRef: RefObject<HTMLElement | null>
  selectedFileName?: string
  stats: ArticleStats
  text: UiText
}) {
  return (
    <section className={`focus-reading-layout ${!keepOutline ? 'without-outline' : ''}`}>
      <div className="focus-reading-main">
        <div className="focus-reading-bar">
          <div>
            <strong>{selectedFileName || text.noOpenedDoc}</strong>
            <span>{text.desktopReading}</span>
          </div>
          {payload && (
            <div className="stats-strip focus-stats">
              <span>{formatWordCount(stats.words, language)}</span>
              <span>{formatReadingMinutes(stats.readingMinutes, language)}</span>
              <span>{formatImageCount(stats.images, language, true)}</span>
            </div>
          )}
        </div>
        <article ref={readerScrollRef} className="focus-reading-canvas" onScroll={onScroll} onClick={onArticleImageClick}>
          {loading && <div className="loading">{text.loading}</div>}
          {!loading && !payload && <div className="empty-reader"><FileText size={34} /><p>{text.selectMarkdownDoc}</p></div>}
          {!loading && payload && (
            <div className={`article-page focus-page ${articleStyleClass}`}>
              <header className="article-title">
                <h1>{previewParsed.title}</h1>
                {previewParsed.digest && <p>{previewParsed.digest}</p>}
              </header>
              <div className="markdown-body" dangerouslySetInnerHTML={{ __html: articleHtml }} />
            </div>
          )}
        </article>
      </div>
      {keepOutline && (
        <aside className="focus-outline-panel">
          <div className="focus-reading-bar">
            <div>
              <strong>{text.outline}</strong>
              <span>{formatArticleCount(outline.length, language)}</span>
            </div>
          </div>
          <OutlineOnly outline={outline} text={text} onSelect={onOutlineSelect} />
        </aside>
      )}
    </section>
  )
}

function OutlinePanel({
  imageSources,
  language,
  missingImages,
  onCopyPath,
  outline,
  selectedArticle,
  stats,
  text,
  onSelect,
}: {
  imageSources: string[]
  language: Language
  missingImages: MissingImage[]
  onCopyPath: (path: string) => void
  outline: OutlineItem[]
  selectedArticle?: ArticleSummary
  stats: ArticleStats
  text: UiText
  onSelect: (item: OutlineItem) => void
}) {
  return (
    <div className="panel-content outline-panel">
      <div className="doc-info">
        <strong>{selectedArticle?.title || text.noOpenedDoc}</strong>
        <span>{selectedArticle?.relative_path || ''}</span>
      </div>
      <div className="stats-grid">
        <div><span>{text.wordCount}</span><strong>{stats.words}</strong></div>
        <div><span>{text.reading}</span><strong>{formatReadingMinutes(stats.readingMinutes, language)}</strong></div>
        <div><span>{text.images}</span><strong>{stats.images}</strong></div>
        <div><span>{text.codeBlocks}</span><strong>{stats.codeBlocks}</strong></div>
      </div>
      <OutlineOnly outline={outline} text={text} onSelect={onSelect} />
      <section className="resource-check">
        <div className="group-title">{missingImages.length ? text.missingImages : text.allImagesReady}</div>
        {missingImages.map((item) => (
          <div className="missing-image" key={item.src}>
            <ImageIcon size={15} />
            <span>{item.src}</span>
            <button onClick={() => onCopyPath(item.resolved_path)}>{text.copyPath}</button>
          </div>
        ))}
        {!missingImages.length && imageSources.slice(0, 8).map((src) => (
          <div className="image-source" key={src}>
            <ImageIcon size={15} />
            <span>{src}</span>
            <button onClick={() => onCopyPath(src)}>{text.copyPath}</button>
          </div>
        ))}
      </section>
    </div>
  )
}

function OutlineOnly({ outline, text, onSelect }: { outline: OutlineItem[]; text: UiText; onSelect: (item: OutlineItem) => void }) {
  return outline.length > 0 ? (
    <div className="outline-list">
      {outline.map((item) => (
        <button className={`outline-row outline-level-${Math.min(6, Math.max(1, item.level))}`} key={item.id} onClick={() => onSelect(item)}>
          <ListTree size={14} />
          <span>{item.text}</span>
        </button>
      ))}
    </div>
  ) : (
    <div className="empty-mini"><ListTree size={22} /><p>{text.noOutline}</p></div>
  )
}

function ActionPanel({
  disabled,
  language,
  onCopyHtml,
  onCopyMarkdown,
  onCopyPlainText,
  onSaveHtml,
  onSavePdf,
  onSaveWordDocx,
  onWordStyleChange,
  stats,
  text,
  wordStyle,
}: {
  disabled: boolean
  language: Language
  onCopyHtml: () => void
  onCopyMarkdown: () => void
  onCopyPlainText: () => void
  onSaveHtml: () => void
  onSavePdf: () => void
  onSaveWordDocx: () => void
  onWordStyleChange: (style: WordStyleId) => void
  stats: ArticleStats
  text: UiText
  wordStyle: WordStyleId
}) {
  return (
    <div className="panel-content action-panel">
      <div className="export-summary">
        <Download size={19} />
        <div>
          <strong>{formatWordCount(stats.words || 0, language)}</strong>
          <span>{formatExportSummary(stats, language)}</span>
        </div>
      </div>
      <label className="word-style-field">
        <span>{text.markdownStyle}</span>
        <select value={wordStyle} onChange={(event) => onWordStyleChange(event.target.value as WordStyleId)}>
          {wordStylePresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {language === 'zh' ? preset.name : preset.nameEn} / {preset.font}
            </option>
          ))}
        </select>
      </label>
      <div className="export-primary-actions">
        <button className="primary-export-button" onClick={onSaveWordDocx} disabled={disabled}><FileDown size={15} />Word<span>{text.wordDescription}</span></button>
        <button className="primary-export-button" onClick={onSavePdf} disabled={disabled}><FileDown size={15} />PDF<span>{text.pdfDescription}</span></button>
      </div>
      <div className="action-list">
        <button onClick={onCopyMarkdown} disabled={disabled}><Copy size={14} />{text.copyMarkdown}</button>
        <button onClick={onCopyPlainText} disabled={disabled}><Copy size={14} />{text.copyPlainText}</button>
        <button onClick={onCopyHtml} disabled={disabled}><Copy size={14} />{text.copyHtml}</button>
        <button onClick={onSaveHtml} disabled={disabled}><Download size={14} />{text.saveHtml}</button>
      </div>
    </div>
  )
}

function SettingsPanel({
  language,
  settings,
  text,
  wordStyle,
  onChange,
  onUseCurrentWorkspace,
}: {
  language: Language
  settings: ReaderSettings
  text: UiText
  wordStyle: WordStyleId
  onChange: (settings: Partial<ReaderSettings>) => void
  onUseCurrentWorkspace: () => void
}) {
  return (
    <div className="panel-content settings-panel">
      <label className="settings-row">
        <span>{text.defaultWorkspace}</span>
        <button onClick={onUseCurrentWorkspace}><FolderOpen size={14} />{language === 'zh' ? '使用当前' : 'Use current'}</button>
      </label>
      <label className="settings-row">
        <span>{text.defaultReadMode}</span>
        <select value={settings.default_read_mode} onChange={(event) => onChange({ default_read_mode: event.target.value as ReadMode })}>
          <option value="desktop">{text.desktopReading}</option>
          <option value="source">{text.source}</option>
          <option value="edit">{text.edit}</option>
        </select>
      </label>
      <label className="settings-row">
        <span>{text.defaultExportStyle}</span>
        <select value={wordStyle} onChange={(event) => onChange({ default_export_style: event.target.value as WordStyleId })}>
          {wordStylePresets.map((preset) => <option key={preset.id} value={preset.id}>{language === 'zh' ? preset.name : preset.nameEn}</option>)}
        </select>
      </label>
      <ToggleRow label={text.restoreLast} checked={settings.restore_last_document} onChange={(value) => onChange({ restore_last_document: value })} />
      <ToggleRow label={text.rememberScroll} checked={settings.remember_scroll_position} onChange={(value) => onChange({ remember_scroll_position: value })} />
      <ToggleRow label={text.focusOutline} checked={settings.focus_keep_outline} onChange={(value) => onChange({ focus_keep_outline: value })} />
      <label className="settings-row">
        <span>{language === 'zh' ? '语言' : 'Language'}</span>
        <select value={settings.language} onChange={(event) => onChange({ language: event.target.value as Language })}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

function RichMarkdownEditor({
  scrollRef,
  text,
  value,
  onChange,
  onRequestImageMarkdown,
  onSave,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  text: UiText
  value: string
  onChange: (value: string) => void
  onRequestImageMarkdown: () => Promise<string | null>
  onSave: () => void
}) {
  return (
    <div ref={scrollRef} className="rich-editor-scroll">
      <FallbackMarkdownEditor value={value} onChange={onChange} onRequestImageMarkdown={onRequestImageMarkdown} onSave={onSave} text={text} />
    </div>
  )
}

function FallbackMarkdownEditor({
  text,
  value,
  onChange,
  onRequestImageMarkdown,
  onSave,
}: {
  text: UiText
  value: string
  onChange: (value: string) => void
  onRequestImageMarkdown: () => Promise<string | null>
  onSave: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const selectionRef = useRef<{ start: number, end: number } | null>(null)
  const [isInsertingImage, setIsInsertingImage] = useState(false)

  function rememberSelection(target = textareaRef.current) {
    if (!target) return
    selectionRef.current = {
      start: target.selectionStart,
      end: target.selectionEnd,
    }
  }

  async function insertImage() {
    setIsInsertingImage(true)
    try {
      const markdown = await onRequestImageMarkdown()
      if (!markdown) return
      const textarea = textareaRef.current
      const activeSelection = textarea && document.activeElement === textarea && selectionRef.current
        ? { start: textarea.selectionStart, end: textarea.selectionEnd }
        : selectionRef.current
      const fallbackIndex = defaultImageInsertionIndex(value)
      const start = clampIndex(activeSelection?.start ?? fallbackIndex, value.length)
      const end = clampIndex(activeSelection?.end ?? start, value.length)
      const before = value.slice(0, start)
      const after = value.slice(end)
      const prefix = before && !before.endsWith('\n') ? '\n\n' : ''
      const suffix = after && !after.startsWith('\n') ? '\n\n' : '\n'
      const insertion = `${prefix}${markdown}${suffix}`
      const nextValue = `${before}${insertion}${after}`
      const nextCursor = before.length + insertion.length
      onChange(nextValue)
      selectionRef.current = { start: nextCursor, end: nextCursor }
      window.requestAnimationFrame(() => {
        textarea?.focus()
        textarea?.setSelectionRange(nextCursor, nextCursor)
      })
    } finally {
      setIsInsertingImage(false)
    }
  }

  return (
    <div className="fallback-editor-frame">
      <div className="fallback-editor-tools">
        <button onClick={insertImage} disabled={isInsertingImage} title={text.insertImageTitle}>
          <ImageIcon size={15} />
          {text.insertImage}
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className="fallback-markdown-editor"
        value={value}
        onChange={(event) => {
          rememberSelection(event.target)
          onChange(event.target.value)
        }}
        onClick={() => rememberSelection()}
        onKeyUp={() => rememberSelection()}
        onMouseUp={() => rememberSelection()}
        wrap="off"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            onSave()
          }
        }}
        spellCheck={false}
      />
    </div>
  )
}

function clampIndex(index: number, max: number) {
  return Math.min(Math.max(index, 0), max)
}

function defaultImageInsertionIndex(markdown: string) {
  if (!/^---\r?\n/.test(markdown)) return markdown.length

  const lines = markdown.split(/(\r?\n)/)
  let cursor = lines[0].length + (lines[1]?.length || 0)
  for (let index = 2; index < lines.length; index += 2) {
    const line = lines[index]
    const lineBreak = lines[index + 1] || ''
    if (line === '---') return cursor + line.length + lineBreak.length
    cursor += line.length + lineBreak.length
  }

  return markdown.length
}

function AppErrorFallback({ message }: { message: string }) {
  return (
    <main className="app-shell app-error-screen">
      <div className="app-error-card">
        <strong>Markdown Reader failed to start / 启动失败</strong>
        <p>{message}</p>
      </div>
    </main>
  )
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { message: string }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { message: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return { message: error.message || 'The frontend hit a runtime error. / 前端运行时出现异常。' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Markdown Reader failed to render.', error, info)
  }

  render() {
    if (this.state.message) return <AppErrorFallback message={this.state.message} />
    return this.props.children
  }
}

function isTauri() {
  return Boolean('__TAURI_INTERNALS__' in window)
}

export default App
