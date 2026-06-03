import { Component, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ErrorInfo, ReactNode, RefObject } from 'react'
import {
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
  PencilLine,
  PanelLeftClose,
  PanelLeftOpen,
  Monitor,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Save,
  Search,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import './App.css'
import {
  buildOutline,
  buildReadingHtml,
  getArticleStats,
  markdownToHtml,
  parseArticle,
  renderWechatHtml,
} from './markdown'
import { getWordStylePreset, wordStylePresets } from './wordStyles'
import type {
  ArticlePayload,
  ArticleStats,
  ArticleSummary,
  OutlineItem,
  PanelTab,
  ReadMode,
  WordStyleId,
} from './types'

const demoArticle: ArticleSummary = {
  path: 'demo.md',
  file_name: 'demo.md',
  title: 'Markdown 多平台阅读器设计样张',
  digest: '本地阅读、文章大纲和导出放进同一个桌面工作台。',
  group: '示例',
  status: 'draft',
  updated: Math.floor(Date.now() / 1000),
}

const demoPayload: ArticlePayload = {
  path: demoArticle.path,
  base_dir: '',
  content: `---
title: Markdown 多平台阅读器设计样张
digest: 本地阅读、文章大纲和导出放进同一个桌面工作台。
---

![系统预览](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwMCIgaGVpZ2h0PSI1NjAiIHZpZXdCb3g9IjAgMCAxMDAwIDU2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwMCIgaGVpZ2h0PSI1NjAiIGZpbGw9IiNmNmY4ZmEiLz48cmVjdCB4PSI2MCIgeT0iNjAiIHdpZHRoPSIyMDAiIGhlaWdodD0iNDQwIiByeD0iMTIiIGZpbGw9IiNlOWVmZjIiLz48cmVjdCB4PSIzMDAiIHk9IjYwIiB3aWR0aD0iNDIwIiBoZWlnaHQ9IjQ0MCIgcng9IjEyIiBmaWxsPSIjZmZmIi8+PHJlY3QgeD0iNzYwIiB5PSI2MCIgd2lkdGg9IjE4MCIgaGVpZ2h0PSI0NDAiIHJ4PSIxMiIgZmlsbD0iI2ZmZiIvPjx0ZXh0IHg9IjMzMCIgeT0iMTUwIiBmb250LXNpemU9IjM2IiBmb250LWZhbWlseT0iQXJpYWwiIGZpbGw9IiMxZjI5MzMiPkRlc2t0b3AgUmVhZGluZzwvdGV4dD48dGV4dCB4PSIzMzAiIHk9IjIyMCIgZm9udC1zaXplPSIyMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmaWxsPSIjNjI3MDdhIj5XZUNoYXQgYW5kIFhIUyBwcmV2aWV3IGluIG9uZSBsb2NhbCBhcHAuPC90ZXh0Pjwvc3ZnPg==)

## 系统需求分析

这个工具首先解决电脑阅读问题。写作者仍然使用 Markdown，但是不再被手机宽度锁住，可以直接在桌面上看清长文、系统截图、流程图和代码片段。

它也要照顾交付场景：同一份内容可能需要给团队看 Word，给自己留 Markdown，给公众号准备 HTML。工具不应该把写作者拖进复杂流程里，而是把这些出口自然放在工作台边上。

## 功能设计

- 左侧列出草稿、审稿稿和已确认稿。
- 中间默认显示电脑阅读版。
- 右侧切换文章大纲和导出结果。
- 导出页把 Word 和 PDF 放在主入口，HTML 放进高级输出里。
- Word 和 PDF 导出都内置转换依赖，不要求用户额外安装工具。
- 编辑器支持把本地图片复制到文章旁边的 assets 文件夹，并插入相对 Markdown 路径。

## Word 工作流

导出内置多种 Markdown 样式和字体方案，适合产品说明、技术文档、书稿阅读和会议讲义。样式作用在 Markdown 渲染后的 Word/PDF 版式上，不依赖外部软件。

> 这里的目标是把 Markdown 稳定交付为 Word、PDF 和 HTML，而不是依赖用户电脑上的外部转换器。

## 示例代码

\`\`\`ts
const target = await openMarkdownFile()
const article = await readArticle(target)
await exportWord(article, 'codex')
\`\`\`

## 实现亮点

第一版只做本地文件、本地预览、本地图片资源和本地导出。发布动作仍然交给已有脚本，避免把工具做成另一个复杂平台。

## 后续方向

1. 继续增强 PDF 导出，让长文、截图和代码块的分页更稳定。
2. 让导出样式支持保存为用户自己的预设。
3. 后续如需导入，再单独做成“草稿提取”能力，而不是混在导出工作流里。
`,
  preview_content: '',
}
demoPayload.preview_content = demoPayload.content

interface InsertImageAssetResponse {
  markdown: string
  relativePath: string
}

const uiText = {
  zh: {
    brandSubtitle: '本地多平台预览',
    languageToggleAria: '界面语言',
    switchLanguageTitle: '切换到 English',
    workspaceAria: '工作区路径',
    workspacePlaceholder: '选择或输入 Markdown 文件夹 / 文件',
    collapseDocs: '收起文档栏',
    expandDocs: '展开文档栏',
    collapsePanel: '收起平台栏',
    expandPanel: '展开平台栏',
    focusMode: '专注模式',
    exitFocus: '退出专注模式',
    openFolder: '打开目录',
    openMarkdownFile: '打开 Markdown 文件',
    quickOpen: '快速打开',
    refresh: '刷新',
    saveMarkdown: '保存 MD',
    documents: '文档',
    searchPlaceholder: '搜索标题或文件',
    noArticlesInPath: '当前路径没有找到文章。',
    chooseWorkspaceOrFileFirst: '先选择 Markdown 文件夹或文件。',
    chooseFolder: '选择目录',
    chooseFile: '选择文件',
    desktopReading: '电脑阅读',
    source: '原文',
    edit: '编辑',
    unsaved: '未保存',
    loading: '正在加载...',
    dirty: '有未保存修改',
    saved: '已保存',
    noOpenedDoc: '未打开文档',
    chooseLeftDoc: '选择左侧 Markdown 文档开始预览。',
    chooseMarkdownDoc: '请选择一个 Markdown 文件夹或文件。',
    outline: '大纲',
    export: '导出',
    selectMarkdownDoc: '请选择一个 Markdown 文档。',
    livePreview: '实时预览',
    previewWillUpdate: '预览会在右侧实时更新。',
    startTypingPreview: '开始输入 Markdown，右侧会实时渲染。',
    wordCount: '字数',
    reading: '阅读',
    images: '图片',
    codeBlocks: '代码块',
    noOutline: '当前文档还没有标题层级。',
    markdownStyle: 'Markdown 样式',
    wordDescription: '保留标题、段落和列表',
    pdfDescription: '生成干净阅读版',
    copyMarkdown: '复制 Markdown',
    htmlOutput: 'HTML 输出',
    collapse: '收起',
    expand: '展开',
    readingVersion: '阅读版',
    wechat: '公众号',
    copy: '复制',
    save: '保存',
    quickOpenPlaceholder: '快速打开 Markdown',
    noMatches: '没有匹配的文档。',
    insertImage: '图片',
    insertImageTitle: '插入图片',
    launchFailed: 'Markdown Reader 启动失败',
    runtimeFailed: '前端运行时出现异常。',
    choosePathFirst: '请先选择或输入 Markdown 文件夹 / 文件。',
    loadFailed: '加载失败',
    readFailed: '读取失败',
    browserNoDir: '浏览器预览模式下不能打开本地目录。',
    browserNoFile: '浏览器预览模式下不能打开本地文件。',
    workspaceDialogTitle: '选择文章工作区',
    markdownDialogTitle: '选择 Markdown 文件',
    copiedWechatHtml: '已复制公众号 HTML',
    noUnsavedChanges: '当前没有未保存修改。',
    browserDemoUpdated: '浏览器预览模式已更新示例内容。',
    markdownSaved: 'Markdown 已保存',
    browserCopyOnlyHtml: '浏览器预览模式下仅支持复制 HTML。',
    generatedOpenedHtml: '已生成并打开 HTML',
    copiedMarkdown: '已复制 Markdown',
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
  },
  en: {
    brandSubtitle: 'Local multi-platform preview',
    languageToggleAria: 'Interface language',
    switchLanguageTitle: 'Switch to Chinese',
    workspaceAria: 'Workspace path',
    workspacePlaceholder: 'Choose or enter a Markdown folder / file',
    collapseDocs: 'Collapse documents',
    expandDocs: 'Expand documents',
    collapsePanel: 'Collapse panel',
    expandPanel: 'Expand panel',
    focusMode: 'Focus mode',
    exitFocus: 'Exit focus mode',
    openFolder: 'Open folder',
    openMarkdownFile: 'Open Markdown file',
    quickOpen: 'Quick open',
    refresh: 'Refresh',
    saveMarkdown: 'Save MD',
    documents: 'Documents',
    searchPlaceholder: 'Search title or file',
    noArticlesInPath: 'No Markdown articles found in this path.',
    chooseWorkspaceOrFileFirst: 'Choose a Markdown folder or file first.',
    chooseFolder: 'Choose folder',
    chooseFile: 'Choose file',
    desktopReading: 'Desktop',
    source: 'Source',
    edit: 'Edit',
    unsaved: 'Unsaved',
    loading: 'Loading...',
    dirty: 'Unsaved changes',
    saved: 'Saved',
    noOpenedDoc: 'No document open',
    chooseLeftDoc: 'Choose a Markdown document from the left.',
    chooseMarkdownDoc: 'Choose a Markdown folder or file.',
    outline: 'Outline',
    export: 'Export',
    selectMarkdownDoc: 'Choose a Markdown document.',
    livePreview: 'Live preview',
    previewWillUpdate: 'The preview updates here as you edit.',
    startTypingPreview: 'Start typing Markdown to render the preview.',
    wordCount: 'Words',
    reading: 'Read',
    images: 'Images',
    codeBlocks: 'Code blocks',
    noOutline: 'This document has no heading structure yet.',
    markdownStyle: 'Markdown style',
    wordDescription: 'Keep headings, paragraphs, and lists',
    pdfDescription: 'Create a clean reading version',
    copyMarkdown: 'Copy Markdown',
    htmlOutput: 'HTML output',
    collapse: 'Collapse',
    expand: 'Expand',
    readingVersion: 'Reading',
    wechat: 'WeChat',
    copy: 'Copy',
    save: 'Save',
    quickOpenPlaceholder: 'Quick open Markdown',
    noMatches: 'No matching documents.',
    insertImage: 'Image',
    insertImageTitle: 'Insert image',
    launchFailed: 'Markdown Reader failed to start',
    runtimeFailed: 'The frontend hit a runtime error.',
    choosePathFirst: 'Choose or enter a Markdown folder / file first.',
    loadFailed: 'Load failed',
    readFailed: 'Read failed',
    browserNoDir: 'Local folders cannot be opened in browser preview mode.',
    browserNoFile: 'Local files cannot be opened in browser preview mode.',
    workspaceDialogTitle: 'Choose article workspace',
    markdownDialogTitle: 'Choose Markdown file',
    copiedWechatHtml: 'WeChat HTML copied',
    noUnsavedChanges: 'There are no unsaved changes.',
    browserDemoUpdated: 'Demo content updated in browser preview mode.',
    markdownSaved: 'Markdown saved',
    browserCopyOnlyHtml: 'Browser preview mode only supports copying HTML.',
    generatedOpenedHtml: 'Generated and opened HTML',
    copiedMarkdown: 'Markdown copied',
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
  const [readMode, setReadMode] = useState<ReadMode>('desktop')
  const [panelTab, setPanelTab] = useState<PanelTab>('outline')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isPlatformOpen, setIsPlatformOpen] = useState(true)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false)
  const [wordStyle, setWordStyle] = useState<WordStyleId>('codex')
  const [language, setLanguage] = useState<Language>('zh')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const text = uiText[language]
  const editorScrollRef = useRef<HTMLDivElement | null>(null)
  const currentContent = payload ? editedContent : ''
  const isDirty = Boolean(payload && editedContent !== payload.content)
  const previewContent = livePreviewContent || (isDirty ? editedContent : payload?.preview_content || '')
  const activeMarkdownStyle = useMemo(() => getWordStylePreset(wordStyle), [wordStyle])
  const articleStyle = useMemo(() => markdownStyleVars(activeMarkdownStyle), [activeMarkdownStyle])

  const previewParsed = useMemo(
    () => parseArticle(previewContent),
    [previewContent],
  )
  const articleHtml = useMemo(
    () => markdownToHtml(previewParsed.body),
    [previewParsed.body],
  )
  const wechatHtml = useMemo(
    () => renderWechatHtml(previewContent),
    [previewContent],
  )
  const readingHtml = useMemo(() => buildReadingHtml(previewContent), [previewContent])
  const outline = useMemo(() => buildOutline(currentContent), [currentContent])
  const stats = useMemo(() => getArticleStats(currentContent), [currentContent])
  const selectedArticle = articles.find((article) => article.path === selectedPath)
  const groupedArticles = useMemo(() => {
    const filtered = articles.filter((article) => {
      const target = `${article.title} ${article.file_name}`.toLowerCase()
      return target.includes(query.trim().toLowerCase())
    })
    return filtered.reduce<Record<string, ArticleSummary[]>>((acc, article) => {
      acc[article.group] = acc[article.group] || []
      acc[article.group].push(article)
      return acc
    }, {})
  }, [articles, query])

  async function bootstrap() {
    if (isTauri()) {
      try {
        const initialPath = await invoke<string | null>('initial_open_path')
        if (initialPath) {
          setWorkspace(initialPath)
          await loadArticles(initialPath, initialPath)
        }
      } catch (error) {
        setNotice(`${text.loadFailed}: ${String(error)}`)
      }
      return
    }
    if (new URLSearchParams(window.location.search).get('demo') === '1') {
      setWorkspace('demo')
      setArticles([demoArticle])
      setSelectedPath(demoArticle.path)
      setPayload(demoPayload)
      setEditedContent(demoPayload.content)
    }
  }

  useEffect(() => {
    void bootstrap()
    // The app should only consume process launch args once on startup.
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
          if (!cancelled) {
            setLivePreviewContent(nextContent)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLivePreviewContent(editedContent)
          }
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [editedContent, isDirty, payload])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setIsQuickOpenOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  async function loadArticles(root = workspace, pathToSelect = selectedPath) {
    if (!root.trim()) {
      setNotice(text.choosePathFirst)
      return
    }
    setLoading(true)
    try {
      const items = isTauri()
        ? await invoke<ArticleSummary[]>('scan_workspace', { workspace: root })
        : [demoArticle]
      setArticles(items)
      const target = pathToSelect && items.some((item) => item.path === pathToSelect)
        ? pathToSelect
        : items[0]?.path
      if (target) {
        await selectArticle(target)
      } else {
        setSelectedPath('')
        setPayload(null)
        setEditedContent('')
      }
      await record(`刷新文章列表：${root}，共 ${items.length} 篇。`)
    } catch (error) {
      setNotice(`${text.loadFailed}: ${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  async function selectArticle(path: string) {
    setSelectedPath(path)
    setLoading(true)
    try {
      const nextPayload = isTauri()
        ? await invoke<ArticlePayload>('read_article', { path })
        : demoPayload
      setPayload(nextPayload)
      setEditedContent(nextPayload.content)
      await record(`打开文章：${path}`)
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
    const selected = await open({
      directory: true,
      multiple: false,
      title: text.workspaceDialogTitle,
    })
    if (typeof selected === 'string') {
      setWorkspace(selected)
      await loadArticles(selected, '')
      await record(`切换工作区：${selected}`)
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
      filters: [
        {
          name: 'Markdown',
          extensions: ['md', 'markdown', 'mdown'],
        },
      ],
    })
    if (typeof selected === 'string') {
      setWorkspace(selected)
      await loadArticles(selected, selected)
      await record(`切换 Markdown 文件：${selected}`)
    }
  }

  async function copyWechatHtml() {
    if (!payload) return
    await navigator.clipboard.writeText(wechatHtml)
    setNotice(text.copiedWechatHtml)
    await record(`复制公众号 HTML：${payload.path}`)
  }

  async function saveMarkdown() {
    if (!payload) return
    if (!isDirty) {
      setNotice(text.noUnsavedChanges)
      return
    }
    if (!isTauri()) {
      const nextPayload = { ...demoPayload, content: editedContent, preview_content: editedContent }
      setPayload(nextPayload)
      setNotice(text.browserDemoUpdated)
      return
    }
    const nextPayload = await invoke<ArticlePayload>('save_article', {
      request: {
        path: payload.path,
        content: editedContent,
      },
    })
    setPayload(nextPayload)
    setEditedContent(nextPayload.content)
    setNotice(text.markdownSaved)
    await record(`保存 Markdown：${payload.path}`)
    await refreshArticleList(payload.path)
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

  async function saveWechatHtml() {
    if (!payload) return
    if (!isTauri()) {
      setNotice(text.browserCopyOnlyHtml)
      return
    }
    const output = await invoke<string>('save_wechat_html', {
      articlePath: payload.path,
      html: wechatHtml,
    })
    setNotice(`${text.generatedOpenedHtml}: ${output}`)
    await record(`生成公众号 HTML：${output}`)
  }

  async function copyMarkdown() {
    if (!payload) return
    await navigator.clipboard.writeText(editedContent)
    setNotice(text.copiedMarkdown)
    await record(`复制 Markdown：${payload.path}`)
  }

  async function copyReadingHtml() {
    if (!payload) return
    await navigator.clipboard.writeText(readingHtml)
    setNotice(text.copiedReadingHtml)
    await record(`复制阅读 HTML：${payload.path}`)
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
    await record(`生成阅读 HTML：${output}`)
  }

  async function saveWordDocx() {
    if (!payload) return
    setLoading(true)
    try {
      const { markdownToDocxBase64 } = await import('./word')
      const contentBase64 = await markdownToDocxBase64(previewContent, wordStyle)
      if (!isTauri()) {
        downloadBase64File(
          contentBase64,
          exportFileName(selectedArticle?.file_name, 'docx'),
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )
        setNotice(text.browserDownloadedWord)
        return
      }
      const output = await invoke<string>('save_binary_export', {
        request: {
          articlePath: payload.path,
          contentBase64,
          extension: 'docx',
        },
      })
      setNotice(`${text.generatedOpenedWord}: ${output}`)
      await record(`生成 Word：${output}`)
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
        request: {
          articlePath: payload.path,
          contentBase64,
          extension: 'pdf',
        },
      })
      setNotice(`${text.generatedOpenedPdf}: ${output}`)
      await record(`生成 PDF：${output}`)
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
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
        },
      ],
    })
    if (typeof selected !== 'string') {
      return null
    }
    try {
      const response = await invoke<InsertImageAssetResponse>('insert_image_asset', {
        request: {
          articlePath: payload.path,
          imagePath: selected,
        },
      })
      setNotice(`${text.insertedImage}: ${response.relativePath}`)
      await record(`插入图片资源：${response.relativePath}`)
      return response.markdown
    } catch (error) {
      setNotice(`${text.insertImageFailed}: ${String(error)}`)
      return null
    }
  }

  function jumpToOutline(item: OutlineItem) {
    setReadMode('desktop')
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const heading = document.getElementById(item.id)
        if (!heading) return
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }

  async function record(message: string) {
    const time = new Date().toLocaleString('zh-CN', { hour12: false })
    const entry = `## ${time}\n\n- ${message}`
    if (isTauri()) {
      await invoke('append_build_log', { entry })
    }
  }

  function toggleFocusMode() {
    setIsFocusMode((value) => {
      if (!value) {
        setReadMode('desktop')
        setPanelTab('outline')
      }
      return !value
    })
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
        <div className="workspace-field" title={workspace}>
          <FolderOpen size={16} />
          <input
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') loadArticles(event.currentTarget.value)
            }}
            aria-label={text.workspaceAria}
            placeholder={text.workspacePlaceholder}
          />
        </div>
        <div className="toolbar">
          <button
            className="language-button"
            onClick={() => setLanguage((value) => (value === 'zh' ? 'en' : 'zh'))}
            title={text.switchLanguageTitle}
            type="button"
            aria-label={text.languageToggleAria}
          >
            <Languages size={16} />
            <span>{language === 'zh' ? '中' : 'EN'}</span>
          </button>
          <button
            className="icon-button"
            onClick={() => setIsSidebarOpen((value) => !value)}
            title={isSidebarOpen ? text.collapseDocs : text.expandDocs}
          >
            {isSidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          <button
            className="icon-button"
            onClick={() => setIsPlatformOpen((value) => !value)}
            title={isPlatformOpen ? text.collapsePanel : text.expandPanel}
          >
            {isPlatformOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
          <button
            className={`icon-button ${isFocusMode ? 'is-active' : ''}`}
            onClick={toggleFocusMode}
            title={isFocusMode ? text.exitFocus : text.focusMode}
          >
            {isFocusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button className="icon-button" onClick={chooseWorkspace} title={text.openFolder}>
            <FolderOpen size={17} />
          </button>
          <button className="icon-button" onClick={chooseMarkdownFile} title={text.openMarkdownFile}>
            <FileText size={17} />
          </button>
          <button
            className="icon-button"
            onClick={() => setIsQuickOpenOpen(true)}
            title={text.quickOpen}
            disabled={articles.length === 0}
          >
            <Search size={17} />
          </button>
          <button
            className="icon-button"
            onClick={() => loadArticles()}
            title={text.refresh}
            disabled={!workspace.trim()}
          >
            <RefreshCw size={17} />
          </button>
          <button className="command-button" onClick={saveMarkdown} disabled={!isDirty}>
            <Save size={16} />
            {text.saveMarkdown}
          </button>
        </div>
      </header>

      <section
        className={`workbench ${!isSidebarOpen ? 'sidebar-collapsed' : ''} ${
          !isPlatformOpen ? 'platform-collapsed' : ''
        } ${isFocusMode ? 'focus-mode' : ''}`}
      >
        {isSidebarOpen && !isFocusMode && (
        <aside className="sidebar">
          <div className="sidebar-head">
            <span>{text.documents}</span>
            <div className="sidebar-tools">
              <small>{formatArticleCount(articles.length, language)}</small>
              <button
                className="panel-toggle"
                onClick={() => setIsSidebarOpen(false)}
                title={text.collapseDocs}
              >
                <PanelLeftClose size={15} />
              </button>
            </div>
          </div>
          <label className="search-box">
            <Search size={15} />
            <input
              placeholder={text.searchPlaceholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="article-groups">
            {Object.entries(groupedArticles).map(([group, items]) => (
              <section className="article-group" key={group}>
                <div className="group-title">{displayGroupName(group, language)}</div>
                {items.map((article) => (
                  <button
                    className={`article-row ${
                      article.path === selectedPath ? 'is-active' : ''
                    }`}
                    key={article.path}
                    onClick={() => selectArticle(article.path)}
                  >
                    <span>{article.title || article.file_name}</span>
                    <small>{article.file_name}</small>
                  </button>
                ))}
              </section>
            ))}
            {articles.length === 0 && (
              <div className="empty-state">
                <PanelRight size={22} />
                <p>{workspace ? text.noArticlesInPath : text.chooseWorkspaceOrFileFirst}</p>
                {!workspace && (
                  <>
                  <button className="inline-action" onClick={chooseWorkspace}>
                    <FolderOpen size={15} />
                    {text.chooseFolder}
                  </button>
                  <button className="inline-action" onClick={chooseMarkdownFile}>
                    <FileText size={15} />
                    {text.chooseFile}
                  </button>
                  </>
                )}
              </div>
            )}
          </div>
        </aside>
        )}

        <section className={`reader-panel ${isFocusMode ? 'focus-reader' : ''}`}>
          {isFocusMode ? (
            <FocusReader
              articleHtml={articleHtml}
              articleStyle={articleStyle}
              language={language}
              loading={loading}
              onOutlineSelect={jumpToOutline}
              outline={outline}
              payload={payload}
              previewParsed={previewParsed}
              selectedFileName={selectedArticle?.file_name}
              stats={stats}
              text={text}
            />
          ) : (
          <>
          <div className="reader-tabs">
            <button
              className={readMode === 'desktop' ? 'selected' : ''}
              onClick={() => setReadMode('desktop')}
            >
              <Monitor size={16} />
              {text.desktopReading}
            </button>
            <button
              className={readMode === 'source' ? 'selected' : ''}
              onClick={() => setReadMode('source')}
            >
              <FileText size={16} />
              {text.source}
            </button>
            <button
              className={readMode === 'edit' ? 'selected' : ''}
              onClick={() => setReadMode('edit')}
            >
              <PencilLine size={16} />
              {text.edit}
            </button>
            {isDirty && <span className="dirty-badge">{text.unsaved}</span>}
            {payload && (
              <div className="stats-strip">
                <span>{formatWordCount(stats.words, language)}</span>
                <span>{formatReadingMinutes(stats.readingMinutes, language)}</span>
                <span>{formatImageCount(stats.images, language, true)}</span>
              </div>
            )}
          </div>
          <article className={`reader-canvas ${readMode}`}>
            {loading && <div className="loading">{text.loading}</div>}
            {!loading && payload && readMode !== 'source' && readMode !== 'edit' && (
              <div className="article-page" style={articleStyle}>
                <header className="article-title">
                  <h1>{previewParsed.title || selectedArticle?.title}</h1>
                  {previewParsed.digest && <p>{previewParsed.digest}</p>}
                </header>
                <div
                  className="markdown-body"
                  dangerouslySetInnerHTML={{ __html: articleHtml }}
                />
              </div>
            )}
            {!loading && payload && readMode === 'source' && (
              <pre className="source-view">{currentContent}</pre>
            )}
            {!loading && payload && readMode === 'edit' && (
              <div className="editor-shell">
                <div className="editor-bar">
                  <div>
                    <strong>{selectedArticle?.file_name || 'Markdown'}</strong>
                    <span>{isDirty ? text.dirty : text.saved}</span>
                  </div>
                  <button className="command-button" onClick={saveMarkdown} disabled={!isDirty}>
                    <Save size={16} />
                    {text.saveMarkdown}
                  </button>
                </div>
                <RichMarkdownEditor
                  editorKey={selectedPath || 'normal-editor'}
                  scrollRef={editorScrollRef}
                  value={editedContent}
                  onChange={setEditedContent}
                  onRequestImageMarkdown={requestImageMarkdown}
                  onSave={saveMarkdown}
                  onScroll={() => undefined}
                  text={text}
                />
              </div>
            )}
            {!loading && !payload && (
              <div className="empty-reader">
                <FileText size={34} />
                <p>{workspace ? text.chooseLeftDoc : text.chooseMarkdownDoc}</p>
                {!workspace && (
                  <>
                  <button className="command-button" onClick={chooseWorkspace}>
                    <FolderOpen size={16} />
                    {text.chooseFolder}
                  </button>
                  <button className="command-button" onClick={chooseMarkdownFile}>
                    <FileText size={16} />
                    {text.chooseFile}
                  </button>
                  </>
                )}
              </div>
            )}
          </article>
          </>
          )}
        </section>

        {isPlatformOpen && !isFocusMode && (
        <aside className="platform-panel">
          <div className="panel-tabs">
            <button
              className="panel-toggle"
              onClick={() => setIsPlatformOpen(false)}
              title={text.collapsePanel}
            >
              <PanelRightClose size={15} />
            </button>
            <button
              className={panelTab === 'outline' ? 'selected' : ''}
              onClick={() => setPanelTab('outline')}
            >
              {text.outline}
            </button>
            <button
              className={panelTab === 'exports' ? 'selected' : ''}
              onClick={() => setPanelTab('exports')}
            >
              {text.export}
            </button>
          </div>

          {panelTab === 'outline' && (
            <OutlinePanel
              language={language}
              outline={outline}
              stats={stats}
              text={text}
              onSelect={jumpToOutline}
            />
          )}
          {panelTab === 'exports' && (
            <ExportPanel
              disabled={!payload}
              language={language}
              onCopyMarkdown={copyMarkdown}
              onCopyReadingHtml={copyReadingHtml}
              onCopyWechatHtml={copyWechatHtml}
              onSaveReadingHtml={saveReadingHtml}
              onSaveWechatHtml={saveWechatHtml}
              onSavePdf={savePdf}
              onSaveWordDocx={saveWordDocx}
              onWordStyleChange={setWordStyle}
              stats={stats}
              text={text}
              wordStyle={wordStyle}
            />
          )}
        </aside>
        )}
      </section>

      {isQuickOpenOpen && (
        <QuickOpenDialog
          articles={articles}
          language={language}
          text={text}
          onClose={() => setIsQuickOpenOpen(false)}
          onSelect={(path) => {
            setIsQuickOpenOpen(false)
            void selectArticle(path)
          }}
        />
      )}

      {notice && (
        <button className="toast" onClick={() => setNotice('')}>
          {notice}
        </button>
      )}
    </main>
  )
}

function FocusReader({
  articleHtml,
  articleStyle,
  language,
  loading,
  onOutlineSelect,
  outline,
  payload,
  previewParsed,
  selectedFileName,
  stats,
  text,
}: {
  articleHtml: string
  articleStyle: CSSProperties
  language: Language
  loading: boolean
  onOutlineSelect: (item: OutlineItem) => void
  outline: OutlineItem[]
  payload: ArticlePayload | null
  previewParsed: { title: string; digest: string }
  selectedFileName?: string
  stats: ArticleStats
  text: UiText
}) {
  return (
    <section className="focus-reading-layout">
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
        <div className="focus-reading-canvas">
          {loading && <div className="loading">{text.loading}</div>}
          {!loading && !payload && (
            <div className="empty-reader">
              <FileText size={34} />
              <p>{text.selectMarkdownDoc}</p>
            </div>
          )}
          {!loading && payload && (
            <div className="article-page focus-page" style={articleStyle}>
              <header className="article-title">
                <h1>{previewParsed.title}</h1>
                {previewParsed.digest && <p>{previewParsed.digest}</p>}
              </header>
              <div
                className="markdown-body"
                dangerouslySetInnerHTML={{ __html: articleHtml }}
              />
            </div>
          )}
        </div>
      </div>
      <aside className="focus-outline-panel">
        <div className="focus-reading-bar">
          <div>
            <strong>{text.outline}</strong>
            <span>{formatArticleCount(outline.length, language)}</span>
          </div>
        </div>
        <OutlinePanel
          language={language}
          outline={outline}
          stats={stats}
          text={text}
          onSelect={onOutlineSelect}
        />
      </aside>
    </section>
  )
}

function RichMarkdownEditor({
  scrollRef,
  text,
  value,
  onChange,
  onRequestImageMarkdown,
  onSave,
  onScroll,
}: {
  editorKey: string
  scrollRef: RefObject<HTMLDivElement | null>
  text: UiText
  value: string
  onChange: (value: string) => void
  onRequestImageMarkdown: () => Promise<string | null>
  onSave: () => void
  onScroll: () => void
}) {
  return (
    <div ref={scrollRef} className="rich-editor-scroll" onScroll={onScroll}>
      <FallbackMarkdownEditor
        value={value}
        onChange={onChange}
        onRequestImageMarkdown={onRequestImageMarkdown}
        onSave={onSave}
        onScroll={onScroll}
        text={text}
      />
    </div>
  )
}

function OutlinePanel({
  language,
  outline,
  stats,
  text,
  onSelect,
}: {
  language: Language
  outline: OutlineItem[]
  stats: ArticleStats
  text: UiText
  onSelect: (item: OutlineItem) => void
}) {
  return (
    <div className="panel-content outline-panel">
      <div className="stats-grid">
        <div>
          <span>{text.wordCount}</span>
          <strong>{stats.words}</strong>
        </div>
        <div>
          <span>{text.reading}</span>
          <strong>{formatReadingMinutes(stats.readingMinutes, language)}</strong>
        </div>
        <div>
          <span>{text.images}</span>
          <strong>{stats.images}</strong>
        </div>
        <div>
          <span>{text.codeBlocks}</span>
          <strong>{stats.codeBlocks}</strong>
        </div>
      </div>
      {outline.length > 0 ? (
        <div className="outline-list">
          {outline.map((item) => (
            <button
              className="outline-row"
              key={item.id}
              onClick={() => onSelect(item)}
              style={{ paddingLeft: `${Math.max(0, item.level - 1) * 12}px` }}
            >
              <ListTree size={14} />
              <span>{item.text}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-mini">
          <ListTree size={22} />
          <p>{text.noOutline}</p>
        </div>
      )}
    </div>
  )
}

function ExportPanel({
  disabled,
  language,
  onCopyMarkdown,
  onCopyReadingHtml,
  onCopyWechatHtml,
  onSaveReadingHtml,
  onSaveWechatHtml,
  onSavePdf,
  onSaveWordDocx,
  onWordStyleChange,
  stats,
  text,
  wordStyle,
}: {
  disabled: boolean
  language: Language
  onCopyMarkdown: () => void
  onCopyReadingHtml: () => void
  onCopyWechatHtml: () => void
  onSaveReadingHtml: () => void
  onSaveWechatHtml: () => void
  onSavePdf: () => void
  onSaveWordDocx: () => void
  onWordStyleChange: (style: WordStyleId) => void
  stats: ArticleStats
  text: UiText
  wordStyle: WordStyleId
}) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)

  return (
    <div className="panel-content export-panel">
      <div className="export-summary">
        <Download size={19} />
        <div>
          <strong>{formatWordCount(stats.words || 0, language)}</strong>
          <span>{formatExportSummary(stats, language)}</span>
        </div>
      </div>
      <label className="word-style-field">
        <span>{text.markdownStyle}</span>
        <select
          value={wordStyle}
          onChange={(event) => onWordStyleChange(event.target.value as WordStyleId)}
        >
          {wordStylePresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {language === 'zh' ? preset.name : preset.nameEn} / {preset.font}
            </option>
          ))}
        </select>
      </label>
      <div className="export-primary-actions">
        <button className="primary-export-button" onClick={onSaveWordDocx} disabled={disabled}>
          <FileDown size={15} />
          Word
          <span>{text.wordDescription}</span>
        </button>
        <button className="primary-export-button" onClick={onSavePdf} disabled={disabled}>
          <FileDown size={15} />
          PDF
          <span>{text.pdfDescription}</span>
        </button>
      </div>
      <div className="export-copy-row export-utility-row">
        <button onClick={onCopyMarkdown} disabled={disabled}>
          <Copy size={14} />
          {text.copyMarkdown}
        </button>
      </div>
      <button
        className="export-advanced-toggle"
        onClick={() => setIsAdvancedOpen((value) => !value)}
      >
        <span>
          <FileText size={14} />
          {text.htmlOutput}
        </span>
        <span>{isAdvancedOpen ? text.collapse : text.expand}</span>
      </button>
      {isAdvancedOpen && (
        <div className="export-html-actions">
          <div className="export-html-row">
            <span>{text.readingVersion}</span>
            <button onClick={onCopyReadingHtml} disabled={disabled}>
              <Copy size={14} />
              {text.copy}
            </button>
            <button onClick={onSaveReadingHtml} disabled={disabled}>
              <Download size={14} />
              {text.save}
            </button>
          </div>
          <div className="export-html-row">
            <span>{text.wechat}</span>
            <button onClick={onCopyWechatHtml} disabled={disabled}>
              <Copy size={14} />
              {text.copy}
            </button>
            <button onClick={onSaveWechatHtml} disabled={disabled}>
              <Download size={14} />
              {text.save}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
function QuickOpenDialog({
  articles,
  language,
  text,
  onClose,
  onSelect,
}: {
  articles: ArticleSummary[]
  language: Language
  text: UiText
  onClose: () => void
  onSelect: (path: string) => void
}) {
  const [filter, setFilter] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const filtered = useMemo(() => {
    const target = filter.trim().toLowerCase()
    if (!target) return articles.slice(0, 12)
    return articles
      .filter((article) =>
        `${article.title} ${article.file_name} ${article.group}`.toLowerCase().includes(target),
      )
      .slice(0, 12)
  }, [articles, filter])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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
              if (event.key === 'Escape') {
                onClose()
              }
              if (event.key === 'Enter' && filtered[0]) {
                onSelect(filtered[0].path)
              }
            }}
            placeholder={text.quickOpenPlaceholder}
          />
        </div>
        <div className="quick-open-list">
          {filtered.map((article) => (
            <button key={article.path} onClick={() => onSelect(article.path)}>
              <FileText size={16} />
              <span>{article.title || article.file_name}</span>
              <small>{displayGroupName(article.group, language)}</small>
            </button>
          ))}
          {filtered.length === 0 && <div className="empty-mini">{text.noMatches}</div>}
        </div>
      </section>
    </div>
  )
}

function FallbackMarkdownEditor({
  text,
  value,
  onChange,
  onRequestImageMarkdown,
  onSave,
  onScroll,
}: {
  text: UiText
  value: string
  onChange: (value: string) => void
  onRequestImageMarkdown: () => Promise<string | null>
  onSave: () => void
  onScroll: () => void
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
        onScroll={onScroll}
        wrap="off"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            void onSave()
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
    if (this.state.message) {
      return <AppErrorFallback message={this.state.message} />
    }
    return this.props.children
  }
}

function base64ToArrayBuffer(base64: string) {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

async function readBundledPdfFont() {
  const response = await fetch('fonts/NotoSansSC-VF.ttf')
  if (!response.ok) {
    throw new Error('内置 PDF 字体加载失败')
  }
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
  return `${(name || 'article').replace(/\.[^.]+$/, '')}.${extension}`
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
  if (language === 'zh') {
    return short ? `${count} 图` : `${count} 张图片`
  }
  return short ? `${count} img` : `${count} images`
}

function formatExportSummary(stats: ArticleStats, language: Language) {
  const minutes = stats.readingMinutes || 1
  const images = stats.images || 0
  return language === 'zh'
    ? `${minutes} 分钟阅读，${images} 张图片`
    : `${minutes} min read, ${images} images`
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
    'WeMD 审稿': 'WeMD Review',
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

function isTauri() {
  return Boolean('__TAURI_INTERNALS__' in window)
}

export default App
