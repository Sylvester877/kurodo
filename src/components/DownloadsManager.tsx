import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Download, Loader2, CheckCircle2, XCircle, X, FolderOpen,
  FileVideo, Magnet, Plus, Trash2, Wifi, Play, Subtitles,
  Search, Globe, Key,
} from 'lucide-react'
import { cn } from '../lib/utils'
import type { DownloadEntry } from '../types'

/** Open a video stream with an external subtitle track in a new browser tab. */
function openStreamWithSubs(streamUrl: string, subUrl: string, title: string) {
  const html = [
    '<!DOCTYPE html><html><head>',
    `<title>${title}</title>`,
    '</head><body style="margin:0;background:#000">',
    '<video controls autoplay style="width:100vw;height:100vh" crossorigin="anonymous">',
    `<source src="${streamUrl}">`,
    `<track kind="subtitles" src="${subUrl}" default>`,
    '</video></body></html>',
  ].join('')
  const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const w = window.open(blobUrl, '_blank')
  // Revoke the blob URL after a short delay so the new window has time to load it.
  // If popup was blocked, revoke immediately to avoid leaking memory.
  if (!w) {
    URL.revokeObjectURL(blobUrl)
    return false
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 3000)
  return true
}

interface TorrentInfo {
  infoHash: string
  name: string
  magnetURI: string
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  downloaded: number
  total: number
  numPeers: number
  done: boolean
  files: Array<{
    name: string
    length: number
    downloaded: number
    progress: number
  }>
}

function formatBytes(b: number) {
  if (!b || b <= 0) return ''
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatSpeed(bps: number) {
  if (!bps || bps <= 0) return ''
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

function formatTimeAgo(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'Just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return `${Math.floor(diff / 86400_000)}d ago`
}

function extractEpisode(filename: string): string | null {
  const m = filename.match(/[Ee][Pp]?\s*(\d+)/) ?? filename.match(/Episode\s*(\d+)/i)
  return m ? `EP ${m[1]}` : null
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function DownloadsManager({ open, onClose }: Props) {
  const [history, setHistory] = useState<DownloadEntry[]>([])
  const [torrents, setTorrents] = useState<TorrentInfo[]>([])
  const [magnetInput, setMagnetInput] = useState('')
  const [addingTorrent, setAddingTorrent] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const api = (window as any).electronAPI

  // Load initial history + subscribe to updates
  useEffect(() => {
    if (!api?.getDownloadHistory) return
    setHistory(api.getDownloadHistory?.() ?? [])

    const cleanup = api.onDownloadHistoryUpdate?.((h: DownloadEntry[]) => setHistory(h))
    return () => cleanup?.()
  }, [api])

  // Subscribe to torrent progress
  useEffect(() => {
    if (!api?.onTorrentProgress) return
    const cleanup = api.onTorrentProgress((data: TorrentInfo[]) => {
      setTorrents(data ?? [])
    })
    return () => cleanup?.()
  }, [api])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open, onClose])

  const clearHistory = useCallback(() => {
    api?.clearDownloadHistory?.()
  }, [api])

  const handleAddMagnet = async () => {
    const uri = magnetInput.trim()
    if (!uri || !api?.addTorrent) return

    if (!/^magnet:\?xt=urn:btih:/i.test(uri) && !/^[0-9a-fA-F]{40}$/.test(uri)) {
      return
    }

    setAddingTorrent(true)
    try {
      const info = await api.addTorrent(uri)
      if (info?.files) {
        info.files.forEach((_: any, i: number) => api.selectTorrentFile(info.infoHash, i))
      }
      setMagnetInput('')
    } catch (err: any) {
      console.error('[torrent] Add failed:', err)
    } finally {
      setAddingTorrent(false)
    }
  }

  if (!open) return null

  const activeDownloads = history.filter((d) => d.state === 'preparing' || d.state === 'downloading')
  const pastDownloads = history
    .filter((d) => d.state === 'completed' || d.state === 'cancelled' || d.state === 'interrupted')
    .sort((a, b) => (b.endTime ?? b.startTime) - (a.endTime ?? a.startTime))

  const activeTorrents = torrents.filter((t) => !t.done)
  const completedTorrents = torrents.filter((t) => t.done)

  const totalActive = activeDownloads.length + activeTorrents.length

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />

      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[420px] h-full bg-[#0d0d0d] border-l border-white/[0.06] flex flex-col animate-[slideInRight_0.25s_ease] shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/15 grid place-items-center">
              <Download className="h-4 w-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Downloads</h3>
              <button
                onClick={() => api?.openTorrentFolder?.()}
                title="Open KurodoTorrents folder"
                className="text-[10px] text-white/25 hover:text-white/60 transition-colors flex items-center gap-1 mt-0.5"
              >
                <FolderOpen className="h-3 w-3" />
                Open folder
              </button>
              {totalActive > 0 && (
                <p className="text-[10px] text-indigo-300/80 font-mono">
                  {totalActive} active
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-md text-white/45 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div data-lenis-prevent className="flex-1 overflow-y-auto custom-scrollbar py-2">
          {api?.addTorrent && (
            <div className="px-5 pb-3 mb-2 border-b border-white/[0.04]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-2 flex items-center gap-1.5">
                <Magnet className="h-3 w-3" />
                Add Magnet
              </p>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={magnetInput}
                  onChange={(e) => setMagnetInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddMagnet()}
                  placeholder="magnet:?xt=urn:btih:..."
                  className="flex-1 h-8 px-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-white text-[11px] font-mono placeholder:text-white/20 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                />
                <button
                  onClick={handleAddMagnet}
                  disabled={addingTorrent || !magnetInput.trim()}
                  className="px-3 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-[11px] font-semibold hover:bg-indigo-500/30 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
                >
                  {addingTorrent ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  Add
                </button>
              </div>
            </div>
          )}

          {activeTorrents.length > 0 && (
            <div className="mb-4">
              <p className="px-5 text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-2 flex items-center gap-1.5">
                <Wifi className="h-3 w-3" />
                Torrents
              </p>
              {activeTorrents.map((t) => (
                <TorrentRow key={t.infoHash} torrent={t} isActive />
              ))}
            </div>
          )}

          {completedTorrents.length > 0 && (
            <div className="mb-4">
              <p className="px-5 text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-2 flex items-center gap-1.5">
                <Wifi className="h-3 w-3" />
                Seeding ({completedTorrents.length})
              </p>
              {completedTorrents.map((t) => (
                <TorrentRow key={t.infoHash} torrent={t} />
              ))}
            </div>
          )}

          {activeDownloads.length > 0 && (
            <div className="mb-4">
              <p className="px-5 text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-2">
                Downloading
              </p>
              {activeDownloads.map((d) => (
                <DownloadRow key={d.id} download={d} isActive />
              ))}
            </div>
          )}

          {pastDownloads.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-5 mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
                  Recent
                </p>
                <button
                  onClick={clearHistory}
                  className="text-[9px] text-white/25 hover:text-white/60 transition-colors"
                >
                  Clear all
                </button>
              </div>
              {pastDownloads.map((d) => (
                <DownloadRow key={d.id} download={d} />
              ))}
            </div>
          )}

          {history.length === 0 && torrents.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 px-8 text-center">
              <div className="h-12 w-12 rounded-xl bg-white/[0.03] grid place-items-center">
                <Download className="h-5 w-5 text-white/15" />
              </div>
              <div>
                <p className="text-sm text-white/30 font-medium mb-1">No downloads yet</p>
                <p className="text-[11px] text-white/20 leading-relaxed">
                  Downloads from the Watch page appear here.
                  {api?.addTorrent && ' Paste a magnet link above to download via torrent.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** A torrent download row — shows P2P download status with subtitle support. */
function TorrentRow({ torrent: t, isActive }: { torrent: TorrentInfo; isActive?: boolean }) {
  const api = (window as any).electronAPI
  const epLabel = extractEpisode(t.name)
  const [subProbing, setSubProbing] = useState(false)
  const [subStreams, setSubStreams] = useState<any[] | null>(null)
  const [extractingIdx, setExtractingIdx] = useState<number | null>(null)
  // Wyzie Subs fallback state
  const [wyzieQuery, setWyzieQuery] = useState('')
  const [wyzieSearching, setWyzieSearching] = useState(false)
  const [wyzieResults, setWyzieResults] = useState<any[] | null>(null)
  const [wyzieError, setWyzieError] = useState('')
  const [wyzieDownloading, setWyzieDownloading] = useState<string | null>(null)
  // Wyzie API key input
  const [showWyzieKey, setShowWyzieKey] = useState(false)
  const [wyzieKey, setWyzieKeyLocal] = useState(api?.getWyzieKey?.() ?? '')
  // AniList title lookup
  const [titleLookup, setTitleLookup] = useState('')
  const [titleSearching, setTitleSearching] = useState(false)
  const [titleResults, setTitleResults] = useState<any[] | null>(null)

  const vidFileIdx = t.files
    ?.map((f: any, i: number) => ({ ...f, i }))
    .filter((f: any) => /\.(mkv|mp4|webm|avi|mov)$/i.test(f.name))
    .sort((a: any, b: any) => b.length - a.length)[0]?.i ?? 0

  const handleProbeSubtitles = async () => {
    if (!api?.probeTorrentSubtitles || subProbing) return
    setSubProbing(true)
    setSubStreams(null)
    // Reset Wyzie state when re-probing
    setWyzieResults(null)
    setWyzieError('')
    setTitleResults(null)
    try {
      const result = await api.probeTorrentSubtitles(t.infoHash, vidFileIdx)
      setSubStreams(result?.streams ?? [])
    } catch {
      setSubStreams([])
    } finally {
      setSubProbing(false)
    }
  }

  const handleExtractAndStream = async (streamIdx: number) => {
    if (!api?.extractTorrentSubtitle || !api?.getTorrentStreamUrl) return
    setExtractingIdx(streamIdx)
    try {
      const [subResult, streamUrl] = await Promise.all([
        api.extractTorrentSubtitle(t.infoHash, vidFileIdx, streamIdx),
        api.getTorrentStreamUrl(t.infoHash, vidFileIdx),
      ])
      if (subResult?.url && streamUrl) {
        const ok = openStreamWithSubs(streamUrl, subResult.url, t.name)
        if (!ok) console.warn('[torrent] Popup blocked — stream window could not open')
      }
    } catch {
      // ignore
    } finally {
      setExtractingIdx(null)
    }
  }

  // AbortController refs to cancel in-flight requests when a new search starts
  const wyzieAbortRef = useRef<AbortController | null>(null)
  const titleAbortRef = useRef<AbortController | null>(null)

  // Clean up in-flight requests when this torrent row unmounts
  useEffect(() => () => {
    wyzieAbortRef.current?.abort()
    titleAbortRef.current?.abort()
  }, [])

  const handleWyzieSearch = async () => {
    const q = wyzieQuery.trim()
    if (!q || !api?.wyzieSearch || wyzieSearching) return
    // Cancel any previous in-flight Wyzie search
    if (wyzieAbortRef.current) wyzieAbortRef.current.abort()
    wyzieAbortRef.current = new AbortController()
    const signal = wyzieAbortRef.current.signal

    setWyzieSearching(true)
    setWyzieError('')
    setWyzieResults(null)
    try {
      const result = await api.wyzieSearch(q)
      if (signal.aborted) return
      if (result?.error) { setWyzieError(result.error); setWyzieResults([]) }
      else setWyzieResults(result?.results ?? [])
    } catch {
      if (signal.aborted) return
      setWyzieError('Search failed')
      setWyzieResults([])
    } finally {
      if (!signal.aborted) setWyzieSearching(false)
    }
  }

  const handleWyzieDownload = async (r: any) => {
    if (!api?.wyzieDownload || !api?.getTorrentStreamUrl) return
    setWyzieDownloading(r.url)
    try {
      const [subResult, streamUrl] = await Promise.all([
        api.wyzieDownload(r.url, r.format),
        api.getTorrentStreamUrl(t.infoHash, vidFileIdx),
      ])
      if (subResult?.url && streamUrl) {
        const ok = openStreamWithSubs(streamUrl, subResult.url, t.name)
        if (!ok) console.warn('[torrent] Popup blocked — stream window could not open')
      }
    } catch {
      // ignore
    } finally {
      setWyzieDownloading(null)
    }
  }

  const handleWyzieKeySave = async () => {
    if (!api?.setWyzieKey) return
    const result = await api.setWyzieKey(wyzieKey)
    if (result?.success) setShowWyzieKey(false)
  }

  // AniList title → ID lookup (uses the app's existing AniList GraphQL in the renderer)
  const handleTitleLookup = async () => {
    const q = titleLookup.trim()
    if (!q || titleSearching) return
    // Cancel any previous in-flight title lookup
    if (titleAbortRef.current) titleAbortRef.current.abort()
    titleAbortRef.current = new AbortController()
    const signal = titleAbortRef.current.signal

    setTitleSearching(true)
    setTitleResults(null)
    try {
      // Use the app's AniList client to search by title
      const { anilistRequest } = await import('../api/anilistClient')
      const data = await anilistRequest<{
        Page: { media: Array<{ id: number; idMal: number | null; title: { romaji: string; english: string | null }; format: string; episodes: number | null }> }
      }>(
        `query ($q: String) {
          Page(page: 1, perPage: 5) {
            media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
              id idMal
              title { romaji english }
              format episodes
            }
          }
        }`,
        { q },
      )
      if (signal.aborted) return
      setTitleResults(data.Page?.media ?? [])
    } catch {
      if (signal.aborted) return
      setTitleResults([])
    } finally {
      if (!signal.aborted) setTitleSearching(false)
    }
  }

  // When user selects an AniList result, use the MAL ID as the Wyzie search query
  const handleTitleSelect = (media: any) => {
    const id = media.idMal || media.id
    if (id) {
      setWyzieQuery(String(id))
      setTitleResults(null) // close the picker
    }
  }

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-5 py-2.5 transition-colors',
        isActive && 'bg-indigo-500/[0.04]',
        !isActive && 'hover:bg-white/[0.02]',
      )}
    >
      <div className="shrink-0 mt-0.5">
        {isActive ? (
          <Magnet className="h-4 w-4 text-indigo-400 animate-pulse" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {epLabel && (
            <span className="text-[10px] font-mono font-bold text-indigo-300/80 bg-indigo-500/10 px-1.5 py-0.5 rounded">
              {epLabel}
            </span>
          )}
          <p className="text-xs truncate text-white/70" title={t.name}>
            {t.name || 'Unknown torrent'}
          </p>
        </div>

        <div className="flex items-center gap-2 mt-1">
          {isActive && (
            <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-400 transition-all duration-300"
                style={{ width: `${Math.min(t.progress, 100)}%` }}
              />
            </div>
          )}
          <span className="text-[10px] text-white/30 font-mono shrink-0">
            {isActive
              ? `${t.progress}% · ${formatSpeed(t.downloadSpeed)} · ${t.numPeers} peers`
              : `${formatBytes(t.total)} · Done`}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Subtitles button — probe for embedded subtitle streams */}
        {t.files?.length > 0 && api?.probeTorrentSubtitles && (
          <div className="relative flex flex-col items-end">
            <button
              onClick={handleProbeSubtitles}
              disabled={subProbing}
              title="Detect subtitles"
              className="p-1.5 rounded-md text-white/45 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
            >
              {subProbing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Subtitles className="h-3.5 w-3.5" />
              )}
            </button>
            {/* Subtitle stream picker dropdown */}
            {subStreams && subStreams.length > 0 && (
              <div className="glass-card rounded-lg border border-white/10 p-1.5 shadow-lg z-10 min-w-[160px]">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-white/40 px-2 py-1">
                  Subtitles ({subStreams.length})
                </p>
                {subStreams.map((s: any) => (
                  <button
                    key={s.index}
                    onClick={() => handleExtractAndStream(s.index)}
                    disabled={extractingIdx !== null}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-50 transition-colors"
                  >
                    <span className="text-[9px] font-mono bg-white/[0.06] px-1 rounded">
                      {s.language?.toUpperCase() || '?'}
                    </span>
                    <span className="truncate">{s.title || `Track ${s.index}`}</span>
                    {extractingIdx === s.index && (
                      <Loader2 className="h-3 w-3 animate-spin ml-auto" />
                    )}
                  </button>
                ))}
              </div>
            )}
            {subStreams && subStreams.length === 0 && !subProbing && (
              <div className="glass-card rounded-lg border border-white/10 p-2 shadow-lg z-10 min-w-[220px]">
                <p className="text-[10px] text-white/50 px-1 pb-1.5 border-b border-white/5">
                  No embedded subs found
                </p>
                {/* Wyzie Subs fallback search */}
                {api?.wyzieSearch && (
                  <div className="pt-1.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-white/30 px-1 mb-1 flex items-center gap-1">
                      <Globe className="h-2.5 w-2.5" />
                      Wyzie Subs
                    </p>

                    {/* API key input (if not set) */}
                    {!wyzieKey && (
                      <div className="px-1 mb-1.5">
                        {showWyzieKey ? (
                          <div className="flex gap-1">
                            <input
                              type="text"
                              value={wyzieKey}
                              onChange={(e) => setWyzieKeyLocal(e.target.value)}
                              placeholder="Wyzie API key"
                              className="flex-1 h-6 px-2 rounded-md bg-white/[0.06] border border-white/10 text-white text-[9px] placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                            />
                            <button
                              onClick={handleWyzieKeySave}
                              className="px-1.5 h-6 rounded-md bg-amber-500/15 border border-amber-500/25 text-amber-300 text-[9px] font-semibold hover:bg-amber-500/25 transition-colors"
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowWyzieKey(true)}
                            className="flex items-center gap-1 text-[9px] text-amber-400/60 hover:text-amber-400 transition-colors"
                          >
                            <Key className="h-2.5 w-2.5" />
                            Set API key
                          </button>
                        )}
                      </div>
                    )}

                    {/* AniList title search (find IMDb/TMDB ID from anime title) */}
                    <div className="flex gap-1 px-1 mb-1">
                      <input
                        type="text"
                        value={titleLookup}
                        onChange={(e) => setTitleLookup(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleTitleLookup() }}
                        placeholder="Find by title..."
                        className="flex-1 h-6 px-2 rounded-md bg-white/[0.06] border border-white/10 text-white text-[9px] placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                      />
                      <button
                        onClick={handleTitleLookup}
                        disabled={titleSearching || !titleLookup.trim()}
                        className="px-1.5 h-6 rounded-md bg-white/[0.06] border border-white/10 text-white/40 text-[9px] font-semibold hover:bg-white/10 disabled:opacity-30 transition-colors flex items-center gap-1"
                      >
                        {titleSearching ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <Search className="h-2.5 w-2.5" />
                        )}
                      </button>
                    </div>
                    {/* Title lookup results */}
                    {titleResults && titleResults.length > 0 && (
                      <div data-lenis-prevent className="px-1 mb-1.5 max-h-[100px] overflow-y-auto custom-scrollbar">
                        {titleResults.map((m: any) => (
                          <button
                            key={m.id}
                            onClick={() => handleTitleSelect(m)}
                            className="w-full text-left text-[9px] text-white/50 hover:text-white hover:bg-white/5 px-1 py-0.5 rounded transition-colors"
                          >
                            {m.title?.english || m.title?.romaji || 'Unknown'}
                            <span className="text-white/20 ml-1">
                              {m.idMal ? `MAL#${m.idMal}` : `AniList#${m.id}`}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Manual ID search */}
                    <div className="flex gap-1 px-1">
                      <input
                        type="text"
                        value={wyzieQuery}
                        onChange={(e) => setWyzieQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleWyzieSearch() }}
                        placeholder="IMDb/TMDB ID (tt1234567)"
                        className="flex-1 h-7 px-2 rounded-md bg-white/[0.06] border border-white/10 text-white text-[10px] placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                      />
                      <button
                        onClick={handleWyzieSearch}
                        disabled={wyzieSearching || !wyzieQuery.trim()}
                        className="px-2 h-7 rounded-md bg-amber-500/15 border border-amber-500/25 text-amber-300 text-[10px] font-semibold hover:bg-amber-500/25 disabled:opacity-30 transition-colors flex items-center gap-1"
                      >
                        {wyzieSearching ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <Search className="h-2.5 w-2.5" />
                        )}
                      </button>
                    </div>
                    {wyzieError && (
                      <p className="text-[9px] text-red-400/70 px-1 mt-1">{wyzieError}</p>
                    )}
                    {/* Wyzie results */}
                    {wyzieResults && wyzieResults.length > 0 && (
                      <div data-lenis-prevent className="mt-1.5 max-h-[180px] overflow-y-auto custom-scrollbar">
                        {wyzieResults.map((r: any) => (
                          <button
                            key={r.url}
                            onClick={() => handleWyzieDownload(r)}
                            disabled={wyzieDownloading !== null}
                            className="w-full flex items-center gap-2 px-1.5 py-1 text-left text-[10px] text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-50 transition-colors rounded"
                          >
                            <span className="text-[8px] font-mono bg-white/[0.06] px-1 rounded shrink-0">
                              {r.language?.toUpperCase() || '?'}
                            </span>
                            <span className="text-[8px] font-mono bg-amber-500/10 px-1 rounded shrink-0">
                              {r.format?.toUpperCase()}
                            </span>
                            <span className="truncate">{r.release || r.display || 'Unknown'}</span>
                            {r.hearingImpaired && (
                              <span className="text-[7px] text-white/25 shrink-0">SDH</span>
                            )}
                            {wyzieDownloading === r.url && (
                              <Loader2 className="h-2.5 w-2.5 animate-spin ml-auto shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    {wyzieResults && wyzieResults.length === 0 && !wyzieSearching && !wyzieError && (
                      <p className="text-[9px] text-white/30 px-1 mt-1">No results on Wyzie</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* Stream button — watch while downloading */}
        {t.files?.length > 0 && (
          <button
            onClick={async () => {
              const api = (window as any).electronAPI
              if (!api?.getTorrentStreamUrl) return
              const url = await api.getTorrentStreamUrl(t.infoHash, vidFileIdx)
              if (url) window.open(url, '_blank')
            }}
            title="Stream in browser"
            className="p-1.5 rounded-md text-white/20 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={() => api?.removeTorrent?.(t.infoHash)}
          title="Remove torrent"
          className="p-1.5 rounded-md text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

/** A single download row — used for both active and past entries. */
function DownloadRow({
  download: d,
  isActive,
}: {
  download: DownloadEntry
  isActive?: boolean
}) {
  const api = (window as any).electronAPI
  const epLabel = extractEpisode(d.filename)

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-5 py-2.5 transition-colors',
        isActive && 'bg-indigo-500/[0.04]',
        d.state === 'completed' && 'hover:bg-white/[0.02]',
      )}
    >
      <div className="shrink-0 mt-0.5">
        {d.state === 'downloading' || d.state === 'preparing' ? (
          <Loader2 className="h-4 w-4 text-indigo-400 animate-spin" />
        ) : d.state === 'completed' ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        ) : (
          <XCircle className="h-4 w-4 text-red-400" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {epLabel && (
            <span className="text-[10px] font-mono font-bold text-indigo-300/80 bg-indigo-500/10 px-1.5 py-0.5 rounded">
              {epLabel}
            </span>
          )}
          <p
            className={cn(
              'text-xs truncate',
              d.state === 'completed' ? 'text-white/70' : 'text-white/60',
            )}
            title={d.filename}
          >
            {d.filename || 'Unknown file'}
          </p>
        </div>

        <div className="flex items-center gap-2 mt-1">
          {(d.state === 'downloading' || d.state === 'preparing') && (
            <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-400 transition-all duration-300"
                style={{ width: `${Math.min(d.percent, 100)}%` }}
              />
            </div>
          )}

          <span className="text-[10px] text-white/30 font-mono shrink-0">
            {d.state === 'completed'
              ? `${formatBytes(d.total)} · ${d.endTime ? formatTimeAgo(d.endTime) : ''}`
              : d.state === 'downloading'
                ? `${d.percent}%${d.total > 0 ? ` · ${formatBytes(d.received)} / ${formatBytes(d.total)}` : ''}`
                : d.state === 'preparing'
                  ? 'Preparing…'
                  : d.state === 'interrupted'
                    ? 'Failed'
                    : 'Cancelled'}
          </span>
        </div>
      </div>

      {d.state === 'completed' && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => api?.openDownloadFile?.(d.savePath)}
            title="Open file"
            className="p-1.5 rounded-md text-white/25 hover:text-white/60 hover:bg-white/[0.04] transition-colors"
          >
            <FileVideo className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => api?.openDownloadFolder?.(d.savePath)}
            title="Show in folder"
            className="p-1.5 rounded-md text-white/25 hover:text-white/60 hover:bg-white/[0.04] transition-colors"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
