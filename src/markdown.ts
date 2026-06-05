import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import highlightCss from 'highlight.js/styles/github.min.css?inline'
import katexCss from 'katex/dist/katex.min.css?inline'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import markedKatex from 'marked-katex-extension'
import type { ArticleStats, OutlineItem, ParsedArticle } from './types'

const markdownRenderer = new Marked(
  {
    gfm: true,
    breaks: false,
  },
  markedKatex({
    throwOnError: false,
    nonStandard: true,
  }),
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const normalizedLang = lang?.trim().split(/\s+/)[0] || ''
      if (normalizedLang === 'mermaid') return escapeHtml(code)
      const language = normalizedLang && hljs.getLanguage(normalizedLang) ? normalizedLang : 'plaintext'
      return hljs.highlight(code, { language }).value
    },
  }),
)

export function parseArticle(raw: string): ParsedArticle {
  const normalized = raw.replace(/^\uFEFF/, '')
  const frontmatter = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const data = frontmatter ? parseYamlBlock(frontmatter[1]) : {}
  return {
    title: String(data.title || '').trim(),
    digest: String(data.digest || '').trim(),
    body: normalized.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim(),
  }
}

export function markdownToHtml(markdown: string): string {
  const rawHtml = markdownRenderer.parse(markdown, { async: false }) as string
  return sanitizeMarkdownHtml(addHeadingAnchors(enhanceMarkdownHtml(rawHtml)))
}

export function getArticleStats(raw: string): ArticleStats {
  const { body } = parseArticle(raw)
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/[#>*_`~\-[\]().]/g, ' ')
  const cjkChars = [...text.matchAll(/[\u4e00-\u9fa5]/g)].length
  const latinWords = text.match(/[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*/g)?.length || 0
  const words = cjkChars + latinWords
  const headings = [...body.matchAll(/^#{1,6}\s+.+$/gm)].length
  const images = [...body.matchAll(/!\[[^\]]*]\([^)]+\)/g)].length
  const codeBlocks = [...body.matchAll(/^```.*$/gm)].length / 2

  return {
    words,
    headings,
    images,
    codeBlocks: Math.floor(codeBlocks),
    readingMinutes: Math.max(1, Math.ceil(words / 450)),
  }
}

export function buildOutline(raw: string): OutlineItem[] {
  const { body } = parseArticle(raw)
  return [...body.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match, index) => ({
    id: `heading-${index + 1}`,
    level: match[1].length,
    text: match[2].trim(),
  }))
}

export function buildReadingHtml(raw: string): string {
  const parsed = parseArticle(raw)
  const title = parsed.title || 'Markdown'
  const body = markdownToHtml(parsed.body)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';" />
  <title>${escapeHtml(title)}</title>
  <style>
    body{margin:0;background:#eef1f4;color:#26323d;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
    main{max-width:900px;margin:32px auto;padding:42px 52px;background:#fff;border:1px solid #e0e5e9;border-radius:8px;}
    h1{margin:0 0 12px;font-size:30px;line-height:1.35;}
    .digest{margin:0 0 28px;color:#687783;line-height:1.7;}
    article{font-size:17px;line-height:1.92;}
    ${highlightCss}
    ${katexCss}
    img{display:block;max-width:100%;height:auto;margin:22px auto;border-radius:6px;}
    table{width:100%;border-collapse:collapse;margin:18px 0;font-size:15px;}
    th,td{padding:9px 11px;border:1px solid #d8e0e7;text-align:left;vertical-align:top;}
    th{background:#f5f7f9;color:#1f2933;}
    pre{overflow:auto;margin:0;padding:14px 16px;background:#f7f9fb;}
    code{font-family:Consolas,Menlo,monospace;}
    .code-block{margin:18px 0;border:1px solid #d8e0e7;border-radius:8px;background:#f7f9fb;overflow:hidden;}
    .code-block figcaption{padding:7px 11px;border-bottom:1px solid #e3e8ed;color:#637282;background:#fbfcfd;font:12px Consolas,Menlo,monospace;}
    .mermaid-block{margin:22px 0;padding:18px;border:1px solid #d8e0e7;border-radius:8px;background:#fbfcfd;overflow:auto;}
    .markdown-callout{margin:18px 0;padding:12px 15px;border-left:4px solid #5b7cfa;background:#f5f7ff;border-radius:7px;}
    .markdown-callout.warning{border-left-color:#d97706;background:#fff8eb;}
    .markdown-callout.important{border-left-color:#dc2626;background:#fff1f2;}
    .markdown-callout-title{display:block;margin-bottom:6px;color:#1f2933;font-weight:700;}
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${parsed.digest ? `<p class="digest">${escapeHtml(parsed.digest)}</p>` : ''}
    <article>${body}</article>
  </main>
</body>
</html>`
}

function sanitizeMarkdownHtml(html: string) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'base',
      'embed',
      'form',
      'iframe',
      'input',
      'link',
      'meta',
      'object',
      'option',
      'script',
      'select',
      'style',
      'textarea',
    ],
    ADD_ATTR: ['data-language', 'data-mermaid-state'],
    FORBID_ATTR: ['formaction', 'ping', 'srcdoc', 'srcset'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|data:image\/(?:gif|jpeg|jpg|png|webp);base64,|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  }).replace(
    /<img\b([^>]*?)\bsrc=(["'])(https?:\/\/[^"']+)\2([^>]*)>/gi,
    '<img$1$4>',
  )
}

function enhanceMarkdownHtml(html: string) {
  return decorateCallouts(decorateMermaidBlocks(decorateCodeBlocks(html)))
}

function decorateCodeBlocks(html: string) {
  return html.replace(
    /<pre><code class="([^"]*\blanguage-([^"\s]+)[^"]*)"([^>]*)>([\s\S]*?)<\/code><\/pre>/g,
    (_full, className: string, language: string, attrs: string, code: string) => {
      if (language === 'mermaid') {
        return `<pre><code class="${className}"${attrs}>${code}</code></pre>`
      }
      const label = language || 'text'
      return `<figure class="code-block" data-language="${escapeHtml(label)}"><figcaption><span>${escapeHtml(label)}</span><button type="button" class="code-copy-button">Copy</button></figcaption><pre><code class="${className}"${attrs}>${code}</code></pre></figure>`
    },
  ).replace(
    /<pre><code class="hljs"([^>]*)>([\s\S]*?)<\/code><\/pre>/g,
    (_full, attrs: string, code: string) => `<figure class="code-block" data-language="text"><figcaption><span>text</span><button type="button" class="code-copy-button">Copy</button></figcaption><pre><code class="hljs"${attrs}>${code}</code></pre></figure>`,
  )
}

function decorateMermaidBlocks(html: string) {
  return html.replace(
    /<pre><code class="([^"]*\blanguage-mermaid[^"]*)"([^>]*)>([\s\S]*?)<\/code><\/pre>/g,
    (_full, _className: string, _attrs: string, code: string) => `<figure class="mermaid-block"><figcaption>mermaid</figcaption><div class="mermaid" data-mermaid-state="pending">${code}</div></figure>`,
  )
}

function decorateCallouts(html: string) {
  return html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)](?:\s*<br>)?\s*([\s\S]*?)<\/p>\s*<\/blockquote>/gi, (_full, kind: string, body: string) => {
    const normalizedKind = kind.toLowerCase()
    const label = kind.toUpperCase()
    return `<aside class="markdown-callout ${normalizedKind}"><strong class="markdown-callout-title">${label}</strong><div>${body}</div></aside>`
  })
}

function addHeadingAnchors(html: string) {
  let index = 0
  return html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g, (full, level, attrs, content) => {
    index += 1
    if (/\sid=/.test(attrs)) {
      return full
    }
    return `<h${level}${attrs} id="heading-${index}">${content}</h${level}>`
  })
}

function escapeHtml(text: string) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function parseYamlBlock(block: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    result[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return result
}
