import { Component, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ErrorInfo, ReactNode, RefObject } from 'react'
import {
  Copy,
  Download,
  FileDown,
  FileText,
  FolderOpen,
  Image as ImageIcon,
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
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
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
      setNotice('请先选择或输入 Markdown 文件夹 / 文件。')
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
      setNotice(`加载失败：${String(error)}`)
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
      setNotice(`读取失败：${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  async function chooseWorkspace() {
    if (!isTauri()) {
      setNotice('浏览器预览模式下不能打开本地目录。')
      return
    }
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择文章工作区',
    })
    if (typeof selected === 'string') {
      setWorkspace(selected)
      await loadArticles(selected, '')
      await record(`切换工作区：${selected}`)
    }
  }

  async function chooseMarkdownFile() {
    if (!isTauri()) {
      setNotice('浏览器预览模式下不能打开本地文件。')
      return
    }
    const selected = await open({
      multiple: false,
      title: '选择 Markdown 文件',
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
    setNotice('已复制公众号 HTML')
    await record(`复制公众号 HTML：${payload.path}`)
  }

  async function saveMarkdown() {
    if (!payload) return
    if (!isDirty) {
      setNotice('当前没有未保存修改。')
      return
    }
    if (!isTauri()) {
      const nextPayload = { ...demoPayload, content: editedContent, preview_content: editedContent }
      setPayload(nextPayload)
      setNotice('浏览器预览模式已更新示例内容。')
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
    setNotice('Markdown 已保存')
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
      setNotice('浏览器预览模式下仅支持复制 HTML。')
      return
    }
    const output = await invoke<string>('save_wechat_html', {
      articlePath: payload.path,
      html: wechatHtml,
    })
    setNotice(`已生成并打开 HTML：${output}`)
    await record(`生成公众号 HTML：${output}`)
  }

  async function copyMarkdown() {
    if (!payload) return
    await navigator.clipboard.writeText(editedContent)
    setNotice('已复制 Markdown')
    await record(`复制 Markdown：${payload.path}`)
  }

  async function copyReadingHtml() {
    if (!payload) return
    await navigator.clipboard.writeText(readingHtml)
    setNotice('已复制阅读 HTML')
    await record(`复制阅读 HTML：${payload.path}`)
  }

  async function saveReadingHtml() {
    if (!payload) return
    if (!isTauri()) {
      setNotice('浏览器预览模式下仅支持复制 HTML。')
      return
    }
    const output = await invoke<string>('save_reading_html', {
      articlePath: payload.path,
      html: readingHtml,
    })
    setNotice(`已生成并打开阅读 HTML：${output}`)
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
        setNotice('浏览器预览模式已下载 Word。')
        return
      }
      const output = await invoke<string>('save_binary_export', {
        request: {
          articlePath: payload.path,
          contentBase64,
          extension: 'docx',
        },
      })
      setNotice(`已生成并打开 Word：${output}`)
      await record(`生成 Word：${output}`)
    } catch (error) {
      setNotice(`Word 导出失败：${String(error)}`)
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
        setNotice('浏览器预览模式已下载 PDF。')
        return
      }
      const output = await invoke<string>('save_binary_export', {
        request: {
          articlePath: payload.path,
          contentBase64,
          extension: 'pdf',
        },
      })
      setNotice(`已生成并打开 PDF：${output}`)
      await record(`生成 PDF：${output}`)
    } catch (error) {
      setNotice(`PDF 导出失败：${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  async function requestImageMarkdown() {
    if (!payload) {
      setNotice('请先打开一个 Markdown 文件。')
      return null
    }
    if (!isTauri()) {
      setNotice('浏览器预览模式下不能插入本地图片。')
      return null
    }
    const selected = await open({
      multiple: false,
      title: '插入图片',
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
      setNotice(`已插入图片：${response.relativePath}`)
      await record(`插入图片资源：${response.relativePath}`)
      return response.markdown
    } catch (error) {
      setNotice(`插入图片失败：${String(error)}`)
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <FileText size={19} />
          <div>
            <strong>Markdown Reader</strong>
            <span>本地多平台预览</span>
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
            aria-label="工作区路径"
            placeholder="选择或输入 Markdown 文件夹 / 文件"
          />
        </div>
        <div className="toolbar">
          <button
            className="icon-button"
            onClick={() => setIsSidebarOpen((value) => !value)}
            title={isSidebarOpen ? '收起文档栏' : '展开文档栏'}
          >
            {isSidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          <button
            className="icon-button"
            onClick={() => setIsPlatformOpen((value) => !value)}
            title={isPlatformOpen ? '收起平台栏' : '展开平台栏'}
          >
            {isPlatformOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
          <button
            className={`icon-button ${isFocusMode ? 'is-active' : ''}`}
            onClick={() => setIsFocusMode((value) => !value)}
            title={isFocusMode ? '退出专注模式' : '专注模式'}
          >
            {isFocusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button className="icon-button" onClick={chooseWorkspace} title="打开目录">
            <FolderOpen size={17} />
          </button>
          <button className="icon-button" onClick={chooseMarkdownFile} title="打开 Markdown 文件">
            <FileText size={17} />
          </button>
          <button
            className="icon-button"
            onClick={() => setIsQuickOpenOpen(true)}
            title="快速打开"
            disabled={articles.length === 0}
          >
            <Search size={17} />
          </button>
          <button
            className="icon-button"
            onClick={() => loadArticles()}
            title="刷新"
            disabled={!workspace.trim()}
          >
            <RefreshCw size={17} />
          </button>
          <button className="command-button" onClick={saveMarkdown} disabled={!isDirty}>
            <Save size={16} />
            保存MD
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
            <span>文档</span>
            <div className="sidebar-tools">
              <small>{articles.length} 篇</small>
              <button
                className="panel-toggle"
                onClick={() => setIsSidebarOpen(false)}
                title="收起文档栏"
              >
                <PanelLeftClose size={15} />
              </button>
            </div>
          </div>
          <label className="search-box">
            <Search size={15} />
            <input
              placeholder="搜索标题或文件"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="article-groups">
            {Object.entries(groupedArticles).map(([group, items]) => (
              <section className="article-group" key={group}>
                <div className="group-title">{group}</div>
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
                <p>{workspace ? '当前路径没有找到文章。' : '先选择 Markdown 文件夹或文件。'}</p>
                {!workspace && (
                  <>
                  <button className="inline-action" onClick={chooseWorkspace}>
                    <FolderOpen size={15} />
                    选择目录
                  </button>
                  <button className="inline-action" onClick={chooseMarkdownFile}>
                    <FileText size={15} />
                    选择文件
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
            <FocusEditor
              articleHtml={articleHtml}
              articleStyle={articleStyle}
              currentContent={currentContent}
              editedContent={editedContent}
              editorKey={selectedPath || 'focus-editor'}
              isDirty={isDirty}
              loading={loading}
              onChange={setEditedContent}
              onRequestImageMarkdown={requestImageMarkdown}
              onSave={saveMarkdown}
              payload={payload}
              previewParsed={previewParsed}
              selectedFileName={selectedArticle?.file_name}
            />
          ) : (
          <>
          <div className="reader-tabs">
            <button
              className={readMode === 'desktop' ? 'selected' : ''}
              onClick={() => setReadMode('desktop')}
            >
              <Monitor size={16} />
              电脑阅读
            </button>
            <button
              className={readMode === 'source' ? 'selected' : ''}
              onClick={() => setReadMode('source')}
            >
              <FileText size={16} />
              原文
            </button>
            <button
              className={readMode === 'edit' ? 'selected' : ''}
              onClick={() => setReadMode('edit')}
            >
              <PencilLine size={16} />
              编辑
            </button>
            {isDirty && <span className="dirty-badge">未保存</span>}
            {payload && (
              <div className="stats-strip">
                <span>{stats.words} 字</span>
                <span>{stats.readingMinutes} 分钟</span>
                <span>{stats.images} 图</span>
              </div>
            )}
          </div>
          <article className={`reader-canvas ${readMode}`}>
            {loading && <div className="loading">正在加载...</div>}
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
                    <span>{isDirty ? '有未保存修改' : '已保存'}</span>
                  </div>
                  <button className="command-button" onClick={saveMarkdown} disabled={!isDirty}>
                    <Save size={16} />
                    保存MD
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
                />
              </div>
            )}
            {!loading && !payload && (
              <div className="empty-reader">
                <FileText size={34} />
                <p>{workspace ? '选择左侧 Markdown 文档开始预览。' : '请选择一个 Markdown 文件夹或文件。'}</p>
                {!workspace && (
                  <>
                  <button className="command-button" onClick={chooseWorkspace}>
                    <FolderOpen size={16} />
                    选择目录
                  </button>
                  <button className="command-button" onClick={chooseMarkdownFile}>
                    <FileText size={16} />
                    选择文件
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
              title="收起平台栏"
            >
              <PanelRightClose size={15} />
            </button>
            <button
              className={panelTab === 'outline' ? 'selected' : ''}
              onClick={() => setPanelTab('outline')}
            >
              大纲
            </button>
            <button
              className={panelTab === 'exports' ? 'selected' : ''}
              onClick={() => setPanelTab('exports')}
            >
              导出
            </button>
          </div>

          {panelTab === 'outline' && <OutlinePanel outline={outline} stats={stats} onSelect={jumpToOutline} />}
          {panelTab === 'exports' && (
            <ExportPanel
              disabled={!payload}
              onCopyMarkdown={copyMarkdown}
              onCopyReadingHtml={copyReadingHtml}
              onCopyWechatHtml={copyWechatHtml}
              onSaveReadingHtml={saveReadingHtml}
              onSaveWechatHtml={saveWechatHtml}
              onSavePdf={savePdf}
              onSaveWordDocx={saveWordDocx}
              onWordStyleChange={setWordStyle}
              stats={stats}
              wordStyle={wordStyle}
            />
          )}
        </aside>
        )}
      </section>

      {isQuickOpenOpen && (
        <QuickOpenDialog
          articles={articles}
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

function FocusEditor({
  articleHtml,
  articleStyle,
  currentContent,
  editedContent,
  editorKey,
  isDirty,
  loading,
  onChange,
  onRequestImageMarkdown,
  onSave,
  payload,
  previewParsed,
  selectedFileName,
}: {
  articleHtml: string
  articleStyle: CSSProperties
  currentContent: string
  editedContent: string
  editorKey: string
  isDirty: boolean
  loading: boolean
  onChange: (value: string) => void
  onRequestImageMarkdown: () => Promise<string | null>
  onSave: () => void
  payload: ArticlePayload | null
  previewParsed: { title: string; digest: string }
  selectedFileName?: string
}) {
  const focusEditorScrollRef = useRef<HTMLDivElement | null>(null)
  const focusPreviewRef = useRef<HTMLDivElement | null>(null)

  function syncPreviewScroll() {
    const editor = focusEditorScrollRef.current
    const preview = focusPreviewRef.current
    if (!editor || !preview) return
    const editorMax = editor.scrollHeight - editor.clientHeight
    const previewMax = preview.scrollHeight - preview.clientHeight
    if (editorMax <= 0 || previewMax <= 0) return
    preview.scrollTop = (editor.scrollTop / editorMax) * previewMax
  }

  useEffect(() => {
    requestAnimationFrame(syncPreviewScroll)
  }, [editedContent])

  return (
    <section className="focus-split">
      <div className="focus-editor-pane">
        <div className="focus-bar">
          <div>
            <strong>{selectedFileName || 'Markdown'}</strong>
            <span>{payload ? (isDirty ? '有未保存修改' : '已保存') : '未打开文档'}</span>
          </div>
          <button className="command-button" onClick={onSave} disabled={!isDirty}>
            <Save size={16} />
            保存MD
          </button>
        </div>
        {loading && <div className="loading">正在加载...</div>}
        {!loading && payload && (
          <RichMarkdownEditor
            editorKey={editorKey}
            scrollRef={focusEditorScrollRef}
            value={editedContent}
            onChange={onChange}
            onRequestImageMarkdown={onRequestImageMarkdown}
            onSave={onSave}
            onScroll={syncPreviewScroll}
          />
        )}
        {!loading && !payload && (
          <div className="empty-reader">
            <FileText size={34} />
            <p>请选择一个 Markdown 文档。</p>
          </div>
        )}
      </div>
      <div className="focus-preview-pane">
        <div className="focus-bar">
          <div>
            <strong>实时预览</strong>
            <span>电脑阅读</span>
          </div>
        </div>
        <div ref={focusPreviewRef} className="focus-preview-canvas">
          {!payload && (
            <div className="empty-reader">
              <FileText size={34} />
              <p>预览会在右侧实时更新。</p>
            </div>
          )}
          {payload && (
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
          {payload && !currentContent.trim() && (
            <div className="empty-reader">开始输入 Markdown，右侧会实时渲染。</div>
          )}
        </div>
      </div>
    </section>
  )
}

function RichMarkdownEditor({
  scrollRef,
  value,
  onChange,
  onRequestImageMarkdown,
  onSave,
  onScroll,
}: {
  editorKey: string
  scrollRef: RefObject<HTMLDivElement | null>
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
      />
    </div>
  )
}

function OutlinePanel({
  outline,
  stats,
  onSelect,
}: {
  outline: OutlineItem[]
  stats: ArticleStats
  onSelect: (item: OutlineItem) => void
}) {
  return (
    <div className="panel-content outline-panel">
      <div className="stats-grid">
        <div>
          <span>字数</span>
          <strong>{stats.words}</strong>
        </div>
        <div>
          <span>阅读</span>
          <strong>{stats.readingMinutes} 分钟</strong>
        </div>
        <div>
          <span>图片</span>
          <strong>{stats.images}</strong>
        </div>
        <div>
          <span>代码块</span>
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
          <p>当前文档还没有标题层级。</p>
        </div>
      )}
    </div>
  )
}

function ExportPanel({
  disabled,
  onCopyMarkdown,
  onCopyReadingHtml,
  onCopyWechatHtml,
  onSaveReadingHtml,
  onSaveWechatHtml,
  onSavePdf,
  onSaveWordDocx,
  onWordStyleChange,
  stats,
  wordStyle,
}: {
  disabled: boolean
  onCopyMarkdown: () => void
  onCopyReadingHtml: () => void
  onCopyWechatHtml: () => void
  onSaveReadingHtml: () => void
  onSaveWechatHtml: () => void
  onSavePdf: () => void
  onSaveWordDocx: () => void
  onWordStyleChange: (style: WordStyleId) => void
  stats: ArticleStats
  wordStyle: WordStyleId
}) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)

  return (
    <div className="panel-content export-panel">
      <div className="export-summary">
        <Download size={19} />
        <div>
          <strong>{stats.words || 0} 字</strong>
          <span>{stats.readingMinutes || 1} 分钟阅读，{stats.images || 0} 张图片</span>
        </div>
      </div>
      <label className="word-style-field">
        <span>Markdown 样式</span>
        <select
          value={wordStyle}
          onChange={(event) => onWordStyleChange(event.target.value as WordStyleId)}
        >
          {wordStylePresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name} / {preset.font}
            </option>
          ))}
        </select>
      </label>
      <div className="export-primary-actions">
        <button className="primary-export-button" onClick={onSaveWordDocx} disabled={disabled}>
          <FileDown size={15} />
          Word
          <span>保留标题、段落和列表</span>
        </button>
        <button className="primary-export-button" onClick={onSavePdf} disabled={disabled}>
          <FileDown size={15} />
          PDF
          <span>生成干净阅读版</span>
        </button>
      </div>
      <div className="export-copy-row export-utility-row">
        <button onClick={onCopyMarkdown} disabled={disabled}>
          <Copy size={14} />
          复制 Markdown
        </button>
      </div>
      <button
        className="export-advanced-toggle"
        onClick={() => setIsAdvancedOpen((value) => !value)}
      >
        <span>
          <FileText size={14} />
          HTML 输出
        </span>
        <span>{isAdvancedOpen ? '收起' : '展开'}</span>
      </button>
      {isAdvancedOpen && (
        <div className="export-html-actions">
          <div className="export-html-row">
            <span>阅读版</span>
            <button onClick={onCopyReadingHtml} disabled={disabled}>
              <Copy size={14} />
              复制
            </button>
            <button onClick={onSaveReadingHtml} disabled={disabled}>
              <Download size={14} />
              保存
            </button>
          </div>
          <div className="export-html-row">
            <span>公众号</span>
            <button onClick={onCopyWechatHtml} disabled={disabled}>
              <Copy size={14} />
              复制
            </button>
            <button onClick={onSaveWechatHtml} disabled={disabled}>
              <Download size={14} />
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
function QuickOpenDialog({
  articles,
  onClose,
  onSelect,
}: {
  articles: ArticleSummary[]
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
            placeholder="快速打开 Markdown"
          />
        </div>
        <div className="quick-open-list">
          {filtered.map((article) => (
            <button key={article.path} onClick={() => onSelect(article.path)}>
              <FileText size={16} />
              <span>{article.title || article.file_name}</span>
              <small>{article.group}</small>
            </button>
          ))}
          {filtered.length === 0 && <div className="empty-mini">没有匹配的文档。</div>}
        </div>
      </section>
    </div>
  )
}

function FallbackMarkdownEditor({
  value,
  onChange,
  onRequestImageMarkdown,
  onSave,
  onScroll,
}: {
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
        <button onClick={insertImage} disabled={isInsertingImage} title="插入图片">
          <ImageIcon size={15} />
          图片
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
        <strong>Markdown Reader 启动失败</strong>
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
    return { message: error.message || '前端运行时出现异常。' }
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
