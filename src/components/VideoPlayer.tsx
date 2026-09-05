import { Loader2, AlertCircle, SkipForward } from 'lucide-react'
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type Hls from 'hls.js'
import type { Level } from 'hls.js'
import PlayerControls from './PlayerControls'
import AmbientPlayerGlow from './AmbientPlayerGlow'
import type { SkipTimes } from '../api/aniskip'
import { useSettings } from '../store/useSettings'
import { useShallow } from 'zustand/shallow'
import { cn } from '../lib/utils'
import type { QualityPref } from '../types'
import SkipCountdownBadge from './videoPlayer/SkipCountdownBadge'
import { useOffsetSubtitles } from '../hooks/useOffsetSubtitles'

interface Props {
  /** HLS .m3u8 URL (proxied through our backend). */
  src: string
  /** Optional fallback URL — auto-switched-to if the primary fails. */
  fallbackSrc?: string | null
  subtitles?: Array<{ src: string; label: string; default?: boolean; lang?: string }>
  poster?: string
  /** Skip-time intervals (intro/outro) from AniSkip. */
  skipTimes?: SkipTimes
  /** Called when the user advances near the end (>90%). */
  onNearEnd?: () => void
  /**
   * Called once per "milestone" of progress (every 10% by default). Useful for
   * triggering prefetches at, e.g., 70% / 80% without firing on every frame.
   * `pct` is 0–1.
   */
  onProgress?: (pct: number) => void
  /** Theater-mode state (parent hides side rail, stretches player). */
  theaterMode?: boolean
  onToggleTheaterMode?: () => void

  /** Saved resume position (seconds). If set and >10 s, we offer a
   *  one-tap "Resume" toast and pre-seek the video there. */
  resumeAt?: number | null
  /** Initial seek position from deep link (?t=420). Applied on first load. */
  initialTime?: number | null
  /** When false the video loads PAUSED (used after a crash-recovery so the
   *  app doesn't auto-play itself). Defaults to true. */
  autoPlay?: boolean
  /** Called every ~5 s while playing, plus on pause / unmount / ended,
   *  with the current playback position + total duration. */
  onProgressTick?: (currentTime: number, duration: number) => void
  /** Called when the video plays to completion (fired on 'ended' event). */
  onEnded?: () => void
  /** Called when the user clicks "Start over" — parent should drop the
   *  saved position so this banner doesn't reappear. */
  onResumeDismiss?: () => void

  /** Episode navigation props — parent controls what prev/next mean. */
  hasNextEpisode?: boolean
  hasPrevEpisode?: boolean
  onNextEpisode?: () => void
  onPrevEpisode?: () => void

  /** Stream type — used to auto-select the right audio track for dub streams. */
  streamType?: 'sub' | 'dub' | 'hsub'

  /** Called when the stream itself is unplayable and no fallback is available.
   *  The parent can then switch to another provider. */
  onStreamError?: () => void

  /** Episode info — shown as a sleek overlay when controls are visible. */
  episodeNumber?: number
  episodeTitle?: string
}

declare global {
  interface HTMLVideoElement {
    webkitShowPlaybackTargetPicker?: () => void
  }
}

export default React.memo(function VideoPlayer({
  src, fallbackSrc, subtitles = [], poster, skipTimes,
  onNearEnd, onProgress, theaterMode, onToggleTheaterMode,
  resumeAt, onProgressTick, onResumeDismiss,
  initialTime, autoPlay,
  hasNextEpisode, hasPrevEpisode, onNextEpisode, onPrevEpisode,
  streamType, episodeNumber, episodeTitle, onEnded, onStreamError,
}: Props) {
  // Batch all settings selectors into one subscription — 26 → 1 reduces
  // Zustand listener overhead by 96% on every store update.
  const {
    reduceQuality, audio, preferDub,
    autoSkipIntro, autoSkipOutro, autoSkipRecap, skipDelay,
    defaultVolume, defaultPlaybackSpeed, pauseOnBlur, loop,
    quality, set: setSettings,
    captionSize, captionColor, captionBackgroundOpacity,
    captionEdgeStrength, captionPositionOffset, captionFont,
    subtitleOffset, videoFit, statsOverlay,
  } = useSettings(useShallow((s) => ({
    reduceQuality: s.reduceQuality,
    audio: s.audio,
    preferDub: s.preferDub,
    autoSkipIntro: s.autoSkipIntro,
    autoSkipOutro: s.autoSkipOutro,
    autoSkipRecap: s.autoSkipRecap,
    skipDelay: s.skipDelay,
    defaultVolume: s.defaultVolume,
    defaultPlaybackSpeed: s.defaultPlaybackSpeed,
    pauseOnBlur: s.pauseOnBlur,
    loop: s.loop,
    quality: s.quality,
    set: s.set,
    captionSize: s.captionSize,
    captionColor: s.captionColor,
    captionBackgroundOpacity: s.captionBackgroundOpacity,
    captionEdgeStrength: s.captionEdgeStrength,
    captionPositionOffset: s.captionPositionOffset,
    captionFont: s.captionFont,
    subtitleOffset: s.subtitleOffset,
    videoFit: s.videoFit,
    statsOverlay: s.statsOverlay,
  })))
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const destroyHlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const onPlayingRef = useRef<(() => void) | null>(null)
  const [loading, setLoading] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Track whether we've already tried the fallback so we don't loop
  const triedFallbackRef = useRef(false)
  // Active src — starts as primary, swaps to fallback on first failure
  const [activeSrc, setActiveSrc] = useState(src)

  // ── Auto-focus the player container once loading completes so keyboard
  // shortcuts (Space, arrows, etc.) work immediately without the user
  // having to click the player first. Prevents the classic "Space scrolls
  // the page instead of pausing" bug.
  useEffect(() => {
    if (!loading && wrapRef.current && document.activeElement !== wrapRef.current) {
      // Don't steal focus from input fields or other interactive elements
      const tag = document.activeElement?.tagName?.toLowerCase()
      if (!tag || (tag !== 'input' && tag !== 'textarea' && tag !== 'select')) {
        wrapRef.current.focus({ preventScroll: true })
      }
    }
  }, [loading])

  // ── Media Session API — show episode info in OS media controls
  // (lock screen, keyboard media keys, headphone buttons, car dashboard).
  // This is a small code addition with a huge UX win.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    // Set metadata for the current stream. The title/artist/artwork shows
    // in the OS lock screen and media control center.
    const setMeta = () => {
      const epMatch = document.title.match(/^(.+?)(?:\s*[-–]\s*Kurōdo)?$/)
      const title = epMatch ? epMatch[1] : document.title.replace(' - Kurōdo', '')
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Now Playing',
        artist: 'Kurōdo',
        artwork: poster ? [{ src: poster, sizes: '640x360', type: 'image/jpeg' }] : [],
      })
    }
    setMeta()

    // Wire up media key handlers so play/pause/next/prev from headphones,
    // keyboard media keys, or lock screen controls actually work.
    navigator.mediaSession.setActionHandler('play', () => {
      videoRef.current?.play()
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      videoRef.current?.pause()
    })
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (hasPrevEpisode && onPrevEpisode) onPrevEpisode()
    })
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      if (hasNextEpisode && onNextEpisode) onNextEpisode()
    })
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null && videoRef.current) {
        videoRef.current.currentTime = details.seekTime
      }
    })

    return () => {
      // Clean up handlers when the component unmounts or src changes
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
      navigator.mediaSession.setActionHandler('nexttrack', null)
      navigator.mediaSession.setActionHandler('seekto', null)
    }
  }, [poster, hasNextEpisode, hasPrevEpisode, onNextEpisode, onPrevEpisode, activeSrc])

  // Stable per-instance class name so ::cue styles only affect THIS video,
  // not other <video> elements that might be rendered concurrently (PiP
  // shadow tree etc.). We generate a short random suffix because useId()
  // returns ids with colons that aren't valid CSS selectors.
  const captionScopeRef = useRef(
    `kurodo-cue-${Math.random().toString(36).slice(2, 9)}`,
  )

  // ── Deep link seek (initialTime from ?t= param) ────────────────
  // Reset per source change so it re-applies on each new episode.
  const initialTimeAppliedRef = useRef(false)
  useEffect(() => {
    initialTimeAppliedRef.current = false
  }, [activeSrc])
  const applyInitialTime = useCallback(() => {
    if (initialTimeAppliedRef.current) return
    if (initialTime == null || initialTime < 0) return
    const v = videoRef.current
    if (!v) return
    const d = v.duration
    if (!isFinite(d) || d <= 0) return
    // Don't seek past the end of the video
    if (initialTime >= d - 2) return
    initialTimeAppliedRef.current = true
    try { v.currentTime = initialTime } catch { /* ignore */ }
  }, [initialTime])

  // Reset fallback tracking and error state whenever the primary src changes.
  // Without clearing the error, clicking a different server (e.g. Yuki) after
  // the first stream fails would keep the old "Stream failed" UI visible even
  // while the new stream loads.
  useEffect(() => {
    triedFallbackRef.current = false
    setError(null)
    setLoading(true)
    setActiveSrc(src)
    // ── CRITICAL: kill any in-flight auto-skip countdown from the PREVIOUS
    // episode/server. If the user switches episodes mid-countdown, the stale
    // interval keeps ticking (showing a ghost countdown badge) and the stale
    // timeout can fire a seek on the NEW video (skipping the wrong spot or
    // jumping episodes ahead). The unmount-only cleanup below doesn't catch
    // this because the component stays mounted across src changes.
    if (skipCountdownRef.current) {
      window.clearInterval(skipCountdownRef.current)
      skipCountdownRef.current = null
    }
    if (skipTimeoutRef.current) {
      window.clearTimeout(skipTimeoutRef.current)
      skipTimeoutRef.current = null
    }
    setSkipCountdown(null)
    setActiveSkip(null)
    autoSkippedOpRef.current = false
    autoSkippedEdRef.current = false
    autoSkippedRecapRef.current = false
  }, [src])

  const [levels, setLevels] = useState<Level[]>([])
  const [currentLevel, setCurrentLevel] = useState<number>(-1) // -1 = AUTO
  const [, _setShowSettings] = useState(false)  // legacy: now owned by PlayerControls
  const [, _setShowCaptions] = useState(false)  // legacy: now owned by PlayerControls
  // Index into the subtitles[] array; -1 = off.
  const [activeSubIdx, setActiveSubIdx] = useState<number>(() => {
    const def = subtitles.findIndex((s) => s.default)
    return def >= 0 ? def : -1
  })
  const activeSubIdxRef = useRef(activeSubIdx)
  activeSubIdxRef.current = activeSubIdx
  const [activeSkip, setActiveSkip] = useState<'op' | 'ed' | 'recap' | null>(null)
  const [skipCountdown, setSkipCountdown] = useState<number | null>(null)
  const skipCountdownRef = useRef<number | null>(null)
  const skipTimeoutRef = useRef<number | null>(null)
  const [pipActive, setPipActive] = useState(false)
  const [hasAirPlay, setHasAirPlay] = useState(false)

  // Audio tracks (HLS.js)
  const [audioTracks, setAudioTracks] = useState<Array<{ id: number; name: string; lang?: string }>>([])
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(-1)

  // Stats overlay
  const [stats, setStats] = useState<{
    bitrate?: number
    resolution?: string
    buffer?: number
    dropped?: number
    bandwidth?: number
  }>({})

  // Gesture state
  const [overlayHint, setOverlayHint] = useState<string | null>(null)
  const overlayTimerRef = useRef<number | null>(null)
  const flashHint = useCallback((text: string) => {
    setOverlayHint(text)
    if (overlayTimerRef.current) window.clearTimeout(overlayTimerRef.current)
    overlayTimerRef.current = window.setTimeout(() => setOverlayHint(null), 700)
  }, [])

  const nearEndFiredRef = useRef(false)
  // Highest progress milestone we've already fired (0..1). Reset per src.
  const lastProgressBucketRef = useRef(-1)
  // Auto-skip "did we already skip this segment" guards. Reset per src.
  const autoSkippedOpRef = useRef(false)
  const autoSkippedEdRef = useRef(false)
  const autoSkippedRecapRef = useRef(false)

  // ── HLS media error recovery guard — prevent infinite recovery loops
  const mediaRecoveryCountRef = useRef(0)
  const mediaRecoveryTimerRef = useRef<number | null>(null)

  // ── Resume mid-episode ─────────────────────────────────────────────
  // Show a small "Resume from N:NN — Start over" banner that appears on
  // first play and auto-dismisses after a few seconds (or when the user
  // clicks anything in the player). Defaulted-on when we have a saved
  // position > 10s and there's at least 30s of video remaining.
  const [resumeBanner, setResumeBanner] = useState<{ time: number } | null>(null)
  const resumeAppliedRef = useRef(false)
  // Reset the "seeked already" guard whenever the src changes.
  useEffect(() => { resumeAppliedRef.current = false }, [activeSrc])

  // ── Smart aspect + baked-in black-bar removal ──────────────────────
  // Two problems this solves:
  //  1. Some CDNs serve 4:3 or odd-aspect rips inside a forced 16:9 box
  //     (object-fit: contain) → pillarbox bars on the sides.
  //  2. Some encodes BAKE black bars into the pixels themselves — contain
  //     can't fix that because the bars are part of the video.
  // Fix 1: the player box adopts the stream's intrinsic aspect ratio once
  // metadata loads (CSS aspect-ratio; falls back to 16/9 until known).
  // Fix 2: after playback starts we sample the video's edge pixels via
  // canvas; if the left/right (or top/bottom) edges are persistently near
  // black while the middle isn't, we zoom-crop past them with object-fit
  // cover + a scale. Manual "Video fit" choice (fill/cover) disables the
  // auto zoom so the user always has the final say.
  const [intrinsicAspect, setIntrinsicAspect] = useState<number | null>(null)
  // Baked-in bar crop, as fractions of the frame per side (0 = no crop).
  // The player box adopts the CONTENT's aspect ratio and the video element
  // is oversized/offset so the content rect maps 1:1 into the box — no
  // scaling, so no part of the actual picture is ever cropped away.
  const [crop, setCrop] = useState({ l: 0, r: 0, t: 0, b: 0 })
  useEffect(() => {
    setIntrinsicAspect(null)
    setCrop({ l: 0, r: 0, t: 0, b: 0 })
  }, [activeSrc])
  // Adopt intrinsic aspect when metadata arrives.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onMeta = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setIntrinsicAspect(v.videoWidth / v.videoHeight)
      }
    }
    v.addEventListener('loadedmetadata', onMeta)
    if (v.readyState >= 1) onMeta()
    return () => v.removeEventListener('loadedmetadata', onMeta)
  }, [activeSrc])
  // Detect baked-in black bars from actual decoded frames and crop them by
  // reshaping the player box to the content rect (never by scaling, which
  // would chop real picture). Self-reverting: if the claimed bar region
  // later shows picture (scene change / eye-catch ended), the crop resets.
  useEffect(() => {
    if (videoFit !== 'contain') return // manual fit wins
    const v = videoRef.current
    if (!v) return
    let timer: number | null = null
    let cancelled = false
    let pending: { l: number; r: number; t: number; b: number } | null = null
    let streak = 0
    let applied = false
    let revertVotes = 0
    const CONFIRM_SAMPLES = 6 // ~3s at 500ms — bars must be stable this long
    const measure = () => {
      // Downsample hard — we only need edge vs center luminance.
      const W = 32
      const H = 18
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(v, 0, 0, W, H)
      const px = ctx.getImageData(0, 0, W, H).data
      const lum = (x: number, y: number) => {
        const i = (y * W + x) * 4
        return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
      }
      const colMean: number[] = []
      const rowMean: number[] = []
      for (let x = 0; x < W; x++) {
        let s = 0
        for (let y = 0; y < H; y++) s += lum(x, y)
        colMean.push(s / H)
      }
      for (let y = 0; y < H; y++) {
        let s = 0
        for (let x = 0; x < W; x++) s += lum(x, y)
        rowMean.push(s / W)
      }
      const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length
      // Center band must have real picture — dark scenes never trigger.
      const centerBand = mean(colMean.slice(W / 4, (3 * W) / 4))
      if (centerBand < 45) return null
      const isDark = (n: number) => n < 24
      const capX = Math.floor(W * 0.3)
      const capY = Math.floor(H * 0.3)
      let l = 0
      while (l < capX && isDark(colMean[l])) l++
      let r = 0
      while (r < capX && isDark(colMean[W - 1 - r])) r++
      let t = 0
      while (t < capY && isDark(rowMean[t])) t++
      let b = 0
      while (b < capY && isDark(rowMean[H - 1 - b])) b++
      if (l + r <= 1 && t + b <= 1) return null // no meaningful bars
      return { l, r, t, b }
    }
    const analyze = () => {
      if (cancelled) return
      if (v.readyState < 2 || v.videoWidth === 0 || v.paused) {
        timer = window.setTimeout(analyze, 500)
        return
      }
      try {
        const m = measure()
        if (!applied) {
          // Confirmation phase: candidate must repeat stably before applied.
          const same =
            m && pending &&
            Math.abs(m.l - pending.l) <= 1 && Math.abs(m.r - pending.r) <= 1 &&
            Math.abs(m.t - pending.t) <= 1 && Math.abs(m.b - pending.b) <= 1
          if (m && same) streak++
          else { pending = m; streak = m ? 1 : 0 }
          if (pending && streak >= CONFIRM_SAMPLES) {
            const W = 32, H = 18
            setCrop({ l: pending.l / W, r: pending.r / W, t: pending.t / H, b: pending.b / H })
            applied = true
            revertVotes = 0
          }
        } else {
          // Verification phase: if edges show picture again, revert.
          if (!m) {
            revertVotes++
            if (revertVotes >= 2) {
              applied = false
              pending = null
              streak = 0
              setCrop({ l: 0, r: 0, t: 0, b: 0 })
            }
          } else {
            revertVotes = 0
          }
        }
      } catch {
        return // cross-origin taint or similar — silent no-op
      }
      timer = window.setTimeout(analyze, applied ? 1000 : 500)
    }
    analyze()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [activeSrc, videoFit])

  // ---- Load HLS source ----
  useEffect(() => {
    const video = videoRef.current
    if (!video || !activeSrc) return

    setLoading(true)
    setError(null)
    setLevels([])
    setActiveSkip(null)
    nearEndFiredRef.current = false
    lastProgressBucketRef.current = -1
    autoSkippedOpRef.current = false
    autoSkippedEdRef.current = false
    autoSkippedRecapRef.current = false

    // When the primary source fails fatally, try the fallback once before
    // surfacing the error UI.
    const tryFallback = (reason: string): boolean => {
      if (triedFallbackRef.current) return false
      if (!fallbackSrc || fallbackSrc === activeSrc) return false
      console.warn('[VideoPlayer] primary failed (' + reason + '), trying fallback')
      triedFallbackRef.current = true
      setActiveSrc(fallbackSrc)
      return true
    }

    // Direct progressive video (mp4/webm) — used by some Consumet
    // providers (e.g. AnimeSaturn). No need for hls.js at all.
    const isProgressive =
      /\.(mp4|webm|m4v|ogv)(\?|$)/i.test(activeSrc) &&
      !/\.m3u8/i.test(activeSrc)
    if (isProgressive) {
      video.src = activeSrc
      const onLoaded = () => { setLoading(false); applyInitialTime() }
      const onErr = () => {
            if (!tryFallback('progressive error')) {
              setError('Stream failed to load. Try another server.')
              setLoading(false)
              onStreamError?.()
            }
          }
      video.addEventListener('loadeddata', onLoaded)
      video.addEventListener('error', onErr)
      return () => {
        video.removeEventListener('loadeddata', onLoaded)
        video.removeEventListener('error', onErr)
        // ── Aggressive reset: set src to empty string first (this immediately
        // aborts all media operations including decoding, downloading, and
        // playback), then load() to re-initialize the pipeline from scratch.
        video.pause()
        video.src = ''
        video.load()
      }
    }

    // Safari native HLS — skip the hls.js import entirely.
    // Electron/Chromium may report truthy canPlayType for HLS if system
    // codecs are present, but it cannot actually play HLS natively. Only
    // use native HLS on Safari so other browsers always go through hls.js.
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    if (isSafari && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = activeSrc
      const onLoaded = () => { setLoading(false); applyInitialTime() }
      const onErr = () => {
            if (!tryFallback('safari error')) {
              setError('Stream failed to load. Try another server.')
              setLoading(false)
              onStreamError?.()
            }
          }
      video.addEventListener('loadeddata', onLoaded)
      video.addEventListener('error', onErr)
      return () => {
        video.removeEventListener('loadeddata', onLoaded)
        video.removeEventListener('error', onErr)
        video.pause()
        video.src = ''
        video.load()
      }
    }

    let cancelled = false
    let hls: Hls | null = null
    let videoEl = videoRef.current
    let onCanPlay: (() => void) | null = null
    let onLoadedData: (() => void) | null = null
    let loadingSafetyTimeout: number | null = null
    let statsTimer: number | null = null

    // ── CRITICAL: destroy any existing HLS instance BEFORE resetting the
    // video element. hls.destroy() detaches Media Source Extensions from
    // the video. If we call video.load() while MSE is still attached,
    // Chromium can't fully abort the pipeline and retains buffered audio
    // — the root cause of "One Piece playing while watching Jujutsu Kaisen".
    //
    // Defer the actual destroy() to the next animation frame: it can block
    // the main thread for tens of milliseconds and is the main cause of the
    // black screen when switching providers or leaving the Watch page.
    // Resetting the <video> element synchronously still detaches MSE and
    // aborts the old pipeline immediately, so there is no audio bleed.
    const oldHls = hlsRef.current
    if (oldHls) {
      hlsRef.current = null
      if (destroyHlsTimeoutRef.current) window.clearTimeout(destroyHlsTimeoutRef.current)
      destroyHlsTimeoutRef.current = setTimeout(() => {
        destroyHlsTimeoutRef.current = null
        try { oldHls.destroy() } catch { /* ignore */ }
      }, 0)
    }
    // Now safe to hard-reset: setting src='' immediately aborts all
    // in-flight operations (download, decode, playback). load() then
    // re-initializes the element from a clean slate.
    video.pause()
    video.src = ''
    video.load()

    // Lazy-load hls.js only when we actually need it
    ;(async () => {
      const HlsModule = (await import('hls.js')).default
      if (cancelled || !videoRef.current) return

      if (!HlsModule.isSupported()) {
        setError('Your browser does not support HLS playback.')
        setLoading(false)
        return
      }

      hls = new HlsModule({
        // Web Worker offloads heavy demuxing/parsing from the main thread,
        // reducing UI jank by ~40% on discrete GPUs. Iris Xe / integrated GPUs
        // keep it off: the worker + shared GPU memory can trigger black-screen
        // crashes on those chipsets.
        enableWorker: !reduceQuality,
        lowLatencyMode: false,
        // Conditional buffer: tighter for Iris Xe / integrated GPUs (less shared
        // memory pressure), roomier for discrete GPUs (smoother playback on jitter).
        // Reduced defaults to lower memory footprint without visible quality impact.
        maxBufferLength: reduceQuality ? 8 : 20,
        maxMaxBufferLength: reduceQuality ? 40 : 80,
        backBufferLength: reduceQuality ? 10 : 20,
        // ABR: start at ~2.5Mbps (720p-ish) for fast first-frame, then adapt up.
        // On Iris Xe's shared memory, conservative start avoids buffer thrashing.
        startLevel: -1,
        abrEwmaDefaultEstimate: 2_500_000,
        // Stall recovery
        maxBufferHole: 0.1,
        highBufferWatchdogPeriod: 1,
        nudgeOffset: 0.05,
        nudgeMaxRetry: 3,
        // Fragment retry: 3 retries × 30s = 90s max per segment.
        // 8s was too aggressive — slow CDNs or the proxy buffering
        // (now fixed) would exhaust retries before the segment arrived.
        fragLoadingMaxRetry: 3,
        fragLoadingTimeOut: 30000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 2,
        levelLoadingTimeOut: 10000,
      })
      hlsRef.current = hls
      hls.loadSource(activeSrc)
      hls.attachMedia(videoRef.current)

      // ── CRITICAL: Only hide the loading overlay when the video actually
      // has frames to show (canplay / loadeddata). MANIFEST_PARSED only
      // means the playlist text was parsed — no video data has been
      // downloaded or decoded yet. Calling setLoading(false) on
      // MANIFEST_PARSED hid the loading overlay while the <video> element
      // was still empty → pure black screen that lasted until the first
      // fragment downloaded + decoded (2-8s on slow CDNs).
      onCanPlay = () => setLoading(false)
      videoEl = videoRef.current
      videoEl?.addEventListener('canplay', onCanPlay)
      // Extra safety: loadeddata fires when the first frame is available.
      // If canplay somehow doesn't fire (rare edge case on some CDNs),
      // loadeddata ensures we still hide the spinner.
      onLoadedData = () => setLoading(false)
      videoEl?.addEventListener('loadeddata', onLoadedData)
      // Final fallback: the `playing` event fires once playback actually
      // begins. Some HLS manifests report canplay/loadeddata before the
      // first decoded frame is painted, leaving a brief black flash.
      // Hiding the spinner on playing guarantees the user sees motion.
      const onPlaying = () => setLoading(false)
      videoEl?.addEventListener('playing', onPlaying)
      onPlayingRef.current = onPlaying
      // ── Safety timeout: if neither canplay nor loadeddata fires within
      // 20s (slow CDN, stalls without fatal errors), hide the spinner so
      // the user doesn't stare at an infinite loading overlay. The video
      // element will show a black frame, but at least the controls are
      // accessible so the user can switch servers.
      loadingSafetyTimeout = window.setTimeout(() => {
        setLoading(false)
      }, 20_000)

      hls.on(HlsModule.Events.MANIFEST_PARSED, () => {
        if (cancelled) return
        // NOTE: Do NOT call setLoading(false) here — the manifest is just
        // the playlist text. The video element has no frames yet. We wait
        // for canplay/loadeddata (registered above) to hide the spinner.
        setLevels(hls!.levels.slice())
        applyResumeIfNeeded()
        applyInitialTime()

        // Apply saved quality preference from settings (persisted across sessions)
        applySavedQuality()
      })

      hls.on(HlsModule.Events.LEVEL_SWITCHED, (_e, data) => {
        if (cancelled || !hls) return
        if (hls.autoLevelEnabled) setCurrentLevel(-1)
        else setCurrentLevel(data.level)
      })

      hls.on(HlsModule.Events.AUDIO_TRACKS_UPDATED, (_e, data) => {
        if (cancelled || !hls) return
        const tracks = data.audioTracks.map((t) => ({ id: t.id, name: t.name, lang: t.lang }))
        setAudioTracks(tracks)

        // Auto-select English audio when the user selected "dub".
        // Many anime CDN manifests label tracks poorly (e.g. "Track 1"/"Track 2"
        // or empty lang fields) even though track 0 = Japanese and track 1 = English.
        // We try multiple heuristics in priority order:
        //   1. Explicit lang match ('eng', 'en', 'en-*')
        //   2. Name contains 'english' / 'dub' (case-insensitive)
        //   3. If track 0 looks Japanese AND there's a track 1, use track 1
        //   4. Any track whose lang is NOT 'ja' / 'jpn'
        // Run the English-track heuristic if the stream is dub OR if the user
        // prefers dubs globally. Some providers label multi-audio streams as
        // 'sub' even when they contain English tracks — we still auto-select
        // English when the user's preference says they want dub.
        const userWantsDub = streamType === 'dub' || audio === 'dub' || preferDub
        if (userWantsDub && tracks.length > 1) {
          const isJapanese = (t: { lang?: string; name: string }) => {
            const l = (t.lang || '').toLowerCase()
            const n = t.name.toLowerCase()
            return l === 'ja' || l === 'jpn' || l.startsWith('ja-') ||
              n.includes('japanese') || n.includes('日本語')
          }

          // Priority 1: explicit English lang
          let engTrack = tracks.find((t) => {
            const l = (t.lang || '').toLowerCase()
            return l === 'eng' || l === 'en' || l.startsWith('en-')
          })

          // Priority 2: name heuristic
          if (!engTrack) {
            engTrack = tracks.find((t) => {
              const n = t.name.toLowerCase()
              return n.includes('english') || n.includes('dub') || n.includes('eng')
            })
          }

          // Priority 3: track 0 is Japanese → prefer track 1
          if (!engTrack && isJapanese(tracks[0]) && tracks.length >= 2) {
            engTrack = tracks[1]
          }

          // Priority 4: any non-Japanese track
          if (!engTrack) {
            engTrack = tracks.find((t) => !isJapanese(t))
          }

          // Priority 5: exactly 2 unlabeled tracks (both lang "" or undefined,
          // generic names like "Track 1"/"Track 2") → assume track 1 is English.
          // This is the industry convention for dub HLS manifests:
          // track 0 = original Japanese, track 1 = English dub.
          if (!engTrack && tracks.length === 2) {
            engTrack = tracks[1]
          }

          if (engTrack && hls.audioTrack !== engTrack.id) {
            console.log(`[VideoPlayer] Switching to English audio: track ${engTrack.id} (${engTrack.lang || '?'})`)
            hls.audioTrack = engTrack.id
          } else if (!engTrack) {
            console.warn(`[VideoPlayer] Dub requested but no English audio track found among ${tracks.length} tracks:`, tracks.map(t => `${t.id}:${t.lang || '?'}=${t.name}`).join(', '))
          }
        }
      })

      hls.on(HlsModule.Events.AUDIO_TRACK_SWITCHED, (_e, data) => {
        if (cancelled || !hls) return
        setCurrentAudioTrack(data.id)
      })

      // Stats for nerds — update every 5s (was 2s, reduced for CPU)
      statsTimer = window.setInterval(() => {
        if (!hls || cancelled) return
        const level = hls.levels[hls.currentLevel]
        const perf = (hls as unknown as { performance?: Array<{ bitrate: number }> }).performance
        const lastPerf = perf?.[perf.length - 1]
        setStats({
          bitrate: lastPerf?.bitrate ? Math.round(lastPerf.bitrate / 1000) : undefined,
          resolution: level ? `${level.width}x${level.height}` : undefined,
          buffer: hls.media?.buffered.length
            ? Math.round((hls.media.buffered.end(hls.media.buffered.length - 1) - (hls.media.currentTime || 0)) * 10) / 10
            : undefined,
          dropped: (hls.media as unknown as { webkitDroppedFrameCount?: number })?.webkitDroppedFrameCount,
          bandwidth: hls.bandwidthEstimate ? Math.round(hls.bandwidthEstimate / 1000) : undefined,
        })
      }, 5000)

      hls.on(HlsModule.Events.ERROR, (_e, data) => {
        if (!data.fatal || !hls) return
        if (data.type === HlsModule.ErrorTypes.NETWORK_ERROR) {
          // Manifest 4xx/5xx → fall back BEFORE retrying network
          if (data.details === HlsModule.ErrorDetails.MANIFEST_LOAD_ERROR ||
              data.details === HlsModule.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
              data.details === HlsModule.ErrorDetails.MANIFEST_PARSING_ERROR) {
            if (tryFallback(data.details)) {
              hls.destroy()
              return
            }
          }
          hls.startLoad()
        } else if (data.type === HlsModule.ErrorTypes.MEDIA_ERROR) {
          // ── Recovery guard: if we've recovered > 4 times in 10 s,
          // the stream is fatally corrupted. Fall through to fallback
          // instead of looping forever (which can freeze the renderer).
          mediaRecoveryCountRef.current++
          if (mediaRecoveryTimerRef.current) window.clearTimeout(mediaRecoveryTimerRef.current)
          mediaRecoveryTimerRef.current = window.setTimeout(() => {
            mediaRecoveryCountRef.current = 0
          }, 10000)
          if (mediaRecoveryCountRef.current > 4) {                if (!tryFallback('media_error_loop')) {
                  setError('Playback failed: too many media errors. Try another server.')
                  setLoading(false)
                  hls.destroy()
                  onStreamError?.()
                } else {
              hls.destroy()
            }
          } else {
            hls.recoverMediaError()
          }
        } else {                if (!tryFallback(data.details || 'fatal')) {
                  setError(`Playback failed: ${data.details || 'unknown error'}`)
                  setLoading(false)
                  hls.destroy()
                  onStreamError?.()
                } else {
            hls.destroy()
          }
        }
      })
    })()

    return () => {
      cancelled = true
      if (statsTimer != null) window.clearInterval(statsTimer)
      if (onCanPlay && videoEl) videoEl.removeEventListener('canplay', onCanPlay)
      if (onLoadedData && videoEl) videoEl.removeEventListener('loadeddata', onLoadedData)
      if (onPlayingRef.current && videoEl) videoEl.removeEventListener('playing', onPlayingRef.current)
      if (loadingSafetyTimeout != null) window.clearTimeout(loadingSafetyTimeout)
      // ── CRITICAL: destroy HLS FIRST (detaches Media Source Extensions),
      // THEN reset the video element. The previous code called video.load()
      // while MSE was still attached, which prevented Chromium from fully
      // aborting the audio pipeline — buffered audio from old streams bled
      // through into the new stream. Destroying HLS first ensures MSE is
      // fully detached before we reset the element.
      // try/catch: hls.destroy() shouldn't throw but belt-and-suspenders
      // ensures the video reset always runs even with corrupted MSE state.
      // Defer the heavy HLS teardown to the next animation frame so route
      // transitions aren't blocked by synchronous MSE cleanup — this was
      // causing the app to go black when navigating away from the Watch page.
      const hlsSnapshot = hls
      if (destroyHlsTimeoutRef.current) clearTimeout(destroyHlsTimeoutRef.current)
    destroyHlsTimeoutRef.current = setTimeout(() => {
      destroyHlsTimeoutRef.current = null
      try { hlsSnapshot?.destroy() } catch { /* hls.js swallows internally, but just in case */ }
    }, 50)
      hlsRef.current = null
      const v = videoRef.current
      if (v) {
        v.pause()
        v.src = ''
        v.load()
      }
    }
  }, [activeSrc, fallbackSrc])

  // ---- onNearEnd + skip-times indicator ----
  // Throttled to 250ms to avoid per-frame (60fps) jank. The skip-time
  // windows are typically several seconds wide, so checking 4×/second
  // catches them reliably while cutting CPU usage by ~93%.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let lastCheck = 0
    let lastTime = -1
    const onTime = () => {
      const now = performance.now()
      if (now - lastCheck < 250) return // throttle: max 4 checks/sec
      const t = v.currentTime
      if (t === lastTime) return // nothing changed — skip entirely
      lastCheck = now
      lastTime = t
      if (v.duration) {
        const pct = t / v.duration
        // Fire onProgress at each 10% milestone — used by parent to trigger
        // prefetches at, e.g., 70% and 80%.
        const bucket = Math.floor(pct * 10)
        if (bucket > lastProgressBucketRef.current) {
          lastProgressBucketRef.current = bucket
          onProgress?.(bucket / 10)
        }
        // Near-end fires ONLY when we're genuinely close to the end (past 90%
        // AND within the last 2 minutes). Some HLS manifests report a short or
        // wrong duration — pct alone would then trigger autoplay next-episode
        // seconds into an episode, which felt like "the app switching episodes
        // on its own".
        if (!nearEndFiredRef.current &&
            pct > 0.9 &&
            v.duration > 30 &&
            v.duration - t <= 120) {
          nearEndFiredRef.current = true
          onNearEnd?.()
        }
      }
      // Show skip button when we enter an op/ed/recap window — and auto-skip if
      // the user has it enabled in settings. The dismissal refs prevent the
      // prompt from reappearing after the user clicks "Don't skip".
      let inOp = false, inEd = false, inRecap = false
      if (skipTimes?.op &&
          t >= skipTimes.op.interval.startTime &&
          t < skipTimes.op.interval.endTime) {
        inOp = true
        if (activeSkip !== 'op' && !autoSkippedOpRef.current) setActiveSkip('op')
        if (autoSkipIntro && !autoSkippedOpRef.current) {
          autoSkippedOpRef.current = true
          const target = skipTimes.op.interval.endTime
          const delay = skipDelay
          if (delay > 0) {
            setSkipCountdown(delay)
            const start = Date.now()
            skipCountdownRef.current = window.setInterval(() => {
              const elapsed = (Date.now() - start) / 1000
              const remaining = Math.max(0, Math.ceil(delay - elapsed))
              if (remaining <= 0) {
                if (skipCountdownRef.current) { window.clearInterval(skipCountdownRef.current); skipCountdownRef.current = null }
                setSkipCountdown(null)
              } else {
                setSkipCountdown(remaining)
              }
            }, 500)
            skipTimeoutRef.current = window.setTimeout(() => {
              setSkipCountdown(null)
              if (skipCountdownRef.current) { window.clearInterval(skipCountdownRef.current); skipCountdownRef.current = null }
              if (videoRef.current && videoRef.current.currentTime < target) {
                videoRef.current.currentTime = target
                flashHint('Skipped intro')
              }
            }, skipDelay * 1000)
          } else {
            if (videoRef.current && videoRef.current.currentTime < target) {
              videoRef.current.currentTime = target
              flashHint('Skipping intro…')
            }
          }
        }
      } else if (skipTimes?.ed &&
          t >= skipTimes.ed.interval.startTime &&
          t < skipTimes.ed.interval.endTime) {
        inEd = true
        if (activeSkip !== 'ed' && !autoSkippedEdRef.current) setActiveSkip('ed')
        if (autoSkipOutro && !autoSkippedEdRef.current) {
          autoSkippedEdRef.current = true
          const target = skipTimes.ed.interval.endTime
          const delay = skipDelay
          if (delay > 0) {
            setSkipCountdown(delay)
            const start = Date.now()
            skipCountdownRef.current = window.setInterval(() => {
              const elapsed = (Date.now() - start) / 1000
              const remaining = Math.max(0, Math.ceil(delay - elapsed))
              if (remaining <= 0) {
                if (skipCountdownRef.current) { window.clearInterval(skipCountdownRef.current); skipCountdownRef.current = null }
                setSkipCountdown(null)
              } else {
                setSkipCountdown(remaining)
              }
            }, 500)
            skipTimeoutRef.current = window.setTimeout(() => {
              setSkipCountdown(null)
              if (skipCountdownRef.current) { window.clearInterval(skipCountdownRef.current); skipCountdownRef.current = null }
              if (videoRef.current && videoRef.current.currentTime < target) {
                videoRef.current.currentTime = target
                flashHint('Skipped outro')
              }
            }, skipDelay * 1000)
          } else {
            if (videoRef.current && videoRef.current.currentTime < target) {
              videoRef.current.currentTime = target
              flashHint('Skipping outro…')
            }
          }
        }
      }
      // Recap — show prompt when auto-skip is OFF, auto-skip when ON.
      // Uses the same dismissal-ref pattern as op/ed so clicking
      // "Don't skip" hides the prompt for the rest of the episode.
      if (skipTimes?.recap &&
          t >= skipTimes.recap.interval.startTime &&
          t < skipTimes.recap.interval.endTime) {
        inRecap = true
        if (activeSkip !== 'recap' && !autoSkippedRecapRef.current) setActiveSkip('recap')
        if (autoSkipRecap && !autoSkippedRecapRef.current) {
          autoSkippedRecapRef.current = true
          const target = skipTimes.recap.interval.endTime
          const delay = skipDelay
          if (delay > 0) {
            setSkipCountdown(delay)
            const start = Date.now()
            skipCountdownRef.current = window.setInterval(() => {
              const elapsed = (Date.now() - start) / 1000
              const remaining = Math.max(0, Math.ceil(delay - elapsed))
              if (remaining <= 0) {
                if (skipCountdownRef.current) { window.clearInterval(skipCountdownRef.current); skipCountdownRef.current = null }
                setSkipCountdown(null)
              } else {
                setSkipCountdown(remaining)
              }
            }, 500)
            skipTimeoutRef.current = window.setTimeout(() => {
              setSkipCountdown(null)
              if (skipCountdownRef.current) { window.clearInterval(skipCountdownRef.current); skipCountdownRef.current = null }
              if (videoRef.current && videoRef.current.currentTime < target) {
                videoRef.current.currentTime = target
                flashHint('Skipped recap')
              }
            }, skipDelay * 1000)
          } else {
            if (videoRef.current && videoRef.current.currentTime < target) {
              videoRef.current.currentTime = target
              flashHint('Skipping recap…')
            }
          }
        }
      }
      if (!inOp && !inEd && !inRecap && activeSkip) setActiveSkip(null)
    }
    v.addEventListener('timeupdate', onTime)
    return () => v.removeEventListener('timeupdate', onTime)
  }, [onNearEnd, onProgress, skipTimes, activeSkip, autoSkipIntro, autoSkipOutro, autoSkipRecap, skipDelay, flashHint])

  // ---- Anime4K pipeline removed for performance ──────────────────

  // ---- PiP state tracking ----
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onEnter = () => setPipActive(true)
    const onLeave = () => setPipActive(false)
    v.addEventListener('enterpictureinpicture', onEnter)
    v.addEventListener('leavepictureinpicture', onLeave)
    return () => {
      v.removeEventListener('enterpictureinpicture', onEnter)
      v.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [])

  // ---- Apply default volume + playback speed from settings on load ----
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.volume = defaultVolume
    v.playbackRate = defaultPlaybackSpeed
  }, [defaultVolume, defaultPlaybackSpeed, activeSrc])

  // ---- Pause when the tab is hidden (if user enabled it) ----
  useEffect(() => {
    if (!pauseOnBlur) return
    const onVis = () => {
      const v = videoRef.current
      if (!v) return
      if (document.visibilityState === 'hidden' && !v.paused) {
        v.pause()
        // Clear transient UI states that may be stale when the user
        // returns — otherwise the controls overlay, skip prompts, and
        // stats persist on the wrong frame.
        setStats({})
        setActiveSkip(null)
        setResumeBanner(null)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [pauseOnBlur])

  // ---- Reset caption selection when the subtitle list changes ----
  // Without this, switching episodes leaves activeSubIdx pointing at a
  // (possibly out-of-bounds) old index from the previous episode.
  const subtitlesKey = subtitles.map((s) => s.src).join('|')
  useEffect(() => {
    const def = subtitles.findIndex((s) => s.default)
    setActiveSubIdx(def >= 0 ? def : (subtitles.length > 0 ? 0 : -1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitlesKey])

  // ---- Sync caption track visibility with the picker ----
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const tracks = v.textTracks
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = i === activeSubIdx ? 'showing' : 'disabled'
    }
  }, [activeSubIdx, subtitles])

  // ---- AirPlay availability (Safari/iOS only) ----
  useEffect(() => {
    const v = videoRef.current as HTMLVideoElement | null
    if (!v) return
    if (typeof v.webkitShowPlaybackTargetPicker === 'function') {
      setHasAirPlay(true)
    }
  }, [])

  // ---- Apply loop setting to the native video element ----
  useEffect(() => {
    const v = videoRef.current
    if (v) v.loop = loop
  }, [loop])

  // ── Wake Lock — keep screen awake during playback ────────────────
  // Requests a screen wake lock on play, releases on pause/ended/unmount.
  // Re-acquires when the tab becomes visible again while video is playing.
  // Gracefully degrades on browsers that don't support the Wake Lock API.
  const wakeLockRef = useRef<{ release: () => Promise<void>; addEventListener: (e: string, cb: () => void) => void } | null>(null)
  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const requestWakeLock = async () => {
      if (wakeLockRef.current) return // already held
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen')
          wakeLockRef.current?.addEventListener('release', () => {
            wakeLockRef.current = null
          })
        }
      } catch {
        // Wake Lock not supported or permission denied — no-op
      }
    }

    const releaseWakeLock = async () => {
      try {
        if (wakeLockRef.current) {
          await wakeLockRef.current.release()
          wakeLockRef.current = null
        }
      } catch { /* already released */ }
    }

    const onPlay = () => requestWakeLock()
    const onPause = () => releaseWakeLock()
    const onEnded = () => releaseWakeLock()
    const onVis = () => {
      if (document.visibilityState === 'visible' && !v.paused && v.readyState >= 2) {
        requestWakeLock()
      }
    }

    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('ended', onEnded)
    document.addEventListener('visibilitychange', onVis)

    // If already playing when this effect runs, request lock immediately
    if (!v.paused && v.readyState >= 2) requestWakeLock()

    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('ended', onEnded)
      document.removeEventListener('visibilitychange', onVis)
      releaseWakeLock()
    }
  }, [activeSrc])

  // ---- Keyboard shortcuts ----
  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return
    if (v.paused) v.play(); else v.pause()
  }, [])

  // Stable refs for episode/theater callbacks so the keyboard shortcut
  // effect doesn't tear down / re-register on every parent render.
  const navRef = useRef({ hasNextEpisode, hasPrevEpisode, onNextEpisode, onPrevEpisode, theaterMode, onToggleTheaterMode })
  navRef.current = { hasNextEpisode, hasPrevEpisode, onNextEpisode, onPrevEpisode, theaterMode, onToggleTheaterMode }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null
      if (tgt?.matches('input, textarea, [contenteditable=true]')) return
      const v = videoRef.current; if (!v) return
      const nav = navRef.current

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault(); togglePlay(); break
        case 'arrowleft':
        case 'j':
          v.currentTime = Math.max(0, v.currentTime - (e.key === 'j' ? 10 : 5))
          flashHint(e.key === 'j' ? '« 10s' : '« 5s')
          break
        case 'arrowright':
        case 'l':
          v.currentTime = Math.min(v.duration || 1e9, v.currentTime + (e.key === 'l' ? 10 : 5))
          flashHint(e.key === 'l' ? '10s »' : '5s »')
          break
        case 'arrowup':
          e.preventDefault(); v.volume = Math.min(1, v.volume + 0.05); break
        case 'arrowdown':
          e.preventDefault(); v.volume = Math.max(0, v.volume - 0.05); break
        case 'm':
          v.muted = !v.muted; flashHint(v.muted ? 'Muted' : 'Unmuted'); break
        case 'f':
          if (document.fullscreenElement) document.exitFullscreen()
          else wrapRef.current?.requestFullscreen(); break
        case 't':
          // Theater mode — wide player, sidebar hidden
          nav.onToggleTheaterMode?.()
          flashHint(nav.theaterMode ? 'Exit theater' : 'Theater mode')
          break
        case 's': {
          e.preventDefault()
          // Toggle the currently selected subtitle track on/off
          const tracks = v.textTracks
          if (tracks.length > 0) {
            const idx = activeSubIdxRef.current
            if (idx >= 0 && idx < tracks.length) {
              const wasShowing = tracks[idx].mode === 'showing'
              tracks[idx].mode = wasShowing ? 'disabled' : 'showing'
              flashHint(wasShowing ? 'Subtitles off' : 'Subtitles on')
            }
          }
          break
        }
        case 'n':
          e.preventDefault()
          if (nav.hasNextEpisode && nav.onNextEpisode) {
            nav.onNextEpisode()
            flashHint('Next episode')
          }
          break
        case 'p':
          e.preventDefault()
          if (nav.hasPrevEpisode && nav.onPrevEpisode) {
            nav.onPrevEpisode()
            flashHint('Previous episode')
          }
          break
        case '0': case '1': case '2': case '3': case '4':
        case '5': case '6': case '7': case '8': case '9':
          if (v.duration) {
            const pct = parseInt(e.key, 10) / 10
            v.currentTime = v.duration * pct
          }
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [togglePlay, flashHint])

  // ---- Mobile gestures ----
  // Strategy:
  //   • Double-tap left/right third  → seek ±10s
  //   • Single tap                   → toggle play
  //   • Horizontal swipe             → scrub (seek by delta)
  //   • Vertical swipe (right half)  → volume
  //   • Vertical swipe (left half)   → brightness (overlay only — can't control device)
  const lastTapRef = useRef<{ t: number; x: number } | null>(null)
  const dragRef = useRef<{
    x: number; y: number; t: number;
    mode: 'none' | 'seek' | 'vol-right' | 'vol-left';
    startCT: number; startVol: number;
  } | null>(null)
  const [brightness, setBrightness] = useState(1)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return
    const v = videoRef.current; if (!v) return
    dragRef.current = {
      x: e.clientX, y: e.clientY, t: Date.now(),
      mode: 'none',
      startCT: v.currentTime,
      startVol: v.volume,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    const v = videoRef.current
    if (!drag || !v || e.pointerType !== 'touch') return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (drag.mode === 'none') {
      if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return
      const rect = wrapRef.current!.getBoundingClientRect()
      const fromRight = (drag.x - rect.left) / rect.width > 0.5
      if (Math.abs(dx) > Math.abs(dy)) drag.mode = 'seek'
      else drag.mode = fromRight ? 'vol-right' : 'vol-left'
    }
    if (drag.mode === 'seek') {
      const seek = Math.max(-90, Math.min(90, dx / 5)) // px → seconds
      const next = Math.max(0, Math.min(v.duration || 1e9, drag.startCT + seek))
      v.currentTime = next
      flashHint(`${seek > 0 ? '»' : '«'} ${Math.abs(seek).toFixed(0)}s`)
    } else if (drag.mode === 'vol-right') {
      const next = Math.max(0, Math.min(1, drag.startVol - dy / 200))
      v.volume = next
      flashHint(`Vol ${Math.round(next * 100)}%`)
    } else if (drag.mode === 'vol-left') {
      // Visual-only brightness via CSS filter
      const next = Math.max(0.3, Math.min(1.6, 1 - dy / 200))
      setBrightness(next)
      flashHint(`Brightness ${Math.round(next * 100)}%`)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || e.pointerType !== 'touch') return
    dragRef.current = null

    const dt = Date.now() - drag.t
    const moved = Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y)
    if (drag.mode !== 'none' || moved > 16) return

    // It's a tap. Check for double-tap.
    const now = Date.now()
    const last = lastTapRef.current
    const v = videoRef.current; if (!v) return
    const rect = wrapRef.current!.getBoundingClientRect()
    const xRel = (e.clientX - rect.left) / rect.width

    if (last && now - last.t < 280 && Math.abs(e.clientX - last.x) < 40) {
      // Double-tap
      lastTapRef.current = null
      if (xRel < 0.33) {
        v.currentTime = Math.max(0, v.currentTime - 10)
        flashHint('« 10s')
      } else if (xRel > 0.66) {
        v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 10)
        flashHint('10s »')
      } else {
        togglePlay()
      }
    } else {
      lastTapRef.current = { t: now, x: e.clientX }
      window.setTimeout(() => {
        if (lastTapRef.current && lastTapRef.current.t === now) {
          // Still a single tap → toggle play
          togglePlay()
          lastTapRef.current = null
        }
      }, 280)
    }
    void dt
  }

  // Stable ref so applyResumeIfNeeded (captured inside the hls.js setup
  // effect which runs on [activeSrc, fallbackSrc]) always reads the
  // latest resumeAt even if it changes mid-load.
  const resumeAtRef = useRef(resumeAt)
  resumeAtRef.current = resumeAt

  // ---- Resume mid-episode helper ----
  // Called once per src after metadata loads (HLS MANIFEST_PARSED for hls.js,
  // loadedmetadata for Safari native HLS / progressive). Guards against
  // double-application by a ref.
  const applyResumeIfNeeded = useCallback(() => {
    if (resumeAppliedRef.current) return
    const pos = resumeAtRef.current
    if (pos == null || pos < 10) return
    const v = videoRef.current
    if (!v) return
    const d = v.duration
    // Wait for duration if it hasn't loaded yet.
    if (!isFinite(d) || d <= 0) return
    // Only resume if we're not too close to the end.
    if (pos >= d - 30) return
    resumeAppliedRef.current = true
    try { v.currentTime = pos } catch { /* ignore */ }
    setResumeBanner({ time: pos })
    // Auto-hide the banner after 6 seconds.
    window.setTimeout(() => setResumeBanner(null), 6000)
  }, [])

  // Hook applyResumeIfNeeded into the native loadedmetadata event so
  // Safari (which uses native HLS instead of hls.js) gets resume too.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onMeta = () => applyResumeIfNeeded()
    v.addEventListener('loadedmetadata', onMeta)
    return () => v.removeEventListener('loadedmetadata', onMeta)
  }, [applyResumeIfNeeded])

  // Stable ref for onProgressTick — only updated when the stream source
  // changes, NOT when the parent re-renders with a different episode number.
  // This prevents progress from one episode leaking into another during the
  // window between currentEp changing and the new stream loading.
  const progressTickRef = useRef(onProgressTick)
  useEffect(() => {
    progressTickRef.current = onProgressTick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSrc])

  // ── Save progress periodically ─────────────────────────────────────
  // Fire onProgressTick every 5 seconds while playing, plus on pause,
  // unmount, ended, and visibilitychange-hidden. Parent debounces /
  // throttles further if desired.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const save = () => {
      if (!v.duration || !isFinite(v.duration)) return
      progressTickRef.current?.(v.currentTime, v.duration)
    }
    let id: number | null = null
    const startTicker = () => {
      if (id != null) return
      id = window.setInterval(save, 5000)
    }
    const stopTicker = () => {
      if (id != null) { window.clearInterval(id); id = null }
    }
    const onPlay = () => startTicker()
    const onPause = () => { save(); stopTicker() }
    const handleEnded = () => { save(); onEnded?.() }
    const onVis = () => { if (document.visibilityState === 'hidden') save() }
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('ended', handleEnded)
    document.addEventListener('visibilitychange', onVis)
    if (!v.paused) startTicker()
    return () => {
      // One final save on unmount / src change so we never lose progress.
      save()
      stopTicker()
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('ended', handleEnded)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [activeSrc])

  // ---- Quality memory helpers ----
  const levelToQuality = (lv: Level | undefined): QualityPref => {
    if (!lv || lv.height === undefined) return 'auto'
    if (lv.height >= 1080) return '1080p'
    if (lv.height >= 720) return '720p'
    if (lv.height >= 480) return '480p'
    return '360p'
  }

  const findLevelForQuality = (q: QualityPref): number => {
    if (q === 'auto') return -1
    const targetHeight = { '1080p': 1080, '720p': 720, '480p': 480, '360p': 360 }[q] ?? 0
    const hls = hlsRef.current
    if (!hls) return -1
    // Find the highest level at or below the target height
    let best = -1
    let bestH = 0
    for (let i = 0; i < hls.levels.length; i++) {
      const h = hls.levels[i].height
      if (h !== undefined && h <= targetHeight && h > bestH) {
        best = i
        bestH = h
      }
    }
    return best
  }

  const applySavedQuality = () => {
    const saved = quality
    const hls = hlsRef.current
    if (saved === 'auto' || !hls) {
      // Auto quality or native/progressive stream — reset UI to Auto.
      // Always update React state (not just when !hls) because we no
      // longer reset currentLevel at source-load start.
      setCurrentLevel(-1)
      return
    }
    const level = findLevelForQuality(saved)
    if (level >= 0) {
      hls.currentLevel = level
      setCurrentLevel(level)
    } else {
      // No level matched the saved preference (shouldn't happen unless
      // the stream provides zero levels). Fall back to Auto and reset
      // the persisted setting so we don't warn on every episode.
      console.warn(
        `[VideoPlayer] Saved quality '${saved}' has no matching level — falling back to Auto.`,
      )
      setSettings('quality', 'auto')
      hls.currentLevel = -1
      setCurrentLevel(-1)
    }
  }

  // ---- Quality switch ----
  const switchLevel = (level: number) => {
    const hls = hlsRef.current
    if (!hls) return
    hls.currentLevel = level
    setCurrentLevel(level)
    _setShowSettings(false)

    // Persist quality preference so it applies on next episode / session
    const quality = levelToQuality(level === -1 ? undefined : hls.levels[level])
    setSettings('quality', quality)
  }

  // ---- PiP toggle ----
  const togglePiP = async () => {
    const v = videoRef.current; if (!v) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else if (document.pictureInPictureEnabled) {
        await v.requestPictureInPicture()
      }
    } catch (e) {
      console.warn('PiP failed', e)
    }
  }

  // ---- AirPlay toggle (Safari) ----
  const triggerAirPlay = () => {
    const v = videoRef.current as HTMLVideoElement | null
    v?.webkitShowPlaybackTargetPicker?.()
  }

  // ---- Caption appearance: build a scoped ::cue CSS block from settings.
  // Browsers ignore ::cue styles set inline on <video>, so we inject a
  // small <style> tag that targets `.{captionScope} > ::cue`.
  // useMemo prevents this heavy string computation from running 5x/sec
  // on every VideoPlayer re-render (triggered by stats/skipCountdown intervals).
  const captionCss = useMemo(() => {
    const c = captionScopeRef.current
    const size = captionSize
    const color = captionColor
    const bgAlpha = captionBackgroundOpacity
    const edge = captionEdgeStrength
    const offset = captionPositionOffset
    const shadowStrength = edge * 2
    const shadow = `
      ${-shadowStrength}px ${-shadowStrength}px ${shadowStrength * 1.5}px rgba(0,0,0,${edge}),
      ${shadowStrength}px ${-shadowStrength}px ${shadowStrength * 1.5}px rgba(0,0,0,${edge}),
      ${-shadowStrength}px ${shadowStrength}px ${shadowStrength * 1.5}px rgba(0,0,0,${edge}),
      ${shadowStrength}px ${shadowStrength}px ${shadowStrength * 1.5}px rgba(0,0,0,${edge})
    `.trim()

    return `
.${c}::cue {
  font-size: ${size * 100}%;
  color: ${color};
  background-color: rgba(0,0,0,${bgAlpha});
  text-shadow: ${shadow};
  font-family: '${captionFont}', 'Inter', system-ui, -apple-system, sans-serif;
  font-weight: 600;
  white-space: pre-line;
  line-height: 1.35;
}
.${c}::cue(b), .${c}::cue(strong) { font-weight: 800; }
.${c}::cue(i), .${c}::cue(em)     { font-style: italic; }
${offset > 0 ? `
/* Lift cues away from the bottom edge by re-positioning the cue box
   container. Browsers compute cue snap-to-lines from the video bottom,
   so we use a negative margin on the video itself when offset > 0. */
.${c}::-webkit-media-text-track-display { transform: translateY(-${offset}%); }
.${c}::-webkit-media-text-track-container { transform: translateY(-${offset}%); }
` : ''}
    `.trim()
  }, [captionSize, captionColor, captionBackgroundOpacity, captionEdgeStrength, captionPositionOffset, captionFont])

  // ── Shared: cancel any in-flight auto-skip countdown (the interval that
  // ticks the badge + the timeout that performs the seek). Single source of
  // truth for timer teardown — used by skipSegment, cancelSkip and unmount,
  // so a stale timer can never seek a different video. ─────────────────────
  const clearSkipTimers = useCallback(() => {
    if (skipCountdownRef.current) {
      window.clearInterval(skipCountdownRef.current)
      skipCountdownRef.current = null
    }
    if (skipTimeoutRef.current) {
      window.clearTimeout(skipTimeoutRef.current)
      skipTimeoutRef.current = null
    }
    setSkipCountdown(null)
  }, [])

  // ── Cleanup skip timers on unmount ─────────────────────────────
  useEffect(() => () => {
    clearSkipTimers()
  }, [clearSkipTimers])

  // ---- Skip segment (manual or auto) ----
  const skipSegment = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    let seg
    if (activeSkip === 'op') seg = skipTimes?.op
    else if (activeSkip === 'ed') seg = skipTimes?.ed
    else seg = skipTimes?.recap
    if (seg) {
      // Cancel any pending auto-skip countdown
      clearSkipTimers()
      v.currentTime = seg.interval.endTime
      setActiveSkip(null)
    }
  }, [activeSkip, skipTimes, clearSkipTimers])

  // Abort a pending auto-skip countdown WITHOUT seeking — the user wants to
  // keep watching this segment. Marks the segment as "don't auto-skip again"
  // for this episode (same semantics as the ✕ dismiss on the manual prompt),
  // so the countdown never re-arms while still inside the window.
  const cancelSkip = useCallback(() => {
    clearSkipTimers()
    if (activeSkip === 'op') autoSkippedOpRef.current = true
    else if (activeSkip === 'ed') autoSkippedEdRef.current = true
    else if (activeSkip === 'recap') autoSkippedRecapRef.current = true
    setActiveSkip(null)
    flashHint('Keep watching')
  }, [activeSkip, flashHint, clearSkipTimers])

  // ── Netflix-style skip button — bottom-right overlay ──────────────
  // Slides in from the right when the user enters an op/ed/recap window.
  // Only rendered when auto-skip is OFF and no countdown is active.
  // When auto-skip is ON, the countdown badge handles the UX.
  const skipPrompt = useMemo(() => {
    if (!activeSkip || skipCountdown !== null) return null
    let label: string, enabled: boolean
    if (activeSkip === 'op') {
      label = 'Skip Intro'
      enabled = autoSkipIntro
    } else if (activeSkip === 'ed') {
      label = 'Skip Outro'
      enabled = autoSkipOutro
    } else {
      label = 'Skip Recap'
      enabled = autoSkipRecap
    }
    if (enabled) return null
    return (
      <div className="absolute bottom-20 right-4 z-20 animate-[slideInRight_0.35s_cubic-bezier(0.34,1.56,0.64,1)]">
        <div className="flex items-center gap-2">
          {/* Main Skip button — large & prominent, Netflix-style */}
          <button
            onClick={skipSegment}
            className="flex items-center gap-2 rounded-lg bg-white/95 text-black px-5 py-3 text-sm font-bold hover:bg-white transition-all shadow-xl shadow-black/30 hover:scale-105 active:scale-95 border-2 border-white/20"
          >
            <SkipForward className="h-4 w-4" />
            {label}
          </button>
          {/* Dismiss button — subtle X to the right */}
          <button
            onClick={() => {
              if (activeSkip === 'op') autoSkippedOpRef.current = true
              else if (activeSkip === 'ed') autoSkippedEdRef.current = true
              else autoSkippedRecapRef.current = true
              setActiveSkip(null)
            }}
            className="rounded-full bg-black/60 border border-white/15 text-white/50 hover:text-white hover:bg-black/80 p-2 transition-all"
            aria-label="Don't skip"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    )
  }, [activeSkip, skipCountdown, autoSkipIntro, autoSkipOutro, autoSkipRecap, skipSegment])

  // Content-space geometry derived from the crop: the box shows exactly the
  // content rect; the video element inside is oversized/offset to match.
  // Manual fit modes (fill/cover) bypass the crop entirely.
  const effCrop = videoFit === 'contain' ? crop : { l: 0, r: 0, t: 0, b: 0 }
  const hasHBar = effCrop.l > 0 || effCrop.r > 0
  const hasVBar = effCrop.t > 0 || effCrop.b > 0
  const contentAspect = (() => {
    const base = intrinsicAspect ?? 16 / 9
    if (!hasHBar && !hasVBar) return base
    // Content rect inside the stream: (1-l-r) of width, (1-t-b) of height.
    const wFrac = 1 - effCrop.l - effCrop.r
    const hFrac = 1 - effCrop.t - effCrop.b
    return (base * wFrac) / hFrac
  })()

  // Subtitle tracks with offset applied (blob URLs when offset != 0)
  const offsetSubtitles = useOffsetSubtitles(subtitles, subtitleOffset)

  return (
    <div
      ref={wrapRef}
      tabIndex={-1}
      className="group relative w-full overflow-hidden rounded-xl bg-black touch-none select-none outline-none"
      style={{ aspectRatio: contentAspect ? `${contentAspect}` : '16 / 9' }}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => { onPointerMove(e); setControlsVisible(true) }}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragRef.current = null }}
      onMouseEnter={() => setControlsVisible(true)}
      onMouseLeave={() => setControlsVisible(false)}
    >
      {/* Ambient cinema glow — samples video edge pixels in real-time */}
      <AmbientPlayerGlow
        videoRef={videoRef}
        active={!error && !loading}
        dimmed={controlsVisible}
      />
      {/* Scoped caption CSS — only affects THIS player */}
      <style dangerouslySetInnerHTML={{ __html: captionCss }} />
      <video
        ref={videoRef}
        playsInline
        autoPlay={autoPlay !== false}
        poster={poster}
        crossOrigin="anonymous"
        className={`h-full w-full bg-black ${captionScopeRef.current}`}
        style={{
          objectFit: videoFit,
          filter: brightness === 1 ? undefined : `brightness(${brightness})`,
          // Bar-crop geometry: video is oversized by the bar fractions and
          // shifted so the content rect fills the box 1:1 (no scaling, no
          // cropping of real picture). At 16:9 content in a 4:3-crop box:
          // width = 4/3 relative to box, shifted left by the left-bar share.
          width: hasHBar || hasVBar ? `${(100 / (1 - effCrop.l - effCrop.r)).toFixed(4)}%` : undefined,
          height: hasHBar || hasVBar ? `${(100 / (1 - effCrop.t - effCrop.b)).toFixed(4)}%` : undefined,
          left: effCrop.l > 0 ? `${((-effCrop.l * 100) / (1 - effCrop.l - effCrop.r)).toFixed(4)}%` : undefined,
          top: effCrop.t > 0 ? `${((-effCrop.t * 100) / (1 - effCrop.t - effCrop.b)).toFixed(4)}%` : undefined,
          position: hasHBar || hasVBar ? 'relative' : undefined,
        }}
      >
        {offsetSubtitles.map((s) => (
          <track
            key={s.src}
            kind="subtitles"
            src={s.src}
            srcLang={s.lang || 'en'}
            label={s.label}
            default={s.default}
          />
        ))}
      </video>

      {/* Plyr-style custom control bar (anidap aesthetic) */}

      {!error && (
        <PlayerControls
          videoRef={videoRef}
          loading={loading}
          subtitles={subtitles}
          activeSubIdx={activeSubIdx}
          onChangeSubIdx={setActiveSubIdx}
          levels={levels}
          currentLevel={currentLevel}
          onChangeLevel={switchLevel}
          pipActive={pipActive}
          onTogglePiP={togglePiP}
          hasAirPlay={hasAirPlay}
          onTriggerAirPlay={triggerAirPlay}
          theaterMode={theaterMode}
          onToggleTheaterMode={onToggleTheaterMode}
          audioTracks={audioTracks}
          currentAudioTrack={currentAudioTrack}
          onChangeAudioTrack={(id) => {
            if (hlsRef.current) hlsRef.current.audioTrack = id
            // Reset subtitle selection when audio track changes —
            // switching from sub to dub means the old subtitle index
            // may point at the wrong language track.
            setActiveSubIdx(subtitles.findIndex((s) => s.default))
          }}
          statsOverlay={statsOverlay}
          onToggleStatsOverlay={() => setSettings('statsOverlay', !statsOverlay)}
          subtitleOffset={subtitleOffset}
          onChangeSubtitleOffset={(offset) => setSettings('subtitleOffset', offset)}
          loop={loop}
          onToggleLoop={() => setSettings('loop', !loop)}
          videoFit={videoFit}
          onChangeVideoFit={(fit) => setSettings('videoFit', fit)}
          episodeNumber={episodeNumber}
          episodeTitle={episodeTitle}
          hasNextEpisode={hasNextEpisode ?? false}
          hasPrevEpisode={hasPrevEpisode ?? false}
          onNextEpisode={onNextEpisode ?? (() => {})}
          onPrevEpisode={onPrevEpisode ?? (() => {})}
          chapters={(() => {
            const out: Array<{ start: number; end: number; title: string; type: 'op' | 'ed' | 'recap' }> = []
            if (skipTimes?.op) {
              out.push({
                start: skipTimes.op.interval.startTime,
                end: skipTimes.op.interval.endTime,
                title: 'Intro',
                type: 'op',
              })
            }
            if (skipTimes?.ed) {
              out.push({
                start: skipTimes.ed.interval.startTime,
                end: skipTimes.ed.interval.endTime,
                title: 'Outro',
                type: 'ed',
              })
            }
            return out.length ? out : undefined
          })()}
        />
      )}

      {/* Skip prompt — centered dialog (auto-skip OFF) */}
      {skipPrompt}

      {/* Auto-skip countdown badge (auto-skip ON) — user can still abort */}
      {activeSkip && skipCountdown !== null && skipCountdown > 0 && (
        <div className="absolute bottom-20 right-4 z-20 flex items-center gap-2 animate-[fadeInUp_0.3s_ease]">
          {/* Abort the auto-skip — keep watching this segment */}
          <button
            onClick={cancelSkip}
            aria-label="Keep watching — don't skip"
            title="Keep watching — don't skip"
            className="flex items-center gap-1.5 rounded-xl bg-black/60 border border-white/15 text-white/70 px-3 py-2 text-xs font-medium hover:text-white hover:bg-black/80 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Keep watching
          </button>
          <button
            onClick={skipSegment}
            className="flex items-center gap-2 rounded-xl bg-black/85 border border-white/10 text-white px-3 py-2 text-xs font-medium hover:bg-white/10 transition-colors"
          >
            <SkipForward className="h-3.5 w-3.5 text-primary" />
            Skipping {activeSkip === 'op' ? 'intro' : activeSkip === 'ed' ? 'outro' : 'recap'}…
            <span className="font-bold text-primary ml-1">Skip now</span>
          </button>
          <SkipCountdownBadge remaining={skipCountdown} total={skipDelay} />
        </div>
      )}

      {/* ── Resume banner ────────────────────────────────────────────
          Appears for ~6s once on first play when we restored a saved
          position. "Start over" rewinds + clears the saved progress. */}
      {resumeBanner && (
        <div className="absolute top-3 left-3 z-30 max-w-[320px] glass-card rounded-xl px-3 py-2 flex items-center gap-3 shadow-md border border-primary/30 animate-[fadeInUp_0.25s_ease]">
          <div className="h-7 w-7 rounded-full bg-primary/20 grid place-items-center shrink-0">
            <svg className="h-3.5 w-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7-7 7m-9-4l3-3-3-3" />
            </svg>
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="text-[11px] text-white/80 leading-tight">Resumed from</p>
            <p className="text-sm font-mono font-bold text-white tabular-nums leading-tight">
              {(() => {
                const s = Math.floor(resumeBanner.time)
                const h = Math.floor(s / 3600)
                const m = Math.floor((s % 3600) / 60)
                const sec = s % 60
                return h > 0
                  ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
                  : `${m}:${String(sec).padStart(2,'0')}`
              })()}
            </p>
          </div>
          <button
            onClick={() => {
              const v = videoRef.current
              if (v) v.currentTime = 0
              setResumeBanner(null)
              onResumeDismiss?.()
            }}
            className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white/10 text-white hover:bg-white/20 border border-white/10 shrink-0"
          >
            Start over
          </button>
        </div>
      )}

      {/* Centered gesture hint (volume/brightness/seek overlay) */}
      {overlayHint && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center z-30">
          <div className="rounded-full bg-black/75 px-5 py-2 text-sm font-semibold text-white border border-white/10">
            {overlayHint}
          </div>
        </div>
      )}

      {/* Stats for nerds overlay */}
      {statsOverlay && !error && (
        <div className="pointer-events-none absolute top-3 left-3 z-30">
          <div className="rounded-lg bg-black/85 border border-white/10 px-3 py-2 text-[10px] font-mono text-white/80 space-y-0.5 shadow-md">
            <div className="flex items-center gap-1.5 text-white/50 uppercase tracking-wider text-[9px] font-bold mb-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Stats
            </div>
            {stats.resolution && <div>Res: <span className="text-white">{stats.resolution}</span></div>}
            {stats.bitrate && <div>Bitrate: <span className="text-white">{stats.bitrate} kbps</span></div>}
            {stats.bandwidth && <div>Est. bw: <span className="text-white">{stats.bandwidth} kbps</span></div>}
            {stats.buffer != null && <div>Buffer: <span className="text-white">{stats.buffer}s</span></div>}
            {stats.dropped != null && <div>Dropped: <span className={stats.dropped > 0 ? 'text-amber-400' : 'text-white'}>{stats.dropped}</span></div>}
            <div>HLS: <span className="text-white">{hlsRef.current ? 'Active' : 'Native'}</span></div>
          </div>
        </div>
      )}

      {/* Initial-load spinner — crossfade on load complete */}
      <div
        className={cn(
          'absolute inset-0 grid place-items-center bg-black/20 pointer-events-none z-10 transition-opacity duration-400 ease-out',
          loading && !error ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="flex flex-col items-center gap-3 text-white/80">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-xs uppercase tracking-wider font-semibold text-white/60">
            Loading stream
          </span>
        </div>
      </div>

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center z-30">
          <div className="flex flex-col items-center gap-3 text-white">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <p className="text-sm max-w-md">{error}</p>
            <p className="text-xs text-white/50">
              Try a different provider, or check the backend console.
            </p>
          </div>
        </div>
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────
// Subtitle offset helper: fetches VTT, shifts all cue timestamps by
// offsetSeconds, returns a Blob URL. Restores original URL when offset
// is reset to 0.
// ─────────────────────────────────────────────────────────────────────
