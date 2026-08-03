import { useState, useRef, useCallback } from 'react'
import {
  Download, Loader2, CheckCircle2, XCircle, X, Clock,
} from 'lucide-react'
import { cn, getBackendOrigin } from '../lib/utils'

interface Props {
  slug: string
  episodes: number[]
  availableTypes: string[]
  onClose: () => void
}

interface EpDownloadState {
  ep: number
  status: 'idle' | 'downloading' | 'completed' | 'failed'
  percent?: number
}

/**
 * Batch download dialog — queues episode downloads sequentially
 * using Electron's `startDownload` API.
 *
 * Features:
 * — Episode range picker (start / end)
 * — Sub / Dub / Hsub audio selector
 * — Sequential download queue (one at a time to avoid rate limits)
 * — Per-episode status + overall progress bar
 * — Cancel queued downloads
 */
export default function BatchDownloadDialog({
  slug, episodes, availableTypes, onClose,
}: Props) {
  const [rangeStart, setRangeStart] = useState(1)
  const [rangeEnd, setRangeEnd] = useState(Math.min(episodes.length, 25))
  const [streamType, setStreamType] = useState(
    availableTypes.includes('sub') ? 'sub' : availableTypes[0] ?? 'sub',
  )
  const [downloadStates, setDownloadStates] = useState<EpDownloadState[]>([])
  const [isDownloading, setIsDownloading] = useState(false)
  const [batchProvider, setBatchProvider] = useState<string>('')

  const cancelRef = useRef(false)
  const cleanupRefs = useRef<Array<() => void>>([])

  const maxEp = episodes.length

  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v))

  const targetEps = episodes.slice(
    Math.max(0, rangeStart - 1),
    Math.min(maxEp, rangeEnd),
  )

  const startBatch = useCallback(async () => {
    const api = (window.electronAPI as any)
    if (!api?.startDownload) return

    setIsDownloading(true)
    cancelRef.current = false
    const states: EpDownloadState[] = targetEps.map((ep) => ({
      ep,
      status: 'idle' as const,
    }))
    setDownloadStates([...states])

    for (let i = 0; i < targetEps.length; i++) {
      if (cancelRef.current) {
        // Mark remaining as idle (cancelled before start)
        break
      }

      const ep = targetEps[i]

      // Update current to downloading
      states[i].status = 'downloading'
      states[i].percent = 0
      setDownloadStates([...states])

      const origin = getBackendOrigin()
      const url = `${origin}/api/anidap/download/${encodeURIComponent(slug)}/${ep}/${encodeURIComponent(batchProvider)}/${encodeURIComponent(streamType)}?convert=1`

      try {
        await new Promise<void>((resolve) => {
          const cleanup = api.startDownload(url, (data: any) => {
            if (data.state === 'downloading') {
              states[i].percent = data.percent ?? 0
              setDownloadStates([...states])
            }
            if (data.state === 'completed') {
              states[i].status = 'completed'
              states[i].percent = 100
              setDownloadStates([...states])
              cleanup()
              resolve()
            }
            if (data.state === 'interrupted' || data.state === 'cancelled') {
              states[i].status = 'failed'
              setDownloadStates([...states])
              cleanup()
              resolve()
            }
          })
          cleanupRefs.current.push(cleanup)
        })
      } catch {
        states[i].status = 'failed'
        setDownloadStates([...states])
      }
    }

    setIsDownloading(false)
  }, [targetEps, slug, batchProvider, streamType])

  const cancelBatch = () => {
    cancelRef.current = true
    cleanupRefs.current.forEach((fn) => fn())
    cleanupRefs.current = []
    setIsDownloading(false)
  }

  const completedCount = downloadStates.filter((s) => s.status === 'completed').length
  const totalCount = targetEps.length
  const overallPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
      onClick={() => { if (!isDownloading) onClose() }}
    >
      <div
        className="glass-card rounded-2xl p-5 w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Download className="h-4 w-4 text-indigo-400" />
            Batch Download
          </h3>
          <button
            onClick={onClose}
            disabled={isDownloading}
            aria-label="Close"
            className="p-1.5 rounded-md text-white/30 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Audio type selector */}
        <div className="mb-4 shrink-0">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1.5 block">
            Audio
          </label>
          <div className="flex gap-1.5">
            {['sub', 'dub', 'hsub'].map((t) => {
              const available = availableTypes.includes(t)
              return (
                <button
                  key={t}
                  disabled={!available || isDownloading}
                  onClick={() => setStreamType(t)}
                  className={cn(
                    'flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all border',
                    streamType === t && available
                      ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                      : available
                        ? 'bg-white/[0.03] text-white/50 border-white/8 hover:bg-white/[0.06] hover:text-white/70'
                        : 'bg-white/[0.01] text-white/20 border-white/5 cursor-not-allowed',
                  )}
                >
                  {t.toUpperCase()}
                </button>
              )
            })}
          </div>
        </div>

        {/* Range picker */}
        <div className="mb-4 shrink-0">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1.5 block">
            Episode Range
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={maxEp}
              value={rangeStart}
              disabled={isDownloading}
              onChange={(e) =>
                setRangeStart(clamp(Number(e.target.value) || 1, 1, rangeEnd))
              }
              className="w-20 h-9 px-3 rounded-lg bg-white/[0.04] border border-white/10 text-white text-sm text-center focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/30 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-white/20 text-sm">to</span>
            <input
              type="number"
              min={rangeStart}
              max={maxEp}
              value={rangeEnd}
              disabled={isDownloading}
              onChange={(e) =>
                setRangeEnd(clamp(Number(e.target.value) || rangeStart, rangeStart, maxEp))
              }
              className="w-20 h-9 px-3 rounded-lg bg-white/[0.04] border border-white/10 text-white text-sm text-center focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/30 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[10px] text-white/30 ml-1">
              of {maxEp}
            </span>
          </div>
        </div>

        {/* Provider picker — use first available for the selected type */}
        <div className="mb-4 shrink-0">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1.5 block">
            Provider
          </label>
          <input
            type="text"
            value={batchProvider}
            onChange={(e) => setBatchProvider(e.target.value)}
            disabled={isDownloading}
            placeholder="e.g. saturn, gogoanime…"
            className="w-full h-9 px-3 rounded-lg bg-white/[0.04] border border-white/10 text-white text-xs placeholder:text-white/25 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
          />
        </div>

        {/* Action button */}
        <div className="mb-4 shrink-0">
          {!isDownloading ? (
            <button
              onClick={startBatch}
              disabled={!batchProvider.trim() || targetEps.length === 0}
              className="w-full py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              Download {targetEps.length} Episode{targetEps.length !== 1 ? 's' : ''}
            </button>
          ) : (
            <button
              onClick={cancelBatch}
              className="w-full py-2 rounded-lg text-sm font-bold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-all flex items-center justify-center gap-2"
            >
              <XCircle className="h-4 w-4" />
              Cancel Batch
            </button>
          )}
        </div>

        {/* Overall progress bar */}
        {downloadStates.length > 0 && (
          <div className="mb-3 shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono text-white/50">
                {completedCount}/{totalCount} done
              </span>
              <span className="text-[10px] font-mono text-indigo-300">
                {overallPct}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-300 ease-out"
                style={{ width: `${overallPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Episode queue list */}
        <div data-lenis-prevent className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-1 pr-1">
          {downloadStates.map((s) => (
            <div
              key={s.ep}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors',
                s.status === 'downloading' && 'bg-indigo-500/10 border border-indigo-500/15',
                s.status === 'completed' && 'bg-emerald-500/5',
                s.status === 'failed' && 'bg-red-500/5',
              )}
            >
              {/* Status icon */}
              <div className="shrink-0 w-4 h-4 flex items-center justify-center">
                {s.status === 'idle' && (
                  <Clock className="h-3 w-3 text-white/20" />
                )}
                {s.status === 'downloading' && (
                  <Loader2 className="h-3 w-3 text-indigo-400 animate-spin" />
                )}
                {s.status === 'completed' && (
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                )}
                {s.status === 'failed' && (
                  <XCircle className="h-3 w-3 text-red-400" />
                )}
              </div>

              {/* Episode label */}
              <span
                className={cn(
                  'font-mono font-semibold flex-1',
                  s.status === 'completed' && 'text-emerald-300',
                  s.status === 'failed' && 'text-red-300',
                  s.status === 'downloading' && 'text-indigo-300',
                  s.status === 'idle' && 'text-white/30',
                )}
              >
                EP {s.ep}
              </span>

              {/* Percent */}
              {s.status === 'downloading' && s.percent != null && (
                <span className="text-[10px] font-mono text-indigo-300/80">
                  {s.percent}%
                </span>
              )}

              {/* Mini progress bar */}
              {s.status === 'downloading' && (
                <div className="w-12 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-400 transition-all duration-300"
                    style={{ width: `${Math.min(s.percent ?? 0, 100)}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
