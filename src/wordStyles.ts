import type { WordStyleId } from './types'

export interface WordStylePreset {
  id: WordStyleId
  name: string
  font: string
  accent: string
  bodySize: number
  lineSpacing: number
}

export const wordStylePresets: WordStylePreset[] = [
  { id: 'codex', name: 'Codex 清爽', font: 'Aptos', accent: '#2f6f4e', bodySize: 22, lineSpacing: 320 },
  { id: 'clean', name: '极简白', font: 'Calibri', accent: '#1f2933', bodySize: 22, lineSpacing: 300 },
  { id: 'serif', name: '英文 Serif', font: 'Georgia', accent: '#355c7d', bodySize: 23, lineSpacing: 330 },
  { id: 'song', name: '宋体长文', font: 'SimSun', accent: '#374151', bodySize: 22, lineSpacing: 340 },
  { id: 'hei', name: '黑体报告', font: 'SimHei', accent: '#2563eb', bodySize: 22, lineSpacing: 310 },
  { id: 'yahei', name: '微软雅黑', font: 'Microsoft YaHei', accent: '#1f7a4b', bodySize: 22, lineSpacing: 320 },
  { id: 'kai', name: '楷体手稿', font: 'KaiTi', accent: '#9a650f', bodySize: 23, lineSpacing: 350 },
  { id: 'mono', name: '技术文档', font: 'Consolas', accent: '#4b5563', bodySize: 21, lineSpacing: 300 },
  { id: 'report', name: '产品报告', font: 'DengXian', accent: '#0f766e', bodySize: 22, lineSpacing: 320 },
  { id: 'book', name: '书稿阅读', font: 'FangSong', accent: '#6b4f3a', bodySize: 23, lineSpacing: 360 },
  { id: 'compact', name: '紧凑备忘', font: 'Arial', accent: '#475569', bodySize: 20, lineSpacing: 260 },
  { id: 'presentation', name: '演示讲义', font: 'Microsoft YaHei', accent: '#7c3aed', bodySize: 24, lineSpacing: 340 },
]

export function getWordStylePreset(id: WordStyleId) {
  return wordStylePresets.find((preset) => preset.id === id) || wordStylePresets[0]
}
