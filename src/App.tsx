import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode, RefObject } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  FileText,
  FolderOpen,
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
  Smartphone,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import './App.css'
import {
  makeChecks,
  markdownToHtml,
  parseArticle,
  renderWechatHtml,
} from './markdown'
import type {
  ArticlePayload,
  ArticleSummary,
  CheckItem,
  FocusPreviewMode,
  PanelTab,
  ReadMode,
} from './types'

const LazyRichMarkdownEditor = lazy(() => import('./RichMarkdownEditor'))

const demoArticle: ArticleSummary = {
  path: 'demo.md',
  file_name: 'demo.md',
  title: 'Markdown 多平台阅读器设计样张',
  digest: '本地阅读、公众号预览和内容检查放进同一个桌面工作台。',
  group: '示例',
  status: 'draft',
  updated: Math.floor(Date.now() / 1000),
}

const demoPayload: ArticlePayload = {
  path: demoArticle.path,
  base_dir: '',
  content: `---
title: Markdown 多平台阅读器设计样张
digest: 本地阅读、公众号预览和内容检查放进同一个桌面工作台。
---

![系统预览](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwMCIgaGVpZ2h0PSI1NjAiIHZpZXdCb3g9IjAgMCAxMDAwIDU2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwMCIgaGVpZ2h0PSI1NjAiIGZpbGw9IiNmNmY4ZmEiLz48cmVjdCB4PSI2MCIgeT0iNjAiIHdpZHRoPSIyMDAiIGhlaWdodD0iNDQwIiByeD0iMTIiIGZpbGw9IiNlOWVmZjIiLz48cmVjdCB4PSIzMDAiIHk9IjYwIiB3aWR0aD0iNDIwIiBoZWlnaHQ9IjQ0MCIgcng9IjEyIiBmaWxsPSIjZmZmIi8+PHJlY3QgeD0iNzYwIiB5PSI2MCIgd2lkdGg9IjE4MCIgaGVpZ2h0PSI0NDAiIHJ4PSIxMiIgZmlsbD0iI2ZmZiIvPjx0ZXh0IHg9IjMzMCIgeT0iMTUwIiBmb250LXNpemU9IjM2IiBmb250LWZhbWlseT0iQXJpYWwiIGZpbGw9IiMxZjI5MzMiPkRlc2t0b3AgUmVhZGluZzwvdGV4dD48dGV4dCB4PSIzMzAiIHk9IjIyMCIgZm9udC1zaXplPSIyMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmaWxsPSIjNjI3MDdhIj5XZUNoYXQgYW5kIFhIUyBwcmV2aWV3IGluIG9uZSBsb2NhbCBhcHAuPC90ZXh0Pjwvc3ZnPg==)

## 系统需求分析

这个工具首先解决电脑阅读问题。写作者仍然使用 Markdown，但是不再被手机宽度锁住，可以直接在桌面上看清长文、系统截图、流程图和代码片段。

## 功能设计

- 左侧列出草稿、审稿稿和已确认稿。
- 中间默认显示电脑阅读版。
- 右侧切换公众号和检查结果。

## 实现亮点

第一版只做本地文件、本地预览和本地导出。发布动作仍然交给已有脚本，避免把工具做成另一个复杂平台。
`,
  preview_content: '',
}
demoPayload.preview_content = demoPayload.content

function App() {
  const [workspace, setWorkspace] = useState('')
  const [articles, setArticles] = useState<ArticleSummary[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [payload, setPayload] = useState<ArticlePayload | null>(null)
  const [editedContent, setEditedContent] = useState('')
  const [query, setQuery] = useState('')
  const [readMode, setReadMode] = useState<ReadMode>('desktop')
  const [panelTab, setPanelTab] = useState<PanelTab>('wechat')
  const [focusPreview, setFocusPreview] = useState<FocusPreviewMode>('desktop')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isPlatformOpen, setIsPlatformOpen] = useState(true)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const editorScrollRef = useRef<HTMLDivElement | null>(null)
  const wechatPreviewRef = useRef<HTMLElement | null>(null)
  const currentContent = payload ? editedContent : ''
  const isDirty = Boolean(payload && editedContent !== payload.content)
  const previewContent = isDirty ? editedContent : payload?.preview_content || ''

  const parsed = useMemo(() => parseArticle(currentContent), [currentContent])
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
  const checks = useMemo(
    () => makeChecks(currentContent, previewContent),
    [currentContent, previewContent],
  )
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
    if (panelTab === 'wechat') {
      requestAnimationFrame(syncEditorScrollToWechatPanel)
    }
  }, [editedContent, panelTab])

  async function loadArticles(root = workspace) {
    if (!root.trim()) {
      setNotice('请先选择或输入 Markdown 目录。')
      return
    }
    setLoading(true)
    try {
      const items = isTauri()
        ? await invoke<ArticleSummary[]>('scan_workspace', { workspace: root })
        : [demoArticle]
      setArticles(items)
      const first = items[0]
      if (first) {
        await selectArticle(first.path)
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
      await loadArticles(selected)
      await record(`切换工作区：${selected}`)
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
    setNotice(`已生成 HTML：${output}`)
    await record(`生成公众号 HTML：${output}`)
  }

  async function record(message: string) {
    const time = new Date().toLocaleString('zh-CN', { hour12: false })
    const entry = `## ${time}\n\n- ${message}`
    if (isTauri()) {
      await invoke('append_build_log', { entry })
    }
  }

  function syncEditorScrollToWechatPanel() {
    const editor = editorScrollRef.current
    const preview = wechatPreviewRef.current
    if (!editor || !preview) return
    const editorMax = editor.scrollHeight - editor.clientHeight
    const previewMax = preview.scrollHeight - preview.clientHeight
    if (editorMax <= 0 || previewMax <= 0) return
    preview.scrollTop = (editor.scrollTop / editorMax) * previewMax
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
            placeholder="选择或输入 Markdown 文件夹"
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
          <button className="command-button" onClick={copyWechatHtml} disabled={!payload}>
            <Copy size={16} />
            复制HTML
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
                <p>{workspace ? '当前目录没有找到文章。' : '先选择 Markdown 文件夹。'}</p>
                {!workspace && (
                  <button className="inline-action" onClick={chooseWorkspace}>
                    <FolderOpen size={15} />
                    选择目录
                  </button>
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
              currentContent={currentContent}
              editedContent={editedContent}
              editorKey={selectedPath || 'focus-editor'}
              focusPreview={focusPreview}
              isDirty={isDirty}
              loading={loading}
              onChange={setEditedContent}
              onSave={saveMarkdown}
              onSetFocusPreview={setFocusPreview}
              payload={payload}
              previewParsed={previewParsed}
              selectedFileName={selectedArticle?.file_name}
              wechatHtml={wechatHtml}
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
              className={readMode === 'wechat' ? 'selected' : ''}
              onClick={() => setReadMode('wechat')}
            >
              <Smartphone size={16} />
              公众号宽度
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
          </div>
          <article className={`reader-canvas ${readMode}`}>
            {loading && <div className="loading">正在加载...</div>}
            {!loading && payload && readMode !== 'source' && readMode !== 'edit' && (
              <div className="article-page">
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
                  onSave={saveMarkdown}
                  onScroll={syncEditorScrollToWechatPanel}
                />
              </div>
            )}
            {!loading && !payload && (
              <div className="empty-reader">
                <FileText size={34} />
                <p>{workspace ? '选择左侧 Markdown 文档开始预览。' : '请选择一个 Markdown 文件夹。'}</p>
                {!workspace && (
                  <button className="command-button" onClick={chooseWorkspace}>
                    <FolderOpen size={16} />
                    选择目录
                  </button>
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
              className={panelTab === 'wechat' ? 'selected' : ''}
              onClick={() => setPanelTab('wechat')}
            >
              公众号
            </button>
            <button
              className={panelTab === 'checks' ? 'selected' : ''}
              onClick={() => setPanelTab('checks')}
            >
              检查
            </button>
          </div>

          {panelTab === 'wechat' && (
            <WechatPanel
              html={wechatHtml}
              parsed={parsed}
              previewRef={wechatPreviewRef}
              onCopy={copyWechatHtml}
              onSave={saveWechatHtml}
              disabled={!payload}
            />
          )}
          {panelTab === 'checks' && <ChecksPanel checks={checks} />}
        </aside>
        )}
      </section>

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
  currentContent,
  editedContent,
  editorKey,
  focusPreview,
  isDirty,
  loading,
  onChange,
  onSave,
  onSetFocusPreview,
  payload,
  previewParsed,
  selectedFileName,
  wechatHtml,
}: {
  articleHtml: string
  currentContent: string
  editedContent: string
  editorKey: string
  focusPreview: FocusPreviewMode
  isDirty: boolean
  loading: boolean
  onChange: (value: string) => void
  onSave: () => void
  onSetFocusPreview: (mode: FocusPreviewMode) => void
  payload: ArticlePayload | null
  previewParsed: { title: string; digest: string }
  selectedFileName?: string
  wechatHtml: string
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
  }, [editedContent, focusPreview])

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
            <span>{previewLabel(focusPreview)}</span>
          </div>
          <div className="focus-preview-tabs">
            <button
              className={focusPreview === 'desktop' ? 'selected' : ''}
              onClick={() => onSetFocusPreview('desktop')}
            >
              <Monitor size={15} />
              电脑
            </button>
            <button
              className={focusPreview === 'wechat' ? 'selected' : ''}
              onClick={() => onSetFocusPreview('wechat')}
            >
              <Smartphone size={15} />
              公众号
            </button>
          </div>
        </div>
        <div ref={focusPreviewRef} className={`focus-preview-canvas ${focusPreview}`}>
          {!payload && (
            <div className="empty-reader">
              <FileText size={34} />
              <p>预览会在右侧实时更新。</p>
            </div>
          )}
          {payload && focusPreview === 'desktop' && (
            <div className="article-page focus-page">
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
          {payload && focusPreview === 'wechat' && (
            <div className="phone-frame focus-phone">
              <div className="phone-top">公众号预览</div>
              <section
                className="wechat-preview"
                dangerouslySetInnerHTML={{ __html: wechatHtml }}
              />
            </div>
          )}
          {payload && focusPreview === 'desktop' && !currentContent.trim() && (
            <div className="empty-reader">开始输入 Markdown，右侧会实时渲染。</div>
          )}
        </div>
      </div>
    </section>
  )
}

function previewLabel(mode: FocusPreviewMode) {
  if (mode === 'wechat') return '公众号宽度'
  return '电脑阅读'
}

function WechatPanel({
  html,
  parsed,
  previewRef,
  onCopy,
  onSave,
  disabled,
}: {
  html: string
  parsed: { title: string; digest: string }
  previewRef?: RefObject<HTMLElement | null>
  onCopy: () => void
  onSave: () => void
  disabled: boolean
}) {
  return (
    <div className="panel-content">
      <div className="phone-frame">
        <div className="phone-top">公众号预览</div>
        <section
          ref={previewRef}
          className="wechat-preview"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      <div className="meta-list">
        <div>
          <span>标题</span>
          <strong>{parsed.title || '未填写'}</strong>
        </div>
        <div>
          <span>摘要</span>
          <strong>{parsed.digest ? `${[...parsed.digest].length} 字` : '未填写'}</strong>
        </div>
      </div>
      <div className="panel-actions">
        <button onClick={onCopy} disabled={disabled}>
          <Copy size={15} />
          复制HTML
        </button>
        <button onClick={onSave} disabled={disabled}>
          <FileText size={15} />
          保存HTML
        </button>
      </div>
    </div>
  )
}

function RichMarkdownEditor({
  editorKey,
  scrollRef,
  value,
  onChange,
  onSave,
  onScroll,
}: {
  editorKey: string
  scrollRef: RefObject<HTMLDivElement | null>
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onScroll: () => void
}) {
  return (
    <EditorErrorBoundary
      fallback={
        <FallbackMarkdownEditor
          value={value}
          onChange={onChange}
          onSave={onSave}
          onScroll={onScroll}
        />
      }
    >
      <Suspense
        fallback={
          <div className="editor-loading">
            <span>正在加载富文本编辑器...</span>
          </div>
        }
      >
        <LazyRichMarkdownEditor
          editorKey={editorKey}
          scrollRef={scrollRef}
          value={value}
          onChange={onChange}
          onSave={onSave}
          onScroll={onScroll}
        />
      </Suspense>
    </EditorErrorBoundary>
  )
}

function FallbackMarkdownEditor({
  value,
  onChange,
  onSave,
  onScroll,
}: {
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onScroll: () => void
}) {
  return (
    <textarea
      className="fallback-markdown-editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onScroll={onScroll}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          void onSave()
        }
      }}
      spellCheck={false}
    />
  )
}

class EditorErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Rich Markdown editor failed to render.', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="editor-fallback">
          <div className="editor-fallback-bar">
            富文本编辑器加载失败，已切换到 Markdown 源码编辑。
          </div>
          {this.props.fallback}
        </div>
      )
    }
    return this.props.children
  }
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

function ChecksPanel({ checks }: { checks: CheckItem[] }) {
  return (
    <div className="checks-list">
      {checks.map((check) => (
        <div className={`check-item ${check.level}`} key={`${check.title}-${check.detail}`}>
          {check.level === 'pass' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
          <div>
            <strong>{check.title}</strong>
            <p>{check.detail}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function isTauri() {
  return Boolean('__TAURI_INTERNALS__' in window)
}

export default App
