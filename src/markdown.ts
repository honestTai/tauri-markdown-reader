import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { ArticleStats, OutlineItem, ParsedArticle } from './types'

marked.use({
  gfm: true,
  breaks: false,
})

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
  const rawHtml = marked.parse(markdown, { async: false }) as string
  return sanitizeMarkdownHtml(addHeadingAnchors(rawHtml))
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
    img{display:block;max-width:100%;height:auto;margin:22px auto;border-radius:6px;}
    pre{overflow:auto;padding:14px 16px;border-radius:7px;background:#f4f6f8;}
    code{font-family:Consolas,Menlo,monospace;}
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
      'button',
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
    FORBID_ATTR: ['formaction', 'ping', 'srcdoc', 'srcset', 'style'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|data:image\/(?:gif|jpeg|jpg|png|webp);base64,|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  }).replace(
    /<img\b([^>]*?)\bsrc=(["'])(https?:\/\/[^"']+)\2([^>]*)>/gi,
    '<img$1$4>',
  )
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
