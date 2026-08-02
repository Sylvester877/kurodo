// Manga reader settings store. Persisted to localStorage.
// Consolidated from scattered useState + localStorage calls into a single store.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ReadMode = 'strip' | 'page'
export type FitMode = 'width' | 'height' | 'none'
export type ReadingDir = 'ltr' | 'rtl' | 'ttb'
export type ClickAction = 'next' | 'previous' | 'settings'
export type ClickTrigger = 'press' | 'release'
export type PreviewMode = 'off' | 'hover' | 'attached'
export type ImageFilter = 'auto' | 'pixelated' | 'crisp-edges'
export type BgTheme = 'dark' | 'black' | 'sepia' | 'light'
export type BgPattern = 'solid' | 'paper' | 'gradient' | 'dotted' | 'lined'
export type ColorMode = 'natural' | 'enhanced' | 'custom'
export type ImagePreset = 'original' | 'reading' | 'night' | 'sepia' | 'vivid' | 'oled' | 'eink' | 'hdr'
export type ReadingModePreset = 'webtoon' | 'long-strip' | 'single-page' | 'double-page' | 'vertical'
export type PageTransition = 'instant' | 'fade' | 'slide'
export type LoadingStrategy = 'eager' | 'lazy'
export type ProgressIndicator = 'page' | 'chapter'
export type LoadingMethod = 'native' | 'blob' | 'bg-image'

/** Today as YYYY-MM-DD (local) — used as the key for daily reading stats. */
export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface Bookmark {
  pageIndex: number
  chapterId: string
  chapterNum: string
  thumbnailUrl: string
  label?: string
  at: number
}

export interface ReaderSettings {
  // Reading
  readMode: ReadMode
  spreadMode: boolean
  readingDir: ReadingDir
  firstPageSingle: boolean
  // Display
  fitMode: FitMode
  zoomScale: number
  // Strip layout
  stripMaxWidth: number   // px, 0 = no limit (100% wide)
  stripGap: number        // px, gap between pages in strip mode (0 = seamless)
  // Image
  imageBrightness: number // 50-150 (%) — overlay dim for night reading
  imageFilter: ImageFilter
  // Image presets (atsu.moe-style)
  imagePreset: ImagePreset // one-click composed preset
  // Color (vibrance/contrast for colored manga)
  colorMode: ColorMode
  colorSaturation: number // 0-200 (%) — saturation boost for colored manga
  colorContrast: number   // 50-200 (%) — contrast punch
  coloredOnly: boolean    // filter chapters to only show colored releases
  // Background
  bgTheme: BgTheme
  bgPattern: BgPattern
  paperIntensity: number  // 0-100 — opacity of background pattern overlay
  // Controls
  clickAction: ClickAction
  clickTrigger: ClickTrigger
  // Cursor
  cursorVisible: boolean
  cursorHideDist: number
  // Auto scroll
  autoScrollEnabled: boolean
  autoScrollSpeed: number
  // Auto-advance chapter
  autoAdvance: boolean      // auto-navigate to next chapter when done
  autoAdvanceDelay: number  // seconds countdown before auto-advance
  // Page preview strip
  previewMode: PreviewMode
  // Loading
  loadingStrategy: LoadingStrategy  // eager = load all pages upfront, lazy = on scroll/intersect
  preloadPages: number              // how many pages to preload ahead of current (0 = none, 3 = +3 pages)
  preloadAdaptive: boolean         // when true, scale preload depth by scroll velocity
  // Spread
  spreadGap: number                 // px gap between paired pages in spread mode (0-40)
  // Zoom
  zoomLock: boolean                 // keep zoom level across page navigations
  // Animation
  smoothScroll: boolean
  pageTransition: PageTransition
  // Zen mode
  zenMode: boolean
  // Tap zones
  leftTapAction: ClickAction
  rightTapAction: ClickAction
  centerTapAction: ClickAction
  // Volume key navigation
  volumeKeyNav: boolean
  // Notifications
  showNotifications: boolean
  progressIndicator: ProgressIndicator
  loadingMethod: LoadingMethod
  // Per-manga overrides — keyed by MAL ID so a saga of Shingeki no Kyojin
  // can keep your preferred settings even if you switch between seasons.
  directionOverride: Record<number, ReadingDir>
  readModeOverride: Record<number, ReadMode>
  // Reading stats (weekly summary stats). Aggregate; no PII.
  readingTimeAcc: Record<string, number> // "YYYY-MM-DD" -> minutes
  pagesReadTotal: number
  // Visual bookmarks — keyed by manga ID (mangaDex or atsu)
  bookmarks: Record<string, Bookmark[]>
}

/** Apply a one-click preset to the given settings object. Returns the new
 *  values for imageBrightness/colorSaturation/colorContrast/colorMode. */
export function presetToSettings(preset: ImagePreset): {
  brightness: number
  saturation: number
  contrast: number
  mode: ColorMode
  hueRotate?: number
} {
  switch (preset) {
    case 'original':  return { brightness: 100, saturation: 100, contrast: 100, mode: 'natural' }
    case 'reading':   return { brightness: 105, saturation: 110, contrast: 115, mode: 'custom' }
    case 'night':     return { brightness: 75,  saturation: 85,  contrast: 110, mode: 'custom' }
    case 'sepia':     return { brightness: 98,  saturation: 140, contrast: 105, mode: 'custom', hueRotate: -20 }
    case 'vivid':     return { brightness: 103, saturation: 160, contrast: 115, mode: 'custom' }
    case 'oled':      return { brightness: 90,  saturation: 120, contrast: 180, mode: 'custom' }
    case 'eink':      return { brightness: 95,  saturation: 0,   contrast: 130, mode: 'custom' }
    case 'hdr':       return { brightness: 110, saturation: 135, contrast: 140, mode: 'custom' }
  }
}

/** Apply a reading-mode preset — sets multiple fields at once for common reading styles. */
export function modePresetToSettings(preset: ReadingModePreset): Partial<ReaderSettings> {
  switch (preset) {
    case 'webtoon':
      return { readMode: 'strip', stripGap: 0, readingDir: 'ltr', spreadMode: false }
    case 'long-strip':
      return { readMode: 'strip', stripGap: 16, readingDir: 'ltr', spreadMode: false }
    case 'single-page':
      return { readMode: 'page', spreadMode: false, readingDir: 'ltr' }
    case 'double-page':
      return { readMode: 'page', spreadMode: true, readingDir: 'ltr', firstPageSingle: true }
    case 'vertical':
      return { readMode: 'page', spreadMode: false, readingDir: 'ttb' }
  }
}

export interface ReaderStore extends ReaderSettings {
  set: <K extends keyof ReaderStore>(key: K, value: ReaderStore[K]) => void
  /** Atomically write multiple keys — used for image preset application. */
  setMany: (patch: Partial<ReaderSettings>) => void
  reset: () => void
  /** Apply an image preset (also resets colorMode + brightness/sat/contrast). */
  applyImagePreset: (preset: ImagePreset) => void
  /** Apply a reading-mode preset (webtoon, long-strip, etc.) */
  applyModePreset: (preset: ReadingModePreset) => void
  /** Record minutes spent reading (capped to per-day accumulator). */
  addReadingMinutes: (minutes: number) => void
  /** Increment lifetime-page counter; called on each page change. */
  recordPageRead: () => void
  /** Persist per-manga direction override. */
  setDirectionOverride: (malId: number, dir: ReadingDir) => void
  setReadModeOverride: (malId: number, mode: ReadMode) => void
  clearMangaOverrides: (malId: number) => void
  // Bookmarks
  addBookmark: (mangaId: string, bm: Bookmark) => void
  removeBookmark: (mangaId: string, chapterId: string, pageIndex: number) => void
  getBookmarks: (mangaId: string) => Bookmark[]
}

const DEFAULTS: ReaderSettings = {
  readMode: 'strip',
  spreadMode: false,
  readingDir: 'ltr',
  firstPageSingle: false,
  fitMode: 'height',
  zoomScale: 1.0,
  stripMaxWidth: 800,
  stripGap: 0,
  imageBrightness: 100,
  imageFilter: 'auto',
  imagePreset: 'original',
  colorMode: 'natural',
  colorSaturation: 100,
  colorContrast: 100,
  coloredOnly: false,
  bgTheme: 'black',
  bgPattern: 'solid',
  paperIntensity: 30,
  clickAction: 'next',
  clickTrigger: 'release',
  cursorVisible: true,
  cursorHideDist: 0,
  autoScrollEnabled: false,
  autoScrollSpeed: 2,
  autoAdvance: true,
  autoAdvanceDelay: 5,
  previewMode: 'hover',
  loadingStrategy: 'lazy',
  preloadPages: 3,
  preloadAdaptive: true,
  spreadGap: 4,
  zoomLock: false,
  smoothScroll: true,
  pageTransition: 'instant',
  zenMode: false,
  leftTapAction: 'previous',
  rightTapAction: 'next',
  centerTapAction: 'settings',
  volumeKeyNav: false,
  showNotifications: true,
  progressIndicator: 'page',
  loadingMethod: 'native',
  directionOverride: {},
  readModeOverride: {},
  readingTimeAcc: {},
  pagesReadTotal: 0,
  bookmarks: {},
}

export const useReaderStore = create<ReaderStore>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Partial<ReaderStore>),
      setMany: (patch) => set(patch as Partial<ReaderStore>),
      reset: () => set({ ...DEFAULTS }),
      applyImagePreset: (preset) => {
        const { brightness, saturation, contrast, mode } = presetToSettings(preset)
        const patch: Partial<ReaderStore> = {
          imagePreset: preset,
          imageBrightness: brightness,
          colorSaturation: saturation,
          colorContrast: contrast,
          colorMode: mode,
        }
        set(patch as Partial<ReaderStore>)
      },
      applyModePreset: (preset) => {
        const patch = modePresetToSettings(preset)
        set(patch as Partial<ReaderStore>)
      },
      addReadingMinutes: (minutes) => {
        if (minutes <= 0) return
        const key = todayKey()
        const cur = get().readingTimeAcc[key] || 0
        set({ readingTimeAcc: { ...get().readingTimeAcc, [key]: cur + minutes } })
      },
      recordPageRead: () => set({ pagesReadTotal: get().pagesReadTotal + 1 }),
      setDirectionOverride: (malId, dir) => {
        const cur = get().directionOverride
        const next = { ...cur, [malId]: dir }
        if (cur[malId] === dir) return
        set({ directionOverride: next })
      },
      setReadModeOverride: (malId, mode) => {
        const cur = get().readModeOverride
        if (cur[malId] === mode) return
        set({ readModeOverride: { ...cur, [malId]: mode } })
      },
      clearMangaOverrides: (malId) => {
        const dir = { ...get().directionOverride }
        const mode = { ...get().readModeOverride }
        delete dir[malId]
        delete mode[malId]
        set({ directionOverride: dir, readModeOverride: mode })
      },
      addBookmark: (mangaId, bm) => {
        const cur = get().bookmarks
        const list = [...(cur[mangaId] || [])]
        // Remove existing bookmark at same chapter+page (upsert)
        const idx = list.findIndex(b => b.chapterId === bm.chapterId && b.pageIndex === bm.pageIndex)
        if (idx >= 0) list.splice(idx, 1)
        list.push(bm)
        // Sort by timestamp descending (most recent first)
        list.sort((a, b) => b.at - a.at)
        // Cap at 200 per manga
        if (list.length > 200) list.length = 200
        set({ bookmarks: { ...cur, [mangaId]: list } })
      },
      removeBookmark: (mangaId, chapterId, pageIndex) => {
        const cur = get().bookmarks
        const list = (cur[mangaId] || []).filter(
          b => !(b.chapterId === chapterId && b.pageIndex === pageIndex)
        )
        set({ bookmarks: { ...cur, [mangaId]: list } })
      },
      getBookmarks: (mangaId) => get().bookmarks[mangaId] || [],
    }),
    {
      name: 'kurodo-reader',
      version: 10,
      migrate: (persisted: any, version: number) => {
        if (version < 4 && persisted.stripMaxWidth === 0) persisted.stripMaxWidth = 800
        if (version < 5 && persisted.bgTheme === 'dark') persisted.bgTheme = 'black'
        if (version < 7) {
          if (persisted.autoAdvance === undefined) persisted.autoAdvance = true
          if (persisted.autoAdvanceDelay === undefined) persisted.autoAdvanceDelay = 5
        }
        if (version < 8) {
          if (persisted.loadingStrategy === undefined) persisted.loadingStrategy = 'lazy'
          if (persisted.preloadPages === undefined) persisted.preloadPages = 3
          if (persisted.spreadGap === undefined) persisted.spreadGap = 4
          if (persisted.zoomLock === undefined) persisted.zoomLock = false
        }
        if (version < 9) {
          if (persisted.showNotifications === undefined) persisted.showNotifications = false
          if (persisted.progressIndicator === undefined) persisted.progressIndicator = 'page'
          if (persisted.loadingMethod === undefined) persisted.loadingMethod = 'native'
        }
        if (version < 10) {
          if (persisted.imagePreset === undefined) persisted.imagePreset = 'original'
          if (persisted.bgPattern === undefined) persisted.bgPattern = 'solid'
          if (persisted.paperIntensity === undefined) persisted.paperIntensity = 30
          if (persisted.preloadAdaptive === undefined) persisted.preloadAdaptive = true
          if (persisted.directionOverride === undefined) persisted.directionOverride = {}
          if (persisted.readModeOverride === undefined) persisted.readModeOverride = {}
          if (persisted.readingTimeAcc === undefined) persisted.readingTimeAcc = {}
          if (persisted.pagesReadTotal === undefined) persisted.pagesReadTotal = 0
        }
        return persisted as ReaderStore
      },
    },
  ),
)

// Helpers exported for use in render components. Pure functions so they can
// be called inline without re-render churn.
export function getBgColor(theme: BgTheme): string {
  switch (theme) {
    case 'black':  return '#000000'
    case 'dark':   return '#0a0a0a'
    case 'sepia':  return '#3a2e22'
    case 'light':  return '#f5f0e6'
  }
}

export function getTextColorForBg(theme: BgTheme): string {
  return theme === 'light' ? 'rgba(20,20,20,0.85)' : 'rgba(255,255,255,0.85)'
}

/** Compute the effective CSS `filter` shorthand given the per-image settings.
 *  Order matters: hue-rotate first so brightness/saturation apply cleanly. */
export function composeImageFilter(opts: {
  brightness: number    // 50-150 (%)
  saturation: number    // 0-200 (%)
  contrast: number      // 50-200 (%)
  imageFilter: ImageFilter
  hueRotate?: number    // -180..180 (deg), for sepia preset
}): React.CSSProperties {
  const filters: string[] = []
  if (opts.hueRotate && opts.hueRotate !== 0) filters.push(`hue-rotate(${opts.hueRotate}deg)`)
  filters.push(`brightness(${opts.brightness}%)`)
  if (opts.saturation !== 100) filters.push(`saturate(${opts.saturation}%)`)
  if (opts.contrast !== 100) filters.push(`contrast(${opts.contrast}%)`)

  const style: React.CSSProperties = {}
  if (filters.length > 0) style.filter = filters.join(' ')
  if (opts.imageFilter === 'pixelated') style.imageRendering = 'pixelated'
  else if (opts.imageFilter === 'crisp-edges') style.imageRendering = 'crisp-edges'
  return style
}
