import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Volume1,
  Maximize, Minimize, Settings, Captions, RotateCcw, RotateCw,
  PictureInPicture2, Cast, Check, SkipBack, SkipForward, ChevronRight,
  Type, SlidersHorizontal, ArrowLeft, RectangleHorizontal, Maximize2,
  Camera, Link, MonitorPlay, 
} from 'lucide-react'
import { cn } from '../lib/utils'
import SegmentedControl from './SegmentedControl'
import type { Level } from 'hls.js'
import { useSettings } from '../store/useSettings'
import { toast } from '../components/Toaster'

interface ChapterMarker {
  /** Absolute start time in seconds. PlayerControls converts to a
   *  percentage at render time using its live `duration` state, so
   *  the markers appear as soon as the video metadata loads. */
  start: number
  end: number
  title: string
  /** 'op' | 'ed' | 'recap' — colors the marker. */
  type?: 'op' | 'ed' | 'recap'
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** Loading overlay: show the spinner over the play button when buffering. */
  loading?: boolean

  // Captions
  subtitles: Array<{ src: string; label: string; default?: boolean; lang?: string }>
  activeSubIdx: number
  onChangeSubIdx: (i: number) => void

  // Quality
  levels: Level[]
  currentLevel: number  // -1 = AUTO
  onChangeLevel: (i: number) => void

  // PiP / AirPlay
  pipActive: boolean
  onTogglePiP: () => void
  hasAirPlay: boolean
  onTriggerAirPlay: () => void

  /** Optional chapter markers to render on the timeline. */
  chapters?: ChapterMarker[]
  /** Theater mode state — when true the parent has hidden the side rail
   *  and stretched the player; the button shows the "exit" icon. */
  theaterMode?: boolean
  /** Called when the user clicks the theater-mode toggle button. */
  onToggleTheaterMode?: () => void

  // Audio tracks (HLS)
  audioTracks: Array<{ id: number; name: string; lang?: string }>
  currentAudioTrack: number
  onChangeAudioTrack: (id: number) => void

  // Stats overlay toggle
  statsOverlay: boolean
  onToggleStatsOverlay: () => void

  // Subtitle offset (seconds, -30..+30)
  subtitleOffset: number
  onChangeSubtitleOffset: (offset: number) => void

  // Loop toggle
  loop: boolean
  onToggleLoop: () => void

  // Video fit mode
  videoFit: 'contain' | 'cover' | 'fill'
  onChangeVideoFit: (fit: 'contain' | 'cover' | 'fill') => void

  // Episode navigation
  hasNextEpisode: boolean
  hasPrevEpisode: boolean
  onNextEpisode: () => void
  onPrevEpisode: () => void

  /** Episode info — shown as a sleek overlay in the top-left when controls are visible. */
  episodeNumber?: number
  episodeTitle?: string
}

function formatTime(s: number) {
  if (!isFinite(s) || s < 0) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

function levelLabel(l: Level | undefined) {
  if (!l) return 'Auto'
  if (l.height) return `${l.height}p`
  if (l.bitrate) return `${Math.round(l.bitrate / 1000)}k`
  return 'Auto'
}

/**
 * Plyr/anidap-style custom control bar.
 *
 * Layered absolutely over the video element. Reads & writes through
 * `videoRef` directly — no React state for currentTime (that would
 * re-render on every frame). We just subscribe to the video's events
 * and update local state at sane intervals.
 *
 * Auto-hides after 3s of mouse inactivity (unless paused).
 */
export default function PlayerControls({
  videoRef, loading,
  subtitles, activeSubIdx, onChangeSubIdx,
  levels, currentLevel, onChangeLevel,
  pipActive, onTogglePiP, hasAirPlay, onTriggerAirPlay,
  chapters,
  theaterMode, onToggleTheaterMode,
  audioTracks, currentAudioTrack, onChangeAudioTrack,
  statsOverlay, onToggleStatsOverlay,
  subtitleOffset, onChangeSubtitleOffset,
  loop, onToggleLoop,
  videoFit, onChangeVideoFit,
  hasNextEpisode, hasPrevEpisode, onNextEpisode, onPrevEpisode,
  episodeNumber, episodeTitle,
}: Props) {
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [visible, setVisible] = useState(true)
  const [hoveredPct, setHoveredPct] = useState<number | null>(null)
  const [menu, setMenu] = useState<'settings' | 'captions' | 'quality' | null>(null)
  const [captionsTab, setCaptionsTab] = useState<'tracks' | 'appearance'>('tracks')
  const [speed, setSpeed] = useState(1)

  // Visual feedback for click / double-tap on the video surface.
  // Each entry is rendered as a fading animation and removed after 600ms.
  const [taps, setTaps] = useState<Array<{ id: number; x: number; y: number; kind: 'play' | 'pause' | 'seek-back' | 'seek-fwd' }>>([])
  const tapIdRef = useRef(0)
  const lastClickRef = useRef<{ t: number; x: number; side: 'left' | 'center' | 'right' } | null>(null)
  const playerSurfaceRef = useRef<HTMLDivElement>(null)

  const hideTimer = useRef<number | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const scrubbingRef = useRef(false)

  // Subscribe to video events. Each handler is light & fires <30 Hz.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTime = () => {
      if (!scrubbingRef.current) setCurrentTime(v.currentTime)
      // Update buffered (the end of the last buffered range)
      if (v.buffered.length > 0) {
        setBuffered(v.buffered.end(v.buffered.length - 1))
      }
    }
    const onDur = () => setDuration(v.duration || 0)
    const onVol = () => { setVolume(v.volume); setMuted(v.muted) }
    const onRate = () => setSpeed(v.playbackRate)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('durationchange', onDur)
    v.addEventListener('loadedmetadata', onDur)
    v.addEventListener('volumechange', onVol)
    v.addEventListener('ratechange', onRate)
    // Initialize from current state
    setPlaying(!v.paused)
    setVolume(v.volume); setMuted(v.muted)
    setDuration(v.duration || 0)
    setSpeed(v.playbackRate)
    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('durationchange', onDur)
      v.removeEventListener('loadedmetadata', onDur)
      v.removeEventListener('volumechange', onVol)
      v.removeEventListener('ratechange', onRate)
    }
  }, [videoRef])

  // Track document fullscreen
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // Auto-hide controls after 2.5s of inactivity (only while playing).
  // Also: always show on hover, always show when paused, always show when
  // a menu is open.
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    if (!playing) return  // never auto-hide while paused
    if (menu) return      // never auto-hide while a menu is open
    hideTimer.current = window.setTimeout(() => setVisible(false), 3000)
  }, [playing, menu])

  const showAndReschedule = useCallback(() => {
    setVisible(true)
    scheduleHide()
  }, [scheduleHide])

  useEffect(() => {
    // When state changes, re-evaluate the auto-hide.
    if (!playing || menu) {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      setVisible(true)
    } else {
      scheduleHide()
    }
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [playing, menu, scheduleHide])

  // Screenshot capture
  const captureScreenshot = () => {
    const v = videoRef.current
    if (!v || v.readyState < 2) return
    try {
      const canvas = document.createElement('canvas')
      canvas.width = v.videoWidth
      canvas.height = v.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const ts = formatTime(v.currentTime).replace(/:/g, '-')
        a.download = `screenshot-${ts}.png`
        document.body.appendChild(a); a.click(); a.remove()
        URL.revokeObjectURL(url)
      }, 'image/png')
    } catch { /* canvas tainted or CORS issue */ }
  }

  // ─── Actions ─────────────────────────────────────────────────────
  const addTap = (x: number, y: number, kind: 'play' | 'pause' | 'seek-back' | 'seek-fwd') => {
    const id = ++tapIdRef.current
    setTaps((arr) => [...arr, { id, x, y, kind }])
    window.setTimeout(() => {
      setTaps((arr) => arr.filter((t) => t.id !== id))
    }, 600)
  }

  const togglePlay = () => {
    const v = videoRef.current; if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }

  const seek = (delta: number) => {
    const v = videoRef.current; if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + delta))
  }

  const setVolumeAndUnmute = (next: number) => {
    const v = videoRef.current; if (!v) return
    v.volume = Math.max(0, Math.min(1, next))
    if (v.muted && next > 0) v.muted = false
  }

  const toggleMute = () => {
    const v = videoRef.current; if (!v) return
    v.muted = !v.muted
  }

  const toggleFullscreen = () => {
    const wrap = videoRef.current?.parentElement
    if (!document.fullscreenElement) wrap?.requestFullscreen?.()
    else document.exitFullscreen?.()
  }

  const setPlaybackSpeed = (s: number) => {
    const v = videoRef.current; if (!v) return
    v.playbackRate = s
  }

  // Timeline interaction — handles click, drag, and hover preview.
  const tlPctFromEvent = (e: { clientX: number }): number => {
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }

  const onTlPointerDown = (e: React.PointerEvent) => {
    if (!duration) return
    scrubbingRef.current = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const pct = tlPctFromEvent(e)
    setCurrentTime(pct * duration)
    const v = videoRef.current
    if (v) v.currentTime = pct * duration
  }
  const onTlPointerMove = (e: React.PointerEvent) => {
    if (!duration) return
    const pct = tlPctFromEvent(e)
    setHoveredPct(pct)
    if (scrubbingRef.current) {
      setCurrentTime(pct * duration)
      const v = videoRef.current
      if (v) v.currentTime = pct * duration
    }
  }
  const onTlPointerUp = (e: React.PointerEvent) => {
    scrubbingRef.current = false
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
  }
  const onTlLeave = () => setHoveredPct(null)

  // ─── Render ──────────────────────────────────────────────────────
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0
  const hoverTime = hoveredPct != null && duration ? hoveredPct * duration : null
  // Pre-derive percent-based positions so we don't repeat the math in JSX.
  const chapterRanges = duration > 0 && chapters
    ? chapters
        .map((c) => ({
          ...c,
          startPct: Math.max(0, Math.min(1, c.start / duration)),
          endPct: Math.max(0, Math.min(1, c.end / duration)),
        }))
        .filter((c) => c.endPct > c.startPct)
    : []
  const hoveredChapter = hoveredPct != null && chapterRanges.length > 0
    ? chapterRanges.find((c) => hoveredPct >= c.startPct && hoveredPct <= c.endPct) ?? null
    : null

  return (
    <div
      className={cn(
        // Overlay layer above the video, below the menus / top-right cluster.
        'absolute inset-0 z-10 select-none',
        'transition-[opacity,transform] duration-400 ease-out',
        visible ? 'opacity-100' : 'opacity-0 translate-y-2',
      )}
      onMouseMove={showAndReschedule}
      onMouseLeave={() => { if (playing && !menu) setVisible(false) }}
      onTouchStart={showAndReschedule}
    >
      {/* Click-anywhere surface: smart single/double-tap handling.
          - Single tap anywhere → play/pause toggle + ripple at tap point.
          - Double-tap LEFT  third → seek -10s + fan animation.
          - Double-tap RIGHT third → seek +10s + fan animation.
          - Double-tap CENTER    → fullscreen toggle. */}
      <div
        ref={playerSurfaceRef}
        onClick={(e) => {
          const el = playerSurfaceRef.current
          if (!el) return
          const rect = el.getBoundingClientRect()
          const xRel = (e.clientX - rect.left) / rect.width
          const side: 'left' | 'center' | 'right' =
            xRel < 0.33 ? 'left' : xRel > 0.66 ? 'right' : 'center'
          const localX = e.clientX - rect.left
          const localY = e.clientY - rect.top
          const now = Date.now()
          const last = lastClickRef.current
          const isDoubleClick =
            last && now - last.t < 320 && last.side === side
          if (isDoubleClick) {
            lastClickRef.current = null
            if (side === 'center') {
              toggleFullscreen()
              return
            }
            // Seek by ±10s with fan animation.
            const v = videoRef.current
            if (!v) return
            const delta = side === 'right' ? 10 : -10
            v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + delta))
            addTap(localX, localY, side === 'right' ? 'seek-fwd' : 'seek-back')
            return
          }
          // Single tap → schedule play/pause toggle, but only if no
          // second click arrives before the dbl-click window closes.
          lastClickRef.current = { t: now, x: e.clientX, side }
          window.setTimeout(() => {
            const cur = lastClickRef.current
            if (cur && cur.t === now) {
              // Still a single click
              const v = videoRef.current
              if (!v) return
              const wasPaused = v.paused
              if (wasPaused) v.play().catch(() => {})
              else v.pause()
              addTap(localX, localY, wasPaused ? 'play' : 'pause')
              lastClickRef.current = null
            }
          }, 320)
        }}
        className="absolute inset-0 cursor-pointer"
      />

      {/* Tap / double-tap feedback overlays. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {taps.map((t) => (
          <div
            key={t.id}
            className={cn(
              'absolute z-10',
              (t.kind === 'play' || t.kind === 'pause') && 'animate-[playerRipple_0.55s_ease-out_forwards]',
              t.kind === 'seek-back' && 'animate-[playerFanLeft_0.55s_ease-out_forwards]',
              t.kind === 'seek-fwd' && 'animate-[playerFanRight_0.55s_ease-out_forwards]',
            )}
            style={
              t.kind === 'play' || t.kind === 'pause'
                ? { left: t.x - 32, top: t.y - 32, width: 64, height: 64 }
                : t.kind === 'seek-back'
                ? { left: 0, top: 0, bottom: 0, width: '33%' }
                : { right: 0, top: 0, bottom: 0, width: '33%' }
            }
          >
            {t.kind === 'play' || t.kind === 'pause' ? (
              <div className="h-full w-full rounded-full bg-white/15 border border-white/20" />
            ) : (
              <div className={cn(
                'h-full w-full grid place-items-center',
                t.kind === 'seek-back' ? 'rounded-r-full' : 'rounded-l-full',
                'bg-gradient-to-' + (t.kind === 'seek-back' ? 'r' : 'l') + ' from-white/20 to-transparent',
              )}>
                <div className="flex flex-col items-center gap-1 text-white">
                  {t.kind === 'seek-back'
                    ? <RotateCcw className="h-7 w-7" />
                    : <RotateCw className="h-7 w-7" />}
                  <span className="text-xs font-bold">10s</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Center play / pause indicator — premium glow-ring design */}
      {(!playing || loading) && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center z-10">
          <div className={cn(
            'relative h-20 w-20 rounded-full flex items-center justify-center',
            'bg-black/75 border border-white/[0.12]',
            'shadow-[0_0_40px_-8px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.3),0_10px_40px_-10px_rgba(0,0,0,0.9)]',
            'transition-all duration-300 ease-out',
            !loading && 'animate-[fadeInUp_0.35s_ease]',
            loading && 'scale-95',
          )}>
            {/* Glow ring — gentle pulse */}
            <div className="absolute inset-0 rounded-full border border-primary/40 animate-[glowPulse_2s_ease-in-out_infinite]" />
            {loading ? (
              <div className="relative h-7 w-7 rounded-full border-2 border-white/20 border-t-primary animate-spin" />
            ) : (
              <Play className="relative h-9 w-9 text-white fill-white translate-x-0.5 drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]" />
            )}
          </div>
        </div>
      )}

      {/* Ghost glass control bar — transparent, blur-backed for anidap feel */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28 transition-opacity duration-500"
        style={{
          background: 'linear-gradient(to top, rgba(8,8,10,0.85) 0%, rgba(8,8,10,0.35) 60%, transparent 100%)',
        }}
      />

      {/* Episode info overlay — sleek top-left title card (Netflix-style) */}
      {episodeNumber != null && visible && (
        <div className="pointer-events-none absolute top-3 left-3 z-20">
          <div className="glass-card rounded-xl px-4 py-2.5 border border-white/[0.06] shadow-md animate-[fadeInUp_0.3s_ease]">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest bg-primary/20 text-primary border border-primary/30 px-2 py-0.5 rounded-full">
                EP {episodeNumber}
              </span>
              {episodeTitle && (
                <span className="text-xs text-white/85 font-medium line-clamp-1 max-w-[280px] sm:max-w-[400px]">
                  {episodeTitle}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-auto absolute inset-x-0 bottom-0 px-3 sm:px-4 pb-3 sm:pb-4 pt-1 flex flex-col gap-1.5">
        {/* Hovered chapter label — shown above the timeline */}
        {hoveredChapter && (
          <div className="flex items-center justify-center mb-0.5 pointer-events-none">
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border',
                hoveredChapter.type === 'op'
                  ? 'bg-amber-400/15 border-amber-400/40 text-amber-200'
                  : hoveredChapter.type === 'ed'
                  ? 'bg-sky-400/15 border-sky-400/40 text-sky-200'
                  : 'bg-white/10 border-white/20 text-white',
              )}
            >
              {hoveredChapter.title}
            </span>
          </div>
        )}

        {/* Timeline */}
        <div
          ref={timelineRef}
          onPointerDown={onTlPointerDown}
          onPointerMove={onTlPointerMove}
          onPointerUp={onTlPointerUp}
          onPointerLeave={onTlLeave}
          className="relative h-5 group flex items-center cursor-pointer touch-none"
        >
          {/* Track (3px, expands to 8px on hover — ghost thin-line) */}
          <div className="relative w-full h-[3px] group-hover:h-2 transition-all duration-200 rounded-full bg-white/[0.12] overflow-hidden">
            {/* Buffered range */}
            <div
              className="absolute inset-y-0 left-0 bg-white/25"
              style={{ width: `${bufferedPct}%` }}
            />
            {/* Chapter ranges — translucent colored swaths sitting UNDER
                the progress bar so the progress fill paints over them as
                the user watches. Gives an at-a-glance map of intro/outro. */}
            {chapterRanges.map((c, i) => {
              const left = c.startPct * 100
              const width = Math.max(0.5, (c.endPct - c.startPct) * 100)
              return (
                <div
                  key={`r-${i}`}
                  className={cn(
                    'absolute inset-y-0 pointer-events-none',
                    c.type === 'op'
                      ? 'bg-amber-300/40'
                      : c.type === 'ed'
                      ? 'bg-sky-300/40'
                      : 'bg-white/30',
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              )
            })}
            {/* Progress — paints over both base + chapter swaths */}
            <div
              className="absolute inset-y-0 left-0 bg-primary rounded-full"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Chapter EDGES — thin vertical ticks at the boundaries so the
              user can see where a chapter starts/ends even after watching. */}
          {chapterRanges.map((c, i) => (
            <span
              key={`e-${i}`}
              title={c.title}
              aria-hidden
              className={cn(
                'absolute top-1/2 -translate-y-1/2 h-2.5 w-px pointer-events-none',
                c.type === 'op' ? 'bg-amber-300' : c.type === 'ed' ? 'bg-sky-300' : 'bg-white/70',
              )}
              style={{ left: `${c.startPct * 100}%` }}
            />
          ))}

          {/* Scrubber knob (visible on hover / scrub) */}
          <div
            className="absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white shadow-[0_0_0_3px_rgba(79,70,229,0.5)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{ left: `calc(${progressPct}% - 8px)` }}
          />

          {/* Hover time tooltip */}
          {hoverTime != null && (
            <div
              className="absolute bottom-full mb-2 -translate-x-1/2 pointer-events-none rounded-md bg-black/90 border border-white/10 px-2 py-1 text-[11px] font-mono text-white whitespace-nowrap"
              style={{ left: `${(hoveredPct ?? 0) * 100}%` }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        {/* Button row */}
        <div className="flex items-center gap-1 text-white">
          <CtrlBtn onClick={togglePlay} label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="h-5 w-5 fill-white" /> : <Play className="h-5 w-5 fill-white" />}
          </CtrlBtn>

          {hasPrevEpisode && (
            <CtrlBtn onClick={onPrevEpisode} label="Previous episode">
              <SkipBack className="h-[18px] w-[18px]" />
            </CtrlBtn>
          )}
          {hasNextEpisode && (
            <CtrlBtn onClick={onNextEpisode} label="Next episode">
              <SkipForward className="h-[18px] w-[18px]" />
            </CtrlBtn>
          )}

          <CtrlBtn onClick={() => seek(-10)} label="Back 10s">
            <RotateCcw className="h-[18px] w-[18px]" />
          </CtrlBtn>
          <CtrlBtn onClick={() => seek(10)} label="Forward 10s">
            <RotateCw className="h-[18px] w-[18px]" />
          </CtrlBtn>

          {/* Volume — hover to reveal slider (Plyr-style) */}
          <div className="group/vol relative flex items-center">
            <CtrlBtn onClick={toggleMute} label={muted ? 'Unmute' : 'Mute'}>
              <VolumeIcon className="h-[18px] w-[18px]" />
            </CtrlBtn>
            <div className="hidden sm:block w-0 group-hover/vol:w-[80px] transition-all overflow-hidden">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => setVolumeAndUnmute(Number(e.target.value))}
                aria-label="Volume"
                className="ml-1 w-[72px] accent-primary cursor-pointer align-middle"
              />
            </div>
          </div>

          {/* Time */}
          <div className="ml-1 text-[12px] font-mono tabular-nums text-white/85">
            {formatTime(currentTime)}
            <span className="text-white/40 mx-1">/</span>
            {formatTime(duration)}
          </div>

          <div className="flex-1" />

          {/* Quality — slider for quick resolution switching */}
          {levels.length > 1 && (() => {
            // Build sorted quality options: [Auto, 360p, 480p, 720p, 1080p, ...]
            const sortedLevels = levels
              .map((l, i) => ({ l, i }))
              .sort((a, b) => (a.l.height ?? 0) - (b.l.height ?? 0))
            const options: Array<{ label: string; levelIndex: number }> = [
              { label: 'Auto', levelIndex: -1 },
              ...sortedLevels.map(({ l, i }) => ({
                label: l.height ? `${l.height}p` : `${Math.round((l.bitrate ?? 0) / 1000)}k`,
                levelIndex: i,
              })),
            ]
            const sliderVal = currentLevel === -1 ? 0 : options.findIndex((o) => o.levelIndex === currentLevel)
            return (
              <div
                className="group/quality-slider relative flex items-center gap-1.5 ml-1"
                title={`Quality · ${currentLevel === -1 ? 'Auto' : levelLabel(levels[currentLevel])}`}
              >
                <MonitorPlay className="h-[16px] w-[16px] shrink-0 text-white/60" />
                <span className="text-[10px] font-mono font-bold text-white/80 min-w-[28px] text-center">
                  {currentLevel === -1 ? 'Auto' : levelLabel(levels[currentLevel])}
                </span>
                <input
                  type="range"
                  min={0}
                  max={options.length - 1}
                  step={1}
                  value={sliderVal >= 0 ? sliderVal : 0}
                  onChange={(e) => {
                    const idx = Number(e.target.value)
                    const opt = options[idx]
                    if (opt) onChangeLevel(opt.levelIndex)
                  }}
                  aria-label="Quality"
                  className="w-0 group-hover/quality-slider:w-[72px] sm:w-[72px] transition-all accent-primary cursor-pointer h-1"
                />
              </div>
            )
          })()}

          {/* Captions */}
          {subtitles.length > 0 && (
            <Menu open={menu === 'captions'} setOpen={(o) => setMenu(o ? 'captions' : null)}>
              <CtrlBtn
                label="Captions"
                onClick={() => setMenu(menu === 'captions' ? null : 'captions')}
                active={activeSubIdx >= 0}
              >
                <Captions className="h-[18px] w-[18px]" />
              </CtrlBtn>
              {menu === 'captions' && (
                <MenuPanel
                  /* The whole panel is a single dropdown; the title bar
                     turns into a back-button when we drill into appearance. */
                  title={captionsTab === 'tracks' ? 'Captions' : undefined}
                  header={captionsTab === 'appearance' && (
                    <button
                      onClick={() => setCaptionsTab('tracks')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-white/70 hover:text-white hover:bg-white/5 border-b border-white/5"
                    >
                      <ArrowLeft className="h-3 w-3" />
                      Appearance
                    </button>
                  )}
                >
                  {captionsTab === 'tracks' ? (
                    <>
                      <MenuItem
                        active={activeSubIdx === -1}
                        onClick={() => { onChangeSubIdx(-1) }}
                      >
                        Off
                      </MenuItem>
                      {subtitles.map((s, i) => (
                        <MenuItem
                          key={s.src}
                          active={activeSubIdx === i}
                          onClick={() => { onChangeSubIdx(i) }}
                        >
                          {s.label}
                        </MenuItem>
                      ))}
                      {/* Appearance entry */}
                      <button
                        onClick={() => setCaptionsTab('appearance')}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-xs text-white/80 hover:bg-white/8 border-t border-white/5"
                      >
                        <span className="inline-flex items-center gap-2">
                          <SlidersHorizontal className="h-3.5 w-3.5 text-white/50" />
                          Appearance
                        </span>
                        <span className="text-white/40 text-[10px]">›</span>
                      </button>
                    </>
                  ) : (
                    <CaptionAppearancePanel />
                  )}
                </MenuPanel>
              )}
            </Menu>
          )}

          {/* PiP */}
          {typeof document !== 'undefined' && document.pictureInPictureEnabled && (
            <CtrlBtn
              onClick={onTogglePiP}
              label={pipActive ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}
              active={pipActive}
            >
              <PictureInPicture2 className="h-[18px] w-[18px]" />
            </CtrlBtn>
          )}

          {/* AirPlay (Safari only) */}
          {hasAirPlay && (
            <CtrlBtn onClick={onTriggerAirPlay} label="AirPlay">
              <Cast className="h-[18px] w-[18px]" />
            </CtrlBtn>
          )}

          {/* Settings (speed + quality + more) */}
          <Menu open={menu === 'settings'} setOpen={(o) => setMenu(o ? 'settings' : null)}>
            <CtrlBtn
              label="Settings"
              onClick={() => setMenu(menu === 'settings' ? null : 'settings')}
            >
              <Settings className="h-[18px] w-[18px]" />
            </CtrlBtn>
            {menu === 'settings' && (
              <MenuPanel>
                <MenuRow label="Speed" value={`${speed}x`}>
                  <SegmentedControl<string>
                    value={String(speed)}
                    options={[
                      { value: '0.5', label: '0.5x' },
                      { value: '0.75', label: '0.75x' },
                      { value: '1', label: '1x' },
                      { value: '1.25', label: '1.25x' },
                      { value: '1.5', label: '1.5x' },
                      { value: '2', label: '2x' },
                    ]}
                    onChange={(v) => setPlaybackSpeed(Number(v))}
                    size="sm"
                  />
                </MenuRow>
                {/* Quality selector is exposed as a dedicated toolbar button
                    (with its own dropdown) for quick access — see the
                    right cluster of the control bar. Keeping the same
                    control here too would be redundant. */}

                {/* Audio track selector (HLS multi-audio) */}
                {audioTracks.length > 1 && (
                  <MenuRow
                    label="Audio"
                    value={audioTracks.find((a) => a.id === currentAudioTrack)?.name || 'Auto'}
                  >
                    <div className="flex flex-wrap gap-1 justify-end">
                      {audioTracks.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => onChangeAudioTrack(a.id)}
                          className={cn(
                            'px-2 py-0.5 rounded text-[10px] font-mono font-bold',
                            currentAudioTrack === a.id
                              ? 'bg-primary text-white'
                              : 'bg-white/8 text-white/70 hover:bg-white/15',
                          )}
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                  </MenuRow>
                )}

                {/* Video fit mode */}
                <MenuRow label="Video fit" value={videoFit}>
                  <SegmentedControl
                    value={videoFit}
                    options={[
                      { value: 'contain', label: 'Contain' },
                      { value: 'cover', label: 'Cover' },
                      { value: 'fill', label: 'Fill' },
                    ]}
                    onChange={(v) => onChangeVideoFit(v as 'contain' | 'cover' | 'fill')}
                    size="sm"
                  />
                </MenuRow>


                {/* Subtitle sync offset */}
                {subtitles.length > 0 && (
                  <MenuRow
                    label="Sub sync"
                    value={`${subtitleOffset > 0 ? '+' : ''}${subtitleOffset.toFixed(1)}s`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={-30}
                        max={30}
                        step={0.5}
                        value={subtitleOffset}
                        onChange={(e) => onChangeSubtitleOffset(Number(e.target.value))}
                        className="w-24 accent-primary"
                        aria-label="Subtitle sync offset"
                      />
                      <button
                        onClick={() => onChangeSubtitleOffset(0)}
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-white/8 text-white/70 hover:bg-white/15"
                      >
                        Reset
                      </button>
                    </div>
                  </MenuRow>
                )}

                {/* Loop toggle */}
                <MenuRow label="Loop" value={loop ? 'On' : 'Off'}>
                  <button
                    onClick={() => onToggleLoop()}
                    className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors',
                      loop
                        ? 'bg-primary text-white'
                        : 'bg-white/8 text-white/70 hover:bg-white/15',
                    )}
                  >
                    {loop ? 'On' : 'Off'}
                  </button>
                </MenuRow>

                {/* Screenshot */}
                <div className="px-3 py-2 border-t border-white/5">
                  <button
                    onClick={captureScreenshot}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-semibold bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white border border-white/8 transition-colors"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Capture screenshot
                  </button>
                </div>

                {/* Copy link to this moment */}
                <div className="px-3 py-2 border-t border-white/5">
                  <button
                    onClick={() => {
                      const t = Math.floor(currentTime)
                      const url = new URL(window.location.href)
                      url.searchParams.set('t', String(t))
                      navigator.clipboard.writeText(url.toString()).then(
                        () => toast?.info?.('Link copied to clipboard', 2000),
                        () => {},
                      )
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-semibold bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white border border-white/8 transition-colors"
                  >
                    <Link className="h-3.5 w-3.5" />
                    Copy link at {formatTime(currentTime)}
                  </button>
                </div>

                {/* Stats overlay toggle */}
                <MenuRow label="Stats" value={statsOverlay ? 'Shown' : 'Hidden'}>
                  <button
                    onClick={() => onToggleStatsOverlay()}
                    className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors',
                      statsOverlay
                        ? 'bg-primary text-white'
                        : 'bg-white/8 text-white/70 hover:bg-white/15',
                    )}
                  >
                    {statsOverlay ? 'On' : 'Off'}
                  </button>
                </MenuRow>
              </MenuPanel>
            )}
          </Menu>

          {/* Theater mode — hidden on small screens (no room for the
              sidebar to begin with). */}
          {onToggleTheaterMode && (
            <span className="hidden lg:inline-flex">
              <CtrlBtn
                onClick={onToggleTheaterMode}
                label={theaterMode ? 'Exit theater mode' : 'Theater mode (T)'}
                active={theaterMode}
              >
                {/* Rectangle icon — narrower when in theater mode (visual cue). */}
                <RectangleHorizontal className={cn('h-[18px] w-[18px]', theaterMode && 'rotate-90')} />
              </CtrlBtn>
            </span>
          )}

          {/* Fullscreen */}
          <CtrlBtn onClick={toggleFullscreen} label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {fullscreen ? <Minimize className="h-[18px] w-[18px]" /> : <Maximize className="h-[18px] w-[18px]" />}
          </CtrlBtn>
        </div>
      </div>
    </div>
  )
}

/* ─── Tiny presentational helpers ─────────────────────────────────── */

function CtrlBtn({
  children, onClick, label, active,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'p-1.5 rounded-md transition-all',
        'hover:bg-white/10 active:scale-95',
        active && 'text-primary',
      )}
    >
      {children}
    </button>
  )
}

function Menu({
  children, open,
}: {
  children: React.ReactNode
  open: boolean
  setOpen: (o: boolean) => void
}) {
  return <div className={cn('relative', open && 'z-20')}>{children}</div>
}

function MenuPanel({
  title, header, children,
}: {
  title?: string
  header?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="absolute bottom-full mb-2 right-0 min-w-[240px] rounded-lg bg-black/92 border border-white/10 shadow-lg overflow-hidden animate-[fadeInUp_0.15s_ease]">
      {header
        ? header
        : title && (
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-white/50 border-b border-white/5">
              {title}
            </div>
          )}
      <div data-lenis-prevent className="py-1 max-h-[320px] overflow-y-auto">{children}</div>
    </div>
  )
}

function MenuItem({
  children, active, onClick,
}: {
  children: React.ReactNode
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between gap-3 px-3 py-2 text-xs transition-colors',
        active ? 'text-primary bg-primary/5' : 'text-white hover:bg-white/8',
      )}
    >
      <span className="truncate">{children}</span>
      {active && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  )
}

function MenuRow({
  label, value, children,
}: {
  label: string
  value?: string
  children: React.ReactNode
}) {
  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-wider font-bold text-white/50">
          {label}
        </span>
        {value && <span className="text-[11px] font-mono text-white/60">{value}</span>}
      </div>
      {children}
    </div>
  )
}

/**
 * Caption appearance controls — font size, color, background, edges,
 * vertical position. All values write to the global useSettings store
 * so they persist across episodes and the actual ::cue styles are
 * injected by the parent VideoPlayer via a <style> tag.
 */
function CaptionAppearancePanel() {
  const captionSize = useSettings((s) => s.captionSize)
  const captionColor = useSettings((s) => s.captionColor)
  const captionBackgroundOpacity = useSettings((s) => s.captionBackgroundOpacity)
  const captionEdgeStrength = useSettings((s) => s.captionEdgeStrength)
  const captionPositionOffset = useSettings((s) => s.captionPositionOffset)
  const setS = useSettings((s) => s.set)

  return (
    <div className="py-2 px-3 space-y-3">
      {/* Font size */}
      <Field label="Font size" value={`${Math.round(captionSize * 100)}%`}>
        <input
          type="range" min={0.7} max={2.0} step={0.1}
          value={captionSize}
          onChange={(e) => setS('captionSize', Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="Caption font size"
        />
      </Field>

      {/* Color */}
      <Field label="Text color" value={captionColor}>
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: '#ffffff', label: 'White' },
            { id: '#fff176', label: 'Yellow' },
            { id: '#80d8ff', label: 'Cyan' },
            { id: '#a5d6a7', label: 'Green' },
            { id: '#ff8a80', label: 'Red' },
          ].map((c) => (
            <button
              key={c.id}
              onClick={() => setS('captionColor', c.id)}
              aria-label={c.label}
              title={c.label}
              className={cn(
                'h-6 w-6 rounded-full border-2 transition-all',
                captionColor === c.id
                  ? 'border-primary scale-110'
                  : 'border-white/15 hover:border-white/40',
              )}
              style={{ background: c.id }}
            />
          ))}
        </div>
      </Field>

      {/* Background opacity */}
      <Field
        label="Background"
        value={`${Math.round(captionBackgroundOpacity * 100)}%`}
      >
        <input
          type="range" min={0} max={1} step={0.05}
          value={captionBackgroundOpacity}
          onChange={(e) => setS('captionBackgroundOpacity', Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="Caption background opacity"
        />
      </Field>

      {/* Edge strength (text shadow) */}
      <Field
        label="Edge / shadow"
        value={`${Math.round(captionEdgeStrength * 100)}%`}
      >
        <input
          type="range" min={0} max={1} step={0.05}
          value={captionEdgeStrength}
          onChange={(e) => setS('captionEdgeStrength', Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="Caption edge strength"
        />
      </Field>

      {/* Vertical position (lift up from bottom) */}
      <Field
        label="Position"
        value={captionPositionOffset === 0 ? 'Default' : `+${captionPositionOffset}%`}
      >
        <input
          type="range" min={0} max={30} step={1}
          value={captionPositionOffset}
          onChange={(e) => setS('captionPositionOffset', Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="Caption vertical position"
        />
      </Field>

      {/* Reset */}
      <button
        onClick={() => {
          setS('captionSize', 1.0)
          setS('captionColor', '#ffffff')
          setS('captionBackgroundOpacity', 0.55)
          setS('captionEdgeStrength', 0.6)
          setS('captionPositionOffset', 0)
        }}
        className="w-full mt-2 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-[11px] text-white/70 hover:text-white border border-white/10"
      >
        Reset to defaults
      </button>

      <p className="text-[10px] text-white/40 leading-snug pt-1 border-t border-white/5">
        <Type className="inline h-2.5 w-2.5 mr-0.5" />
        Changes apply to all videos and persist across sessions.
      </p>
    </div>
  )
}

function Field({
  label, value, children,
}: {
  label: string
  value?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="uppercase tracking-wider font-bold text-white/50">{label}</span>
        {value && <span className="font-mono text-white/60">{value}</span>}
      </div>
      {children}
    </div>
  )
}

// Suppress unused-var warnings for icons re-exported only to give the
// VideoPlayer a single import surface in the future.
const _spare = [ChevronRight, Maximize2]
void _spare
