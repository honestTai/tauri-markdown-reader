import { marked } from 'marked'
import type { CheckItem, ParsedArticle } from './types'

const forbiddenWords = [
  '论文',
  '答辩',
  '老师',
  '学校',
  '报告结构',
  '买前',
  '值不值得入手',
  '适合什么人',
  '项目资料',
]

const metaPhrases = [
  '读者先看懂',
  '后面再看',
  '作为开放样例',
  '这篇会放进',
  '首先',
  '其次',
  '最后',
]

const S = {
  root: 'max-width:100%;box-sizing:border-box;color:#27364a;font-size:16px;line-height:1.9;letter-spacing:0;background:#ffffff;',
  p: 'margin:0 0 16px 0;color:#27364a;font-size:16px;line-height:1.9;text-align:left;',
  h2Wrap: 'display:flex;align-items:center;margin:34px 0 18px 0;padding:0;',
  h2Bar: 'display:inline-block;width:5px;height:24px;background:#42a66f;border-radius:2px;margin-right:10px;vertical-align:middle;',
  h2: 'display:inline-block;margin:0;color:#1f2d3d;font-size:22px;line-height:1.35;font-weight:700;',
  list: 'margin:0 0 18px 0;padding:0 0 0 24px;color:#27364a;font-size:16px;line-height:1.9;',
  li: 'margin:0 0 8px 0;color:#27364a;font-size:16px;line-height:1.9;',
  figure: 'margin:24px 0 28px 0;text-align:center;',
  img: 'display:block;width:100%;max-width:100%;height:auto;border-radius:6px;margin:0 auto;',
  caption: 'margin-top:8px;color:#7b8794;font-size:13px;line-height:1.6;text-align:center;',
  codeWrap: 'margin:18px 0 22px 0;padding:14px 16px;background:#f7f8fa;border-left:4px solid #42a66f;border-radius:6px;box-sizing:border-box;',
  pre: 'margin:0;white-space:pre-wrap;word-break:break-word;color:#465468;font-size:14px;line-height:1.8;font-family:Menlo,Consolas,monospace;',
  inlineCode: 'padding:2px 5px;margin:0 2px;background:#f2f4f7;border-radius:4px;color:#2f6f4e;font-size:90%;font-family:Menlo,Consolas,monospace;',
  strong: 'font-weight:700;color:#1f2d3d;',
}

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
  return marked.parse(markdown, { async: false }) as string
}

export function renderWechatHtml(raw: string): string {
  const { body } = parseArticle(raw)
  const lines = body.split(/\r?\n/)
  const chunks: string[] = []
  let paragraph: string[] = []
  let list: null | { type: 'ul' | 'ol'; items: string[] } = null
  let code: null | { lines: string[] } = null

  function flushParagraph() {
    if (paragraph.length === 0) return
    chunks.push(`<p style="${S.p}">${inline(paragraph.join(''))}</p>`)
    paragraph = []
  }

  function flushList() {
    if (!list) return
    const items = list.items
      .map((item) => `<li style="${S.li}">${inline(item)}</li>`)
      .join('')
    chunks.push(`<${list.type} style="${S.list}">${items}</${list.type}>`)
    list = null
  }

  function flushCode() {
    if (!code) return
    chunks.push(
      `<section style="${S.codeWrap}"><pre style="${S.pre}"><code>${escapeHtml(
        code.lines.join('\n'),
      )}</code></pre></section>`,
    )
    code = null
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (code) {
      if (/^```/.test(trimmed)) flushCode()
      else code.lines.push(line)
      continue
    }
    if (/^```/.test(trimmed)) {
      flushParagraph()
      flushList()
      code = { lines: [] }
      continue
    }
    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    const image = trimmed.match(/^!\[(.*?)\]\(([\s\S]+?)\)$/)
    if (image) {
      flushParagraph()
      flushList()
      const alt = escapeHtml(image[1])
      chunks.push(
        `<figure style="${S.figure}"><img src="${escapeHtml(
          image[2].trim(),
        )}" alt="${alt}" style="${S.img}" /><figcaption style="${
          S.caption
        }">${alt}</figcaption></figure>`,
      )
      continue
    }

    const heading = trimmed.match(/^##\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      chunks.push(
        `<section style="${S.h2Wrap}"><span style="${S.h2Bar}"></span><h2 style="${
          S.h2
        }">${inline(heading[1])}</h2></section>`,
      )
      continue
    }

    const bullet = trimmed.match(/^-\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      if (!list || list.type !== 'ul') {
        flushList()
        list = { type: 'ul', items: [] }
      }
      list.items.push(bullet[1])
      continue
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/)
    if (ordered) {
      flushParagraph()
      if (!list || list.type !== 'ol') {
        flushList()
        list = { type: 'ol', items: [] }
      }
      list.items.push(ordered[1])
      continue
    }

    flushList()
    paragraph.push(trimmed)
  }

  flushParagraph()
  flushList()
  flushCode()

  return `<section style="${S.root}">\n${chunks.join('\n')}\n</section>\n`
}

export function makeChecks(raw: string, preview: string): CheckItem[] {
  const parsed = parseArticle(raw)
  const body = parsed.body
  const checks: CheckItem[] = []
  const digestLength = chineseLength(parsed.digest)
  const relativeImages = [...raw.matchAll(/!\[[^\]]*]\((?!data:image\/|https?:\/\/|file:)([^)\s]+)[^)]*\)/gi)]
  const unresolvedImages = [...preview.matchAll(/!\[[^\]]*]\((?!data:image\/|https?:\/\/|file:)([^)\s]+)[^)]*\)/gi)]
  const h1 = [...body.matchAll(/^#\s+(.+)$/gm)].map((m) => m[1].trim())
  const longParagraphs = body
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter((block) => block.length > 180 && !block.startsWith('!['))
  const longLists = body
    .split(/\n{2,}/)
    .filter((block) => block.split(/\r?\n/).filter((line) => /^-\s+/.test(line.trim())).length > 7)

  checks.push(
    parsed.title
      ? pass('标题已填写', parsed.title)
      : error('缺少 frontmatter title', '公众号标题需要写在 frontmatter 的 title 字段。'),
  )

  if (!parsed.digest) {
    checks.push(error('缺少 digest', '公众号摘要需要写在 frontmatter 的 digest 字段。'))
  } else if (digestLength > 120) {
    checks.push(error('摘要超过 120 字', `当前约 ${digestLength} 字，需要压缩。`))
  } else {
    checks.push(pass('摘要长度合格', `当前约 ${digestLength} 字。`))
  }

  if (h1.length > 0) {
    checks.push(
      warning('正文含 H1 标题', `正文出现 ${h1.length} 个 H1，公众号文章通常只保留 frontmatter title。`),
    )
  } else {
    checks.push(pass('正文没有重复 H1', '标题只保留在 frontmatter。'))
  }

  if (relativeImages.length > 0) {
    checks.push(
      warning('原文含相对图片路径', `发现 ${relativeImages.length} 个本地图片引用，复制公众号 HTML 前需要内联。`),
    )
  } else {
    checks.push(pass('图片引用可直接交付', '没有发现相对图片路径。'))
  }

  if (unresolvedImages.length > 0) {
    checks.push(
      error('有图片未能解析', `预览中仍有 ${unresolvedImages.length} 个相对图片路径，请检查文件是否存在。`),
    )
  }

  const forbiddenHits = forbiddenWords.filter((word) => raw.includes(word))
  if (forbiddenHits.length > 0) {
    checks.push(error('发现禁用表达', `命中：${forbiddenHits.join('、')}`))
  } else {
    checks.push(pass('未发现禁用词', '没有命中当前公众号规则里的禁用词。'))
  }

  const metaHits = metaPhrases.filter((word) => raw.includes(word))
  if (metaHits.length > 0) {
    checks.push(warning('存在模板化或元叙事表达', `命中：${metaHits.join('、')}`))
  } else {
    checks.push(pass('表达节奏正常', '未发现明显模板化转折。'))
  }

  if (longParagraphs.length > 0) {
    checks.push(warning('存在过长段落', `发现 ${longParagraphs.length} 段超过 180 字，手机阅读可能吃力。`))
  } else {
    checks.push(pass('段落长度适合移动阅读', '没有发现过长段落。'))
  }

  if (longLists.length > 0) {
    checks.push(warning('存在长列表', `发现 ${longLists.length} 组较长列表，公众号阅读可能需要拆分。`))
  } else {
    checks.push(info('列表密度正常', '未发现特别长的项目列表。'))
  }

  return checks
}

function chineseLength(text: string) {
  return [...text.trim()].length
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

function inline(text: string) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, `<code style="${S.inlineCode}">$1</code>`)
    .replace(/\*\*([^*]+)\*\*/g, `<strong style="${S.strong}">$1</strong>`)
}

function error(title: string, detail: string): CheckItem {
  return { level: 'error', title, detail }
}

function warning(title: string, detail: string): CheckItem {
  return { level: 'warning', title, detail }
}

function info(title: string, detail: string): CheckItem {
  return { level: 'info', title, detail }
}

function pass(title: string, detail: string): CheckItem {
  return { level: 'pass', title, detail }
}
