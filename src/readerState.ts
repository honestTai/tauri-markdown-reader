import type { ReadMode, ReaderSettings, ReaderState } from './types'

export const defaultSettings: ReaderSettings = {
  default_workspace: '',
  default_read_mode: 'desktop',
  default_export_style: 'codex',
  restore_last_document: true,
  remember_scroll_position: true,
  focus_keep_outline: true,
  language: 'zh',
}

export const defaultReaderState: ReaderState = {
  recent_workspaces: [],
  recent_files: [],
  favorites: [],
  pinned: [],
  locked: [],
  reading_positions: {},
  last_workspace: '',
  last_file: '',
  last_read_mode: 'desktop',
  focus_mode: false,
  settings: defaultSettings,
}

export function normalizeState(value: ReaderState): ReaderState {
  const settings = { ...defaultSettings, ...(value?.settings || {}) }
  settings.default_read_mode = normalizeReadMode(settings.default_read_mode)
  return {
    ...defaultReaderState,
    ...value,
    settings,
    recent_workspaces: trimList(value?.recent_workspaces || [], 20),
    recent_files: trimList(value?.recent_files || [], 50),
    favorites: trimList(value?.favorites || [], 500),
    pinned: trimList(value?.pinned || [], 500),
    locked: trimList(value?.locked || [], 500),
    reading_positions: value?.reading_positions || {},
    last_read_mode: normalizeReadMode(value?.last_read_mode || settings.default_read_mode),
  }
}

export function moveToFront(values: string[], path: string, max: number) {
  return [path, ...values.filter((value) => value !== path)].slice(0, max)
}

export function togglePath(values: string[], path: string) {
  return values.includes(path) ? values.filter((value) => value !== path) : [path, ...values]
}

function normalizeReadMode(value: unknown): ReadMode {
  if (value === 'source') return 'edit'
  return value === 'edit' || value === 'desktop' ? value : 'desktop'
}

function trimList(values: string[], max: number) {
  return [...new Set(values.filter(Boolean))].slice(0, max)
}
