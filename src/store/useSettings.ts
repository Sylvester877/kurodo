// App-wide settings store. Persisted to localStorage.
// Every value here is a "default" — the user can override per-session in the
// player UI (e.g. switching quality on the fly), but the setting is what
// applies on first load.

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// Debounced localStorage wrapper — batches writes to avoid blocking the
// main thread on every individual set() call. Zustand's persist middleware
// calls setItem() synchronously; wrapping it with a 300ms trailing debounce
// means rapid successive writes (e.g. quality changes, caption tweaks) only
// hit disk once.
//
// IMPORTANT: Storage methods (getItem, setItem, removeItem, clear, key,
// length) live on Storage.prototype, not as own properties of localStorage.
// Spreading {...storage} copies nothing — we must explicitly forward every
// method the persist middleware needs.
function debouncedStorage(storage: Storage, delay = 300) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  // Flush all pending writes before the page unloads so no setting is lost.
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      for (const [key, timer] of timers) {
        clearTimeout(timer)
        try { storage.setItem(key, (window as any).__debouncedStoragePending?.[key] ?? '') } catch {}
      }
      timers.clear()
    })
  }
  const pending = {} as Record<string, string>
  return {
    getItem: (key: string) => storage.getItem(key),
    setItem: (key: string, value: string) => {
      pending[key] = value
      ;(window as any).__debouncedStoragePending = pending
      const existing = timers.get(key)
      if (existing) clearTimeout(existing)
      timers.set(key, setTimeout(() => {
        storage.setItem(key, value)
        timers.delete(key)
        delete pending[key]
      }, delay))
    },
    removeItem: (key: string) => {
      const t = timers.get(key)
      if (t) { clearTimeout(t); timers.delete(key) }
      delete pending[key]
      storage.removeItem(key)
    },
  }
}

import type { QualityPref } from '../types'

export type AudioPref = 'sub' | 'dub' | 'hsub'
export type SubDubFilter = 'all' | 'sub' | 'dub'
export type { QualityPref }
export type TitleLang = 'english' | 'romaji' | 'native'
export type ServerPref = 'yuki' | 'koto' | 'nuri' | 'kami' | 'shiro' | 'kiwi'
                       | 'mochi' | 'pahe' | 'miru' | 'wave' | 'gogo' | 'auto'

export interface SettingsState {
  // ───── Playback ─────
  audio: AudioPref
  server: ServerPref
  quality: QualityPref
  defaultVolume: number       // 0..1
  autoplayNext: boolean
  autoplayDelay: number       // seconds shown in countdown before next ep
  pauseOnBlur: boolean
  /** Prefetch next episode's stream URL while you watch (saves 1-3s on auto-advance). */
  prefetchNext: boolean

  // ───── Skip ─────
  autoSkipIntro: boolean
  autoSkipOutro: boolean
  skipDelay: number           // seconds to wait before auto-skipping (0 = instant)

  // ───── Captions ─────
  /** Subtitle font size multiplier (1 = browser default ~ 18px). */
  captionSize: number         // 0.7..2.0
  /** CSS color of subtitle text. */
  captionColor: string        // 'white' | 'yellow' | '#fff' …
  /** Black background opacity behind the text (0..1). 0 = no background. */
  captionBackgroundOpacity: number
  /** Drop shadow strength behind the text (0..1) — helps over bright scenes. */
  captionEdgeStrength: number
  /** Vertical offset in % of player height. 0 = browser default (bottom). */
  captionPositionOffset: number

  // ───── Discovery / display ─────
  titleLang: TitleLang
  showNsfw: boolean
  compactCards: boolean
  /** Homepage/Browse audio-availability quick filter. Persisted. */
  subDubFilter: SubDubFilter
  /** When available, auto-select dub servers instead of defaulting to sub. */
  preferDub: boolean
  /** Show dub availability badges on episode cards. */
  showDubBadges: boolean

  // ───── AniList activity ─────
  autoSyncAniList: boolean

  // ───── Player extras ─────
  /** Loop the current video when it ends. */
  loop: boolean
  /**
   * How the video fills the player container.
   * `original` plays at the stream's native pixel size (letterboxed when
   * the box can't fit it; never upscaled, never cropped, no baked-bar zoo
   * — 1:1 pixels).
   */
  videoFit: 'contain' | 'cover' | 'fill' | 'original'
  /** Subtitle sync offset in seconds (-30..+30). Positive = delay subtitles. */
  subtitleOffset: number
  /** Show nerd-stats overlay (bitrate, resolution, buffer, dropped frames). */
  statsOverlay: boolean
  /** Preferred audio track index (-1 = auto / default). */
  audioTrack: number
  /** Default playback speed (0.5–2.0). Applied on every video load. */
  defaultPlaybackSpeed: number
  /** Audio boost, as a percentage above unity gain. 0 = off (default).
   *  Applied with a Web Audio GainNode — `video.volume` cannot exceed 1, so a
   *  real boost needs the audio graph. 0..200 → gain 1.0..3.0. */
  audioBoost: number
  /** Incognito: stop writing watch progress / history, and skip tracker sync.
   *  Playback is untouched — this only silences the RECORDING of it. */
  incognito: boolean
  /** Start playing automatically when an episode loads. */
  autoplayVideo: boolean
  /** Skip filler episodes when auto-advancing to the next episode. */
  skipFiller: boolean
  /** Auto-skip recap segments too (not just intro/outro). */
  autoSkipRecap: boolean
  /** Start videos in theater mode by default. */
  defaultTheaterMode: boolean
  /** Subtitle font family (applied via ::cue CSS). */
  captionFont: string
  /** Ambient backdrop glow behind the video player. */
  ambientMode: boolean

  // ───── Appearance ─────
  /** Theme accent colour preset. `anikage` (pink→purple) is the brand default. */
  themeColor: 'anikage' | 'violet' | 'indigo' | 'anidap' | 'crimson' | 'emerald' | 'amber'
  /** Light mode toggle. Uses CSS filter invert trick — flips the entire UI. */
  lightMode: boolean

  // ───── A11y / motion ─────
  reduceMotion: boolean

  // ───── Notifications ─────
  /** Browser notifications when watchlisted shows are about to air. */
  notifyAiring: boolean

  // ───── Performance ─────
  /** Auto-detected on first load. When true, the app reduces GPU-heavy effects
   *  (no backdrop-blur, lighter shadows, faster transitions, fewer animations).
   *  Manually togglable in Settings → Appearance. */
  reduceQuality: boolean

  // mutators
  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void
  reset: () => void
}

const DEFAULTS: Omit<SettingsState, 'set' | 'reset'> = {
  audio: 'sub',
  server: 'yuki',
  quality: 'auto',
  defaultVolume: 1,
  // v7: autoplay-next is ON by default again (owner request: "add auto next").
  // It was made opt-in in v5 because the app "had its own brain" — but that
  // was about SILENT jumping. This is not silent: an 8s "Up Next" countdown
  // is on screen with a Cancel button, and finishing an episode continuing to
  // the next one is what every other player does. The Settings toggle and the
  // ⌘K action remain for anyone who wants it off.
  autoplayNext: true,
  autoplayDelay: 8,
  pauseOnBlur: false,
  prefetchNext: true,

  // v6: auto-skip intro/outro is now OPT-IN. The app must ASK (show the
  // Skip button) before jumping a segment — silently seeking past the
  // outro at ~90% felt like the app had a mind of its own.
  autoSkipIntro: false,
  autoSkipOutro: false,
  skipDelay: 3,

  // Cinematic defaults — Netflix/Crunchyrow parity:
  //  • pill 26% (warm near-black, barely there)
  //  • crisp 1px outline + soft velvet bloom (reads on snow/sky)
  //  • Inter 600 (book-ish, not heavy), 1.5 line-height, 4% lift
  //  • slightly wider tracking so glyphs don't clump at 900p distance
  captionSize: 1.04,
  captionColor: '#ffffff',
  captionBackgroundOpacity: 0.26,
  captionEdgeStrength: 0.82,
  captionPositionOffset: 4,

  titleLang: 'english',
  showNsfw: false,
  compactCards: false,
  subDubFilter: 'all',
  preferDub: false,
  showDubBadges: true,

  autoSyncAniList: true,

  loop: false,
  videoFit: 'contain',
  subtitleOffset: 0,
  statsOverlay: false,
  audioTrack: -1,
  defaultPlaybackSpeed: 1,
  audioBoost: 0,
  incognito: false,
  autoplayVideo: true,
  skipFiller: true,
  // v6: recap auto-skip also became opt-in (same ask-first policy).
  autoSkipRecap: false,
  defaultTheaterMode: false,
  captionFont: 'Inter',
  ambientMode: true,

  themeColor: 'anikage',
  lightMode: false,

  reduceMotion: false,

  notifyAiring: false,

  reduceQuality: false,
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'kurodo-settings',
      // Bump BOTH the number and add the matching `version < N` branch below, or
      // the migration silently never runs (the v6 branch sat dead here because
      // this stayed at 5).
      version: 8,
      // ── createJSONStorage is NOT optional here ──────────────────────
      // `debouncedStorage` is a STRING storage (getItem/setItem move plain
      // strings). `persist` expects a PersistStorage, whose setItem receives
      // the whole `{ state, version }` OBJECT — so passing the string storage
      // straight in made localStorage hold the literal text "[object Object]".
      // getItem then returned that, JSON.parse threw, and the store fell back
      // to defaults… on EVERY launch. Every setting — server preference,
      // volume, theme, auto-next, quality — silently reset each time the app
      // started, and the migrations below never ran either (nothing parsed to
      // migrate). Verified live before the fix: `localStorage.getItem(
      // 'kurodo-settings') === '[object Object]'`.
      storage: typeof localStorage !== 'undefined'
        ? createJSONStorage(() => debouncedStorage(localStorage, 300))
        : undefined,
      // v1 → v2: anidap red was the default accent (indigo users migrated).
      // v2 → v3: violet became the default; old indigo/anidap users migrated.
      // v3 → v4: anikage (pink→purple) is the new brand default. Users still on
      // a previous default (violet/anidap/indigo) are migrated to `anikage`;
      // anyone who deliberately chose another preset keeps their choice.
      migrate: (persisted, version) => {
        const s = persisted as Partial<SettingsState>
        if (version < 2 && s.themeColor === 'indigo') {
          s.themeColor = 'anidap'
        }
        if (version < 3 && (s.themeColor === 'anidap' || s.themeColor === 'indigo')) {
          s.themeColor = 'violet'
        }
        if (version < 4 && (s.themeColor === 'violet' || s.themeColor === 'anidap' || s.themeColor === 'indigo')) {
          s.themeColor = 'anikage'
        }
        if (version < 5) {
          // v5: autoplay-next became opt-in. Users who want binge mode can
          // re-enable it in Settings (the toggle + countdown still exist).
          s.autoplayNext = false
        }
        if (version < 6) {
          // v6: auto-skip intro/outro/recap became opt-in. The app now shows
          // the Skip button and waits for the user instead of silently
          // jumping segments ("it skips without even asking"). Users who
          // want auto-skip can re-enable it in Settings.
          s.autoSkipIntro = false
          s.autoSkipOutro = false
          s.autoSkipRecap = false
          s.skipDelay = 3
        }
        if (version < 7) {
          // v7: auto-next back ON by default (owner request). Existing installs
          // are migrated too — someone on v5/v6 never opted OUT of anything,
          // they just inherited the old default. It stays cancellable via the
          // countdown and switchable in Settings.
          s.autoplayNext = true
        }
        if (version < 8) {
          // v8: four settings moved out of ad-hoc localStorage keys into the
          // store so the player's "More" menu can own them.
          //   · skipFiller was a `useState` in Watch.tsx with NO setter — it
          //     read the legacy flag once and could never be changed at
          //     runtime. Carry the user's existing choice over.
          //   · audioBoost / incognito / autoplayVideo are new; defaults are
          //     correct (off, off, on) so nothing to migrate.
          try {
            const legacy = typeof localStorage !== 'undefined'
              ? localStorage.getItem('kurodo-skip-filler')
              : null
            if (legacy != null) s.skipFiller = legacy !== '0'
          } catch { /* private mode — keep the default */ }
        }
        return s as SettingsState
      },
    },
  ),
)

/** Convenience: read settings outside React (for stores, sync layer, etc.) */
export function getSettings(): SettingsState {
  return useSettings.getState()
}
