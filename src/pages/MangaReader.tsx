import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { useShallow } from 'zustand/shallow'
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, ChevronDown, Loader2, AlertTriangle, Settings2, Play, Pause, SkipForward, Maximize, Minimize, Sun, Columns, AlignJustify, Bookmark } from 'lucide-react'
import { cn } from '../lib/utils'
import { getChapterPages, getChapterFeed, getMangaInfo, type MangaDexPage } from '../api/mangadex'
import { getChapterPages as getChapterPagesAtsu, getChapterFeed as getChapterFeedAtsu, getMangaInfo as getMangaInfoAtsu } from '../api/atsu'
import { useTitle } from '../hooks/useTitle'
import { useMangaListStore } from '../store/useMangaListStore'
import { syncMangaProgress } from '../lib/mangaSync'
import { useReaderStore, getBgColor } from '../store/useReaderStore'
import { ReaderImage } from '../components/ReaderImage'
const ReaderSettingsModal = lazy(() => import('../components/ReaderSettingsModal'))
const ChapterSearchModal = lazy(() => import('../components/ChapterSearchModal'))
const ReadingStatsModal = lazy(() => import('../components/ReadingStatsModal'))
import BackgroundPattern from '../components/BackgroundPattern'
import ProgressScrubber from '../components/ProgressScrubber'
import ColoredManhwaDetector from '../components/ColoredManhwaDetector'
import KeyboardHelpModal from '../components/KeyboardHelpModal'
import SyncConfirmDialog, { useSyncConfirm } from '../components/SyncConfirmDialog'

import BookmarksPanel from '../components/BookmarksPanel'

/** Stable empty arrays — module-level const. Using `?? []` inside a
 *  component creates a NEW array reference on every render when data
 *  is loading, which poisons every useEffect dependency array and
 *  triggers infinite re-render cascades (React error #185). */
const EMPTY_PAGES: MangaDexPage[] = []
const EMPTY_CHAPTERS: Array<{ id: string; chapter: string; title: string | null; pages: number; scanGroup: string | null }> = []

export default function MangaReader() {
  const { chapterId } = useParams<{ chapterId: string }>()
  const [searchParams] = useSearchParams()
  const mangaId = searchParams.get('manga') || ''
  const source = (searchParams.get('source') || 'atsu') as 'mangadex' | 'atsu'
  const anilistIdParam = searchParams.get('anilist') || ''
  const malIdParam = searchParams.get('malId') || ''

  const isAtsu = source === 'atsu'
  const navigate = useNavigate()

  // ── Reader store ──
  // ═══ PERFORMANCE: useShallow to batch-check all reader-store values.
  // Without shallow comparison, any reader.set() call triggers a full
  // MangaReader re-render — even for unrelated keys like bookmarks.
  // useShallow runs a single === check across all selected fields and
  // skips the re-render when nothing changed. ═══
  const {
    readMode, fitMode, zoomScale, spreadMode, readingDir,
    cursorVisible,
    autoScrollEnabled, autoScrollSpeed, previewMode,
    bgTheme, stripMaxWidth, stripGap,
    imageBrightness, imageFilter,
    firstPageSingle, smoothScroll,
    colorMode, colorSaturation, colorContrast, coloredOnly,
    zenMode,
    leftTapAction, rightTapAction, centerTapAction,
    volumeKeyNav,
    autoAdvance, autoAdvanceDelay,
    loadingStrategy, preloadPages, zoomLock,
    showNotifications, progressIndicator, cursorHideDist, loadingMethod,
    bgPattern, paperIntensity, pageTransition,
  } = useReaderStore(useShallow((s) => ({
    readMode: s.readMode, fitMode: s.fitMode, zoomScale: s.zoomScale,
    spreadMode: s.spreadMode, readingDir: s.readingDir,
    cursorVisible: s.cursorVisible,
    autoScrollEnabled: s.autoScrollEnabled, autoScrollSpeed: s.autoScrollSpeed,
    previewMode: s.previewMode,
    bgTheme: s.bgTheme, stripMaxWidth: s.stripMaxWidth, stripGap: s.stripGap,
    imageBrightness: s.imageBrightness, imageFilter: s.imageFilter,
    firstPageSingle: s.firstPageSingle, smoothScroll: s.smoothScroll,
    colorMode: s.colorMode, colorSaturation: s.colorSaturation,
    colorContrast: s.colorContrast, coloredOnly: s.coloredOnly,
    zenMode: s.zenMode,
    leftTapAction: s.leftTapAction, rightTapAction: s.rightTapAction,
    centerTapAction: s.centerTapAction,
    volumeKeyNav: s.volumeKeyNav,
    autoAdvance: s.autoAdvance, autoAdvanceDelay: s.autoAdvanceDelay,
    loadingStrategy: s.loadingStrategy, preloadPages: s.preloadPages,
    zoomLock: s.zoomLock,
    showNotifications: s.showNotifications,
    progressIndicator: s.progressIndicator,
    cursorHideDist: s.cursorHideDist, loadingMethod: s.loadingMethod,
    bgPattern: s.bgPattern, paperIntensity: s.paperIntensity,
    pageTransition: s.pageTransition,
  })))

  const readerSet = useReaderStore((s) => s.set)
  const readerAddBookmark = useReaderStore((s) => s.addBookmark)
  // Don't subscribe to the whole bookmarks object — it changes identity on
  // every bookmark add/remove and would cascade-re-render MangaReader.
  // Keyboard handler only needs the latest value, so read it imperatively.
  const readerBookmarksRef = useRef(useReaderStore.getState().bookmarks)
  useEffect(() => {
    readerBookmarksRef.current = useReaderStore.getState().bookmarks
  }, [])

  // ═══ PERFORMANCE: atomic selectors for manga-list store.
  // Functions are stable references (defined once in create()), but
  // subscribing via the full destructure `useMangaListStore()` was
  // causing a re-render on every setChapterProgress / markChapterRead
  // call — which fires on every page turn. Atomic selectors only
  // trigger the component when their specific slice changes, so the
  // progress-save interval no longer cascade-re-renders MangaReader. ═══
  const isChapterRead = useMangaListStore((s) => s.isChapterRead)
  const markChapterRead = useMangaListStore((s) => s.markChapterRead)
  const setChapterProgress = useMangaListStore((s) => s.setChapterProgress)
  const getChapterProgress = useMangaListStore((s) => s.getChapterProgress)
  const upsertContinueReading = useMangaListStore((s) => s.upsertContinueReading)
  const trackingMalId = malIdParam ? Number(malIdParam) : null

  // ── Chapter read status for the chapter search modal ──
  const checkChapterRead = useCallback((ch: { chapter: string }) => {
    if (!trackingMalId) return false
    const chNum = parseFloat(ch.chapter)
    if (isNaN(chNum)) return false
    return isChapterRead(trackingMalId, chNum)
  }, [trackingMalId, isChapterRead])

  // ── Chapter progress for the chapter search modal ──
  const checkChapterProgress = useCallback((ch: { chapter: string }) => {
    if (!trackingMalId) return null
    const chNum = parseFloat(ch.chapter)
    if (isNaN(chNum)) return null
    return getChapterProgress(trackingMalId, chNum)
  }, [trackingMalId, getChapterProgress])

  // ── UI state ──
  const [currentPage, setCurrentPage] = useState(0)
  const [showUI, setShowUI] = useState(true)
  // ── Sync confirmation ──
  const { show: syncDialogOpen, checkAndPrompt: checkSyncConfirmation, handleConfirm: handleSyncConfirm, handleDecline: handleSyncDecline } = useSyncConfirm(trackingMalId, 'manga')
  const [stripProgress, setStripProgress] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [showKbdHelp, setShowKbdHelp] = useState(false)
  const [showChapterModal, setShowChapterModal] = useState(false)
  const [showStatsModal, setShowStatsModal] = useState(false)
  const [showQuickActions, setShowQuickActions] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [jumpToPageInput, setJumpToPageInput] = useState('')

  // ── Swipe gesture refs ──
  const swipeStartX = useRef(0)
  const swipeStartY = useRef(0)
  const quickActionsContainerRef = useRef<HTMLDivElement>(null)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [zoomPosition, setZoomPosition] = useState({ x: 50, y: 50 })
  const lastTapRef = useRef(0)
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Auto-advance state ──
  const [showAdvanceToast, setShowAdvanceToast] = useState(false)
  const [advanceCountdown, setAdvanceCountdown] = useState(0)
  const [minReadTimeElapsed, setMinReadTimeElapsed] = useState(false)
  const advanceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const advanceCancelledRef = useRef(false)

  const hideUITimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chapterMarkedRef = useRef(false)
  const stripObserverRef = useRef<IntersectionObserver | null>(null)
  const stripPageRefs = useRef<Map<Element, number>>(new Map())
  const lastVisibleRef = useRef(0)
  const mousePos = useRef({ x: 0, y: 0 })
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoScrollRaf = useRef<number | null>(null)
  const readerRef = useRef<HTMLDivElement>(null)
  const minReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isStrip = readMode === 'strip'
  const [isFullscreen, setIsFullscreen] = useState(false)

  // ── Fullscreen toggle ──
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen()
    }
  }, [])

  // Listen for fullscreen changes (user may exit via Esc key)
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // ── Data fetching ──
  const queryClient = useQueryClient()
  const mangaQuery = useQuery({
    queryKey: [source, 'info', mangaId],
    queryFn: () => isAtsu ? getMangaInfoAtsu(mangaId).then((m: any) => ({ title: m.title, coverUrl: m.coverUrl })) : getMangaInfo(mangaId),
    enabled: !!mangaId, staleTime: 10 * 60 * 1000,
  })
  const pagesQuery = useQuery({
    queryKey: [source, 'pages', mangaId, chapterId],
    queryFn: () => isAtsu
      ? getChapterPagesAtsu(mangaId, chapterId!).then((d: any) => ({ pages: d.pages.map((p: any) => ({ url: p.url, fileName: '' })) }))
      : getChapterPages(chapterId!),
    enabled: !!chapterId, staleTime: 30 * 60 * 1000,
  })
  const chaptersQuery = useQuery({
    queryKey: [source, 'chapters', mangaId],
    queryFn: () => isAtsu
      ? getChapterFeedAtsu(mangaId).then((d: any) => ({ chapters: d.chapters.map((c: any) => ({ id: c.id, chapter: c.chapter, title: c.title, pages: c.pageCount, scanGroup: c.scanGroup })) }))
      : getChapterFeed(mangaId, 'en', 500),
    enabled: !!mangaId, staleTime: 5 * 60 * 1000,
  })

  /** Stable empty arrays — module-level const to prevent `?? []` from
   *  creating a new array reference on every render, which would
   *  poison every useEffect dependency array that includes `pages` or
   *  `chapters` and cause infinite re-render cascades (#185). */
  const pages: MangaDexPage[] = pagesQuery.data?.pages ?? EMPTY_PAGES
  /** Atsu.moe / MangaDex API response shapes are not fully typed — these
   *  casts extract known fields from the loosely-typed query results. */
  const chapters: Array<{ id: string; chapter: string; title: string | null; pages: number; scanGroup: string | null }> = (chaptersQuery.data as any)?.chapters ?? EMPTY_CHAPTERS
  const mangaTitle = (mangaQuery.data as any)?.title || 'Manga'
  const mangaCover = (mangaQuery.data as any)?.coverUrl || ''
  const hasPages = pages.length > 0

  // ── Colored-only chapter filter helper ──
  const isColoredChapter = (ch: { title?: string | null; scanGroup?: string | null }) => {
    const text = [ch.title, ch.scanGroup].filter(Boolean).join(' ').toLowerCase()
    return /colou?red|full.?color|official.?color|digital/i.test(text)
  }

  // Filter chapters when coloredOnly is active
  const displayChapters = useMemo(() => {
    if (!coloredOnly) return chapters
    return chapters.filter((ch: any) => isColoredChapter(ch))
  }, [chapters, coloredOnly])

  // ── Last read chapter ID for the chapter search modal "Jump to latest" button ──
  const lastReadChapterId = useMemo(() => {
    if (!trackingMalId || displayChapters.length === 0) return null
    const latestChNum = useMangaListStore.getState().getLatestChapter(trackingMalId)
    if (latestChNum === null) return null
    const match = displayChapters.find((c: any) => parseFloat(c.chapter) === latestChNum)
    return match?.id ?? null
  }, [trackingMalId, displayChapters])

  useTitle(`${mangaTitle} — Chapter`)

  const currentChIndex = useMemo(() => displayChapters.findIndex((c: any) => c.id === chapterId), [displayChapters, chapterId])
  const currentChapter = useMemo(() => displayChapters[currentChIndex], [displayChapters, currentChIndex])

  // Check if current chapter is colored (for badge/warning display)
  const coloredCurrentChapter = useMemo(() => {
    if (!currentChapter) return false
    return isColoredChapter(currentChapter)
  }, [currentChapter])

  // Next chapter in the filtered list (for auto-advance)
  const nextChapterInFilter = useMemo(() => {
    if (currentChIndex < 0 || currentChIndex >= displayChapters.length - 1) return null
    return displayChapters[currentChIndex + 1]
  }, [displayChapters, currentChIndex])

  // ── URL hash position persistence (atsu.moe-style `#rs=p:N`) ──
  const hashReadOnMount = useRef(false)
  useEffect(() => {
    if (hashReadOnMount.current || !hasPages) return
    const hash = window.location.hash
    const match = hash.match(/#rs=p:(\d+)/)
    if (match) {
      const page = Number(match[1])
      if (!isNaN(page) && page >= 0 && page < pages.length) {
        setCurrentPage(page)
        lastVisibleRef.current = page
      }
    }
    hashReadOnMount.current = true
  }, [hasPages, pages.length])

  // Write hash on page change (debounced 500ms)
  const hashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!hasPages) return
    if (hashTimerRef.current) clearTimeout(hashTimerRef.current)
    hashTimerRef.current = setTimeout(() => {
      const page = isStrip ? lastVisibleRef.current : currentPage
      const hash = `#rs=p:${page}`
      if (window.location.hash !== hash) {
        window.history.replaceState(null, '', hash)
      }
    }, 500)
    return () => { if (hashTimerRef.current) clearTimeout(hashTimerRef.current) }
  }, [currentPage, stripProgress, isStrip, hasPages])

  // ── Strip mode IntersectionObserver ──
  useEffect(() => {
    if (readMode !== 'strip' || !hasPages) return
    const observer = new IntersectionObserver(
      (entries) => {
        let highestVisible = lastVisibleRef.current
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = stripPageRefs.current.get(entry.target)
            if (idx != null && idx > highestVisible) highestVisible = idx
          }
        }
        lastVisibleRef.current = highestVisible
        setCurrentPage(highestVisible)
        const pct = pages.length > 1 ? ((highestVisible + 1) / pages.length) * 100 : 0
        setStripProgress(Math.min(Math.round(pct), 100))
      },
      { threshold: 0.25 },
    )
    stripObserverRef.current = observer
    stripPageRefs.current.forEach((_idx, el) => observer.observe(el))
    return () => { observer.disconnect(); stripObserverRef.current = null; stripPageRefs.current.clear() }
  }, [readMode, hasPages, pages.length])

  const registerStripPage = useCallback(
    (el: HTMLElement | null, idx: number) => {
      if (!el) { for (const [key, val] of stripPageRefs.current) { if (val === idx) { stripPageRefs.current.delete(key); break } } return }
      stripPageRefs.current.set(el, idx)
      if (stripObserverRef.current) stripObserverRef.current.observe(el)
    }, [],
  )

  // ── Cursor auto-hide ──
  useEffect(() => {
    if (cursorVisible) return
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - mousePos.current.x
      const dy = e.clientY - mousePos.current.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      mousePos.current = { x: e.clientX, y: e.clientY }
      if (dist > cursorHideDist) {
        document.body.style.cursor = 'default'
        if (cursorTimer.current) clearTimeout(cursorTimer.current)
        cursorTimer.current = setTimeout(() => { document.body.style.cursor = 'none' }, 1500)
      }
    }
    document.body.style.cursor = 'none'
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.body.style.cursor = ''
      if (cursorTimer.current) clearTimeout(cursorTimer.current)
    }
  }, [cursorVisible, cursorHideDist])

  // ── Auto-scroll (strip mode) ──
  useEffect(() => {
    if (!autoScrollEnabled || readMode !== 'strip' || !hasPages) return
    // Don't start auto-scroll if the entire chapter fits on one screen —
    // there's nothing to scroll through.
    if (document.documentElement.scrollHeight <= window.innerHeight + 10) return
    let running = true
    const scroll = () => {
      if (!running) return
      window.scrollBy({ top: autoScrollSpeed, behavior: 'auto' })
      const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 10
      if (atBottom) {
        readerSet('autoScrollEnabled', false)
        return
      }
      autoScrollRaf.current = requestAnimationFrame(scroll)
    }
    autoScrollRaf.current = requestAnimationFrame(scroll)
    return () => { running = false; if (autoScrollRaf.current) cancelAnimationFrame(autoScrollRaf.current) }
  }, [autoScrollEnabled, autoScrollSpeed, readMode, hasPages])

  // ── Edge hover → reveal UI (desktop) + tap → toggle UI (mobile) ──
  const edgeHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchUITimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Touch handler — toggles UI on center tap, auto-hides after 2.5s
  const handleTouchUI = useCallback(() => {
    setShowUI((v) => {
      if (v) {
        // If UI is visible, hide it
        if (touchUITimer.current) clearTimeout(touchUITimer.current)
        return false
      }
      // Show UI, then auto-hide after 2.5s
      if (touchUITimer.current) clearTimeout(touchUITimer.current)
      touchUITimer.current = setTimeout(() => setShowUI(false), 2500)
      return true
    })
  }, [])

  useEffect(() => {
    const EDGE_PX = 80
    const HIDE_DELAY = 2500
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (isTouchDevice) return // Skip edge hover on touch devices — they use tap-to-toggle

    const onMove = (e: MouseEvent) => {
      const w = window.innerWidth, h = window.innerHeight
      const nearEdge =
        e.clientY < EDGE_PX ||                // top
        e.clientX > w - EDGE_PX ||            // right
        e.clientY > h - EDGE_PX               // bottom
      if (nearEdge) {
        setShowUI(true)
        if (edgeHoverTimer.current) clearTimeout(edgeHoverTimer.current)
        edgeHoverTimer.current = setTimeout(() => setShowUI(false), HIDE_DELAY)
      }
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (edgeHoverTimer.current) clearTimeout(edgeHoverTimer.current)
    }
  }, [])

  useEffect(() => () => { if (touchUITimer.current) clearTimeout(touchUITimer.current) }, [])

  // ── Min read-time gate: prevents auto-advance from firing immediately
  //    when a short chapter loads with all pages visible at once.
  //    Resets each time chapterId or hasPages changes.
  const MIN_READ_TIME_MS = 3000
  useEffect(() => {
    setMinReadTimeElapsed(false)
    if (minReadTimerRef.current) clearTimeout(minReadTimerRef.current)
    if (hasPages) {
      minReadTimerRef.current = setTimeout(() => setMinReadTimeElapsed(true), MIN_READ_TIME_MS)
    }
    return () => { if (minReadTimerRef.current) clearTimeout(minReadTimerRef.current) }
  }, [chapterId, hasPages])

  useEffect(() => {
    lastVisibleRef.current = 0
    chapterMarkedRef.current = false
    advanceCancelledRef.current = false
    setCurrentPage(0)
    setStripProgress(0)
    setShowAdvanceToast(false)
    setShowQuickActions(false)
    if (advanceTimerRef.current) { clearInterval(advanceTimerRef.current); advanceTimerRef.current = null }
  }, [chapterId])

  // ── Page mode nav ──
  const stepForward = useCallback(() => {
    setCurrentPage((p) => {
      if (readingDir === 'rtl') { if (spreadMode) return Math.max(p - 2, 0); return Math.max(p - 1, 0) }
      if (spreadMode) { if (p === 0) return Math.min(1, pages.length - 1); return Math.min(p + 2, pages.length - 1) }
      return Math.min(p + 1, pages.length - 1)
    })
  }, [readingDir, spreadMode, pages.length])

  const stepBackward = useCallback(() => {
    setCurrentPage((p) => {
      if (readingDir === 'rtl') { if (spreadMode) return Math.min(p + 2, pages.length - 1); return Math.min(p + 1, pages.length - 1) }
      if (spreadMode) { if (p <= 1) return 0; return Math.max(p - 2, 0) }
      return Math.max(p - 1, 0)
    })
  }, [readingDir, spreadMode, pages.length])

  // ── Style helpers (derived from store settings → applied to images) ──
  const imageStyleFlag = fitMode === 'none' ? { transform: `scale(${zoomScale})`, transformOrigin: 'top center' } : {}
  const imgFilterStyle = imageFilter !== 'auto' ? { imageRendering: imageFilter as 'pixelated' | 'crisp-edges' } : {}
  // Color enhancement for colored manga — compose saturate + contrast
  const imgColorStyle: React.CSSProperties = (() => {
    const filters: string[] = []
    if (colorMode === 'enhanced') { filters.push('saturate(1.35)', 'contrast(1.1)') }
    else if (colorMode === 'custom') {
      if (colorSaturation !== 100) filters.push(`saturate(${colorSaturation}%)`)
      if (colorContrast !== 100) filters.push(`contrast(${colorContrast}%)`)
    }
    // Merge brightness into the same filter property if present
    if (imageBrightness !== 100) filters.unshift(`brightness(${imageBrightness}%)`)
    return filters.length > 0 ? { filter: filters.join(' ') } : {}
  })()
  const stripImgStyle = {
    ...(stripMaxWidth > 0 ? { maxWidth: `${stripMaxWidth}px`, marginInline: 'auto', display: 'block' } : {}),
    ...(stripGap > 0 ? { paddingBottom: `${stripGap}px` } : {}),
    ...imageStyleFlag,
    ...imgFilterStyle,
    ...imgColorStyle,
  } as const
  const pageImgStyle = {
    ...imgFilterStyle,
    ...imgColorStyle,
  } as const

  // firstPageSingle — in spread mode, cover/title page stands alone, then
  // pairs start at currentPage=1 (LTR only — RTL readers are a minority and
  // don't get the cover-alone behavior here).
  const useFirstPageSingle = firstPageSingle && spreadMode && readingDir === 'ltr'
  const showSpreadPair = spreadMode && (
    useFirstPageSingle ? currentPage >= 1 : currentPage > 0
  ) && currentPage + 1 < pages.length
  const pairLeftIdx = useFirstPageSingle && currentPage >= 1 ? currentPage - 1 : currentPage
  const rightPage = showSpreadPair ? (readingDir === 'ltr' ? pages[Math.min(pairLeftIdx + 1, pages.length - 1)] : pages[pairLeftIdx]) : null

  const resetUITimer = useCallback(() => {
    setShowUI(true)
    if (hideUITimer.current) clearTimeout(hideUITimer.current)
    hideUITimer.current = setTimeout(() => setShowUI(false), 3000)
  }, [])

  useEffect(() => () => { if (hideUITimer.current) clearTimeout(hideUITimer.current) }, [])

  // ── Click handler for page regions ──
  const handlePageClick = useCallback((e: React.MouseEvent) => {
    if (isStrip) return
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    if (readingDir === 'ltr') {
      x < rect.width * 0.3 ? stepBackward() : x > rect.width * 0.7 ? stepForward() : null
    } else {
      x < rect.width * 0.3 ? stepForward() : x > rect.width * 0.7 ? stepBackward() : null
    }
    resetUITimer()
  }, [isStrip, readingDir, stepForward, stepBackward, resetUITimer])

  // ── Double-tap zoom ──
  const handleDoubleTap = useCallback((e: React.MouseEvent) => {
    if (!readerRef.current || isStrip) return
    const now = Date.now()
    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current)

    const doZoom = () => {
      if (zoomLevel > 1) {
        setZoomLevel(1)
        setZoomPosition({ x: 50, y: 50 })
      } else {
        const rect = readerRef.current!.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * 100
        const y = ((e.clientY - rect.top) / rect.height) * 100
        setZoomLevel(2)
        setZoomPosition({ x, y })
        setShowUI(false)
      }
    }

    if (now - lastTapRef.current < 300) {
      doZoom()
      lastTapRef.current = 0
    } else {
      lastTapRef.current = now
      tapTimeoutRef.current = setTimeout(() => { lastTapRef.current = 0 }, 300)
    }
  }, [isStrip, zoomLevel])

  // ── Tap zone helper ──
  const handleTapAction = useCallback((action: 'next' | 'previous' | 'settings') => {
    if (action === 'next') stepForward()
    else if (action === 'previous') stepBackward()
    else if (action === 'settings') setShowSettings((v) => !v)
    resetUITimer()
  }, [stepForward, stepBackward, resetUITimer])

  // Cleanup tap timeout on unmount
  useEffect(() => () => { if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current) }, [])

  // ── Click-outside listener for quick-actions popover (avoids blocking overlay) ──
  useEffect(() => {
    if (!showQuickActions) return
    const onClick = (e: MouseEvent) => {
      // Ignore clicks inside the entire quick-actions area (popover + trigger button)
      if (quickActionsContainerRef.current?.contains(e.target as Node)) return
      setShowQuickActions(false)
    }
    // Small delay so the opening click doesn't immediately close it
    const timer = setTimeout(() => window.addEventListener('mousedown', onClick), 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', onClick)
    }
  }, [showQuickActions])

  // ── Swipe gesture handlers (page mode) ──
  const handleSwipeStart = useCallback((e: React.TouchEvent) => {
    swipeStartX.current = e.changedTouches[0].clientX
    swipeStartY.current = e.changedTouches[0].clientY
  }, [])

  const handleSwipeEnd = useCallback((e: React.TouchEvent) => {
    if (isStrip) return
    const dx = e.changedTouches[0].clientX - swipeStartX.current
    const dy = e.changedTouches[0].clientY - swipeStartY.current
    // Only treat as swipe if horizontal movement dominates and exceeds threshold
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return
    const isSwipeRight = dx > 0
    const isSwipeLeft = dx < 0
    if (readingDir === 'ltr') {
      if (isSwipeLeft) stepForward()
      else if (isSwipeRight) stepBackward()
    } else {
      if (isSwipeLeft) stepBackward()
      else if (isSwipeRight) stepForward()
    }
    resetUITimer()
  }, [isStrip, readingDir, stepForward, stepBackward, resetUITimer])

  // ── Page transition animation variants ──
  const pageTransitionVariants = useMemo(() => {
    if (pageTransition === 'fade') {
      return {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      }
    }
    if (pageTransition === 'slide') {
      const isRTL = readingDir === 'rtl'
      return {
        initial: { opacity: 0, x: isRTL ? -40 : 40 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: isRTL ? 40 : -40 },
      }
    }
    // 'instant' — no animation
    return { initial: {}, animate: {}, exit: {} }
  }, [pageTransition, readingDir])

  // ── Keyboard zoom (page mode only) ──
  useEffect(() => {
    if (isStrip || readMode !== 'page') return

    // Ctrl/Cmd + scroll wheel for smooth zoom
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoomLevel((z) => {
        const next = Math.max(1, Math.min(4, z - e.deltaY * 0.005))
        return Math.round(next * 100) / 100
      })
      readerSet('zoomLock', true)
      resetUITimer()
    }

    // Ctrl/Cmd + Plus/Minus/0 for step zoom
    const onZoomKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setZoomLevel((z) => Math.round(Math.min(4, z + 0.25) * 100) / 100)
        readerSet('zoomLock', true)
        resetUITimer()
      } else if (e.key === '-') {
        e.preventDefault()
        setZoomLevel((z) => Math.round(Math.max(1, z - 0.25) * 100) / 100)
        readerSet('zoomLock', true)
        resetUITimer()
      } else if (e.key === '0') {
        e.preventDefault()
        setZoomLevel(1)
        readerSet('zoomLock', false)
        setZoomPosition({ x: 50, y: 50 })
        resetUITimer()
      }
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onZoomKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onZoomKey)
    }
  }, [isStrip, readMode, resetUITimer])

  // ─── Volume key navigation ──
  useEffect(() => {
    if (!volumeKeyNav) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'VolumeUp') {
        e.preventDefault()
        stepForward()
        resetUITimer()
      } else if (e.code === 'VolumeDown') {
        e.preventDefault()
        stepBackward()
        resetUITimer()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [volumeKeyNav, stepForward, stepBackward, resetUITimer])

  // ── Keyboard ──
  // Refs keep the keyboard handler closure fresh without re-registering the
  // listener on every render (which was caused by `reader` and `showSettings`
  // in the dependency array — zustand store object identity changes each render).
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage
  const chapterRefs = useRef({ chapterId: chapterId || '', mangaId, isAtsu, currentChapter, pages } as const)
  chapterRefs.current = { chapterId: chapterId || '', mangaId, isAtsu, currentChapter, pages } as const
  const kbdRefs = useRef({ showSettings, showKbdHelp, readingDir, readMode, spreadMode, isStrip, isFullscreen, fitMode, autoScrollEnabled, bookmarks: readerBookmarksRef.current, showNotifications })
  kbdRefs.current = { showSettings, showKbdHelp, readingDir, readMode, spreadMode, isStrip, isFullscreen, fitMode, autoScrollEnabled, bookmarks: readerBookmarksRef.current, showNotifications }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = kbdRefs.current
      // Ignore if user is typing in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'ArrowRight') { if (s.isStrip) return; s.readingDir === 'ltr' ? stepForward() : stepBackward(); resetUITimer() }
      else if (e.key === 'ArrowLeft') { if (s.isStrip) return; s.readingDir === 'ltr' ? stepBackward() : stepForward(); resetUITimer() }
      else if (e.key === 'd') { if (s.isStrip) return; s.readingDir === 'ltr' ? stepForward() : stepBackward(); resetUITimer() }
      else if (e.key === 'a') { if (s.isStrip) return; s.readingDir === 'ltr' ? stepBackward() : stepForward(); resetUITimer() }
      else if (e.key === 'f') { e.preventDefault(); toggleFullscreen(); resetUITimer() }
      else if (e.key === 's') { if (s.isStrip) return; readerSet('spreadMode', !s.spreadMode); resetUITimer() }
      else if (e.key === 'r') { if (s.isStrip) return; readerSet('readingDir', s.readingDir === 'ltr' ? 'rtl' : 'ltr'); resetUITimer() }
      else if (e.key === 'm') { readerSet('readMode', s.isStrip ? 'page' : 'strip') }
      else if (e.key === 'g') {
        e.preventDefault()
        if (s.showSettings) { setShowSettings(false) } else { setShowSettings(true) }
      }
      else if (e.key === '?') {
        e.preventDefault()
        setShowKbdHelp((v) => !v)
      }
      else if (e.key === 'Escape') {
        if (s.showKbdHelp) setShowKbdHelp(false)
        else if (s.showSettings) setShowSettings(false)
        else if (s.isFullscreen) document.exitFullscreen()
      }
      else if (e.key === ' ' && s.isStrip) {
        e.preventDefault()
        readerSet('autoScrollEnabled', !s.autoScrollEnabled)
        resetUITimer()
      }
      // Visual bookmark — drop a bookmark on the current page (B key)
      else if (e.key === 'b' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault()
        const ch = chapterRefs.current
        const pageIdx = s.isStrip ? lastVisibleRef.current : currentPageRef.current
        const url = ch.pages[pageIdx]?.url
        if (!url || !ch.chapterId) return
        const cn = ch.currentChapter?.chapter || ''
        readerAddBookmark(ch.mangaId || '', {
          pageIndex: pageIdx,
          chapterId: ch.chapterId,
          chapterNum: cn,
          thumbnailUrl: url,
          at: Date.now(),
        })
        if (s.showNotifications) {
          import('../components/Toaster').then(({ toast }) => toast(`📑 Bookmarked page ${pageIdx + 1} of Ch. ${cn}`, 'info', 2000))
        }
        resetUITimer()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepForward, stepBackward, resetUITimer, toggleFullscreen])

  // ── Page mode effects ──
  // Reset zoom on page navigation when zoomLock is off
  useEffect(() => {
    if (!zoomLock && readMode === 'page') {
      setZoomLevel(1)
      setZoomPosition({ x: 50, y: 50 })
    }
  }, [currentPage, zoomLock, readMode])
  useEffect(() => { if (readMode === 'page') window.scrollTo({ top: 0, behavior: smoothScroll ? 'smooth' : 'auto' }) }, [currentPage, readMode, smoothScroll])
  useEffect(() => {
    if (readMode !== 'page' || !trackingMalId || !currentChapter || !hasPages) return
    const chNum = parseFloat(currentChapter.chapter)
    if (isNaN(chNum)) return
    const saved = getChapterProgress(trackingMalId, chNum)
    if (saved && saved.page < pages.length) setCurrentPage(saved.page)
  }, [trackingMalId, currentChapter?.chapter, pages.length, hasPages, readMode])
  useEffect(() => {
    if (readMode !== 'page' || !trackingMalId || !currentChapter || !hasPages) return
    const chNum = parseFloat(currentChapter.chapter)
    if (isNaN(chNum)) return
    setChapterProgress(trackingMalId, chNum, currentPage, pages.length)
  }, [currentPage, trackingMalId, currentChapter?.chapter, pages.length, hasPages, readMode])

  // ── Strip mode continue reading tracking (debounced every 3s) ──
  useEffect(() => {
    if (readMode !== 'strip' || !trackingMalId || !currentChapter || !hasPages) return
    const timer = setInterval(() => {
      const chNum = parseFloat(currentChapter.chapter)
      if (isNaN(chNum)) return
      const page = lastVisibleRef.current
      if (page > 0) {
        setChapterProgress(trackingMalId, chNum, page, pages.length)
        // Also update continue reading entry
        upsertContinueReading({
          mal_id: trackingMalId,
          mangaDexId: !isAtsu ? mangaId : null,
          atsuId: isAtsu ? mangaId : null,
          title: mangaTitle,
          coverUrl: mangaCover,
          chapterId: chapterId!,
          chapter: currentChapter.chapter,
          chapterTitle: currentChapter.title,
          source,
          page,
          totalPages: pages.length,
          anilistId: anilistIdParam || null,
          timestamp: Date.now(),
        })
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [readMode, trackingMalId, currentChapter?.chapter, hasPages, pages.length, chapterId, mangaId, mangaTitle, mangaCover, source, isAtsu, anilistIdParam])

  useEffect(() => {
    if (chapterMarkedRef.current || readMode !== 'page') return
    if (!trackingMalId || !currentChapter || !hasPages) return
    const chNum = parseFloat(currentChapter.chapter)
    if (isNaN(chNum)) return
    if (currentPage >= Math.floor(pages.length * 0.9)) {
      chapterMarkedRef.current = true
      if (!isChapterRead(trackingMalId, chNum)) { markChapterRead(trackingMalId, chNum); checkSyncConfirmation(() => { void syncMangaProgress(trackingMalId, chNum) }) }
    }
  }, [currentPage, pages.length, trackingMalId, currentChapter?.chapter, hasPages, readMode])

  // ── Strip mode mark read ──
  useEffect(() => {
    if (readMode !== 'strip' || chapterMarkedRef.current) return
    if (!trackingMalId || !currentChapter || !hasPages) return
    if (stripProgress >= 90) {
      chapterMarkedRef.current = true
      const chNum = parseFloat(currentChapter.chapter)
      if (!isNaN(chNum) && !isChapterRead(trackingMalId, chNum)) { markChapterRead(trackingMalId, chNum); checkSyncConfirmation(() => { void syncMangaProgress(trackingMalId, chNum) }) }
    }
  }, [stripProgress, trackingMalId, currentChapter?.chapter, hasPages, readMode])

  useEffect(() => {
    if (readMode !== 'page' || !hasPages) return
    const preload = (idx: number) => { if (idx >= 0 && idx < pages.length) { const img = document.createElement('img'); img.src = pages[idx].url } }
    if (preloadPages <= 0) return  // zero means no preloading at all

    // Use requestIdleCallback to defer preloads — avoids competing with
    // current page rendering / animation frames on Iris Xe and other iGPUs.
    const schedule = (fn: () => void) => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(fn, { timeout: 200 })
      } else {
        setTimeout(fn, 0)
      }
    }

    const step = spreadMode ? 2 : 1
    // Preload ahead up to preloadPages count, nearest pages first
    if (readingDir === 'ltr') {
      for (let i = 1; i <= preloadPages; i++) {
        const idx = currentPage + step * i
        schedule(() => preload(idx))
      }
      schedule(() => preload(currentPage - 1))   // always preload one behind
      if (spreadMode) schedule(() => preload(currentPage + 2))
    } else {
      for (let i = 1; i <= preloadPages; i++) {
        const idx = currentPage - step * i
        schedule(() => preload(idx))
      }
      schedule(() => preload(currentPage + 1))   // always preload one behind
      if (spreadMode) schedule(() => preload(currentPage - 2))
    }
  }, [currentPage, pages, spreadMode, readingDir, hasPages, readMode, preloadPages])

  // ── Click-outside chapter dropdown ── (removed; full-screen modal used instead)

  // ── Auto-advance chapter countdown ──
  const triggerAdvance = useCallback(() => {
    if (!autoAdvance || advanceCancelledRef.current) return
    if (!nextChapterInFilter) return
    advanceCancelledRef.current = true
    setShowAdvanceToast(true)
    let remaining = autoAdvanceDelay
    setAdvanceCountdown(remaining)
    if (advanceTimerRef.current) clearInterval(advanceTimerRef.current)
    advanceTimerRef.current = setInterval(() => {
      remaining -= 1
      setAdvanceCountdown(remaining)
      if (remaining <= 0) {
        if (advanceTimerRef.current) clearInterval(advanceTimerRef.current)
        advanceTimerRef.current = null
        setShowAdvanceToast(false)
        // Navigate to next chapter
        navigate(`/manga/read/${nextChapterInFilter.id}?manga=${mangaId}&source=${source}${malIdParam ? `&malId=${malIdParam}` : ''}${anilistIdParam ? `&anilist=${anilistIdParam}` : ''}#rs=p:0`)
      }
    }, 1000)
  }, [autoAdvance, autoAdvanceDelay, nextChapterInFilter, mangaId, source, malIdParam, anilistIdParam, navigate])

  // Detect end of chapter and trigger auto-advance
  useEffect(() => {
    if (!autoAdvance || !hasPages || !minReadTimeElapsed) return

    // Don't auto-advance on chapters that fit entirely on one screen —
    // the user hasn't had a chance to scroll through the content yet.
    if (isStrip && document.documentElement.scrollHeight <= window.innerHeight + 50 && window.scrollY === 0) return
    if (!isStrip && pages.length === 1) return

    const isAtEnd = isStrip ? stripProgress >= 98 : currentPage >= pages.length - 1
    if (isAtEnd && !advanceCancelledRef.current) {
      triggerAdvance()
    } else if (!isAtEnd) {
      // Reset the cancelled flag when user navigates away from the end,
      // so auto-advance can re-trigger if they reach the end again.
      advanceCancelledRef.current = false
    }
  }, [stripProgress, currentPage, hasPages, pages.length, isStrip, autoAdvance, triggerAdvance, minReadTimeElapsed])

  // ── Smart chapter preloading: warm next chapter's pages when user is near end ──
  useEffect(() => {
    if (!nextChapterInFilter || !hasPages) return

    const isNearEnd = isStrip ? stripProgress >= 70 : currentPage >= Math.floor(pages.length * 0.7)
    if (!isNearEnd) return

    // Prefetch next chapter's pages via React Query (silent — won't refetch current)
    const nextId = nextChapterInFilter.id
    queryClient.prefetchQuery({
      queryKey: [source, 'pages', mangaId, nextId],
      queryFn: () => isAtsu
        ? getChapterPagesAtsu(mangaId, nextId).then((d: any) => ({ pages: d.pages.map((p: any) => ({ url: p.url, fileName: '' })) }))
        : getChapterPages(nextId),
      staleTime: 30 * 60 * 1000,
    })
  }, [nextChapterInFilter, hasPages, currentPage, pages.length, stripProgress, isStrip, source, mangaId, isAtsu, queryClient])

  const cancelAdvance = useCallback(() => {
    advanceCancelledRef.current = true
    setShowAdvanceToast(false)
    if (advanceTimerRef.current) { clearInterval(advanceTimerRef.current); advanceTimerRef.current = null }
  }, [])

  const skipAdvance = useCallback(() => {
    if (advanceTimerRef.current) { clearInterval(advanceTimerRef.current); advanceTimerRef.current = null }
    setShowAdvanceToast(false)
    if (nextChapterInFilter) {
      navigate(`/manga/read/${nextChapterInFilter.id}?manga=${mangaId}&source=${source}${malIdParam ? `&malId=${malIdParam}` : ''}${anilistIdParam ? `&anilist=${anilistIdParam}` : ''}#rs=p:0`)
    }
  }, [nextChapterInFilter, mangaId, source, malIdParam, anilistIdParam, navigate])

  const loading = pagesQuery.isLoading

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: getBgColor(bgTheme) }}><div className="text-center"><Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-3" /><p className="text-sm text-white/50">Loading chapter...</p></div></div>
  }

  if (!loading && !hasPages && chapters.length === 0) {
    return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: getBgColor(bgTheme) }}><div className="text-center"><BookOpen className="h-12 w-12 text-white/10 mx-auto mb-3" /><p className="text-sm text-white/50">No pages found for this chapter.</p><Link to={mangaId ? `/manga/${mangaId}` : '/manga'} className="text-primary hover:underline text-sm mt-2 inline-block">Back to manga</Link></div></div>
  }

  // ── Fit mode CSS classes (page mode only) ──
  const imgFitClass = isStrip ? 'w-full h-auto'
    : fitMode === 'width' ? 'w-full h-auto'
    : fitMode === 'height' ? 'h-screen w-auto max-w-full'
    : 'w-auto h-auto max-w-full'

  // ── Effective loading method: bg-image on strip mode collapses to 0 height,
  //    so fall back to native for strips.
  const loadingMethodEffective = isStrip && loadingMethod === 'bg-image' ? 'native' : loadingMethod

  // ── Navigate to chapter helper ──
  const navigateToChapter = (ch: { id: string }) => {
    navigate(`/manga/read/${ch.id}?manga=${mangaId}&source=${source}${malIdParam ? `&malId=${malIdParam}` : ''}${anilistIdParam ? `&anilist=${anilistIdParam}` : ''}#rs=p:0`)
  }

  return (
    <BackgroundPattern theme={bgTheme} pattern={bgPattern} intensity={paperIntensity}>
    <div className="min-h-screen relative" onClick={() => { if (!isStrip) resetUITimer() }}>
      {/* ══════ Top bar ══════ */}
      <AnimatePresence>
        {showUI && !zenMode && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}
            className="fixed top-0 left-0 right-0 z-40 bg-gradient-to-b from-black/90 to-transparent pb-12 pointer-events-none"
          >
            <div className="max-w-[900px] mx-auto px-4 h-14 flex items-center justify-between gap-3 pointer-events-auto">
              {/* Left: Back + title */}
              <Link to={mangaId ? `/manga/${mangaId}` : '/manga'} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 text-white/55 hover:text-white/85 transition-colors shrink-0 group">
                <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                <span className="text-xs font-medium truncate max-w-[200px]">{mangaTitle}</span>
                {isAtsu && <span className="glass-pill text-emerald-400/80 border-emerald-500/20 bg-emerald-500/10 text-[8px]">atsu</span>}
              </Link>

              {/* Right: Auto-scroll + Fullscreen + Chapter dropdown + Page counter + Settings */}
              <div className="flex items-center gap-1.5">
                {/* Auto-scroll play/pause + speed slider (strip mode only) */}
                {isStrip && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); readerSet('autoScrollEnabled', !autoScrollEnabled); resetUITimer() }}
                      className={cn(
                        'p-1.5 rounded-lg transition-colors',
                        autoScrollEnabled
                          ? 'text-primary bg-primary/10 hover:bg-primary/15'
                          : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]',
                      )}
                      title={autoScrollEnabled ? 'Pause auto-scroll (Space)' : 'Play auto-scroll (Space)'}
                    >
                      {autoScrollEnabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={autoScrollSpeed}
                      onChange={(e) => { e.stopPropagation(); readerSet('autoScrollSpeed', Number(e.target.value)); resetUITimer() }}
                      className="w-16 accent-primary h-1"
                      title={`Speed: ${autoScrollSpeed}px/frame`}
                      style={{ marginTop: '1px' }}
                    />
                    <span className="text-[9px] font-mono text-white/25 w-5 text-right tabular-nums">{autoScrollSpeed}</span>
                  </div>
                )}

                {/* Fullscreen toggle (atsu.moe style) */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFullscreen(); resetUITimer() }}
                  className="p-1.5 rounded-lg text-white/40 hover:text-white/60 hover:bg-white/[0.04] transition-colors"
                  title={isFullscreen ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)'}
                >
                  {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
                </button>

                {/* Chapter dropdown */}
                {displayChapters.length > 0 && (
                  <div className="relative" data-chapter-dropdown>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowChapterModal(true) }}
                      className="glass-pill hover:bg-white/[0.08] hover:text-white transition-colors text-[11px]"
                    >
                      {currentChapter ? `Ch. ${currentChapter.chapter}` : 'Chapters'}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {/* Page counter */}
                {hasPages && (
                  <div className="flex items-center gap-0.5 text-[11px] text-white/30 font-mono">
                    {!isStrip && (
                      <button
                        onClick={(e) => { e.stopPropagation(); stepBackward(); resetUITimer() }}
                        className={cn('p-1 rounded hover:text-white/60 hover:bg-white/[0.06] transition-colors', currentPage <= 0 && 'opacity-20 cursor-default')}
                      >
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                    )}
                    <span className="tabular-nums min-w-[40px] text-center text-white/60 font-medium">
                      {isStrip ? `${Math.round(stripProgress)}%` : `${currentPage + 1}/${pages.length}`}
                    </span>
                    {!isStrip && (
                      <button
                        onClick={(e) => { e.stopPropagation(); stepForward(); resetUITimer() }}
                        className={cn('p-1 rounded hover:text-white/60 hover:bg-white/[0.06] transition-colors', currentPage >= pages.length - 1 && 'opacity-20 cursor-default')}
                      >
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}                  {/* Stats button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setShowStatsModal(true) }}
                  className="p-1.5 rounded-lg text-white/35 hover:text-white/65 hover:bg-white/[0.04] transition-colors"
                  title="Reading stats"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                </button>

                {/* Bookmarks button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setShowBookmarks(true) }}
                  className="p-1.5 rounded-lg text-white/35 hover:text-white/65 hover:bg-white/[0.04] transition-colors"
                  title="Bookmarks (B to add)"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                </button>

                {/* Settings gear */}
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSettings((v) => !v) }}
                  className="p-1.5 rounded-lg text-white/35 hover:text-white/65 hover:bg-white/[0.04] transition-colors"
                  title="Reader settings (G)"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════ Auto-advance countdown toast ══════ */}
      <AnimatePresence>
        {showAdvanceToast && showUI && showNotifications && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#1a1a1a]/95 border border-white/[0.08] rounded-xl px-4 py-3 shadow-lg shadow-black/40"
          >
            <span className="text-sm text-white/70">
              Next chapter in <span className="text-white font-bold tabular-nums">{advanceCountdown}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={skipAdvance}
                className="flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/10 hover:bg-primary/15 px-2.5 py-1.5 rounded-lg transition-colors"
              >
                <SkipForward className="h-3 w-3" />
                Skip
              </button>
              <button
                onClick={cancelAdvance}
                className="text-[11px] font-medium text-white/40 hover:text-white/70 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════ Non-colored chapter warning (when coloredOnly is active) ══════ */}
      {coloredOnly && currentChapter && !coloredCurrentChapter && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-amber-950/85 border border-amber-600/20 rounded-lg px-3 py-1.5 text-[11px] text-amber-300/80 shadow-md">
          <AlertTriangle className="h-3 w-3" />
          <span>This chapter is not available in colored edition.</span>
          <button
            onClick={() => readerSet('coloredOnly', false)}
            className="text-amber-400 hover:text-amber-200 font-medium underline transition-colors"
          >
            Switch to regular
          </button>
        </div>
      )}

      {/* ══════ Reader content ══════ */}
      <div ref={readerRef} className={cn(isStrip ? '' : 'min-h-screen')}>
        {isStrip ? (
          /* ── Strip mode ── */
          <div className="flex flex-col items-center">
            {pages.map((page, idx) => (
              <ReaderImage
                key={idx}
                ref={(el) => registerStripPage(el, idx)}
                url={page.url}
                alt={`Page ${idx + 1}`}
                className={cn('block select-none', imgFitClass)}
                style={stripImgStyle}
                loadingMethod={loadingMethodEffective}
                imgLoading={loadingStrategy === 'eager' ? 'eager' : idx < 3 ? 'eager' : 'lazy'}
                onClick={(e) => { e.stopPropagation(); resetUITimer() }}
              />
            ))}
          </div>
        ) : (
          /* ── Page mode ── */
          <div
            className={cn(
              'relative flex items-center justify-center min-h-screen select-none',
              zoomLevel > 1 ? 'cursor-zoom-out' : 'cursor-pointer',
            )}
            style={zoomLevel > 1 ? {
              transform: `scale(${zoomLevel})`,
              transformOrigin: `${zoomPosition.x}% ${zoomPosition.y}%`,
            } : undefined}
            onClick={handlePageClick}
            onDoubleClick={handleDoubleTap}
          >
            {/* Left tap zone — works on both mouse and touch */}
            <div
              className="absolute top-0 bottom-0 left-0 w-[30%] z-10"
              onClick={(e) => { e.stopPropagation(); handleTapAction(leftTapAction) }}
              onTouchEnd={(e) => { e.stopPropagation(); handleTapAction(leftTapAction) }}
            />
            {/* Center tap zone — toggles UI + performs action */}
            <div
              className="absolute top-0 bottom-0 left-[30%] w-[40%] z-10"
              onClick={(e) => { e.stopPropagation(); handleTapAction(centerTapAction) }}
              onTouchEnd={(e) => { e.stopPropagation(); handleTouchUI(); handleTapAction(centerTapAction) }}
            />
            {/* Right tap zone — works on both mouse and touch */}
            <div
              className="absolute top-0 bottom-0 right-0 w-[30%] z-10"
              onClick={(e) => { e.stopPropagation(); handleTapAction(rightTapAction) }}
              onTouchEnd={(e) => { e.stopPropagation(); handleTapAction(rightTapAction) }}
            />

            {/* Single page or spread pair — animated transitions */}
            <AnimatePresence mode="wait">
              <motion.div
                key={currentPage}
                initial={pageTransitionVariants.initial}
                animate={pageTransitionVariants.animate}
                exit={pageTransitionVariants.exit}
                transition={{ duration: 0.1 }}
                className="flex items-center justify-center gap-0"
                onTouchStart={handleSwipeStart}
                onTouchEnd={handleSwipeEnd}
              >
                {pages[currentPage] && (
                  <ReaderImage
                    url={pages[currentPage].url}
                    alt={`Page ${currentPage + 1}`}
                    className={cn('block select-none max-h-screen', imgFitClass)}
                    style={pageImgStyle}
                    loadingMethod={loadingMethod}
                    imgLoading={loadingStrategy === 'eager' || !rightPage ? 'eager' : 'lazy'}
                  />
                )}
                {rightPage && (
                  <ReaderImage
                    url={rightPage.url}
                    alt={`Page ${pairLeftIdx + 2}`}
                    className={cn('block select-none max-h-screen', imgFitClass)}
                    style={pageImgStyle}
                    loadingMethod={loadingMethod}
                    imgLoading={loadingStrategy === 'eager' ? 'eager' : 'lazy'}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ══════ Page preview strip (hover) ══════ */}
      {hasPages && previewMode !== 'off' && showUI && (
        <div
          className={cn(
            'fixed bottom-12 left-0 right-0 z-30',
            previewMode === 'hover' ? 'opacity-0 hover:opacity-100 transition-opacity duration-200' : '',
          )}
        >
          <div className="flex justify-center gap-1 overflow-x-auto custom-scrollbar px-4 py-2 bg-black/80">
            {pages.map((page, idx) => (
              <button
                key={idx}
                onClick={(e) => {
                  e.stopPropagation()
                  setCurrentPage(idx)
                  resetUITimer()
                }}
                className={cn(
                  'shrink-0 rounded overflow-hidden border-2 transition-all',
                  idx === currentPage
                    ? 'border-primary shadow-lg shadow-primary/20'
                    : 'border-transparent opacity-50 hover:opacity-80',
                )}
              >
                <ReaderImage
                  url={page.url}
                  alt={`Page ${idx + 1}`}
                  className="h-12 w-auto object-cover"
                  loadingMethod="native"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══════ Bottom bar ══════ */}
      <AnimatePresence>
        {showUI && !zenMode && hasPages && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}
            className="fixed bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-black/90 to-transparent pt-8 pb-3 pointer-events-none"
          >
            <div className="max-w-[900px] mx-auto px-4 pointer-events-auto">
              {/* Progress scrubber with hover thumbnails */}
              <ProgressScrubber
                totalPages={pages.length}
                currentPage={currentPage}
                progressPct={stripProgress}
                isStrip={isStrip}
                pageUrls={pages.map(p => p.url)}
                onSeekToPage={(idx) => { setCurrentPage(idx); resetUITimer() }}
              />
              <div className="flex items-center justify-between text-[10px] text-white/25 mt-1">
                <div className="flex items-center gap-2">
                  <span>
                    {isStrip
                      ? `${Math.round(stripProgress)}%`
                      : progressIndicator === 'chapter' && currentChapter
                        ? `Ch. ${currentChapter.chapter}`
                        : `Page ${currentPage + 1} / ${pages.length}`}
                  </span>
                  {/* Jump-to-page input (page mode only) */}
                  {!isStrip && hasPages && pages.length > 5 && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        const n = parseInt(jumpToPageInput, 10)
                        if (!isNaN(n) && n >= 1 && n <= pages.length) {
                          setCurrentPage(n - 1)
                          resetUITimer()
                        }
                        setJumpToPageInput('')
                      }}
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-white/10">· Go to</span>
                      <input
                        type="number"
                        min={1}
                        max={pages.length}
                        value={jumpToPageInput}
                        onChange={(e) => setJumpToPageInput(e.target.value)}
                        placeholder="#"
                        className="w-10 h-5 bg-white/[0.04] border border-white/[0.08] rounded text-[10px] text-white/60 text-center outline-none focus:border-primary/40 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </form>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {currentChapter && progressIndicator === 'page' && (
                    <span className="truncate max-w-[200px]">
                      Ch. {currentChapter.chapter}{currentChapter.title ? ` — ${currentChapter.title}` : ''}
                    </span>
                  )}
                  {coloredCurrentChapter && (
                    <span className="text-[9px] font-semibold text-amber-400/60">🎨 Colored Edition</span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════ Chapter search modal (full-screen) ══════ */}
      <Suspense fallback={<div className="fixed inset-0 z-50 bg-black/85 animate-pulse" />}>
        {showChapterModal && (
          <ChapterSearchModal
            open={showChapterModal}
            onClose={() => setShowChapterModal(false)}
            chapters={displayChapters}
            currentChapterId={chapterId || null}
            onSelect={navigateToChapter}
            isColoredChapter={(ch: any) => isColoredChapter({ title: ch.title, scanGroup: ch.scanGroup })}
            isChapterRead={(ch: any) => checkChapterRead(ch)}
            chapterProgress={(ch: any) => checkChapterProgress(ch)}
            lastReadChapterId={lastReadChapterId}
            coloredOnly={coloredOnly}
          />
        )}
      </Suspense>

      {/* ══════ Auto-detect colored manhwa prompt ══════ */}
      <ColoredManhwaDetector
        mangaTitle={mangaTitle}
        mangaGenres={(
          // ATSU API returns untyped JSON — see comment above on casts.
          mangaQuery.data as any
        )?.genres || []}
        isColoredChapter={coloredCurrentChapter}
        enabled={hasPages && !loading}
      />

      {/* ══════ Reading stats modal (heatmap) ══════ */}
      <Suspense fallback={<div className="fixed inset-0 z-50 bg-black/75 animate-pulse" />}>
        {showStatsModal && (
          <ReadingStatsModal open={showStatsModal} onClose={() => setShowStatsModal(false)} />
        )}
      </Suspense>

      {/* ══════ Bookmarks panel ══════ */}
      <BookmarksPanel
        open={showBookmarks}
        onClose={() => setShowBookmarks(false)}
        mangaId={mangaId}
        chapters={chapters}
        currentChapterId={chapterId || null}
        onNavigateToPage={(pageIdx) => { setCurrentPage(pageIdx); resetUITimer() }}
      />

      {/* ══════ Settings modal (central 720px, two-column) ══════ */}
      <Suspense fallback={<div className="fixed inset-0 z-50 bg-black/75 animate-pulse" />}>
        {showSettings && (
          <ReaderSettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
        )}
      </Suspense>

      {/* ══════ Keyboard help modal ══════ */}
      <KeyboardHelpModal open={showKbdHelp} onClose={() => setShowKbdHelp(false)} isStrip={isStrip} />

      {/* ══════ Sync confirmation ══════ */}
      <SyncConfirmDialog
        open={syncDialogOpen}
        onConfirm={handleSyncConfirm}
        onDecline={handleSyncDecline}
        onClose={() => handleSyncDecline()}
        type="manga"
        title={mangaTitle}
        malId={trackingMalId}
      />

      {/* ══════ Floating quick-actions button (always visible, even when UI hidden) ══════ */}
      {hasPages && !zenMode && !showSettings && (
        <div ref={quickActionsContainerRef} className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
          <AnimatePresence>
            {showQuickActions && (
              <motion.div
                key="qa-popover"
                initial={{ opacity: 0, scale: 0.9, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 8 }}
                transition={{ duration: 0.1 }}
                className="relative z-10 glass-card rounded-xl p-3 border border-white/10 shadow-2xl min-w-[180px] space-y-3"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Brightness */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Sun className="h-3 w-3 text-white/40" />
                    <span className="text-[10px] text-white/60 font-medium">Brightness</span>
                    <span className="text-[10px] text-white/35 font-mono ml-auto">{imageBrightness}%</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={150}
                    step={5}
                    value={imageBrightness}
                    onChange={(e) => readerSet('imageBrightness', Number(e.target.value))}
                    className="w-full accent-primary h-1"
                  />
                </div>

                {/* Fit mode */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Columns className="h-3 w-3 text-white/40" />
                    <span className="text-[10px] text-white/60 font-medium">Page fit</span>
                  </div>
                  <div className="flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden">
                    {(['width', 'height', 'none'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => { readerSet('fitMode', m); setShowQuickActions(false) }}
                        className={`flex-1 px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                          fitMode === m ? 'bg-primary/20 text-primary' : 'text-white/35 hover:text-white/60'
                        }`}
                      >
                        {m === 'none' ? '1:1' : m === 'width' ? 'W' : 'H'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reading mode toggle */}
                <button
                  onClick={() => { readerSet('readMode', isStrip ? 'page' : 'strip'); setShowQuickActions(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition-colors"
                >
                  <AlignJustify className="h-3.5 w-3.5 text-white/50" />
                  <span className="text-[11px] text-white/60 font-medium">
                    Switch to {isStrip ? 'Page' : 'Strip'} mode
                  </span>
                  <span className="text-[10px] text-white/25 font-mono ml-auto">M</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Floating trigger button */}
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => { e.stopPropagation(); setShowQuickActions((v) => !v) }}
            className={`h-10 w-10 rounded-full grid place-items-center shadow-lg border transition-all ${
              showQuickActions
                ? 'bg-primary text-white border-primary shadow-primary/30'
                : 'bg-black/75 text-white/60 border-white/10 hover:text-white/90 hover:border-white/20'
            }`}
            title="Quick settings"
          >
            <Sun className="h-4 w-4" />
          </motion.button>
        </div>
      )}
    </div>
    </BackgroundPattern>
  )
}
