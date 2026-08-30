/**
 * Electron preload script — runs in a privileged context before the web
 * page loads. Exposes safe IPC channels to the renderer via contextBridge.
 *
 * Uses .cjs extension so it loads as CommonJS even though the project
 * package.json sets "type": "module" — Electron's preload sandbox
 * requires `require()` for contextBridge.
 */

const { contextBridge, ipcRenderer, shell } = require('electron')

// ── Crash-recovery signal ─────────────────────────────────────────
// The main process sends 'app:recovered' whenever it reloads/recreates the
// main window after a renderer crash. We timestamp it here so the SPA can
// detect "this boot was a crash recovery" and stay paused instead of
// auto-playing (the "app opens an anime by itself" bug).
let lastRecoveredAt = 0
ipcRenderer.on('app:recovered', () => { lastRecoveredAt = Date.now() })

contextBridge.exposeInMainWorld('electronAPI', {
  // ── App info ──────────────────────────────────────────────────────
  /** True when running inside Electron (vs a regular browser tab). */
  isElectron: true,

  // ── Crash recovery ───────────────────────────────────────────────
  /** True when this window was recreated/reloaded after a renderer crash
   *  within the last `maxAgeMs` (default 15s). Pages use this to avoid
   *  auto-playing on boot. */
  wasRecentlyRecovered: (maxAgeMs = 15000) =>
    Date.now() - lastRecoveredAt < maxAgeMs,

  /** Backend origin (e.g. http://localhost:5173) for absolute API/image URLs. */
  backendOrigin: process.env.KURODO_BACKEND_ORIGIN || `http://localhost:${process.env.PORT || 5173}`,

  /** The Electron/Chromium version string. */
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  // ── Window controls ───────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // ── External links ────────────────────────────────────────────────
  /** Open a URL in the system's default browser. */
  openExternal: (url) => {
    if (typeof url === 'string' && url.startsWith('http')) {
      shell.openExternal(url)
    }
  },

  // ── Auto-update ───────────────────────────────────────────────────
  /** Listen for 'update-available' events from main process. */
  onUpdateAvailable: (callback) => {
    const handler = (_event, info) => callback(info)
    ipcRenderer.on('update-available', handler)
    return () => ipcRenderer.removeListener('update-available', handler)
  },
  /** Listen for update download progress. */
  onUpdateProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('update-download-progress', handler)
    return () => ipcRenderer.removeListener('update-download-progress', handler)
  },
  /** Listen for 'update-ready' events from main process. */
  onUpdateReady: (callback) => {
    ipcRenderer.on('update-ready', (_event, info) => callback(info))
  },
  /** Remove update-ready listener. */
  removeUpdateReadyListener: () => {
    ipcRenderer.removeAllListeners('update-ready')
  },
  /** Tell the main process to quit and install the downloaded update. */
  installUpdate: () => ipcRenderer.send('update:install'),

  // ── Update settings (Settings page) ────────────────────────────────
  /** Get the current app version. */
  getAppVersion: () => ipcRenderer.sendSync('update:getVersion'),
  /** Get the current update feed URL. */
  getUpdateFeedUrl: () => ipcRenderer.sendSync('update:getFeedUrl'),
  /** Set a new update feed URL at runtime. */
  setUpdateFeedUrl: (url) => ipcRenderer.send('update:setFeedUrl', url),
  /** Manually trigger an update check. */
  checkForUpdates: () => ipcRenderer.send('update:check'),
  /** Listen for 'checking-for-update' events. */
  onUpdateChecking: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('update-checking', handler)
    return () => ipcRenderer.removeListener('update-checking', handler)
  },
  /** Listen for 'update-not-available' events. */
  onUpdateNotAvailable: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('update-not-available', handler)
    return () => ipcRenderer.removeListener('update-not-available', handler)
  },
  /** Listen for update error events. */
  onUpdateError: (callback) => {
    const handler = (_event, message) => callback(message)
    ipcRenderer.on('update-error', handler)
    return () => ipcRenderer.removeListener('update-error', handler)
  },

  // ── Downloads ──────────────────────────────────────────────────────
  /** Start a download via Electron's native download manager.
   *  Returns progress updates via the callback: { state, percent, speed, filename }
   *  state: 'preparing' | 'downloading' | 'completed' | 'cancelled' | 'interrupted'
   *  Call the returned cleanup function to remove the listener. */
  startDownload: (url, callback) => {
    const channel = `download:progress:${Date.now()}`
    const handler = (_event, data) => callback(data)
    ipcRenderer.on(channel, handler)
    ipcRenderer.send('download:start', { url, channel })
    // Return cleanup function
    return () => ipcRenderer.removeAllListeners(channel)
  },

  /** Get all download history entries via synchronous IPC. */
  getDownloadHistory: () => ipcRenderer.sendSync('downloads:getHistory'),
  /** Clear completed, cancelled, and failed downloads from history. */
  clearDownloadHistory: () => ipcRenderer.send('downloads:clearHistory'),
  /** Listen for download history updates from the main process. */
  onDownloadHistoryUpdate: (callback) => {
    const handler = (_event, history) => callback(history)
    ipcRenderer.on('downloads:historyUpdate', handler)
    // Return cleanup
    return () => ipcRenderer.removeListener('downloads:historyUpdate', handler)
  },
  /** Open a downloaded file with the system default app. */
  openDownloadFile: (savePath) => ipcRenderer.send('downloads:openFile', savePath),
  /** Reveal a downloaded file in the system file explorer. */
  openDownloadFolder: (savePath) => ipcRenderer.send('downloads:openFolder', savePath),
  /** Open the KurodoTorrents download folder in the system file explorer. */
  openTorrentFolder: () => ipcRenderer.send('downloads:openTorrentFolder'),

  // ── Splash screen ────────────────────────────────────────────────
  /** Signal the main process that the splash animation is complete. */
  splashDone: () => ipcRenderer.send('splash:done'),

  // ── App restart (error page retry) ────────────────────────────────
  /** Restart the app — used by the error page retry button. */
  restartApp: () => ipcRenderer.send('app:restart'),
  /** Clear the renderer cache and storage (error page hard reload). */
  clearCache: () => ipcRenderer.invoke('app:clearCache'),

  // ── Torrent downloads ───────────────────────────────────────────────
  /** Add a torrent by magnet URI. Returns { infoHash, name, files } via promise. */
  addTorrent: (magnetUri) => ipcRenderer.invoke('torrent:add', magnetUri),
  /** Select a specific file to download within a torrent. */
  selectTorrentFile: (infoHash, fileIndex) =>
    ipcRenderer.send('torrent:selectFile', { infoHash, fileIndex }),
  /** Stop downloading a specific file within a torrent. */
  deselectTorrentFile: (infoHash, fileIndex) =>
    ipcRenderer.send('torrent:deselectFile', { infoHash, fileIndex }),
  /** Remove a torrent completely (deletes data). */
  removeTorrent: (infoHash) => ipcRenderer.send('torrent:remove', infoHash),
  /** Get download details for a specific file in a torrent. */
  getTorrentFileDetails: (infoHash, fileIndex) =>
    ipcRenderer.invoke('torrent:getFileDetails', { infoHash, fileIndex }),
  /** Get a streamable HTTP URL for a torrent file (watch while downloading). */
  getTorrentStreamUrl: (infoHash, fileIndex) =>
    ipcRenderer.invoke('torrent:getStreamUrl', { infoHash, fileIndex }),
  /** Probe a torrent file for embedded subtitle streams (returns { streams: [...] }). */
  probeTorrentSubtitles: (infoHash, fileIndex) =>
    ipcRenderer.invoke('torrent:probeSubtitles', { infoHash, fileIndex }),
  /** Extract a subtitle stream from a torrent file to a cached VTT file. */
  extractTorrentSubtitle: (infoHash, fileIndex, streamIndex) =>
    ipcRenderer.invoke('torrent:extractSubtitle', { infoHash, fileIndex, streamIndex }),
  // ── AniList credentials persistence ─────────────────────────────
  /** Get saved AniList credentials (Client ID + Secret) from userData. */
  getAnilistCredentials: () => ipcRenderer.sendSync('settings:getAnilistCreds'),
  /** Save AniList credentials to disk so they survive reinstalls. */
  setAnilistCredentials: (clientId, clientSecret) =>
    ipcRenderer.invoke('settings:setAnilistCreds', { clientId, clientSecret }),

  // ── Wyzie Subs API ─────────────────────────────────────────────
  /** Get the stored Wyzie Subs API key. */
  getWyzieKey: () => ipcRenderer.sendSync('settings:getWyzieKey'),
  /** Store a Wyzie Subs API key. Returns { success: true/false }. */
  setWyzieKey: (key) => ipcRenderer.invoke('settings:setWyzieKey', key),
  /** Search Wyzie Subs by IMDb/TMDB ID. Returns { results: [...] }. */
  wyzieSearch: (query, season, episode, language) =>
    ipcRenderer.invoke('wyzie:search', { query, season, episode, language }),
  /** Download and convert a Wyzie subtitle to VTT. Returns { url, cached }. */
  wyzieDownload: (url, format) =>
    ipcRenderer.invoke('wyzie:download', { url, format }),

  /** Subscribe to real-time torrent progress (every 1s). Returns cleanup fn. */
  onTorrentProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('torrent:progress', handler)
    return () => ipcRenderer.removeListener('torrent:progress', handler)
  },

  // ── Platform info ─────────────────────────────────────────────────
  platform: process.platform,
})
