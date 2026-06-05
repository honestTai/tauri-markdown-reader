import { Component, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import {
  ArrowUp,
  Bold,
  Code2,
  Copy,
  Download,
  Eye,
  FileDown,
  FileInput,
  FileText,
  FileUp,
  FolderOpen,
  HelpCircle,
  History,
  Image as ImageIcon,
  Italic,
  Languages,
  Link as LinkIcon,
  List,
  ListTree,
  Loader2,
  Lock,
  MapPin,
  Maximize2,
  Minimize2,
  Monitor,
  MoreHorizontal,
  PanelLeftOpen,
  PanelRightClose,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Search,
  TextQuote,
  X,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import 'highlight.js/styles/github.min.css'
import 'katex/dist/katex.min.css'
import './App.css'
import { downloadBase64File, exportFileName, markdownToPlainText, readBundledPdfFont } from './exportHelpers'
import helpGuideEn from './help/markdown-guide.en.md?raw'
import helpGuideZh from './help/markdown-guide.zh.md?raw'
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
  ArticleHistoryItem,
  ArticleStats,
  ArticleSummary,
  ImportDocxResponse,
  ImportPdfResponse,
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

interface DroppedPathInfo {
  path: string
  parent: string
  kind: 'directory' | 'file' | 'unknown'
  extension: string
}

type ImageMarkdownSource =
  | { kind: 'path'; path: string }
  | { kind: 'bytes'; fileName: string; mimeType: string; contentBase64: string }

interface EditorInsertion {
  id: number
  markdown: string
}

type InternalWindow = 'help' | null
type MermaidModule = typeof import('mermaid')
type MarkdownSnippetId = 'table' | 'inlineMath' | 'blockMath' | 'codeBlock' | 'mermaid' | 'callout' | 'frontmatter' | 'taskList' | 'footnote' | 'details' | 'image'

let mermaidModulePromise: Promise<MermaidModule> | null = null
const BUILT_IN_HELP_PREFIX = 'builtin://markdown-reader-help'

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false)
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false)
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false)
  const [internalWindow, setInternalWindow] = useState<InternalWindow>(null)
  const [wordStyle, setWordStyle] = useState<WordStyleId>('codex')
  const [language, setLanguage] = useState<Language>('zh')
  const [readerState, setReaderState] = useState<ReaderState>(defaultReaderState)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState<'html' | 'word' | 'pdf' | null>(null)
  const [importingPdf, setImportingPdf] = useState(false)
  const [importingDocx, setImportingDocx] = useState(false)
  const [notice, setNotice] = useState('')
  const [imagePreview, setImagePreview] = useState('')
  const [pendingEditorInsertion, setPendingEditorInsertion] = useState<EditorInsertion | null>(null)
  const [historyItems, setHistoryItems] = useState<ArticleHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyPreview, setHistoryPreview] = useState<{ item: ArticleHistoryItem; content: string } | null>(null)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const readerStateRef = useRef<ReaderState>(defaultReaderState)
  const isDirtyRef = useRef(false)
  const text = uiText[language]
  const readerScrollRef = useRef<HTMLElement | null>(null)
  const editorScrollRef = useRef<HTMLDivElement | null>(null)
  const scrollSaveTimer = useRef<number | null>(null)
  const currentContent = payload ? editedContent : ''
  const isDirty = Boolean(payload && !isBuiltInHelpPath(payload.path) && editedContent !== payload.content)
  const isCurrentLocked = Boolean(payload && readerState.locked.includes(payload.path))
  const previewContent = livePreviewContent || (isDirty ? editedContent : payload?.preview_content || '')
  const searchTerm = query.trim()
  const articleStyleClass = `article-style-${wordStyle}`
  const previewParsed = useMemo(() => parseArticle(previewContent), [previewContent])
  const shouldRenderArticleHtml = readMode === 'desktop' || isFocusMode
  const articleHtml = useMemo(
    () => (shouldRenderArticleHtml ? highlightHtml(markdownToHtml(previewParsed.body), searchTerm) : ''),
    [previewParsed.body, searchTerm, shouldRenderArticleHtml],
  )
  const readingHtml = useMemo(() => buildReadingHtml(previewContent), [previewContent])
  const outline = useMemo(() => buildOutline(currentContent), [currentContent])
  const stats = useMemo(() => getArticleStats(currentContent), [currentContent])
  const selectedArticle = articles.find((article) => article.path === selectedPath)
  const imageSources = useMemo(() => extractImageSources(currentContent), [currentContent])
  const recentFileSet = useMemo(() => new Set(readerState.recent_files), [readerState.recent_files])
  const favoriteSet = useMemo(() => new Set(readerState.favorites), [readerState.favorites])
  const pinnedSet = useMemo(() => new Set(readerState.pinned), [readerState.pinned])
  const lockedSet = useMemo(() => new Set(readerState.locked), [readerState.locked])
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

  function closeFloatingLayers() {
    const hasDismissibleLayer = isMoreMenuOpen
      || Boolean(imagePreview)
      || Boolean(historyPreview)
      || closeConfirmOpen
      || Boolean(internalWindow)
      || isQuickOpenOpen
      || isSidebarOpen
      || isRightPanelOpen
      || isHistoryPanelOpen
      || Boolean(notice)
    if (!hasDismissibleLayer) return false

    setIsMoreMenuOpen(false)
    setImagePreview('')
    setHistoryPreview(null)
    setCloseConfirmOpen(false)
    setInternalWindow(null)
    closeQuickOpen()
    setIsSidebarOpen(false)
    setIsRightPanelOpen(false)
    setIsHistoryPanelOpen(false)
    setNotice('')
    return true
  }

  function isBuiltInHelpPath(path = payload?.path || '') {
    return path.startsWith(BUILT_IN_HELP_PREFIX)
  }

  function openMarkdownGuide() {
    if (!confirmDiscard()) return
    const content = language === 'zh' ? helpGuideZh : helpGuideEn
    const fileName = language === 'zh' ? 'markdown-reader-guide.zh.md' : 'markdown-reader-guide.en.md'
    const path = `${BUILT_IN_HELP_PREFIX}/${fileName}`
    setSelectedPath(path)
    setPayload({
      path,
      base_dir: BUILT_IN_HELP_PREFIX,
      content,
      preview_content: content,
      missing_images: [],
    })
    setEditedContent(content)
    setLivePreviewContent(content)
    setReadMode('desktop')
    setHistoryItems([])
    setInternalWindow(null)
    setIsSidebarOpen(false)
    setIsRightPanelOpen(false)
    setIsHistoryPanelOpen(false)
    setNotice(text.helpGuideOpened)
  }

  useEffect(() => {
    void bootstrap()
    // The app initializes persisted reader state only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    isDirtyRef.current = isDirty
    if (!isDirty) setCloseConfirmOpen(false)
  }, [isDirty])

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (isTauri()) return
      if (!isDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    if (!isTauri() || !isDirty) return undefined

    let unlisten: (() => void) | null = null
    let disposed = false

    void getCurrentWindow().onCloseRequested((event) => {
      if (!isDirtyRef.current) return
      event.preventDefault()
      setCloseConfirmOpen(true)
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten()
        return
      }
      unlisten = nextUnlisten
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [isDirty])

  async function discardChangesAndCloseWindow() {
    isDirtyRef.current = false
    setCloseConfirmOpen(false)
    if (isTauri()) {
      try {
        await invoke('force_close_app')
      } catch (error) {
        try {
          await getCurrentWindow().destroy()
        } catch (destroyError) {
          isDirtyRef.current = true
          setCloseConfirmOpen(true)
          setNotice(`${text.closeFailed}: ${String(destroyError || error)}`)
        }
      }
      return
    }
    window.close()
  }

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
    const frame = window.requestAnimationFrame(() => {
      renderMermaidDiagrams()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [articleHtml, readMode, isFocusMode])

  useEffect(() => {
    void loadArticleHistory(payload?.path || '')
    // History is tied to the opened article path only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.path])

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
      if (key === 'escape') {
        if (closeFloatingLayers()) {
          event.preventDefault()
          return
        }
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (key === 'p' || key === 'k')) {
        event.preventDefault()
        openQuickOpen()
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'f') {
        event.preventDefault()
        openLibraryPanel()
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
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'p') {
        event.preventDefault()
        void importPdfDraft()
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'd') {
        event.preventDefault()
        void importDocxDraft()
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'i') {
        event.preventDefault()
        void insertImageFromShortcut()
      }
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        void saveMarkdown()
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === '1') {
        event.preventDefault()
        changeReadMode('desktop')
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === '2') {
        event.preventDefault()
        changeReadMode('edit')
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

  useEffect(() => {
    if (!isTauri()) return undefined
    let unlisten: (() => void) | null = null
    let disposed = false

    void getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        void handleDroppedPaths(event.payload.paths)
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten()
      } else {
        unlisten = nextUnlisten
      }
    })

    return () => {
      disposed = true
      unlisten?.()
    }
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

  async function loadArticles(root = workspace, pathToSelect = selectedPath, state = readerState, ask = true) {
    if (!root.trim()) {
      setNotice(text.choosePathFirst)
      return false
    }
    if (ask && !confirmDiscard()) return false
    setLoading(true)
    try {
      const items = isTauri()
        ? await invoke<ArticleSummary[]>('scan_workspace', { workspace: root })
        : demoArticles
      setWorkspace(root)
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
      return true
    } catch (error) {
      setNotice(`${text.loadFailed}: ${String(error)}`)
      return false
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
      await loadArticles(selected, selected)
    }
  }

  async function openRecentWorkspace(path: string) {
    await loadArticles(path, '', readerStateRef.current)
  }

  async function handleDroppedPaths(paths: string[]) {
    if (!paths.length) return
    const imageMarkdown: string[] = []
    for (const path of paths) {
      const info = await invoke<DroppedPathInfo>('describe_dropped_path', { path }).catch((error) => {
        setNotice(`${text.dropFailed}: ${String(error)}`)
        return null
      })
      if (!info) continue

      if (info.kind === 'directory') {
        const opened = await loadArticles(info.path, '', readerStateRef.current)
        if (!opened) return
        continue
      }

      if (info.kind !== 'file') {
        setNotice(text.unsupportedDrop)
        continue
      }

      if (isMarkdownExtension(info.extension)) {
        const root = info.parent || info.path
        const opened = await loadArticles(root, info.path, readerStateRef.current)
        if (!opened) return
        continue
      }

      if (info.extension === 'pdf') {
        await convertPdfDraft(info.path)
        continue
      }

      if (info.extension === 'docx') {
        await convertDocxDraft(info.path)
        continue
      }

      if (isImageExtension(info.extension)) {
        const markdown = await requestImageMarkdown({ kind: 'path', path: info.path })
        if (markdown) imageMarkdown.push(markdown)
        continue
      }

      setNotice(text.unsupportedDrop)
    }

    if (imageMarkdown.length) {
      changeReadMode('edit')
      setPendingEditorInsertion({
        id: Date.now(),
        markdown: imageMarkdown.join('\n'),
      })
    }
  }

  async function importPdfDraft() {
    if (!isTauri()) {
      setNotice(text.browserNoFile)
      return
    }
    const selected = await open({
      multiple: false,
      title: text.pdfImportDialogTitle,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (typeof selected !== 'string') return
    await convertPdfDraft(selected)
  }

  async function convertPdfDraft(selected: string) {
    if (!confirmDiscard()) return
    setImportingPdf(true)
    try {
      const result = await invoke<ImportPdfResponse>('import_pdf_as_markdown', {
        request: { pdfPath: selected, workspace },
      })
      await loadArticles(result.workspace, result.markdownPath, readerStateRef.current, false)
      setPanelTab('outline')
      setNotice(text.pdfImportDone(result.pageCount, result.charCount))
    } catch (error) {
      setNotice(`${text.pdfImportFailed}: ${String(error)}`)
    } finally {
      setImportingPdf(false)
    }
  }

  async function importDocxDraft() {
    if (!isTauri()) {
      setNotice(text.browserNoFile)
      return
    }
    const selected = await open({
      multiple: false,
      title: text.docxImportDialogTitle,
      filters: [{ name: 'Word', extensions: ['docx'] }],
    })
    if (typeof selected !== 'string') return
    await convertDocxDraft(selected)
  }

  async function convertDocxDraft(selected: string) {
    if (!confirmDiscard()) return
    setImportingDocx(true)
    try {
      const result = await invoke<ImportDocxResponse>('import_docx_as_markdown', {
        request: { docxPath: selected, workspace },
      })
      await loadArticles(result.workspace, result.markdownPath, readerStateRef.current, false)
      setPanelTab('outline')
      setNotice(text.docxImportDone(result.paragraphCount, result.tableCount, result.charCount, result.imageCount))
    } catch (error) {
      setNotice(`${text.docxImportFailed}: ${String(error)}`)
    } finally {
      setImportingDocx(false)
    }
  }

  async function saveMarkdown() {
    if (!payload) return
    if (isBuiltInHelpPath(payload.path)) {
      setNotice(text.builtinGuideReadOnly)
      return
    }
    if (isCurrentLocked) {
      setNotice(text.lockedSaveBlocked)
      return
    }
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
      await loadArticleHistory(payload.path)
    } catch (error) {
      setNotice(`${text.saveFailed}: ${String(error)}`)
    }
  }

  async function loadArticleHistory(articlePath = payload?.path || '') {
    if (!articlePath) {
      setHistoryItems([])
      return
    }
    if (articlePath.startsWith(BUILT_IN_HELP_PREFIX)) {
      setHistoryItems([])
      return
    }
    if (!isTauri()) {
      setHistoryItems([])
      return
    }
    setHistoryLoading(true)
    try {
      const items = await invoke<ArticleHistoryItem[]>('list_article_history', {
        request: { articlePath },
      })
      setHistoryItems(items)
    } catch (error) {
      setNotice(`${text.loadHistoryFailed}: ${String(error)}`)
      setHistoryItems([])
    } finally {
      setHistoryLoading(false)
    }
  }

  async function previewArticleHistory(item: ArticleHistoryItem) {
    if (!payload) return
    try {
      const content = await invoke<string>('read_article_history', {
        request: { articlePath: payload.path, historyPath: item.path },
      })
      setHistoryPreview({ item, content })
    } catch (error) {
      setNotice(`${text.loadHistoryFailed}: ${String(error)}`)
    }
  }

  async function restoreArticleHistory(item: ArticleHistoryItem) {
    if (!payload) return
    if (isCurrentLocked) {
      setNotice(text.lockedRestoreBlocked)
      return
    }
    if (!window.confirm(text.restoreHistoryConfirm)) return
    try {
      const nextPayload = await invoke<ArticlePayload>('restore_article_history', {
        request: { articlePath: payload.path, historyPath: item.path },
      })
      setPayload(nextPayload)
      setEditedContent(nextPayload.content)
      setHistoryPreview(null)
      setNotice(text.historyRestored)
      await refreshArticleList(nextPayload.path)
      await loadArticleHistory(nextPayload.path)
    } catch (error) {
      setNotice(`${text.restoreHistoryFailed}: ${String(error)}`)
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
    setExporting('html')
    try {
      await invoke<string>('save_reading_html', {
        articlePath: payload.path,
        html: readingHtml,
      })
      setNotice(text.generatedOpenedReadingHtml)
    } catch (error) {
      setNotice(`${text.htmlExportFailed}: ${String(error)}`)
    } finally {
      setExporting(null)
    }
  }

  async function saveWordDocx() {
    if (!payload) return
    setExporting('word')
    try {
      const { markdownToDocxBase64 } = await import('./word')
      const contentBase64 = await markdownToDocxBase64(previewContent, wordStyle)
      if (!isTauri()) {
        downloadBase64File(contentBase64, exportFileName(selectedArticle?.file_name, 'docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        setNotice(text.browserDownloadedWord)
        return
      }
      await invoke<string>('save_binary_export', {
        request: { articlePath: payload.path, contentBase64, extension: 'docx' },
      })
      setNotice(text.generatedOpenedWord)
    } catch (error) {
      setNotice(`${text.wordExportFailed}: ${String(error)}`)
    } finally {
      setExporting(null)
    }
  }

  async function savePdf() {
    if (!payload) return
    setExporting('pdf')
    try {
      const { markdownToPdfBase64 } = await import('./pdf')
      const fontBase64 = await readBundledPdfFont()
      const contentBase64 = await markdownToPdfBase64(previewContent, fontBase64, wordStyle)
      if (!isTauri()) {
        downloadBase64File(contentBase64, exportFileName(selectedArticle?.file_name, 'pdf'), 'application/pdf')
        setNotice(text.browserDownloadedPdf)
        return
      }
      await invoke<string>('save_binary_export', {
        request: { articlePath: payload.path, contentBase64, extension: 'pdf' },
      })
      setNotice(text.generatedOpenedPdf)
    } catch (error) {
      setNotice(`${text.pdfExportFailed}: ${String(error)}`)
    } finally {
      setExporting(null)
    }
  }

  async function requestImageMarkdown(source?: ImageMarkdownSource) {
    if (!payload) {
      setNotice(text.openMarkdownFirst)
      return null
    }
    if (isCurrentLocked) {
      setNotice(text.lockedImageBlocked)
      return null
    }
    if (!isTauri()) {
      setNotice(text.browserNoLocalImage)
      return null
    }
    try {
      const response = source?.kind === 'bytes'
        ? await invoke<InsertImageAssetResponse>('insert_image_asset_bytes', {
          request: {
            articlePath: payload.path,
            fileName: source.fileName,
            mimeType: source.mimeType,
            contentBase64: source.contentBase64,
          },
        })
        : await insertImageFromPath(source?.kind === 'path' ? source.path : await chooseImagePath(), payload.path)
      if (!response) return null
      setNotice(`${text.insertedImage}: ${response.relativePath}`)
      return response.markdown
    } catch (error) {
      setNotice(`${text.insertImageFailed}: ${String(error)}`)
      return null
    }
  }

  async function chooseImagePath() {
    const selected = await open({
      multiple: false,
      title: text.insertImageTitle,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
    })
    return typeof selected === 'string' ? selected : null
  }

  async function insertImageFromPath(imagePath: string | null, articlePath: string) {
    if (!imagePath) return null
    return invoke<InsertImageAssetResponse>('insert_image_asset', {
      request: { articlePath, imagePath },
    })
  }

  async function insertImageFromShortcut() {
    const markdown = await requestImageMarkdown()
    if (!markdown) return
    changeReadMode('edit')
    setPendingEditorInsertion({ id: Date.now(), markdown })
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

  function toggleLocked(path: string) {
    patchState((current) => ({
      ...current,
      locked: togglePath(current.locked, path),
    }))
    setNotice(lockedSet.has(path) ? text.fileUnlocked : text.fileLocked)
  }

  function updateSettings(settings: Partial<ReaderSettings>) {
    const nextSettings = { ...readerStateRef.current.settings, ...settings }
    if (settings.language) setLanguage(settings.language)
    if (settings.default_export_style) setWordStyle(settings.default_export_style)
    patchState((current) => ({ ...current, settings: nextSettings }))
  }

  async function handleArticleImageClick(event: React.MouseEvent<HTMLElement>) {
    const target = event.target
    if (target instanceof Element) {
      const copyButton = target.closest<HTMLButtonElement>('.code-copy-button')
      if (copyButton) {
        const code = copyButton.closest('.code-block')?.querySelector('code')?.textContent || ''
        if (code) {
          try {
            await navigator.clipboard.writeText(code)
            setNotice(text.copiedCode)
          } catch {
            setNotice(text.copyCodeFailed)
          }
        }
        return
      }
    }
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

  function openPanel(nextTab: PanelTab) {
    setIsSidebarOpen(false)
    setIsHistoryPanelOpen(false)
    if (isRightPanelOpen && panelTab === nextTab) {
      setIsRightPanelOpen(false)
      return
    }
    setPanelTab(nextTab)
    setIsRightPanelOpen(true)
  }

  function toggleHistoryPanel() {
    setIsSidebarOpen(false)
    setIsRightPanelOpen(false)
    setIsHistoryPanelOpen((value) => !value)
  }

  function openLibraryPanel() {
    setIsRightPanelOpen(false)
    setIsHistoryPanelOpen(false)
    setIsSidebarOpen(true)
  }

  function toggleLibraryPanel() {
    if (isSidebarOpen) {
      setIsSidebarOpen(false)
      return
    }
    openLibraryPanel()
  }

  function runMoreAction(action: () => void) {
    setIsMoreMenuOpen(false)
    action()
  }

  function clearLocalHistory() {
    patchState((current) => ({
      ...current,
      last_file: '',
      last_workspace: '',
      reading_positions: {},
      recent_files: [],
      recent_workspaces: [],
    }))
    setNotice(text.historyCleared)
  }

  return (
    <main className={`app-shell ${isFocusMode ? 'focus-active' : ''}`}>
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
          <button className="command-button primary-command" onClick={chooseWorkspace} title={text.openFolder}>
            <FolderOpen size={16} />
            {text.chooseFolder}
          </button>
          <button className="command-button" onClick={openQuickOpen} title={text.quickOpen} disabled={articles.length === 0 && readerState.recent_files.length === 0}>
            <Search size={16} />
            {text.quickOpen}
          </button>
          <button className={`icon-button ${isFocusMode ? 'is-active' : ''}`} onClick={toggleFocusMode} title={isFocusMode ? text.exitFocus : text.focusMode}>
              {isFocusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button className="command-button save-command" onClick={saveMarkdown} disabled={!isDirty || isCurrentLocked} title={isCurrentLocked ? text.lockedSaveBlocked : text.saveMarkdown}>
            <Save size={16} />
            {text.saveMarkdown}
          </button>
          <div className="more-menu-wrap">
            <button className={`icon-button ${isMoreMenuOpen ? 'is-active' : ''}`} onClick={() => setIsMoreMenuOpen((value) => !value)} title={isMoreMenuOpen ? '' : text.moreActions} aria-label={text.moreActions}>
              <MoreHorizontal size={18} />
            </button>
            {isMoreMenuOpen && (
              <div className="more-menu">
                <button onClick={() => runMoreAction(chooseMarkdownFile)}><FileText size={15} />{text.openMarkdownFile}</button>
                <button onClick={() => runMoreAction(importPdfDraft)} disabled={importingPdf}><FileInput size={15} />{text.importPdfDraft}</button>
                <button onClick={() => runMoreAction(importDocxDraft)} disabled={importingDocx}><FileUp size={15} />{text.importDocxDraft}</button>
                <button onClick={() => runMoreAction(toggleLibraryPanel)}><PanelLeftOpen size={15} />{isSidebarOpen ? text.collapseDocs : text.expandDocs}</button>
                <button onClick={() => runMoreAction(() => updateSettings({ language: language === 'zh' ? 'en' : 'zh' }))}><Languages size={15} />{language === 'zh' ? 'English' : '中文'}</button>
                <button onClick={() => runMoreAction(() => loadArticles())} disabled={!workspace.trim()}><RefreshCw size={15} />{text.refresh}</button>
                <button onClick={() => runMoreAction(backToTop)} disabled={!payload}><ArrowUp size={15} />{text.top}</button>
                <button onClick={() => runMoreAction(() => setInternalWindow('help'))}><HelpCircle size={15} />{text.help}</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className={`workbench ${isFocusMode ? 'focus-mode' : ''}`}>
        {isSidebarOpen && !isFocusMode && (
          <LibrarySidebar
            articles={articles}
            favoriteSet={favoriteSet}
            groupedArticles={groupedArticles}
            language={language}
            libraryFilter={libraryFilter}
            loading={loading}
            lockedSet={lockedSet}
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
            onClose={() => setIsSidebarOpen(false)}
            onSelectArticle={(path) => {
              void selectArticle(path)
              setIsSidebarOpen(false)
            }}
            onSortChange={setSortMode}
            onToggleFavorite={toggleFavorite}
            onToggleLocked={toggleLocked}
            onTogglePinned={togglePinned}
          />
        )}

        <section className={`reader-panel ${isFocusMode ? 'focus-reader' : ''}`}>
          {isFocusMode ? (
            <FocusReader
              articleHtml={articleHtml}
              articleStyleClass={articleStyleClass}
              editedContent={editedContent}
              editorScrollRef={editorScrollRef}
              isDirty={isDirty}
              isLocked={isCurrentLocked}
              keepOutline={false}
              language={language}
              loading={loading}
              onArticleImageClick={handleArticleImageClick}
              onChange={setEditedContent}
              onExitFocus={toggleFocusMode}
              onOutlineSelect={jumpToOutline}
              onRequestImageMarkdown={requestImageMarkdown}
              onSave={saveMarkdown}
              onScroll={rememberScroll}
              outline={outline}
              payload={payload}
              pendingInsertion={pendingEditorInsertion}
              previewParsed={previewParsed}
              readerScrollRef={readerScrollRef}
              selectedFileName={selectedArticle?.file_name}
              stats={stats}
              text={text}
            />
          ) : (
            <>
              <div className="reader-tabs">
                <button className={readMode === 'desktop' ? 'selected' : ''} onClick={() => changeReadMode('desktop')} title={text.desktopReading} aria-label={text.desktopReading}>
                  <Monitor size={16} />
                  {text.desktopReading}
                </button>
                <button className={readMode === 'edit' ? 'selected' : ''} onClick={() => changeReadMode('edit')} title={text.edit} aria-label={text.edit}>
                  <PencilLine size={16} />
                  {text.edit}
                </button>
                {isDirty && <span className="dirty-badge">{text.unsaved}</span>}
                {isCurrentLocked && <span className="lock-badge"><Lock size={13} />{text.locked}</span>}
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
                  pendingInsertion={pendingEditorInsertion}
                  payload={payload}
                  previewParsed={previewParsed}
                  readMode={readMode}
                  recentWorkspaces={readerState.recent_workspaces}
                  selectedArticle={selectedArticle}
                  text={text}
                  value={editedContent}
                  isDirty={isDirty}
                  isLocked={isCurrentLocked}
                  onChange={setEditedContent}
                  editorScrollRef={editorScrollRef}
                  onOpenRecentWorkspace={openRecentWorkspace}
                  workspace={workspace}
                />
              </article>
            </>
          )}
        </section>

      </section>

      {!isSidebarOpen && !isFocusMode && (
        <button className="floating-library-button" onClick={openLibraryPanel} title={text.expandDocs} aria-label={text.expandDocs}>
          <PanelLeftOpen size={18} />
        </button>
      )}

      {!isFocusMode && (
        <FloatingToolRail
          isPanelOpen={isRightPanelOpen}
          isHistoryOpen={isHistoryPanelOpen}
          activeTab={panelTab}
          text={text}
          onOpenHelp={() => setInternalWindow('help')}
          onOpenPanel={openPanel}
          onToggleHistory={toggleHistoryPanel}
        />
      )}

      {isRightPanelOpen && !isFocusMode && (
        <aside className="right-panel" aria-label={text.expandPanel}>
          <div className="panel-tabs">
            <button className="panel-toggle" onClick={() => setIsRightPanelOpen(false)} title={text.drawerClose}>
              <PanelRightClose size={15} />
            </button>
            <button className={panelTab === 'outline' ? 'selected' : ''} onClick={() => setPanelTab('outline')}>
              <ListTree size={14} />
              <span>{text.outline}</span>
            </button>
            <button className={panelTab === 'actions' ? 'selected' : ''} onClick={() => setPanelTab('actions')}>
              <Download size={14} />
              <span>{text.actions}</span>
            </button>
            <button className={panelTab === 'settings' ? 'selected' : ''} onClick={() => setPanelTab('settings')}>
              <Settings size={14} />
              <span>{text.settings}</span>
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
              disabled={!payload || Boolean(exporting)}
              exporting={exporting}
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
              onClearHistory={clearLocalHistory}
              onUseCurrentWorkspace={() => {
                updateSettings({ default_workspace: workspace })
                setNotice(text.stateSaved)
              }}
            />
          )}
        </aside>
      )}

      {isHistoryPanelOpen && !isFocusMode && (
        <aside className="history-floating-panel" aria-label={text.editHistory}>
          <div className="floating-panel-head">
            <div>
              <History size={16} />
              <strong>{text.editHistory}</strong>
            </div>
            <button className="panel-toggle" onClick={() => setIsHistoryPanelOpen(false)} title={text.drawerClose}>
              <X size={15} />
            </button>
          </div>
          <HistoryPanel
            historyItems={historyItems}
            loading={historyLoading}
            text={text}
            onPreview={previewArticleHistory}
            onRefresh={() => loadArticleHistory()}
            onRestore={restoreArticleHistory}
          />
        </aside>
      )}

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

      {internalWindow === 'help' && (
        <InternalWindow icon={<HelpCircle size={17} />} title={text.help} text={text} onClose={() => setInternalWindow(null)}>
          <HelpPanel text={text} onOpenMarkdownGuide={openMarkdownGuide} />
        </InternalWindow>
      )}

      {historyPreview && (
        <InternalWindow icon={<History size={17} />} title={text.editHistory} text={text} wide onClose={() => setHistoryPreview(null)}>
          <div className="history-preview">
            <div className="history-preview-bar">
              <div>
                <strong>{formatHistoryTime(historyPreview.item.modified)}</strong>
                <span>{historyPreview.item.fileName}</span>
              </div>
              <button className="command-button" onClick={() => restoreArticleHistory(historyPreview.item)}>
                <RotateCcw size={15} />
                {text.restoreHistory}
              </button>
            </div>
            <pre>{historyPreview.content}</pre>
          </div>
        </InternalWindow>
      )}

      {closeConfirmOpen && (
        <UnsavedCloseDialog
          text={text}
          onCancel={() => setCloseConfirmOpen(false)}
          onDiscard={() => {
            void discardChangesAndCloseWindow()
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

function FloatingToolRail({
  activeTab,
  isHistoryOpen,
  isPanelOpen,
  text,
  onOpenHelp,
  onOpenPanel,
  onToggleHistory,
}: {
  activeTab: PanelTab
  isHistoryOpen: boolean
  isPanelOpen: boolean
  text: UiText
  onOpenHelp: () => void
  onOpenPanel: (tab: PanelTab) => void
  onToggleHistory: () => void
}) {
  return (
    <nav className="floating-tool-rail" aria-label={text.expandPanel}>
      <button className={isPanelOpen && activeTab === 'outline' ? 'selected' : ''} onClick={() => onOpenPanel('outline')} title={text.outline}>
        <ListTree size={18} />
      </button>
      <button className={isPanelOpen && activeTab === 'actions' ? 'selected' : ''} onClick={() => onOpenPanel('actions')} title={text.actions}>
        <Download size={18} />
      </button>
      <button className={isHistoryOpen ? 'selected' : ''} onClick={onToggleHistory} title={text.editHistory}>
        <History size={18} />
      </button>
      <button className={isPanelOpen && activeTab === 'settings' ? 'selected' : ''} onClick={() => onOpenPanel('settings')} title={text.settings}>
        <Settings size={18} />
      </button>
      <button onClick={onOpenHelp} title={text.openHelpWindow}>
        <HelpCircle size={18} />
      </button>
    </nav>
  )
}

function UnsavedCloseDialog({
  text,
  onCancel,
  onDiscard,
}: {
  text: UiText
  onCancel: () => void
  onDiscard: () => void
}) {
  const discardRequestedRef = useRef(false)

  function requestDiscard() {
    if (discardRequestedRef.current) return
    discardRequestedRef.current = true
    onDiscard()
  }

  return (
    <div className="internal-window-backdrop close-confirm-backdrop" onMouseDown={onCancel}>
      <section
        className="internal-window close-confirm-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            requestDiscard()
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-label={text.unsaved}
      >
        <div className="internal-window-head">
          <div>
            <Save size={17} />
            <strong>{text.unsaved}</strong>
          </div>
          <button className="panel-toggle" onClick={onCancel} title={text.cancel}>
            <X size={16} />
          </button>
        </div>
        <div className="close-confirm-body">
          <p>{text.closeDiscardPrompt}</p>
          <div className="close-confirm-actions">
            <button type="button" className="command-button" onClick={onCancel}>{text.cancel}</button>
            <button type="button" className="danger-action strong" onClick={requestDiscard} autoFocus>{text.discardAndClose}</button>
          </div>
        </div>
      </section>
    </div>
  )
}

function InternalWindow({
  children,
  icon,
  text,
  title,
  wide = false,
  onClose,
}: {
  children: ReactNode
  icon: ReactNode
  text: UiText
  title: string
  wide?: boolean
  onClose: () => void
}) {
  return (
    <div className="internal-window-backdrop" onMouseDown={onClose}>
      <section className={`internal-window ${wide ? 'wide' : ''}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="internal-window-head">
          <div>
            {icon}
            <strong>{title}</strong>
          </div>
          <button className="panel-toggle" onClick={onClose} title={text.closeWindow}>
            <X size={16} />
          </button>
        </div>
        <div className="internal-window-body">{children}</div>
      </section>
    </div>
  )
}

function ReaderContent({
  articleHtml,
  articleStyleClass,
  editorScrollRef,
  isDirty,
  isLocked,
  loading,
  onChange,
  onChooseFile,
  onChooseWorkspace,
  onRequestImageMarkdown,
  onSave,
  onOpenRecentWorkspace,
  pendingInsertion,
  payload,
  previewParsed,
  readMode,
  recentWorkspaces,
  selectedArticle,
  text,
  value,
  workspace,
}: {
  articleHtml: string
  articleStyleClass: string
  editorScrollRef: RefObject<HTMLDivElement | null>
  isDirty: boolean
  isLocked: boolean
  loading: boolean
  onChange: (value: string) => void
  onChooseFile: () => void
  onChooseWorkspace: () => void
  onRequestImageMarkdown: (source?: ImageMarkdownSource) => Promise<string | null>
  onSave: () => void
  onOpenRecentWorkspace: (path: string) => void
  pendingInsertion: EditorInsertion | null
  payload: ArticlePayload | null
  previewParsed: { title: string; digest: string }
  readMode: ReadMode
  recentWorkspaces: string[]
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
        {recentWorkspaces.length > 0 && (
          <div className="recent-workspaces">
            <span>{text.recentWorkspaces}</span>
            {recentWorkspaces.slice(0, 3).map((path) => (
              <button type="button" key={path} onClick={() => onOpenRecentWorkspace(path)}>
                <MapPin size={14} />
                <small>{path}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (readMode === 'edit') {
    return (
      <div className="editor-shell">
        <div className="editor-bar">
          <div>
            <strong>{selectedArticle?.file_name || 'Markdown'}</strong>
            <span>{isLocked ? text.lockedEditing : (isDirty ? text.dirty : text.saved)}</span>
          </div>
          <button className="command-button" onClick={onSave} disabled={!isDirty || isLocked} title={isLocked ? text.lockedSaveBlocked : text.saveMarkdown}>
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
          pendingInsertion={pendingInsertion}
          readOnly={isLocked}
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
  editedContent,
  editorScrollRef,
  isDirty,
  isLocked,
  keepOutline,
  language,
  loading,
  onArticleImageClick,
  onChange,
  onExitFocus,
  onOutlineSelect,
  onRequestImageMarkdown,
  onSave,
  onScroll,
  outline,
  payload,
  pendingInsertion,
  previewParsed,
  readerScrollRef,
  selectedFileName,
  stats,
  text,
}: {
  articleHtml: string
  articleStyleClass: string
  editedContent: string
  editorScrollRef: RefObject<HTMLDivElement | null>
  isDirty: boolean
  isLocked: boolean
  keepOutline: boolean
  language: Language
  loading: boolean
  onArticleImageClick: (event: React.MouseEvent<HTMLElement>) => void
  onChange: (value: string) => void
  onExitFocus: () => void
  onOutlineSelect: (item: OutlineItem) => void
  onRequestImageMarkdown: (source?: ImageMarkdownSource) => Promise<string | null>
  onSave: () => void
  onScroll: () => void
  outline: OutlineItem[]
  payload: ArticlePayload | null
  pendingInsertion: EditorInsertion | null
  previewParsed: { title: string; digest: string }
  readerScrollRef: RefObject<HTMLElement | null>
  selectedFileName?: string
  stats: ArticleStats
  text: UiText
}) {
  return (
    <section className={`focus-reading-layout focus-writing-layout ${!keepOutline ? 'without-outline' : ''}`}>
      <div className="focus-writing-main">
        <div className="focus-reading-bar">
          <div>
            <strong>{selectedFileName || text.noOpenedDoc}</strong>
            <span>{isLocked ? text.lockedEditing : text.focusWritePreview}</span>
          </div>
          {payload && (
            <div className="focus-actions">
              <div className="stats-strip focus-stats">
                <span>{formatWordCount(stats.words, language)}</span>
                <span>{formatReadingMinutes(stats.readingMinutes, language)}</span>
                <span>{formatImageCount(stats.images, language, true)}</span>
              </div>
              {isLocked && <span className="lock-badge compact"><Lock size={13} />{text.locked}</span>}
              <button className="icon-button" onClick={onSave} title={isLocked ? text.lockedSaveBlocked : text.saveMarkdown} disabled={!isDirty || isLocked}>
                <Save size={15} />
              </button>
              <button className="icon-button" onClick={onExitFocus} title={text.exitFocus}>
                <Minimize2 size={15} />
              </button>
            </div>
          )}
        </div>
        <div className="focus-writing-split">
          <section className="focus-editor-pane">
            <div className="focus-pane-head">
              <PencilLine size={15} />
              <strong>{text.edit}</strong>
            </div>
            {loading && <div className="loading">{text.loading}</div>}
            {!loading && !payload && <div className="empty-reader"><FileText size={34} /><p>{text.selectMarkdownDoc}</p></div>}
            {!loading && payload && (
              <RichMarkdownEditor
                scrollRef={editorScrollRef}
                value={editedContent}
                onChange={onChange}
                onRequestImageMarkdown={onRequestImageMarkdown}
                onSave={onSave}
                pendingInsertion={pendingInsertion}
                readOnly={isLocked}
                text={text}
              />
            )}
          </section>
          <section className="focus-preview-pane">
            <div className="focus-pane-head">
              <Eye size={15} />
              <strong>{text.livePreview}</strong>
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
          </section>
        </div>
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
  exporting,
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
  exporting: 'html' | 'word' | 'pdf' | null
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
        <button className="primary-export-button" onClick={onSaveWordDocx} disabled={disabled}>
          {exporting === 'word' ? <Loader2 className="spin-icon" size={15} /> : <FileDown size={15} />}
          {exporting === 'word' ? text.exporting : 'Word'}
          <span>{text.wordDescription}</span>
        </button>
        <button className="primary-export-button" onClick={onSavePdf} disabled={disabled}>
          {exporting === 'pdf' ? <Loader2 className="spin-icon" size={15} /> : <FileDown size={15} />}
          {exporting === 'pdf' ? text.exporting : 'PDF'}
          <span>{text.pdfDescription}</span>
        </button>
      </div>
      <div className="action-list">
        <button onClick={onCopyMarkdown} disabled={disabled}><Copy size={14} />{text.copyMarkdown}</button>
        <button onClick={onCopyPlainText} disabled={disabled}><Copy size={14} />{text.copyPlainText}</button>
        <button onClick={onCopyHtml} disabled={disabled}><Copy size={14} />{text.copyHtml}</button>
        <button onClick={onSaveHtml} disabled={disabled}>
          {exporting === 'html' ? <Loader2 className="spin-icon" size={14} /> : <Download size={14} />}
          {exporting === 'html' ? text.exporting : text.saveHtml}
        </button>
      </div>
    </div>
  )
}

function HistoryPanel({
  historyItems,
  loading,
  text,
  onPreview,
  onRefresh,
  onRestore,
}: {
  historyItems: ArticleHistoryItem[]
  loading: boolean
  text: UiText
  onPreview: (item: ArticleHistoryItem) => void
  onRefresh: () => void
  onRestore: (item: ArticleHistoryItem) => void
}) {
  return (
    <div className="panel-content history-panel">
      <div className="history-summary">
        <History size={18} />
        <div>
          <strong>{text.currentFileHistory}</strong>
          <span>{loading ? text.loading : `${historyItems.length}`}</span>
        </div>
        <button className="row-tool" type="button" onClick={onRefresh} title={text.refresh}>
          <RefreshCw size={14} />
        </button>
      </div>
      {historyItems[0] && (
        <button className="restore-latest-button" type="button" onClick={() => onRestore(historyItems[0])}>
          <RotateCcw size={15} />
          <span>{text.restorePreviousVersion}</span>
          <small>{text.latestBackupVersion} · {formatHistoryTime(historyItems[0].modified)}</small>
        </button>
      )}
      <p className="history-safety-note">{text.restoreSafetyNote}</p>
      {historyItems.length === 0 && (
        <div className="empty-mini"><History size={22} /><p>{text.noEditHistory}</p></div>
      )}
      <div className="edit-history-list">
        {historyItems.map((item) => (
          <article className="edit-history-item" key={item.path}>
            <div>
              <strong>{text.latestBackupVersion}</strong>
              <span>{formatHistorySize(item.size)}</span>
              <small>{formatHistoryTime(item.modified)} · {item.fileName}</small>
            </div>
            <div className="edit-history-actions">
              <button type="button" onClick={() => onPreview(item)}>{text.historyPreview}</button>
              <button type="button" onClick={() => onRestore(item)}>
                <RotateCcw size={13} />
                {text.restoreHistory}
              </button>
            </div>
          </article>
        ))}
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
  onClearHistory,
  onUseCurrentWorkspace,
}: {
  language: Language
  settings: ReaderSettings
  text: UiText
  wordStyle: WordStyleId
  onChange: (settings: Partial<ReaderSettings>) => void
  onClearHistory: () => void
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
      <label className="settings-row">
        <span>{text.recentDocuments}</span>
        <button className="danger-action" type="button" onClick={onClearHistory}>{text.clearLocalHistory}</button>
      </label>
    </div>
  )
}

function HelpPanel({ text, onOpenMarkdownGuide }: { text: UiText; onOpenMarkdownGuide: () => void }) {
  return (
    <div className="panel-content help-panel">
      <div className="help-guide-callout">
        <div>
          <strong>{text.markdownGuideTitle}</strong>
          <span>{text.markdownGuideDescription}</span>
        </div>
        <button type="button" className="help-guide-button" onClick={onOpenMarkdownGuide}>
          <FileText size={15} />
          {text.openMarkdownGuide}
        </button>
      </div>
      {text.helpSections.map((section) => (
        <section key={section.title} className="help-section">
          <h3>{section.title}</h3>
          <ul>
            {section.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ))}
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
  readOnly = false,
  scrollRef,
  text,
  value,
  onChange,
  onRequestImageMarkdown,
  onSave,
  pendingInsertion,
}: {
  readOnly?: boolean
  scrollRef: RefObject<HTMLDivElement | null>
  text: UiText
  value: string
  onChange: (value: string) => void
  onRequestImageMarkdown: (source?: ImageMarkdownSource) => Promise<string | null>
  onSave: () => void
  pendingInsertion: EditorInsertion | null
}) {
  return (
    <div ref={scrollRef} className="rich-editor-scroll">
      <FallbackMarkdownEditor value={value} onChange={onChange} onRequestImageMarkdown={onRequestImageMarkdown} onSave={onSave} pendingInsertion={pendingInsertion} readOnly={readOnly} text={text} />
    </div>
  )
}

function FallbackMarkdownEditor({
  readOnly = false,
  text,
  value,
  onChange,
  onRequestImageMarkdown,
  onSave,
  pendingInsertion,
}: {
  readOnly?: boolean
  text: UiText
  value: string
  onChange: (value: string) => void
  onRequestImageMarkdown: (source?: ImageMarkdownSource) => Promise<string | null>
  onSave: () => void
  pendingInsertion: EditorInsertion | null
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const selectionRef = useRef<{ start: number, end: number } | null>(null)
  const consumedInsertionRef = useRef(0)
  const [isInsertingImage, setIsInsertingImage] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, start: number, end: number } | null>(null)

  function rememberSelection(target = textareaRef.current) {
    if (!target) return
    selectionRef.current = {
      start: target.selectionStart,
      end: target.selectionEnd,
    }
  }

  function getCurrentSelection() {
    const textarea = textareaRef.current
    if (textarea && document.activeElement === textarea) {
      return {
        start: clampIndex(textarea.selectionStart, value.length),
        end: clampIndex(textarea.selectionEnd, value.length),
      }
    }
    const saved = selectionRef.current || { start: value.length, end: value.length }
    return {
      start: clampIndex(saved.start, value.length),
      end: clampIndex(saved.end, value.length),
    }
  }

  function insertMarkdown(markdown: string) {
    if (readOnly) return
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
  }

  useEffect(() => {
    if (readOnly) return
    if (!pendingInsertion || consumedInsertionRef.current === pendingInsertion.id) return
    consumedInsertionRef.current = pendingInsertion.id
    insertMarkdown(pendingInsertion.markdown)
    // pendingInsertion is intentionally the trigger; value is read from the render that received it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInsertion, readOnly])

  useEffect(() => {
    if (!contextMenu) return undefined
    function closeContextMenu(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setContextMenu(null)
    }
    window.addEventListener('keydown', closeContextMenu)
    return () => window.removeEventListener('keydown', closeContextMenu)
  }, [contextMenu])

  async function insertImage() {
    if (readOnly) return
    setIsInsertingImage(true)
    try {
      const markdown = await onRequestImageMarkdown()
      if (!markdown) return
      insertMarkdown(markdown)
    } finally {
      setIsInsertingImage(false)
    }
  }

  async function pasteImage(file: File) {
    if (readOnly) return
    setIsInsertingImage(true)
    try {
      const contentBase64 = await blobToBase64(file)
      const markdown = await onRequestImageMarkdown({
        kind: 'bytes',
        fileName: file.name || `pasted-image-${Date.now()}.png`,
        mimeType: file.type || 'image/png',
        contentBase64,
      })
      if (markdown) insertMarkdown(markdown)
    } finally {
      setIsInsertingImage(false)
    }
  }

  function replaceSelection(nextValue: string, cursorStart: number, cursorEnd = cursorStart) {
    if (readOnly) return
    onChange(nextValue)
    selectionRef.current = { start: cursorStart, end: cursorEnd }
    setContextMenu(null)
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(cursorStart, cursorEnd)
    })
  }

  function replaceRange(start: number, end: number, replacement: string, selectionStart = start + replacement.length, selectionEnd = selectionStart) {
    const safeStart = clampIndex(Math.min(start, end), value.length)
    const safeEnd = clampIndex(Math.max(start, end), value.length)
    const nextValue = `${value.slice(0, safeStart)}${replacement}${value.slice(safeEnd)}`
    replaceSelection(nextValue, selectionStart, selectionEnd)
  }

  function wrapSelection(prefix: string, suffix: string, placeholder: string) {
    const selection = contextMenu || getCurrentSelection()
    const start = clampIndex(selection.start, value.length)
    const end = clampIndex(selection.end, value.length)
    const selected = value.slice(start, end) || placeholder
    const nextValue = `${value.slice(0, start)}${prefix}${selected}${suffix}${value.slice(end)}`
    const cursorStart = start + prefix.length
    const cursorEnd = cursorStart + selected.length
    replaceSelection(nextValue, cursorStart, cursorEnd)
  }

  function insertAtLineStart(prefix: string, placeholder: string) {
    const selection = contextMenu || getCurrentSelection()
    const start = clampIndex(selection.start, value.length)
    const end = clampIndex(selection.end, value.length)
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const linePrefix = value.slice(lineStart, start)
    const selected = value.slice(start, end) || placeholder
    const block = selected
      .split(/\r?\n/)
      .map((line) => `${prefix}${line}`)
      .join('\n')
    const nextValue = `${value.slice(0, lineStart)}${linePrefix}${block}${value.slice(end)}`
    const cursorStart = lineStart + linePrefix.length + prefix.length
    const cursorEnd = lineStart + linePrefix.length + block.length
    replaceSelection(nextValue, cursorStart, cursorEnd)
  }

  function insertMarkdownSnippet(snippetId: MarkdownSnippetId) {
    const selection = contextMenu || getCurrentSelection()
    const start = clampIndex(selection.start, value.length)
    const end = clampIndex(selection.end, value.length)
    const selected = value.slice(start, end)
    const snippet = buildMarkdownSnippet(snippetId, selected, text)
    const before = value.slice(0, start)
    const after = value.slice(end)
    const prefix = before && !before.endsWith('\n') ? '\n\n' : ''
    const suffix = after && !after.startsWith('\n') ? '\n\n' : '\n'
    const insertion = snippet.inline ? snippet.value : `${prefix}${snippet.value}${suffix}`
    replaceRange(start, end, insertion)
  }

  function makeHeading(level: 1 | 2 | 3) {
    const marker = `${'#'.repeat(level)} `
    insertAtLineStart(marker, text.headingPlaceholder)
  }

  function copySelection() {
    const selection = contextMenu || getCurrentSelection()
    const selected = value.slice(selection.start, selection.end)
    setContextMenu(null)
    if (!selected) return
    void navigator.clipboard.writeText(selected)
  }

  function runEditorCommand(event: ReactKeyboardEvent<HTMLTextAreaElement>, command: () => void) {
    event.preventDefault()
    event.stopPropagation()
    if (readOnly) return
    command()
  }

  function handleEditorShortcut(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (readOnly) return false
    const key = event.key.toLowerCase()
    const mod = event.ctrlKey || event.metaKey
    if (!mod) return false

    if (!event.shiftKey && !event.altKey && key === 's') {
      runEditorCommand(event, onSave)
      return true
    }
    if (!event.shiftKey && !event.altKey && key === 'b') {
      runEditorCommand(event, () => wrapSelection('**', '**', text.boldPlaceholder))
      return true
    }
    if (!event.shiftKey && !event.altKey && key === 'i') {
      runEditorCommand(event, () => wrapSelection('_', '_', text.italicPlaceholder))
      return true
    }
    if (!event.shiftKey && !event.altKey && key === '`') {
      runEditorCommand(event, () => wrapSelection('`', '`', text.codePlaceholder))
      return true
    }
    if (!event.shiftKey && !event.altKey && key === 'k') {
      runEditorCommand(event, () => wrapSelection('[', '](https://)', text.linkPlaceholder))
      return true
    }
    if (event.shiftKey && !event.altKey && key === 'm') {
      runEditorCommand(event, () => insertMarkdownSnippet('inlineMath'))
      return true
    }
    if (!event.shiftKey && event.altKey && key === 'm') {
      runEditorCommand(event, () => insertMarkdownSnippet('blockMath'))
      return true
    }
    if (event.shiftKey && !event.altKey && key === 't') {
      runEditorCommand(event, () => insertMarkdownSnippet('table'))
      return true
    }
    if (event.shiftKey && !event.altKey && key === 'c') {
      runEditorCommand(event, () => insertMarkdownSnippet('codeBlock'))
      return true
    }
    if (event.shiftKey && !event.altKey && key === 'g') {
      runEditorCommand(event, () => insertMarkdownSnippet('mermaid'))
      return true
    }
    if (event.shiftKey && !event.altKey && key === 'q') {
      runEditorCommand(event, () => insertAtLineStart('> ', text.quotePlaceholder))
      return true
    }
    if (event.shiftKey && !event.altKey && key === 'l') {
      runEditorCommand(event, () => insertAtLineStart('- ', text.listPlaceholder))
      return true
    }
    if (event.shiftKey && !event.altKey && key === 'x') {
      runEditorCommand(event, () => insertMarkdownSnippet('taskList'))
      return true
    }

    return false
  }

  return (
    <div className={readOnly ? 'fallback-editor-frame is-readonly' : 'fallback-editor-frame'}>
      <div className="fallback-editor-tools">
        <button onClick={insertImage} disabled={readOnly || isInsertingImage} title={readOnly ? text.lockedSaveBlocked : text.insertImageTitle}>
          <ImageIcon size={15} />
        </button>
        <button onClick={() => wrapSelection('**', '**', text.boldPlaceholder)} disabled={readOnly} title={shortcutTitle(text.bold, 'Ctrl/Cmd+B')}>
          <Bold size={15} />
        </button>
        <button onClick={() => wrapSelection('_', '_', text.italicPlaceholder)} disabled={readOnly} title={shortcutTitle(text.italic, 'Ctrl/Cmd+I')}>
          <Italic size={15} />
        </button>
        <button onClick={() => wrapSelection('`', '`', text.codePlaceholder)} disabled={readOnly} title={shortcutTitle(text.inlineCode, 'Ctrl/Cmd+`')}>
          <Code2 size={15} />
        </button>
        <button onClick={() => insertAtLineStart('> ', text.quotePlaceholder)} disabled={readOnly} title={shortcutTitle(text.quote, 'Ctrl/Cmd+Shift+Q')}>
          <TextQuote size={15} />
        </button>
        <button onClick={() => insertAtLineStart('- ', text.listPlaceholder)} disabled={readOnly} title={shortcutTitle(text.list, 'Ctrl/Cmd+Shift+L')}>
          <List size={15} />
        </button>
        <button onClick={() => wrapSelection('[', '](https://)', text.linkPlaceholder)} disabled={readOnly} title={shortcutTitle(text.link, 'Ctrl/Cmd+K')}>
          <LinkIcon size={15} />
        </button>
        <label className="prompt-template-select" title={text.markdownSyntax}>
          <Code2 size={15} />
          <select
            disabled={readOnly}
            value=""
            onChange={(event) => {
              const snippetId = event.target.value as MarkdownSnippetId
              if (snippetId) insertMarkdownSnippet(snippetId)
              event.currentTarget.value = ''
            }}
          >
            <option value="">{text.markdownSyntax}</option>
            <option value="table">{text.syntaxTable}</option>
            <option value="inlineMath">{text.syntaxInlineMath}</option>
            <option value="blockMath">{text.syntaxBlockMath}</option>
            <option value="codeBlock">{text.syntaxCodeBlock}</option>
            <option value="mermaid">{text.syntaxMermaid}</option>
            <option value="callout">{text.syntaxCallout}</option>
            <option value="frontmatter">{text.syntaxFrontmatter}</option>
            <option value="taskList">{text.syntaxTaskList}</option>
            <option value="footnote">{text.syntaxFootnote}</option>
            <option value="details">{text.syntaxDetails}</option>
            <option value="image">{text.syntaxImage}</option>
          </select>
        </label>
        <span>{formatEditorStats(value, text)}</span>
      </div>
      <textarea
        ref={textareaRef}
        className="fallback-markdown-editor"
        readOnly={readOnly}
        value={value}
        onChange={(event) => {
          if (readOnly) return
          rememberSelection(event.target)
          onChange(event.target.value)
        }}
        onClick={() => rememberSelection()}
        onKeyUp={() => rememberSelection()}
        onMouseUp={(event) => {
          rememberSelection(event.currentTarget)
          setContextMenu(null)
        }}
        onContextMenu={(event) => {
          if (readOnly) return
          rememberSelection(event.currentTarget)
          const selected = event.currentTarget.value.slice(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)
          if (!selected.trim()) return
          event.preventDefault()
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          })
        }}
        onPaste={(event) => {
          if (readOnly) return
          const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'))
          const file = imageItem?.getAsFile()
          if (!file) return
          event.preventDefault()
          rememberSelection(event.currentTarget)
          void pasteImage(file)
        }}
        wrap="off"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && contextMenu) {
            event.preventDefault()
            event.stopPropagation()
            setContextMenu(null)
            return
          }
          handleEditorShortcut(event)
        }}
        spellCheck={false}
      />
      {contextMenu && (
        <div className="editor-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.preventDefault()}>
          <div className="context-menu-title">{text.selectionActions}</div>
          <button type="button" onClick={() => wrapSelection('**', '**', text.boldPlaceholder)}><Bold size={14} />{text.bold}</button>
          <button type="button" onClick={() => wrapSelection('`', '`', text.codePlaceholder)}><Code2 size={14} />{text.inlineCode}</button>
          <button type="button" onClick={() => insertAtLineStart('> ', text.quotePlaceholder)}><TextQuote size={14} />{text.quote}</button>
          <button type="button" onClick={() => makeHeading(2)}><ListTree size={14} />{text.heading}</button>
          <button type="button" onClick={() => copySelection()}><Copy size={14} />{text.copySelection}</button>
          <div className="context-menu-divider" />
          <button type="button" onClick={() => insertMarkdownSnippet('inlineMath')}><Code2 size={14} />{text.syntaxInlineMath}</button>
          <button type="button" onClick={() => insertMarkdownSnippet('blockMath')}><Code2 size={14} />{text.syntaxBlockMath}</button>
          <button type="button" onClick={() => insertMarkdownSnippet('table')}><List size={14} />{text.syntaxTable}</button>
          <button type="button" onClick={() => insertMarkdownSnippet('codeBlock')}><Code2 size={14} />{text.syntaxCodeBlock}</button>
          <button type="button" onClick={() => insertMarkdownSnippet('taskList')}><List size={14} />{text.syntaxTaskList}</button>
        </div>
      )}
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

function formatEditorStats(value: string, text: UiText) {
  const lines = value ? value.split(/\r?\n/).length : 0
  return text.editorStats(lines, [...value].length)
}

function shortcutTitle(label: string, shortcut: string) {
  return `${label} (${shortcut})`
}

function buildMarkdownSnippet(snippetId: MarkdownSnippetId, selected: string, text: UiText) {
  const trimmed = selected.trim()
  if (snippetId === 'inlineMath') {
    return { value: `$${trimmed || text.mathPlaceholder}$`, inline: true }
  }
  if (snippetId === 'blockMath') {
    return { value: `$$\n${trimmed || 'E = mc^2'}\n$$`, inline: false }
  }
  if (snippetId === 'codeBlock') {
    return { value: `\`\`\`ts\n${trimmed || 'const result = await run()'}\n\`\`\``, inline: false }
  }
  if (snippetId === 'mermaid') {
    return { value: '```mermaid\ngraph TD\n  A[开始] --> B[处理]\n  B --> C[完成]\n```', inline: false }
  }
  if (snippetId === 'callout') {
    return { value: `> [!NOTE]\n> ${trimmed || text.calloutPlaceholder}`, inline: false }
  }
  if (snippetId === 'frontmatter') {
    return { value: `---\ntitle: ${trimmed || text.titlePlaceholder}\ndigest: ${text.digestPlaceholder}\n---`, inline: false }
  }
  if (snippetId === 'taskList') {
    return { value: `- [ ] ${trimmed || text.listPlaceholder}\n- [x] ${text.tableCellExample}`, inline: false }
  }
  if (snippetId === 'footnote') {
    return { value: `${trimmed || text.tableCellDescription}[^1]\n\n[^1]: ${text.footnotePlaceholder}`, inline: false }
  }
  if (snippetId === 'details') {
    return { value: `<details>\n<summary>${text.detailsSummary}</summary>\n\n${trimmed || text.tableCellDescription}\n\n</details>`, inline: false }
  }
  if (snippetId === 'image') {
    return { value: `![${trimmed || text.imageAltPlaceholder}](assets/image.png)`, inline: false }
  }
  return {
    value: `| ${text.tableHeaderName} | ${text.tableHeaderDescription} |\n| --- | --- |\n| ${text.tableCellExample} | ${trimmed || text.tableCellDescription} |`,
    inline: false,
  }
}

function formatHistoryTime(value: number) {
  if (!value) return '-'
  return new Date(value * 1000).toLocaleString()
}

function formatHistorySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`
}

function renderMermaidDiagrams() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('.mermaid[data-mermaid-state="pending"]'))
  if (nodes.length === 0) return
  mermaidModulePromise = mermaidModulePromise || import('mermaid')
  void mermaidModulePromise.then((module) => {
    const mermaid = module.default
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
    })
    nodes.forEach((node, index) => {
      const source = node.textContent || ''
      const id = `markdown-reader-mermaid-${Date.now()}-${index}`
      node.dataset.mermaidState = 'rendering'
      void mermaid.render(id, source)
        .then(({ svg }) => {
          node.innerHTML = svg
          node.dataset.mermaidState = 'done'
        })
        .catch((error) => {
          node.dataset.mermaidState = 'failed'
          node.classList.add('mermaid-error')
          node.textContent = `Mermaid render failed: ${error instanceof Error ? error.message : String(error)}`
        })
    })
  }).catch((error) => {
    nodes.forEach((node) => {
      node.dataset.mermaidState = 'failed'
      node.classList.add('mermaid-error')
      node.textContent = `Mermaid load failed: ${error instanceof Error ? error.message : String(error)}`
    })
  })
}

function isMarkdownExtension(extension: string) {
  return ['md', 'markdown', 'mdown'].includes(extension.toLowerCase())
}

function isImageExtension(extension: string) {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension.toLowerCase())
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      resolve(value.includes(',') ? value.split(',').pop() || '' : value)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
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
