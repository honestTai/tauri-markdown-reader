import { jsPDF } from 'jspdf'
import { marked } from 'marked'
import { imageForPdf } from './exportImages'
import { parseArticle } from './markdown'
import { getWordStylePreset } from './wordStyles'
import type { WordStyleId } from './types'

export async function markdownToPdfBase64(raw: string, fontBase64?: string, styleId: WordStyleId = 'codex') {
  const preset = getWordStylePreset(styleId)
  const parsed = parseArticle(raw)
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const fontName = fontBase64 ? 'ReaderCJK' : 'helvetica'

  if (fontBase64) {
    pdf.addFileToVFS('reader-cjk.ttf', fontBase64)
    pdf.addFont('reader-cjk.ttf', fontName, 'normal')
  }

  pdf.setFont(fontName, 'normal')
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 54
  const maxWidth = pageWidth - margin * 2
  let y = margin

  function ensureSpace(height: number) {
    if (y + height <= pageHeight - margin) return
    pdf.addPage()
    pdf.setFont(fontName, 'normal')
    y = margin
  }

  function writeLines(text: string, size: number, lineHeight: number, color = '#26323d') {
    pdf.setFontSize(size)
    pdf.setTextColor(color)
    const lines = pdf.splitTextToSize(text || ' ', maxWidth) as string[]
    ensureSpace(lines.length * lineHeight)
    pdf.text(lines, margin, y)
    y += lines.length * lineHeight
  }

  if (parsed.title) {
    writeLines(parsed.title, Math.max(20, preset.bodySize), 30, preset.accent)
    y += 8
  }

  if (parsed.digest) {
    writeLines(parsed.digest, Math.max(10, preset.bodySize / 2), 18, '#667085')
    y += 14
  }

  for (const block of parsePdfBlocks(parsed.body)) {
    if (block.type === 'heading') {
      y += block.level === 2 ? 14 : 10
      writeLines(block.text, Math.max(preset.bodySize / 2 + 8 - block.level, 12), 24, preset.accent)
      y += 4
      continue
    }
    if (block.type === 'list') {
      for (const [index, item] of block.items.entries()) {
        writeLines(`${block.ordered ? `${index + 1}.` : '-'} ${item}`, 11, 18)
      }
      y += 6
      continue
    }
    if (block.type === 'image') {
      const image = await imageForPdf(block.src, maxWidth)
      if (!image) {
        writeLines(block.alt || '图片', Math.max(10, preset.bodySize / 2), 18, '#667085')
        y += 6
        continue
      }
      ensureSpace(image.height + (block.alt ? 34 : 18))
      pdf.addImage(image.dataUrl, image.format, margin, y, image.width, image.height)
      y += image.height + 10
      if (block.alt) {
        writeLines(block.alt, 9, 14, '#667085')
      }
      y += 8
      continue
    }
    if (block.type === 'code') {
      ensureSpace(30)
      pdf.setFillColor('#f3f4f6')
      const lines = pdf.splitTextToSize(block.text || ' ', maxWidth - 18) as string[]
      const height = lines.length * 16 + 16
      ensureSpace(height)
      pdf.rect(margin, y - 10, maxWidth, height, 'F')
      pdf.setFontSize(9)
      pdf.setTextColor('#475467')
      pdf.text(lines, margin + 9, y)
      y += height + 8
      continue
    }
    if (block.type === 'quote') {
      writeLines(block.text, 11, 18, '#667085')
      y += 8
      continue
    }
    writeLines(block.text, Math.max(10, preset.bodySize / 2), Math.max(17, preset.lineSpacing / 18))
    y += 6
  }

  return pdf.output('datauristring').split(',')[1]
}

type PdfBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'image'; alt: string; src: string }

function parsePdfBlocks(markdown: string): PdfBlock[] {
  const tokens = marked.lexer(markdown)
  const blocks: PdfBlock[] = []

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
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}
