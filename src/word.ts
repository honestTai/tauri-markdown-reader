import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import { marked } from 'marked'
import { imageForWord } from './exportImages'
import { parseArticle } from './markdown'
import type { WordStylePreset } from './wordStyles'
import { getWordStylePreset } from './wordStyles'
import type { WordStyleId } from './types'

export async function markdownToDocxBase64(raw: string, styleId: WordStyleId) {
  const preset = getWordStylePreset(styleId)
  const parsed = parseArticle(raw)
  const children: Paragraph[] = []

  if (parsed.title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        spacing: { after: 220 },
        children: [
          new TextRun({
            text: parsed.title,
            bold: true,
            color: preset.accent.replace('#', ''),
            font: preset.font,
            size: preset.bodySize + 16,
          }),
        ],
      }),
    )
  }

  if (parsed.digest) {
    children.push(
      new Paragraph({
        spacing: { after: 260 },
        children: [
          new TextRun({
            text: parsed.digest,
            color: '667085',
            font: preset.font,
            italics: true,
            size: preset.bodySize,
          }),
        ],
      }),
    )
  }

  for (const block of parseMarkdownBlocks(parsed.body)) {
    children.push(...(await blockToParagraphs(block, preset)))
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: preset.font,
            size: preset.bodySize,
            color: '26323D',
          },
          paragraph: {
            spacing: { line: preset.lineSpacing, after: 140 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1200,
              right: 1200,
              bottom: 1200,
              left: 1200,
            },
          },
        },
        children,
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  return blobToBase64(blob)
}

async function blockToParagraphs(block: MarkdownBlock, preset: WordStylePreset) {
  if (block.type === 'heading') {
    return [
      new Paragraph({
        heading: headingLevel(block.level),
        spacing: { before: block.level === 2 ? 260 : 180, after: 120 },
        children: [
          new TextRun({
            text: block.text,
            bold: true,
            color: preset.accent.replace('#', ''),
            font: preset.font,
            size: Math.max(preset.bodySize + 10 - block.level * 2, preset.bodySize + 2),
          }),
        ],
      }),
    ]
  }

  if (block.type === 'list') {
    return block.items.map(
      (item, index) =>
        new Paragraph({
          bullet: block.ordered ? undefined : { level: 0 },
          spacing: { after: 80, line: preset.lineSpacing },
          children: inlineRuns(block.ordered ? `${index + 1}. ${item}` : item, preset),
        }),
    )
  }

  if (block.type === 'code') {
    return [
      new Paragraph({
        spacing: { before: 120, after: 160 },
        children: [
          new TextRun({
            text: block.text || ' ',
            font: 'Consolas',
            size: Math.max(preset.bodySize - 2, 18),
            color: '475467',
          }),
        ],
      }),
    ]
  }

  if (block.type === 'quote') {
    return [
      new Paragraph({
        indent: { left: 360 },
        spacing: { after: 140, line: preset.lineSpacing },
        children: [
          new TextRun({
            text: block.text,
            italics: true,
            color: '667085',
            font: preset.font,
            size: preset.bodySize,
          }),
        ],
      }),
    ]
  }

  if (block.type === 'image') {
    const image = await imageForWord(block.src, 420)
    if (!image) {
      return [
        new Paragraph({
          spacing: { after: 140, line: preset.lineSpacing },
          children: [bodyRun(block.alt || '图片', preset)],
        }),
      ]
    }
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: block.alt ? 60 : 180 },
        children: [
          new ImageRun({
            type: image.type,
            data: image.data,
            transformation: {
              width: image.width,
              height: image.height,
            },
            altText: {
              name: block.alt || 'image',
              title: block.alt || 'image',
              description: block.alt || 'Markdown image',
            },
          }),
        ],
      }),
      ...(block.alt
        ? [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 180 },
              children: [
                new TextRun({
                  text: block.alt,
                  color: '667085',
                  font: preset.font,
                  size: Math.max(preset.bodySize - 3, 16),
                }),
              ],
            }),
          ]
        : []),
    ]
  }

  return [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 140, line: preset.lineSpacing },
      children: inlineRuns(block.text, preset),
    }),
  ]
}

function inlineRuns(text: string, preset: WordStylePreset) {
  const runs: TextRun[] = []
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g
  let lastIndex = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) {
      runs.push(bodyRun(text.slice(lastIndex, match.index), preset))
    }
    if (match[2]) {
      runs.push(bodyRun(match[2], preset, { bold: true }))
    } else if (match[3]) {
      runs.push(
        new TextRun({
          text: match[3],
          font: 'Consolas',
          color: '475467',
          size: Math.max(preset.bodySize - 1, 18),
        }),
      )
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    runs.push(bodyRun(text.slice(lastIndex), preset))
  }
  return runs.length > 0 ? runs : [bodyRun('', preset)]
}

function bodyRun(text: string, preset: WordStylePreset, options: { bold?: boolean } = {}) {
  return new TextRun({
    text,
    bold: options.bold,
    font: preset.font,
    size: preset.bodySize,
  })
}

function headingLevel(level: number) {
  if (level === 1) return HeadingLevel.HEADING_1
  if (level === 2) return HeadingLevel.HEADING_2
  if (level === 3) return HeadingLevel.HEADING_3
  if (level === 4) return HeadingLevel.HEADING_4
  if (level === 5) return HeadingLevel.HEADING_5
  return HeadingLevel.HEADING_6
}

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'image'; alt: string; src: string }

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const tokens = marked.lexer(markdown)
  const blocks: MarkdownBlock[] = []

  for (const token of tokens) {
    if (token.type === 'heading') {
      blocks.push({ type: 'heading', level: token.depth, text: stripMarkdown(token.text) })
    }
    if (token.type === 'paragraph') {
      const image = standaloneImageToken(token)
      if (image) {
        blocks.push(image)
      } else {
        blocks.push({ type: 'paragraph', text: stripMarkdown(token.text) })
      }
    }
    if (token.type === 'blockquote') {
      blocks.push({ type: 'quote', text: stripMarkdown(token.text) })
    }
    if (token.type === 'list') {
      blocks.push({
        type: 'list',
        ordered: token.ordered,
        items: token.items.map((item: { text: string }) => stripMarkdown(item.text)),
      })
    }
    if (token.type === 'code') {
      blocks.push({ type: 'code', text: token.text })
    }
    if (token.type === 'space') {
      continue
    }
  }

  return blocks
}

function standaloneImageToken(token: { tokens?: Array<{ type: string; href?: string; text?: string }> }) {
  const image = token.tokens?.length === 1 && token.tokens[0].type === 'image' ? token.tokens[0] : null
  if (!image?.href) return null
  return { type: 'image' as const, alt: image.text || '', src: image.href }
}

function stripMarkdown(text: string) {
  return text
    .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .trim()
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      resolve(value.includes(',') ? value.split(',')[1] : value)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
