import { parseArticle } from './markdown'

export function markdownToPlainText(markdown: string) {
  return parseArticle(markdown).body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function readBundledPdfFont() {
  const response = await fetch('fonts/NotoSansSC-VF.ttf')
  if (!response.ok) throw new Error('内置 PDF 字体加载失败')
  return arrayBufferToBase64(await response.arrayBuffer())
}

export function downloadBase64File(base64: string, filename: string, mimeType: string) {
  const bytes = base64ToArrayBuffer(base64)
  const blob = new Blob([bytes], { type: mimeType })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export function exportFileName(name: string | undefined, extension: string) {
  return `${(name || 'document').replace(/\.[^.]+$/, '')}.${extension}`
}

function base64ToArrayBuffer(base64: string) {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
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
