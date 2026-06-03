import { Component, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ErrorInfo, ReactNode, RefObject } from 'react'
import {
  ArrowUp,
  Copy,
  Download,
  FileDown,
  FileSearch,
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
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import './App.css'
import { buildOutline, buildReadingHtml, getArticleStats, markdownToHtml, parseArticle } from './markdown'
import { getWordStylePreset, wordStylePresets } from './wordStyles'
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

const demoArticle: ArticleSummary = {
  path: 'demo.md',
  file_name: 'demo.md',
  title: 'Markdown Reader V2 示例',
  digest: '本地阅读、全文搜索、收藏和导出放进同一个资料浏览工作台。',
  group: '示例',
  status: 'document',
  updated: Math.floor(Date.now() / 1000),
  relative_path: 'demo.md',
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

![系统预览](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwMCIgaGVpZ2h0PSI1NjAiIHZpZXdCb3g9IjAgMCAxMDAwIDU2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwMCIgaGVpZ2h0PSI1NjAiIGZpbGw9IiNmNmY4ZmEiLz48cmVjdCB4PSI2MCIgeT0iNjAiIHdpZHRoPSIyMDAiIGhlaWdodD0iNDQwIiByeD0iOCIgZmlsbD0iI2ZmZmZmZiIgc3Ryb2tlPSIjZTVlN2ViIi8+PHJlY3QgeD0iMzAwIiB5PSI2MCIgd2lkdGg9IjQyMCIgaGVpZ2h0PSI0NDAiIHJ4PSI4IiBmaWxsPSIjZmZmIiBzdHJva2U9IiNlNWU3ZWIiLz48cmVjdCB4PSI3NjAiIHk9IjYwIiB3aWR0aD0iMTgwIiBoZWlnaHQ9IjQ0MCIgcng9IjgiIGZpbGw9IiNmZmYiIHN0cm9rZT0iI2U1ZTdlYiIvPjx0ZXh0IHg9IjMzMCIgeT0iMTUwIiBmb250LXNpemU9IjM2IiBmb250LWZhbWlseT0iQXJpYWwiIGZpbGw9IiMxZjI5MzMiPkxvY2FsIE1hcmtkb3duIFJlYWRpbmc8L3RleHQ+PHRleHQgeD0iMzMwIiB5PSIyMjAiIGZvbnQtc2l6ZT0iMjAiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZmlsbD0iIzYyNzA3YSI+T3V0bGluZSwgc2VhcmNoLCByZWNlbnQgZmlsZXMsIGFuZCBleHBvcnQuPC90ZXh0Pjwvc3ZnPg==)

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

interface InsertImageAssetResponse {
  markdown: string
  relativePath: string
}

const defaultSettings: ReaderSettings = {
  default_workspace: '',
  default_read_mode: 'desktop',
  default_export_style: 'codex',
  restore_last_document: true,
  remember_scroll_position: true,
  focus_keep_outline: true,
  language: 'zh',
}

const defaultReaderState: ReaderState = {
  recent_workspaces: [],
  recent_files: [],
  favorites: [],
  pinned: [],
  reading_positions: {},
  last_workspace: '',
  last_file: '',
  focus_mode: false,
  settings: defaultSettings,
}

const uiText = {
  zh: {
    brandSubtitle: '本地 Markdown 阅读器',
    languageToggleAria: '界面语言',
    switchLanguageTitle: '切换到 English',
    workspaceAria: '工作区路径',
    workspacePlaceholder: '选择或输入 Markdown 文件夹 / 文件',
    collapseDocs: '收起文档库',
    expandDocs: '展开文档库',
    collapsePanel: '收起右栏',
    expandPanel: '展开右栏',
    focusMode: '专注模式',
    exitFocus: '退出专注',
    openFolder: '打开目录',
    openMarkdownFile: '打开 Markdown 文件',
    quickOpen: '快速打开',
    refresh: '刷新',
    saveMarkdown: '保存',
    documents: '文档库',
    searchPlaceholder: '搜索文件名、标题或正文',
    noArticlesInPath: '当前路径没有找到 Markdown 文档。',
    chooseWorkspaceOrFileFirst: '选择一个 Markdown 目录或文件开始阅读。',
    chooseFolder: '选择目录',
    chooseFile: '选择文件',
    desktopReading: '阅读',
    source: '原文',
    edit: '编辑',
    unsaved: '未保存',
    loading: '正在加载...',
    dirty: '有未保存修改',
    saved: '已保存',
    noOpenedDoc: '未打开文档',
    chooseLeftDoc: '选择左侧 Markdown 文档开始阅读。',
    chooseMarkdownDoc: '请选择一个 Markdown 文件夹或文件。',
    outline: '导航',
    actions: '操作',
    settings: '设置',
    selectMarkdownDoc: '请选择一个 Markdown 文档。',
    wordCount: '字数',
    reading: '阅读',
    images: '图片',
    codeBlocks: '代码块',
    noOutline: '当前文档还没有标题层级。',
    markdownStyle: '导出样式',
    wordDescription: '标题、段落和列表',
    pdfDescription: '干净阅读版',
    copyMarkdown: '复制 Markdown',
    copyPlainText: '复制纯文本',
    copyHtml: '复制阅读 HTML',
    htmlOutput: '阅读 HTML',
    saveHtml: '保存 HTML',
    favorite: '收藏',
    unfavorite: '取消收藏',
    pin: '置顶',
    unpin: '取消置顶',
    favorites: '收藏',
    pinned: '置顶',
    recentFiles: '最近文件',
    recentWorkspaces: '最近工作区',
    currentDirectory: '当前目录',
    allDocuments: '全部文档',
    sortUpdated: '按更新时间',
    sortName: '按文件名',
    sortPath: '按路径',
    recursive: '递归目录',
    missingImages: '缺失图片',
    allImagesReady: '图片资源正常',
    copyPath: '复制路径',
    top: '回到顶部',
    focusOutline: '专注保留大纲',
    restoreLast: '启动恢复上次文档',
    rememberScroll: '记住阅读位置',
    defaultWorkspace: '默认工作区',
    defaultReadMode: '默认阅读模式',
    defaultExportStyle: '默认导出样式',
    noMatches: '没有匹配的文档。',
    searchResults: '全文搜索',
    noSearchResults: '没有正文命中。',
    insertImage: '图片',
    insertImageTitle: '插入图片',
    launchFailed: 'Markdown Reader 启动失败',
    runtimeFailed: '前端运行时出现异常。',
    choosePathFirst: '请先选择或输入 Markdown 文件夹 / 文件。',
    loadFailed: '加载失败',
    readFailed: '读取失败',
    browserNoDir: '浏览器预览模式下不能打开本地目录。',
    browserNoFile: '浏览器预览模式下不能打开本地文件。',
    workspaceDialogTitle: '选择 Markdown 工作区',
    markdownDialogTitle: '选择 Markdown 文件',
    noUnsavedChanges: '当前没有未保存修改。',
    browserDemoUpdated: '浏览器预览模式已更新示例内容。',
    markdownSaved: 'Markdown 已保存，并已生成备份',
    browserCopyOnlyHtml: '浏览器预览模式下仅支持复制。',
    copiedMarkdown: '已复制 Markdown',
    copiedPlainText: '已复制纯文本',
    copiedReadingHtml: '已复制阅读 HTML',
    generatedOpenedReadingHtml: '已生成并打开阅读 HTML',
    browserDownloadedWord: '浏览器预览模式已下载 Word。',
    generatedOpenedWord: '已生成并打开 Word',
    wordExportFailed: 'Word 导出失败',
    browserDownloadedPdf: '浏览器预览模式已下载 PDF。',
    generatedOpenedPdf: '已生成并打开 PDF',
    pdfExportFailed: 'PDF 导出失败',
    openMarkdownFirst: '请先打开一个 Markdown 文件。',
    browserNoLocalImage: '浏览器预览模式下不能插入本地图片。',
    insertedImage: '已插入图片',
    insertImageFailed: '插入图片失败',
    discardPrompt: '当前文档有未保存修改，确定要切换吗？',
    copiedPath: '已复制路径',
    stateSaved: '设置已保存',
  },
  en: {
    brandSubtitle: 'Local Markdown reader',
    languageToggleAria: 'Interface language',
    switchLanguageTitle: 'Switch to Chinese',
    workspaceAria: 'Workspace path',
    workspacePlaceholder: 'Choose or enter a Markdown folder / file',
    collapseDocs: 'Collapse library',
    expandDocs: 'Expand library',
    collapsePanel: 'Collapse right panel',
    expandPanel: 'Expand right panel',
    focusMode: 'Focus mode',
    exitFocus: 'Exit focus',
    openFolder: 'Open folder',
    openMarkdownFile: 'Open Markdown file',
    quickOpen: 'Quick open',
    refresh: 'Refresh',
    saveMarkdown: 'Save',
    documents: 'Library',
    searchPlaceholder: 'Search files, headings, or body',
    noArticlesInPath: 'No Markdown documents found in this path.',
    chooseWorkspaceOrFileFirst: 'Choose a Markdown folder or file to start.',
    chooseFolder: 'Choose folder',
    chooseFile: 'Choose file',
    desktopReading: 'Read',
    source: 'Source',
    edit: 'Edit',
    unsaved: 'Unsaved',
    loading: 'Loading...',
    dirty: 'Unsaved changes',
    saved: 'Saved',
    noOpenedDoc: 'No document open',
    chooseLeftDoc: 'Choose a Markdown document from the left.',
    chooseMarkdownDoc: 'Choose a Markdown folder or file.',
    outline: 'Nav',
    actions: 'Actions',
    settings: 'Settings',
    selectMarkdownDoc: 'Choose a Markdown document.',
    wordCount: 'Words',
    reading: 'Read',
    images: 'Images',
    codeBlocks: 'Code blocks',
    noOutline: 'This document has no heading structure yet.',
    markdownStyle: 'Export style',
    wordDescription: 'Headings and lists',
    pdfDescription: 'Clean reading version',
    copyMarkdown: 'Copy Markdown',
    copyPlainText: 'Copy text',
    copyHtml: 'Copy reading HTML',
    htmlOutput: 'Reading HTML',
    saveHtml: 'Save HTML',
    favorite: 'Favorite',
    unfavorite: 'Unfavorite',
    pin: 'Pin',
    unpin: 'Unpin',
    favorites: 'Favorites',
    pinned: 'Pinned',
    recentFiles: 'Recent files',
    recentWorkspaces: 'Recent workspaces',
    currentDirectory: 'Current dir',
    allDocuments: 'All documents',
    sortUpdated: 'Updated',
    sortName: 'Name',
    sortPath: 'Path',
    recursive: 'Recursive',
    missingImages: 'Missing images',
    allImagesReady: 'Images ready',
    copyPath: 'Copy path',
    top: 'Back to top',
    focusOutline: 'Keep outline in focus',
    restoreLast: 'Restore last document',
    rememberScroll: 'Remember reading position',
    defaultWorkspace: 'Default workspace',
    defaultReadMode: 'Default read mode',
    defaultExportStyle: 'Default export style',
    noMatches: 'No matching documents.',
    searchResults: 'Full-text search',
    noSearchResults: 'No body hits.',
    insertImage: 'Image',
    insertImageTitle: 'Insert image',
    launchFailed: 'Markdown Reader failed to start',
    runtimeFailed: 'The frontend hit a runtime error.',
    choosePathFirst: 'Choose or enter a Markdown folder / file first.',
    loadFailed: 'Load failed',
    readFailed: 'Read failed',
    browserNoDir: 'Local folders cannot be opened in browser preview mode.',
    browserNoFile: 'Local files cannot be opened in browser preview mode.',
    workspaceDialogTitle: 'Choose Markdown workspace',
    markdownDialogTitle: 'Choose Markdown file',
    noUnsavedChanges: 'There are no unsaved changes.',
    browserDemoUpdated: 'Demo content updated in browser preview mode.',
    markdownSaved: 'Markdown saved with backup',
    browserCopyOnlyHtml: 'Browser preview mode only supports copying.',
    copiedMarkdown: 'Markdown copied',
    copiedPlainText: 'Plain text copied',
    copiedReadingHtml: 'Reading HTML copied',
    generatedOpenedReadingHtml: 'Generated and opened reading HTML',
    browserDownloadedWord: 'Word downloaded in browser preview mode.',
    generatedOpenedWord: 'Generated and opened Word',
    wordExportFailed: 'Word export failed',
    browserDownloadedPdf: 'PDF downloaded in browser preview mode.',
    generatedOpenedPdf: 'Generated and opened PDF',
    pdfExportFailed: 'PDF export failed',
    openMarkdownFirst: 'Open a Markdown file first.',
    browserNoLocalImage: 'Local images cannot be inserted in browser preview mode.',
    insertedImage: 'Image inserted',
    insertImageFailed: 'Insert image failed',
    discardPrompt: 'This document has unsaved changes. Switch anyway?',
    copiedPath: 'Path copied',
    stateSaved: 'Settings saved',
  },
} as const

type Language = keyof typeof uiText
type UiText = (typeof uiText)[Language]

function App() {
  const [workspace, setWorkspace] = useState('')
  const [articles, setArticles] = useState<ArticleSummary[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [payload, setPayload] = useState<ArticlePayload | null>(null)
  const [editedContent, setEditedContent] = useState('')
  const [livePreviewContent, setLivePreviewContent] = useState('')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
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
  const text = uiText[language]
  const readerScrollRef = useRef<HTMLElement | null>(null)
  const editorScrollRef = useRef<HTMLDivElement | null>(null)
  const scrollSaveTimer = useRef<number | null>(null)
  const currentContent = payload ? editedContent : ''
  const isDirty = Boolean(payload && editedContent !== payload.content)
  const previewContent = livePreviewContent || (isDirty ? editedContent : payload?.preview_content || '')
  const searchTerm = query.trim()
  const activeMarkdownStyle = useMemo(() => getWordStylePreset(wordStyle), [wordStyle])
  const articleStyle = useMemo(() => markdownStyleVars(activeMarkdownStyle), [activeMarkdownStyle])
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
  const visibleArticles = useMemo(() => {
    const normalizedQuery = searchTerm.toLowerCase()
    const selectedDir = selectedArticle?.relative_path.includes('/')
      ? selectedArticle.relative_path.split('/').slice(0, -1).join('/')
      : ''
    const filtered = articles.filter((article) => {
      if (libraryFilter === 'favorites' && !favoriteSet.has(article.path)) return false
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
  }, [articles, favoriteSet, libraryFilter, pinnedSet, recentFileSet, searchTerm, selectedArticle, sortMode])

  const groupedArticles = useMemo(() => {
    return visibleArticles.reduce<Record<string, ArticleSummary[]>>((acc, article) => {
      const group = pinnedSet.has(article.path) ? text.pinned : displayGroupName(article.group, language)
      acc[group] = acc[group] || []
      acc[group].push(article)
      return acc
    }, {})
  }, [language, pinnedSet, text.pinned, visibleArticles])

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
        const lower = trimmed.toLowerCase()
        setSearchResults(
          demoPayload.content.toLowerCase().includes(lower)
            ? [{
                path: demoArticle.path,
                file_name: demoArticle.file_name,
                title: demoArticle.title,
                relative_path: demoArticle.relative_path,
                heading: 'Demo',
                snippet: makeClientSnippet(demoPayload.content, lower),
                line: 1,
                score: 1,
              }]
            : [],
        )
        return
      }
      void invoke<SearchResult[]>('search_workspace', {
        request: { workspace, query: trimmed },
      })
        .then(setSearchResults)
        .catch((error) => setNotice(`${text.loadFailed}: ${String(error)}`))
    }, 220)
    return () => window.clearTimeout(timer)
  }, [query, text.loadFailed, workspace])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'p') {
        event.preventDefault()
        setIsQuickOpenOpen(true)
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
        setReadMode((value) => (value === 'edit' ? 'desktop' : 'edit'))
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
    const nextState = await loadState()
    setReaderState(nextState)
    setLanguage(nextState.settings.language)
    setWordStyle(nextState.settings.default_export_style)
    setReadMode(nextState.settings.default_read_mode)
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
      setArticles([demoArticle])
      await selectArticle(demoArticle.path)
    }
  }

  async function loadState(): Promise<ReaderState> {
    if (!isTauri()) {
      const raw = window.localStorage.getItem('markdown-reader-state-v2')
      return raw ? normalizeState(JSON.parse(raw)) : defaultReaderState
    }
    const loaded = await invoke<ReaderState>('load_reader_state')
    return normalizeState(loaded)
  }

  function persistState(next: ReaderState) {
    const normalized = normalizeState(next)
    setReaderState(normalized)
    if (!isTauri()) {
      window.localStorage.setItem('markdown-reader-state-v2', JSON.stringify(normalized))
      return
    }
    void invoke('save_reader_state', { state: normalized }).catch((error) => {
      setNotice(`${text.loadFailed}: ${String(error)}`)
    })
  }

  function patchState(updater: (state: ReaderState) => ReaderState) {
    const next = updater(readerState)
    persistState(next)
    return next
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
        : [demoArticle]
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
        : demoPayload
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
        const nextPayload = { ...demoPayload, content: editedContent, preview_content: editedContent }
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
      : [demoArticle]
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
    if (!selectedPath || !readerState.settings.remember_scroll_position) return
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
    setReadMode('desktop')
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
        setReadMode('desktop')
        setPanelTab('outline')
      }
      patchState((current) => ({ ...current, focus_mode: next }))
      return next
    })
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
    const nextSettings = { ...readerState.settings, ...settings }
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
          <button className="icon-button" onClick={() => setIsQuickOpenOpen(true)} title={text.quickOpen} disabled={articles.length === 0 && readerState.recent_files.length === 0}>
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
            onFilterChange={setLibraryFilter}
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
              articleStyle={articleStyle}
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
                <button className={readMode === 'desktop' ? 'selected' : ''} onClick={() => setReadMode('desktop')}>
                  <Monitor size={16} />
                  {text.desktopReading}
                </button>
                <button className={readMode === 'source' ? 'selected' : ''} onClick={() => setReadMode('source')}>
                  <FileText size={16} />
                  {text.source}
                </button>
                <button className={readMode === 'edit' ? 'selected' : ''} onClick={() => setReadMode('edit')}>
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
                  articleStyle={articleStyle}
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
          searchResults={searchResults}
          text={text}
          onClose={() => setIsQuickOpenOpen(false)}
          onQueryChange={setQuery}
          onSelect={(path) => {
            setIsQuickOpenOpen(false)
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

function LibrarySidebar({
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

function ReaderContent({
  articleHtml,
  articleStyle,
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
  articleStyle: CSSProperties
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
    <div className="article-page" style={articleStyle}>
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
  articleStyle,
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
  articleStyle: CSSProperties
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
            <div className="article-page focus-page" style={articleStyle}>
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
        <button className="outline-row" key={item.id} onClick={() => onSelect(item)} style={{ paddingLeft: `${Math.max(0, item.level - 1) * 12}px` }}>
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

function QuickOpenDialog({
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
  const [isInsertingImage, setIsInsertingImage] = useState(false)

  async function insertImage() {
    setIsInsertingImage(true)
    try {
      const markdown = await onRequestImageMarkdown()
      if (!markdown) return
      const textarea = textareaRef.current
      const start = textarea?.selectionStart ?? value.length
      const end = textarea?.selectionEnd ?? start
      const before = value.slice(0, start)
      const after = value.slice(end)
      const prefix = before && !before.endsWith('\n') ? '\n\n' : ''
      const suffix = after && !after.startsWith('\n') ? '\n\n' : '\n'
      const insertion = `${prefix}${markdown}${suffix}`
      const nextValue = `${before}${insertion}${after}`
      const nextCursor = before.length + insertion.length
      onChange(nextValue)
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
        onChange={(event) => onChange(event.target.value)}
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

function normalizeState(value: ReaderState): ReaderState {
  return {
    ...defaultReaderState,
    ...value,
    settings: { ...defaultSettings, ...(value?.settings || {}) },
    recent_workspaces: trimList(value?.recent_workspaces || [], 20),
    recent_files: trimList(value?.recent_files || [], 50),
    favorites: trimList(value?.favorites || [], 500),
    pinned: trimList(value?.pinned || [], 500),
    reading_positions: value?.reading_positions || {},
  }
}

function trimList(values: string[], max: number) {
  return [...new Set(values.filter(Boolean))].slice(0, max)
}

function moveToFront(values: string[], path: string, max: number) {
  return [path, ...values.filter((value) => value !== path)].slice(0, max)
}

function togglePath(values: string[], path: string) {
  return values.includes(path) ? values.filter((value) => value !== path) : [path, ...values]
}

function uniqueArticles(items: ArticleSummary[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.path)) return false
    seen.add(item.path)
    return true
  })
}

function highlightHtml(html: string, term: string) {
  if (!term) return html
  const escaped = escapeRegExp(term)
  if (!escaped) return html
  const pattern = new RegExp(`(${escaped})`, 'gi')
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') ? part : part.replace(pattern, '<mark>$1</mark>')))
    .join('')
}

function extractImageSources(markdown: string) {
  return [...markdown.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map((match) => match[1])
    .filter((src) => !src.startsWith('data:image/'))
}

function markdownToPlainText(markdown: string) {
  return parseArticle(markdown).body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function makeClientSnippet(content: string, query: string) {
  const lower = content.toLowerCase()
  const index = lower.indexOf(query)
  if (index < 0) return content.slice(0, 120)
  return content.slice(Math.max(0, index - 42), index + 84).replace(/\s+/g, ' ')
}

function base64ToArrayBuffer(base64: string) {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

async function readBundledPdfFont() {
  const response = await fetch('fonts/NotoSansSC-VF.ttf')
  if (!response.ok) throw new Error('内置 PDF 字体加载失败')
  return arrayBufferToBase64(await response.arrayBuffer())
}

function downloadBase64File(base64: string, filename: string, mimeType: string) {
  const bytes = base64ToArrayBuffer(base64)
  const blob = new Blob([bytes], { type: mimeType })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

function exportFileName(name: string | undefined, extension: string) {
  return `${(name || 'document').replace(/\.[^.]+$/, '')}.${extension}`
}

function formatArticleCount(count: number, language: Language) {
  return language === 'zh' ? `${count} 篇` : `${count} docs`
}

function formatWordCount(count: number, language: Language) {
  return language === 'zh' ? `${count} 字` : `${count} words`
}

function formatReadingMinutes(minutes: number, language: Language) {
  return language === 'zh' ? `${minutes} 分钟` : `${minutes} min`
}

function formatImageCount(count: number, language: Language, short = false) {
  if (language === 'zh') return short ? `${count} 图` : `${count} 张图片`
  return short ? `${count} img` : `${count} images`
}

function formatExportSummary(stats: ArticleStats, language: Language) {
  const minutes = stats.readingMinutes || 1
  const images = stats.images || 0
  return language === 'zh' ? `${minutes} 分钟阅读，${images} 张图片` : `${minutes} min read, ${images} images`
}

function displayGroupName(group: string, language: Language) {
  if (language === 'zh') return group
  const groups: Record<string, string> = {
    示例: 'Demo',
    文档: 'Documents',
    草稿: 'Drafts',
    审稿: 'Review',
    已确认: 'Approved',
    已确认稿: 'Approved',
  }
  return groups[group] || group
}

function markdownStyleVars(preset: ReturnType<typeof getWordStylePreset>): CSSProperties {
  return {
    '--md-font': `${preset.font}, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
    '--md-accent': preset.accent,
    '--md-body-size': `${Math.max(14, Math.round(preset.bodySize * 0.72))}px`,
    '--md-line-height': String(Math.max(1.55, Math.min(2.12, preset.lineSpacing / 170))),
  } as CSSProperties
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)))
  }
  return window.btoa(chunks.join(''))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isTauri() {
  return Boolean('__TAURI_INTERNALS__' in window)
}

export default App
