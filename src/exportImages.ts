type WordImageType = 'jpg' | 'png' | 'gif' | 'bmp'
type PdfImageFormat = 'JPEG' | 'PNG' | 'WEBP'

interface ExportImage {
  dataUrl: string
  width: number
  height: number
}

export interface WordExportImage extends ExportImage {
  data: Uint8Array
  type: WordImageType
}

export interface PdfExportImage extends ExportImage {
  format: PdfImageFormat
}

export async function imageForWord(src: string, maxWidth: number, maxHeight = 360): Promise<WordExportImage | null> {
  const mime = imageMime(src)
  if (!mime) return null
  let dataUrl = src
  let type = wordImageType(mime)
  if (!type) {
    dataUrl = await rasterizeToPng(src)
    type = 'png'
  }
  const size = await fitImage(dataUrl, maxWidth, maxHeight)
  return {
    data: dataUrlToBytes(dataUrl),
    dataUrl,
    type,
    ...size,
  }
}

export async function imageForPdf(src: string, maxWidth: number, maxHeight = 520): Promise<PdfExportImage | null> {
  const mime = imageMime(src)
  if (!mime) return null
  let dataUrl = src
  let format = pdfImageFormat(mime)
  if (!format) {
    dataUrl = await rasterizeToPng(src)
    format = 'PNG'
  }
  const size = await fitImage(dataUrl, maxWidth, maxHeight)
  return { dataUrl, format, ...size }
}

function imageMime(src: string) {
  return src.match(/^data:(image\/[a-z0-9.+-]+);base64,/i)?.[1].toLowerCase() || ''
}

function wordImageType(mime: string): WordImageType | null {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/bmp') return 'bmp'
  return null
}

function pdfImageFormat(mime: string): PdfImageFormat | null {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'JPEG'
  if (mime === 'image/png') return 'PNG'
  if (mime === 'image/webp') return 'WEBP'
  return null
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] || ''
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function fitImage(src: string, maxWidth: number, maxHeight: number) {
  const natural = await loadImageSize(src)
  const ratio = Math.min(1, maxWidth / natural.width, maxHeight / natural.height)
  return {
    width: Math.max(1, Math.round(natural.width * ratio)),
    height: Math.max(1, Math.round(natural.height * ratio)),
  }
}

function loadImageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth || 640, height: image.naturalHeight || 360 })
    image.onerror = () => reject(new Error('图片尺寸读取失败'))
    image.src = src
  })
}

async function rasterizeToPng(src: string) {
  const image = await loadImageElement(src)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth || 640
  canvas.height = image.naturalHeight || 360
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('图片转换失败')
  }
  context.drawImage(image, 0, 0)
  return canvas.toDataURL('image/png')
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}
