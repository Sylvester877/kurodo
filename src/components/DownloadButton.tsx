import { useState, useEffect, useRef } from 'react'
import { Download, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { cn, getBackendOrigin } from '../lib/utils'

interface Props {
  slug: string
  episode: number
  provider: string
  type: string
  className?: string
  /** Called when this single download completes (for batch tracking). */
  onComplete?: (episode: number, success: boolean) => void
  /** Optional magnet URI — when provided, downloads via WebTorrent instead of ffmpeg. */
  magnetUri?: string
}

interface DownloadProgress {
  state: 'preparing' | 'downloading' | 'completed' | 'cancelled' | 'interrupted'
  percent: number
  received?: number
  total?: number
  filename?: string
}

/**
 * One-click download button matching the Watch page button bar style.
 *
 * In Electron: uses `window.electronAPI.startDownload()` → main process
 * calls `webContents.downloadURL()` → progress updates via IPC.
 * Shows progress as the button label text (e.g. "45%", "Done", "Failed").
 *
 * In browser: falls back to a plain `<a download>` tag.
 */
export default function DownloadButton({
  slug, episode, provider, type, className, onComplete, magnetUri,
}: Props) {
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [torrentPhase, setTorrentPhase] = useState<'idle' | 'fetching' | 'downloading' | 'done'>('idle')
  const cleanupRef = useRef<(() => void) | null>(null)
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isElectron = !!(window.electronAPI as any)?.startDownload
  const canTorrent = !!(window.electronAPI as any)?.addTorrent && !!magnetUri

  const downloadUrl = `${getBackendOrigin()}/api/anidap/download/${encodeURIComponent(slug)}/${episode}/${encodeURIComponent(provider)}/${encodeURIComponent(type)}?convert=1`

  // Clean up IPC listener + auto-dismiss timer on unmount
  useEffect(() => () => {
    cleanupRef.current?.()
    if (autoDismissRef.current) clearTimeout(autoDismissRef.current)
  }, [])

  const handleElectronDownload = () => {
    const api = (window.electronAPI as any)
    if (!api?.startDownload) return

    setProgress({ state: 'preparing', percent: 0 })

    cleanupRef.current = api.startDownload(downloadUrl, (data: DownloadProgress) => {
      setProgress(data)
      if (data.state === 'completed') {
        onComplete?.(episode, true)
        autoDismissRef.current = setTimeout(() => setProgress(null), 3000)
      } else if (data.state === 'cancelled' || data.state === 'interrupted') {
        onComplete?.(episode, false)
        autoDismissRef.current = setTimeout(() => setProgress(null), 4000)
      }
    })
  }

  const handleTorrentDownload = async () => {
    const api = (window.electronAPI as any)
    if (!api?.addTorrent || !magnetUri) return

    // Validate magnet URI before sending to WebTorrent
    if (!/^(magnet:|[0-9a-fA-F]{40}$)/.test(magnetUri.trim())) {
      console.warn('[download] Invalid magnet URI, falling back to ffmpeg')
      handleElectronDownload()
      return
    }

    let cancelled = false
    // CRITICAL: register cleanup BEFORE the first await so unmount
    // during addTorrent() still sets cancelled and prevents the
    // zombie setInterval below.
    const prev = cleanupRef.current
    cleanupRef.current = () => {
      cancelled = true
      prev?.()
    }

    setTorrentPhase('fetching')
    setProgress({ state: 'preparing', percent: 0 })

    try {
      const info = await api.addTorrent(magnetUri)
      if (cancelled) return
      if (!info?.files?.length) {
        setProgress({ state: 'interrupted', percent: 0 })
        setTorrentPhase('idle')
        onComplete?.(episode, false)
        return
      }

      // Auto-select the largest video file
      const vidFiles = info.files
        .map((f: any, i: number) => ({ ...f, index: i }))
        .filter((f: any) => /\.(mkv|mp4|avi|webm|mov)(\b|$)/i.test(f.name))
        .sort((a: any, b: any) => b.length - a.length)

      const target = vidFiles[0] ?? info.files[0]
      api.selectTorrentFile(info.infoHash, target.index)

      if (cancelled) return
      setTorrentPhase('downloading')

      let busy = false
      const interval = setInterval(async () => {
        if (busy) return // skip if previous tick still running
        busy = true
        try {
          const details = await api.getTorrentFileDetails(info.infoHash, target.index)
          if (details) {
            setProgress({
              state: details.progress >= 100 ? 'completed' : 'downloading',
              percent: details.progress,
              received: details.downloaded,
              total: details.length,
              filename: details.name,
            })
            if (details.progress >= 100) {
              clearInterval(interval)
              setTorrentPhase('done')
              onComplete?.(episode, true)
              autoDismissRef.current = setTimeout(() => {
                setProgress(null)
                setTorrentPhase('idle')
              }, 3000)
            }
          }
        } finally {
          busy = false
        }
      }, 1500)

      // Update cleanup to include the interval
      const prev2 = cleanupRef.current
      cleanupRef.current = () => {
        cancelled = true
        clearInterval(interval)
        prev2?.()
      }
    } catch (err: any) {
      if (cancelled) return
      setProgress({ state: 'interrupted', percent: 0 })
      setTorrentPhase('idle')
      onComplete?.(episode, false)
    }
  }

  const isActive = progress != null

  const getLabel = () => {
    if (torrentPhase === 'fetching') return 'Fetching…'
    if (progress?.state === 'preparing') return torrentPhase === 'downloading' ? '0%' : 'Preparing…'
    if (progress?.state === 'downloading') return `${progress.percent}%`
    if (progress?.state === 'completed') return 'Done'
    if (progress?.state === 'interrupted') return 'Failed'
    if (canTorrent) return 'Download'
    return 'Download'
  }

  const buttonStyle = cn(
    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
    isActive
      ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
      : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300 hover:bg-indigo-500/20 hover:text-indigo-200',
    className,
  )

  if (isElectron) {
    return (
      <button
        onClick={canTorrent ? handleTorrentDownload : handleElectronDownload}
        disabled={isActive}
        aria-label={canTorrent ? 'Download via torrent' : 'Download episode'}
        className={buttonStyle}
        title={canTorrent ? 'Download via WebTorrent (P2P)' : undefined}
      >
        {isActive && progress?.state === 'completed' ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : isActive && progress?.state === 'interrupted' ? (
          <XCircle className="h-3.5 w-3.5" />
        ) : isActive ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">{getLabel()}</span>
      </button>
    )
  }

  return (
    <a
      href={downloadUrl}
      download
      aria-label="Download episode"
      className={buttonStyle}
    >
      <Download className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Download</span>
    </a>
  )
}
