import { useState, useEffect, useRef } from 'react'
import {
  Settings as SettingsIcon, Play, SkipForward, Sparkles, Cloud,
  Eye, Trash2, RotateCcw, Download, Upload, AlertCircle, Bell, BellOff,
  Copy, User, RefreshCw, CheckCircle2, Loader2,
} from 'lucide-react'
import { useSettings, type AudioPref, type QualityPref, type ServerPref, type TitleLang } from '../store/useSettings'
import { useWatchListStore } from '../store/useWatchListStore'
import { _buildActivityText } from '../lib/sync'
import { useTitle } from '../hooks/useTitle'
import Section from '../components/settings/Section'
import Row from '../components/settings/Row'
import Toggle from '../components/settings/Toggle'
import Select from '../components/settings/Select'
import { toast } from '../components/Toaster'
import {
  getPermission, requestPermission, sendTestNotification,
} from '../lib/notifications'
import AvatarFramePicker from '../components/profile/AvatarFramePicker'
import BannerDecorPicker from '../components/profile/BannerDecorPicker'

export default function Settings() {
  const s = useSettings()
  useTitle('Settings')
  const [confirmClear, setConfirmClear] = useState(false)
  const [permission, setPermission] = useState(() => getPermission())

  // ─── Update status (Electron only) ───
  type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle')
  const [updateVersion, setUpdateVersion] = useState('')
  const [updateProgress, setUpdateProgress] = useState<{ percent: number; bytesPerSecond: number } | null>(null)
  const [feedUrl, setFeedUrl] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const updateCleanup = useRef<Array<() => void>>([])
  const resetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    setAppVersion(api.getAppVersion?.() ?? '0.1.0')
    setFeedUrl(api.getUpdateFeedUrl?.() ?? '')

    if (api.onUpdateChecking) {
      updateCleanup.current.push(api.onUpdateChecking(() => {
        setUpdatePhase('checking')
        setUpdateProgress(null)
      }))
    }
    if (api.onUpdateAvailable) {
      updateCleanup.current.push(api.onUpdateAvailable((info) => {
        setUpdateVersion(info.version)
        setUpdatePhase('available')
      }))
    }
    if (api.onUpdateNotAvailable) {
      updateCleanup.current.push(api.onUpdateNotAvailable(() => {
        setUpdatePhase('up-to-date')
        // Reset to idle after 5s (with proper cleanup)
        if (resetTimeout.current) clearTimeout(resetTimeout.current)
        resetTimeout.current = setTimeout(() => {
          resetTimeout.current = null
          setUpdatePhase((p) => (p === 'up-to-date' ? 'idle' : p))
        }, 5000)
      }))
    }
    if (api.onUpdateProgress) {
      updateCleanup.current.push(api.onUpdateProgress((data) => {
        setUpdateProgress({ percent: data.percent, bytesPerSecond: data.bytesPerSecond })
        setUpdatePhase('downloading')
      }))
    }
    if (api.onUpdateError) {
      updateCleanup.current.push(api.onUpdateError((_message) => {
        setUpdatePhase('error')
        // Reset to idle after 5s
        if (resetTimeout.current) clearTimeout(resetTimeout.current)
        resetTimeout.current = setTimeout(() => {
          resetTimeout.current = null
          setUpdatePhase((p) => (p === 'error' ? 'idle' : p))
        }, 5000)
      }))
    }

    // onUpdateReady doesn't return a cleanup function
    api.onUpdateReady?.((info) => {
      setUpdateVersion(info.version)
      setUpdatePhase('ready')
      setUpdateProgress(null)
    })

    return () => {
      api.removeUpdateReadyListener?.()
      updateCleanup.current.forEach((fn) => fn())
      if (resetTimeout.current) {
        clearTimeout(resetTimeout.current)
        resetTimeout.current = null
      }
    }
  }, [])

  const handleCheckForUpdates = () => {
    window.electronAPI?.checkForUpdates?.()
  }

  const handleSaveFeedUrl = () => {
    window.electronAPI?.setUpdateFeedUrl?.(feedUrl)
    toast.success('Update feed URL saved')
  }

  const enableNotifications = async () => {
    const result = await requestPermission()
    setPermission(result)
    if (result === 'granted') {
      s.set('notifyAiring', true)
      toast.success('Notifications enabled. We\'ll alert you when watchlist shows air.')
    } else if (result === 'denied') {
      toast.error(
        'Permission denied. Re-enable from your browser\'s site settings.',
        6000,
      )
    } else if (result === 'unsupported') {
      toast.error('Notifications aren\'t supported in this browser.')
    }
  }

  const testNotification = () => {
    const ok = sendTestNotification()
    if (!ok) toast.error('Test notification failed — check permissions.')
  }

  // ─── Storage actions ───
  const clearImageCache = async () => {
    if (typeof caches === 'undefined') {
      toast.info('Cache API not available in this browser')
      return
    }
    const keys = await caches.keys()
    let removed = 0
    for (const k of keys) {
      if (k.includes('image') || k.includes('tvdb') || k.includes('mal-images')) {
        await caches.delete(k)
        removed++
      }
    }
    toast.success(`Cleared ${removed} image cache${removed === 1 ? '' : 's'}`)
  }

  const clearApiCache = () => {
    let removed = 0
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('kurodo-cache:') || key === 'kurodo-rq-cache') {
        localStorage.removeItem(key)
        removed++
      }
    }
    toast.success(`Cleared ${removed} API cache entries · refresh to reload`)
  }

  const clearWatchlist = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      window.setTimeout(() => setConfirmClear(false), 4000)
      return
    }
    useWatchListStore.setState({
      watchlist: [],
      watchedEpisodes: {},
      continueWatching: [],
      watchHistory: [],
    })
    setConfirmClear(false)
    toast.info('Watchlist cleared')
  }

  // ─── Export / import ───
  const exportAll = () => {
    const payload = {
      kind: 'kurodo-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { ...s, set: undefined, reset: undefined },
      watchlist: useWatchListStore.getState().watchlist,
      watchedEpisodes: useWatchListStore.getState().watchedEpisodes,
      continueWatching: useWatchListStore.getState().continueWatching,
      watchHistory: useWatchListStore.getState().watchHistory,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kurodo-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
    toast.success('Exported to JSON')
  }

  // ─── Per-section copy-to-clipboard ───
  const copySettingsOnly = () => {
    const payload = { kind: 'kurodo-export-settings', version: 1, exportedAt: new Date().toISOString(), ...s, set: undefined, reset: undefined }
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    toast.success('Settings copied to clipboard')
  }

  const copyWatchlistOnly = () => {
    const ws = useWatchListStore.getState()
    const payload = { kind: 'kurodo-export-watchlist', version: 1, exportedAt: new Date().toISOString(), watchlist: ws.watchlist, watchedEpisodes: ws.watchedEpisodes, continueWatching: ws.continueWatching }
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    toast.success('Watchlist copied to clipboard')
  }

  const copyHistoryOnly = () => {
    const ws = useWatchListStore.getState()
    const payload = { kind: 'kurodo-export-history', version: 1, exportedAt: new Date().toISOString(), watchHistory: ws.watchHistory }
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    toast.success('History copied to clipboard')
  }

  const importAll = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (data.kind !== 'kurodo-export') throw new Error('Not a Kurōdo backup file')
        if (data.settings) {
          // Apply settings one key at a time so persist middleware runs
          const asRecord = s as unknown as Record<string, unknown>
          for (const [k, v] of Object.entries(data.settings)) {
            if (k in asRecord && typeof asRecord[k] !== 'function') {
              ;(s.set as (k: string, v: unknown) => void)(k, v)
            }
          }
        }
        useWatchListStore.setState({
          watchlist: data.watchlist ?? [],
          watchedEpisodes: data.watchedEpisodes ?? {},
          continueWatching: data.continueWatching ?? [],
          watchHistory: data.watchHistory ?? [],
        })
        toast.success(`Imported ${data.watchlist?.length ?? 0} titles`)
      } catch (e) {
        toast.error('Import failed: ' + (e as Error).message)
      }
    }
    input.click()
  }

  return (
    <div className="pt-20 pb-12 min-h-screen">
      <div className="max-w-[920px] mx-auto px-4">
        {/* ───── Header ───── */}
        <div className="relative rounded-2xl overflow-hidden mb-6">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/5 pointer-events-none" />
          <div className="glass-card rounded-2xl p-6 relative">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/15 border border-primary/25 grid place-items-center shrink-0">
                <SettingsIcon className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="kicker-bar" />
                  <h1 className="text-2xl font-extrabold text-white leading-tight">Settings</h1>
                </div>
                <p className="text-xs text-muted-foreground">
                  Defaults that apply across the app. Per-session overrides in the player are remembered for that session only.
                </p>
              </div>
              <button
                onClick={() => { s.reset(); toast.info('Settings reset to defaults') }}
                className="glass-pill hover:border-primary/30 hover:text-white transition-all shrink-0"
                title="Reset all settings to defaults — profile customization is preserved"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* ───── Playback ───── */}
          <Section
            icon={<Play className="h-4 w-4 text-primary fill-primary" />}
            title="Playback"
            description="What loads when you open an episode"
          >
            <Row label="Default audio" description="Used when the show offers both">
              <Select<AudioPref>
                value={s.audio}
                onChange={(v) => s.set('audio', v)}
                options={[
                  { value: 'sub', label: 'Subbed' },
                  { value: 'dub', label: 'Dubbed' },
                  { value: 'hsub', label: 'Hard sub' },
                ]}
              />
            </Row>
            <Row label="Preferred server" description="Falls back to first available when missing">
              <Select<ServerPref>
                value={s.server}
                onChange={(v) => s.set('server', v)}
                options={[
                  { value: 'auto',  label: 'Auto (best available)' },
                  { value: 'yuki',  label: 'Yuki ⭐' },
                  { value: 'shiro', label: 'Shiro' },
                ]}
              />
            </Row>
            <Row label="Default volume" description={`Currently ${Math.round(s.defaultVolume * 100)}%`}>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(s.defaultVolume * 100)}
                onChange={(e) => s.set('defaultVolume', Number(e.target.value) / 100)}
                className="w-32 accent-primary"
              />
            </Row>
            <Row label="Loop video" description="Automatically replay when finished">
              <Toggle checked={s.loop} onChange={(v) => s.set('loop', v)} />
            </Row>
            <Row label="Autoplay next episode" description="Shows a 8-second cancellable countdown">
              <Toggle checked={s.autoplayNext} onChange={(v) => s.set('autoplayNext', v)} />
            </Row>
            {s.autoplayNext && (
              <Row label="Countdown length" description="Seconds before the next episode plays">
                <Select<string>
                  value={String(s.autoplayDelay)}
                  onChange={(v) => s.set('autoplayDelay', Number(v))}
                  options={[3, 5, 8, 10, 15].map((n) => ({ value: String(n), label: `${n}s` }))}
                />
              </Row>
            )}
            <Row label="Pause when tab is hidden" description="Stops playback when you switch tabs">
              <Toggle checked={s.pauseOnBlur} onChange={(v) => s.set('pauseOnBlur', v)} />
            </Row>
            <Row
              label="Prefetch next episode"
              description="Warms the next episode's stream while you watch — autoplay feels instant"
            >
              <Toggle checked={s.prefetchNext} onChange={(v) => s.set('prefetchNext', v)} />
            </Row>
            <Row label="Default playback speed" description={`Currently ${s.defaultPlaybackSpeed}x`}>
              <Select<string>
                value={String(s.defaultPlaybackSpeed)}
                onChange={(v) => s.set('defaultPlaybackSpeed', Number(v))}
                options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((n) => ({
                  value: String(n),
                  label: `${n}x`,
                }))}
              />
            </Row>
            <Row label="Default theater mode" description="Start videos in widescreen theater mode">
              <Toggle checked={s.defaultTheaterMode} onChange={(v) => s.set('defaultTheaterMode', v)} />
            </Row>
            <Row label="Ambient backdrop" description="Soft blurred glow behind the player matching the episode art">
              <Toggle checked={s.ambientMode} onChange={(v) => s.set('ambientMode', v)} />
            </Row>
          </Section>

          {/* ───── Skip ───── */}
          <Section
            icon={<Play className="h-4 w-4 text-primary fill-primary" />}
            title="Player"
            description="In-player defaults and overlays"
          >
            <Row label="Video fit" description="How video fills the player area">
              <Select<'contain' | 'cover' | 'fill'>
                value={s.videoFit}
                onChange={(v) => s.set('videoFit', v)}
                options={[
                  { value: 'contain', label: 'Contain (letterbox)' },
                  { value: 'cover',  label: 'Cover (crop to fill)' },
                  { value: 'fill',   label: 'Stretch (fill screen)' },
                ]}
              />
            </Row>
            <Row label="Subtitle sync offset" description={`Delay subtitles by ${s.subtitleOffset > 0 ? '+' : ''}${s.subtitleOffset.toFixed(1)}s`}>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={-30}
                  max={30}
                  step={0.5}
                  value={s.subtitleOffset}
                  onChange={(e) => s.set('subtitleOffset', Number(e.target.value))}
                  className="w-32 accent-primary"
                  aria-label="Subtitle sync offset"
                />
                <span className="font-mono text-sm text-white w-10 text-right">
                  {s.subtitleOffset > 0 ? '+' : ''}{s.subtitleOffset.toFixed(1)}s
                </span>
              </div>
            </Row>
            <Row label="Default quality" description="HLS still adapts automatically">
              <Select<QualityPref>
                value={s.quality}
                onChange={(v) => s.set('quality', v)}
                options={[
                  { value: 'auto',  label: 'Auto' },
                  { value: '1080p', label: '1080p' },
                  { value: '720p',  label: '720p' },
                  { value: '480p',  label: '480p' },
                  { value: '360p',  label: '360p' },
                ]}
              />
            </Row>
            <Row label="Stats overlay" description="Show bitrate, resolution & buffer in the player">
              <Toggle checked={s.statsOverlay} onChange={(v) => s.set('statsOverlay', v)} />
            </Row>
          </Section>

          <Section
            icon={<SkipForward className="h-4 w-4 text-primary" />}
            title="Auto-skip"
            description="Powered by AniSkip — community-submitted timestamps"
          >
            <Row label="Auto-skip intro" description="When OFF, you'll be asked before skipping">
              <Toggle checked={s.autoSkipIntro} onChange={(v) => s.set('autoSkipIntro', v)} />
            </Row>
            <Row label="Auto-skip outro" description="When OFF, you'll be asked before skipping">
              <Toggle checked={s.autoSkipOutro} onChange={(v) => s.set('autoSkipOutro', v)} />
            </Row>
            <Row label="Auto-skip recap" description="When OFF, you'll be asked before skipping">
              <Toggle checked={s.autoSkipRecap} onChange={(v) => s.set('autoSkipRecap', v)} />
            </Row>
            {(s.autoSkipIntro || s.autoSkipOutro || s.autoSkipRecap) && (
              <Row label="Skip delay" description="Wait this long before auto-skipping">
                <Select<string>
                  value={String(s.skipDelay)}
                  onChange={(v) => s.set('skipDelay', Number(v))}
                  options={[0, 1, 2, 3, 5].map((n) => ({
                    value: String(n),
                    label: n === 0 ? 'Instant' : `${n}s`,
                  }))}
                />
              </Row>
            )}
          </Section>

          {/* ───── Appearance ───── */}
          <Section
            icon={<Eye className="h-4 w-4 text-accent" />}
            title="Appearance"
            description="Customise the look and feel"
          >
            <Row label="Theme colour" description="Choose your accent colour across the app">
              <div className="flex items-center gap-2">
                {[
                  { id: 'anidap' as const,  label: 'Anidap Red', hsl: 'hsl(357 75% 49%)', ring: 'ring-red-500' },
                  { id: 'indigo' as const,  label: 'Indigo',  hsl: 'hsl(245 75% 60%)',  ring: 'ring-indigo-400' },
                  { id: 'crimson' as const, label: 'Crimson', hsl: 'hsl(354 78% 52%)', ring: 'ring-red-400' },
                  { id: 'emerald' as const, label: 'Emerald', hsl: 'hsl(152 76% 44%)', ring: 'ring-emerald-400' },
                  { id: 'amber' as const,   label: 'Amber',   hsl: 'hsl(36 100% 52%)',  ring: 'ring-amber-400' },
                  { id: 'violet' as const,  label: 'Violet',  hsl: 'hsl(270 80% 62%)', ring: 'ring-violet-400' },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => s.set('themeColor', t.id)}
                    title={t.label}
                    aria-label={`${t.label} theme`}
                    className={`h-8 w-8 rounded-full border-2 transition-all ${
                      s.themeColor === t.id
                        ? 'border-white scale-110'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{
                      backgroundColor: t.hsl,
                      ...(s.themeColor === t.id && { boxShadow: `0 0 16px -4px ${t.hsl}` }),
                    }}
                  />
                ))}
              </div>
            </Row>
          </Section>

          {/* ───── Display ───── */}
          <Section
            icon={<Eye className="h-4 w-4 text-accent" />}
            title="Display"
            description="How titles and lists are rendered"
          >
            <Row label="Title language" description="Used for cards and headings">
              <Select<TitleLang>
                value={s.titleLang}
                onChange={(v) => s.set('titleLang', v)}
                options={[
                  { value: 'english', label: 'English' },
                  { value: 'romaji',  label: 'Romaji' },
                  { value: 'native',  label: 'Japanese (native)' },
                ]}
              />
            </Row>
            <Row label="Show NSFW content" description="Includes adult-rated titles in browse & search">
              <Toggle checked={s.showNsfw} onChange={(v) => s.set('showNsfw', v)} />
            </Row>
            <Row label="Compact cards" description="Tighter spacing, smaller covers">
              <Toggle checked={s.compactCards} onChange={(v) => s.set('compactCards', v)} />
            </Row>
            <Row label="Subtitle font" description="Font used for on-screen captions">
              <Select<string>
                value={s.captionFont}
                onChange={(v) => s.set('captionFont', v)}
                options={[
                  { value: 'Inter', label: 'Inter (sans-serif)' },
                  { value: 'system-ui', label: 'System default' },
                  { value: 'monospace', label: 'Monospace' },
                  { value: 'Georgia, serif', label: 'Serif' },
                ]}
              />
            </Row>
            <Row label="Reduce motion" description="Disable transitions for accessibility">
              <Toggle checked={s.reduceMotion} onChange={(v) => s.set('reduceMotion', v)} />
            </Row>
            <Row label="Performance mode" description="Auto-detected on first load. Disables GPU-heavy effects (backdrop blur, shadows, transitions) for smoother playback on integrated graphics like Intel Iris Xe.">
              <Toggle checked={s.reduceQuality} onChange={(v) => s.set('reduceQuality', v)} />
            </Row>
          </Section>

          {/* ───── Notifications ───── */}
          <Section
            icon={<Bell className="h-4 w-4 text-primary" />}
            title="Notifications"
            description="Get a browser alert when a show in your watchlist is about to air"
          >
            {permission === 'unsupported' ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <BellOff className="h-4 w-4" />
                Your browser doesn't support the Notification API.
              </div>
            ) : permission === 'denied' ? (
              <div className="flex items-start gap-2 text-xs">
                <BellOff className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-white font-semibold mb-0.5">Notifications blocked</p>
                  <p className="text-muted-foreground leading-snug">
                    You declined permission earlier. Re-enable in your browser's
                    site-settings (the lock icon in the address bar) and refresh.
                  </p>
                </div>
              </div>
            ) : permission === 'default' ? (
              <Row
                label="Enable browser notifications"
                description="Asks for permission once. We only notify for shows in your watchlist."
              >
                <button
                  onClick={enableNotifications}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition-all shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.4)] hover:shadow-[0_8px_20px_-6px_hsl(245,75%,60%,0.55)]"
                >
                  <Bell className="h-3.5 w-3.5" />
                  Enable
                </button>
              </Row>
            ) : (
              <>
                <Row
                  label="Notify when watchlist shows air"
                  description="Alerts fire ~5 minutes before air time while the app tab is open."
                >
                  <Toggle
                    checked={s.notifyAiring}
                    onChange={(v) => s.set('notifyAiring', v)}
                  />
                </Row>
                <Row
                  label="Test notification"
                  description="Make sure it appears in your OS notification tray."
                >
                  <button
                    onClick={testNotification}
                    className="glass-pill hover:text-white transition-all"
                  >
                    <Bell className="h-3.5 w-3.5" />
                    Send test
                  </button>
                </Row>
                <p className="text-[11px] text-muted-foreground pt-1">
                  Heads up: notifications only fire while at least one Kurōdo tab
                  is open — there's no background worker yet.
                </p>
              </>
            )}
          </Section>

          {/* ───── AniList sync + activity ───── */}
          <Section
            icon={<Cloud className="h-4 w-4 text-emerald-400" />}
            title="AniList activity"
            description="How your episode progress shows up on your AniList feed"
          >
            <Row
              label="Auto-sync list progress"
              description="Update your AniList entry when you finish an episode"
            >
              <Toggle
                checked={s.autoSyncAniList}
                onChange={(v) => s.set('autoSyncAniList', v)}
              />
            </Row>

            <Row
              label="Auto-post activity"
              description="Shares what you watch to your AniList feed"
            >
              <Toggle
                checked={s.autoPostActivity}
                onChange={(v) => s.set('autoPostActivity', v)}
              />
            </Row>

            {s.autoPostActivity && (
              <>
                <Row
                  label="Minimum episodes per post"
                  description={
                    s.activityMinEpisodes <= 1
                      ? 'Every episode posts (maximum reach — recommended for going viral 🔥)'
                      : `Coalesces watch events; only posts when ${s.activityMinEpisodes}+ episodes are queued`
                  }
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1} max={10} step={1}
                      value={s.activityMinEpisodes}
                      onChange={(e) => s.set('activityMinEpisodes', Number(e.target.value))}
                      className="w-32 accent-primary"
                      aria-label="Minimum episodes per post"
                    />
                    <span className="font-mono text-sm text-white w-6 text-right">
                      {s.activityMinEpisodes}
                    </span>
                  </div>
                </Row>

                <Row
                  label="Auto-flush window"
                  description="How long to coalesce a watch session before posting"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={5} max={300} step={5}
                      value={s.activityFlushSeconds}
                      onChange={(e) => s.set('activityFlushSeconds', Number(e.target.value))}
                      className="w-32 accent-primary"
                      aria-label="Auto-flush window in seconds"
                    />
                    <span className="font-mono text-sm text-white w-12 text-right">
                      {s.activityFlushSeconds}s
                    </span>
                  </div>
                </Row>

                <Row
                  label="Kurōdo backlink"
                  description="Adds a one-line sign-off with a link back to the episode (helps spread the app)"
                >
                  <Toggle
                    checked={s.activityBranded}
                    onChange={(v) => s.set('activityBranded', v)}
                  />
                </Row>

                <Row
                  label="Celebrate finales"
                  description="Use a 🎉 headline + 'Finished on Kurōdo' tag when you watch the last episode"
                >
                  <Toggle
                    checked={s.activityCelebrateCompletion}
                    onChange={(v) => s.set('activityCelebrateCompletion', v)}
                  />
                </Row>

                {/* Template editor */}
                <div className="pt-2 border-t border-white/5">
                  <label className="block text-sm text-white font-medium mb-1">
                    Headline template
                  </label>
                  <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
                    Tokens: <code className="text-primary">{'{title}'}</code>,{' '}
                    <code className="text-primary">{'{episodes}'}</code>,{' '}
                    <code className="text-primary">{'{emoji}'}</code>. Leave blank for the default
                    (<em>"{'{emoji}'} Watched {'{episodes}'} of **{'{title}'}**"</em>).
                  </p>
                  <input
                    type="text"
                    value={s.activityTemplate}
                    placeholder="{emoji} Watched {episodes} of **{title}**"
                    onChange={(e) => s.set('activityTemplate', e.target.value)}
                    className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white font-mono placeholder:text-white/30 outline-none focus:border-primary focus:bg-black/60 transition-all"
                  />

                  {/* Live preview */}
                  <div className="mt-3 rounded-xl bg-black/30 border border-white/5 p-3">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1.5">
                      Preview · single episode
                    </p>
                    <pre className="text-xs text-white/85 font-sans whitespace-pre-wrap leading-relaxed">
                      {_buildActivityText({
                        title: 'Frieren: Beyond Journey\u2019s End',
                        malId: 52991,
                        eps: [5],
                        isLast: false,
                        template: s.activityTemplate,
                        branded: s.activityBranded,
                      })}
                    </pre>
                    <p className="text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1.5 mt-3 pt-3 border-t border-white/5">
                      Preview · binge run
                    </p>
                    <pre className="text-xs text-white/85 font-sans whitespace-pre-wrap leading-relaxed">
                      {_buildActivityText({
                        title: 'Frieren: Beyond Journey\u2019s End',
                        malId: 52991,
                        eps: [2, 3, 4, 5, 6, 7, 8],
                        isLast: false,
                        template: s.activityTemplate,
                        branded: s.activityBranded,
                      })}
                    </pre>
                    <p className="text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1.5 mt-3 pt-3 border-t border-white/5">
                      Preview · finale
                    </p>
                    <pre className="text-xs text-white/85 font-sans whitespace-pre-wrap leading-relaxed">
                      {_buildActivityText({
                        title: 'Frieren: Beyond Journey\u2019s End',
                        malId: 52991,
                        eps: [28],
                        isLast: true,
                        template: s.activityTemplate,
                        branded: s.activityBranded,
                      })}
                    </pre>
                  </div>
                </div>
              </>
            )}

            <p className="text-[11px] text-muted-foreground pt-2">
              Per-anime opt-outs live on each anime's details page
              ("Activity muted" button). Auto-post activity is independent of
              list-progress sync. Watchlist add/remove always mirrors to
              AniList.
            </p>
          </Section>

          {/* ───── Storage ───── */}
          <Section
            icon={<Sparkles className="h-4 w-4 text-accent" />}
            title="Storage"
            description="Manage local cache and backup"
          >
            <Row label="Image cache" description="Episode thumbnails + posters cached by Workbox">
              <button
                onClick={clearImageCache}
                className="glass-pill hover:text-white transition-all"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </button>
            </Row>
            <Row label="API cache" description="Jikan / AniList responses in localStorage">
              <button
                onClick={clearApiCache}
                className="glass-pill hover:text-white transition-all"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </button>
            </Row>
            <Row label="Copy settings JSON" description="Copy just settings to clipboard (no watch history)">
              <button
                onClick={copySettingsOnly}
                className="glass-pill hover:text-white transition-all"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </Row>
            <Row label="Copy watchlist JSON" description="Copy watchlist + episode progress to clipboard">
              <button
                onClick={copyWatchlistOnly}
                className="glass-pill hover:text-white transition-all"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </Row>
            <Row label="Copy history JSON" description="Copy watch history to clipboard">
              <button
                onClick={copyHistoryOnly}
                className="glass-pill hover:text-white transition-all"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </Row>
            <Row label="Export everything" description="Download your watchlist, history & settings">
              <button
                onClick={exportAll}
                className="glass-pill text-primary border-primary/30 bg-primary/15 hover:bg-primary/25 transition-all"
              >
                <Download className="h-3.5 w-3.5" />
                Export JSON
              </button>
            </Row>
            <Row label="Import" description="Replace local data with a previous export">
              <button
                onClick={importAll}
                className="glass-pill hover:text-white transition-all"
              >
                <Upload className="h-3.5 w-3.5" />
                Choose file
              </button>
            </Row>
            <Row
              label="Clear watchlist"
              description="Removes all local watch data (does NOT touch AniList)"
            >
              <button
                onClick={clearWatchlist}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  confirmClear
                    ? 'bg-red-500 text-white border border-red-500 animate-pulse'
                    : 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25'
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {confirmClear ? 'Click again to confirm' : 'Clear watchlist'}
              </button>
            </Row>
          </Section>

          {/* ───── Profile Customization ───── */}
          <Section
            icon={<User className="h-4 w-4 text-pink-400" />}
            title="Profile Customization"
            description="Avatar frames, banner overlays, and badge layout"
          >
            <div className="space-y-6">
              {/* Avatar frame picker */}
              <div>
                <label className="block text-sm text-white font-semibold mb-2">Avatar Frame</label>
                <AvatarFramePicker />
              </div>

              {/* Banner overlay picker */}
              <div className="pt-2 border-t border-white/5">
                <label className="block text-sm text-white font-semibold mb-2">Banner Overlay</label>
                <BannerDecorPicker />
              </div>
            </div>
          </Section>

          {/* ───── Diagnostics ───── */}
          <Section
            icon={<AlertCircle className="h-4 w-4 text-accent" />}
            title="Diagnostics"
            description="Build info & troubleshooting"
          >
            <Row label="AniList sign-in diagnostic">
              <a
                href="/admin"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.04] text-white/70 border border-white/8 hover:bg-white/[0.08] hover:text-white"
              >
                Open
              </a>
            </Row>
            <Row
              label="Scraper diagnostic"
              description="Probe anidap.se to see exactly which step is failing"
            >
              <a
                href="/admin"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.04] text-white/70 border border-white/8 hover:bg-white/[0.08] hover:text-white"
              >
                Open
              </a>
            </Row>
            <Row label="Version">
              <span className="text-xs font-mono text-muted-foreground">0.1.0</span>
            </Row>
            <Row label="Backend">
              <a
                href="/api/health"
                target="_blank" rel="noreferrer"
                className="text-xs font-mono text-primary hover:underline"
              >
                /api/health
              </a>
            </Row>
          </Section>

          {/* ───── Updates (Electron only) ───── */}
          {window.electronAPI && (
            <Section
              icon={<RefreshCw className={`h-4 w-4 text-emerald-400 ${updatePhase === 'checking' ? 'animate-spin' : ''}`} />}
              title="Updates"
              description="App version, update feed URL, and manual update check"
            >
              <Row label="Current version">
                <span className="text-sm font-mono text-white font-semibold">
                  v{appVersion || '0.1.0'}
                </span>
              </Row>

              <Row
                label="Update feed URL"
                description="HTTP server that serves latest.yml + blockmap files for delta updates"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={feedUrl}
                    onChange={(e) => setFeedUrl(e.target.value)}
                    placeholder="http://localhost:8080"
                    className="w-56 rounded-lg bg-black/40 border border-white/10 px-3 py-1.5 text-xs text-white font-mono placeholder:text-white/20 outline-none focus:border-emerald-500/50 focus:bg-black/60 transition-all"
                  />
                  <button
                    onClick={handleSaveFeedUrl}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 transition-all"
                  >
                    Save
                  </button>
                </div>
              </Row>

              <Row
                label="Check for updates"
                description={
                  updatePhase === 'checking'
                    ? 'Contacting update server…'
                    : updatePhase === 'up-to-date'
                      ? '✓ You\'re on the latest version'
                      : updatePhase === 'available'
                        ? `v${updateVersion} available — downloading…`
                        : updatePhase === 'downloading'
                          ? `Downloading v${updateVersion} — ${updateProgress?.percent ?? 0}%`
                          : updatePhase === 'ready'
                            ? `✓ v${updateVersion} ready — restart to install`
                            : updatePhase === 'error'
                              ? 'Check failed — verify feed URL'
                              : 'Manually check the update server for a new version'
                }
              >
                <button
                  onClick={updatePhase === 'ready' ? () => window.electronAPI?.installUpdate() : handleCheckForUpdates}
                  disabled={updatePhase === 'checking' || updatePhase === 'downloading'}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    updatePhase === 'checking' || updatePhase === 'downloading'
                      ? 'bg-white/[0.02] text-white/20 border border-white/5 cursor-not-allowed'
                      : updatePhase === 'ready'
                        ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-[0_4px_16px_-6px_rgba(16,185,129,0.4)]'
                        : updatePhase === 'up-to-date'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25'
                          : 'bg-white/[0.04] text-white/70 border border-white/8 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  {updatePhase === 'checking' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : updatePhase === 'ready' ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : updatePhase === 'up-to-date' ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : updatePhase === 'downloading' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {updatePhase === 'checking'
                    ? 'Checking…'
                    : updatePhase === 'ready'
                      ? 'Restart Now'
                      : updatePhase === 'up-to-date'
                        ? 'Up to Date'
                        : updatePhase === 'downloading'
                          ? `${updateProgress?.percent ?? 0}%`
                          : 'Check Now'}
                </button>
              </Row>

              {/* Download progress bar (only during downloading) */}
              {updatePhase === 'downloading' && updateProgress && (
                <div className="px-1">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] text-white/30">
                      {updateProgress.bytesPerSecond > 0
                        ? `${(updateProgress.bytesPerSecond / 1024).toFixed(0)} KB/s`
                        : 'Starting…'}
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400/70">
                      {updateProgress.percent}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-300 ease-out"
                      style={{ width: `${Math.min(updateProgress.percent, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
