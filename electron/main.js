/**
 * Electron main process — starts the Express backend + scrapers, then opens
 * the Kurōdo app in a native Chromium window.
 *
 * Architecture:
 *   1. Dynamic-import server/index.js → Express starts on :5173
 *   2. Poll /api/health until the server is ready
 *   3. Create a frameless-feel BrowserWindow pointing to localhost:5173
 *
 * The Express server serves the built frontend (dist/) in production mode
 * and handles all scraper API / HLS proxy / AniList OAuth calls.
 *
 * Auto-update: electron-updater checks for new versions on startup.
 * Updates are downloaded in the background and installed on next quit.
 * Configure the update feed via the UPDATE_FEED_URL env var or the
 * publish.provider in package.json > build.publish.
 */

import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import WebTorrent from 'webtorrent'

// electron-updater is a CommonJS module that exposes `autoUpdater` via
// `module.exports` — it has no named ESM exports. When the app is packaged
// into an asar archive, Node loads the main process entry with strict ESM
// resolution, which REJECTS named imports from CJS modules with:
//
//   SyntaxError: Named export 'autoUpdater' not found. The requested
//   module 'electron-updater' is a CommonJS module, which may not support
//   all module.exports as named exports.
//
// Fix: import the default (the whole `module.exports` object) and pull
// `autoUpdater` off of it. This is the pattern the error message itself
// suggests.
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

// ── Single-instance lock ──────────────────────────────────────
// Must be requested BEFORE app.whenReady() / app.on('ready').
// Otherwise the lock is silently ignored and a second launch can
// create duplicate server processes, port conflicts, or a window that
// never appears.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  console.log('[electron] Another instance is already running — quitting.')
  app.quit()
  // app.quit() is async; force exit after a short delay if still alive.
  setTimeout(() => process.exit(0), 2000)
}

app.on('second-instance', () => {
  console.log('[electron] Second instance requested — focusing existing window.')
  // mainWindow may not be assigned yet if the second launch happens very
  // early; fall back to the first BrowserWindow.
  const win = mainWindow || BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  }
})

// ── Child-process crash logging / recovery ──────────────────────
// In packaged builds the GPU, network, or utility processes can exit
// unexpectedly. Log the details so we can diagnose them, and in the
// case of the renderer process crash, attempt a graceful reload with
// a bounded retry count to avoid an infinite crash/reload loop.
let renderCrashReloadCount = 0
const MAX_RENDER_CRASH_RELOADS = 3

app.on('child-process-gone', (_event, details) => {
  console.error('[electron] child-process-gone:', details.type, details.reason, details.exitCode, details.serviceName)
})

app.on('render-process-gone', (_event, webContents, details) => {
  console.error('[electron] render-process-gone:', details.reason, details.exitCode)

  // Try to reload the main window so the user isn't stuck on a blank page,
  // but cap retries to avoid an infinite crash/reload loop.
  const win = mainWindow || BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed() && win.webContents === webContents) {
    if (renderCrashReloadCount >= MAX_RENDER_CRASH_RELOADS) {
      console.error('[electron] Renderer keeps crashing — stopping automatic reloads.')
      return
    }
    renderCrashReloadCount++
    console.log(`[electron] Attempting to reload main window after render process crash (retry ${renderCrashReloadCount}/${MAX_RENDER_CRASH_RELOADS})...`)
    win.reload()
  }
})

// ── GPU / sandbox stability for packaged app ───────────────────
// On Windows, Electron's GPU and network child processes can crash during
// sandbox initialization in packaged builds (exit_code=143 / "GPU process
// exited unexpectedly" / "Network service crashed"). These flags relax the
// sandbox around the GPU process without turning off Chromium's renderer
// sandbox entirely.
//
//   disable-gpu-memory-buffer-video-frames: prevents GPU shared-memory
//     video frame buffers that can stall the compositor pipeline.
//   disable-gpu-sandbox: allows the GPU process to start when the stricter
//     sandbox used in packaged builds fails to initialize.
//   disable-software-rasterizer: keeps GPU rasterization on; combined with the
//     flags above this avoids the "all black" fallback renderer.
//   disable-features=IsolateOrigins,site-per-process: reduces the renderer
//     sandbox overhead that can also trigger child-process termination.
//
// NOTE: We deliberately do NOT set disable-accelerated-video-decode.
// That flag forces ALL video decoding onto the CPU, which is the
// #1 cause of perceived "lag" during playback. The flags above prevent
// the crash without sacrificing hardware decode performance.
app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 5173
const SERVER_URL = `http://localhost:${PORT}`

// Reference to the main application window, used by the second-instance
// handler so it focuses the real app window (not the splash window).
let mainWindow = null

// Current update feed URL (can be changed at runtime via settings page)
let currentFeedUrl = process.env.UPDATE_FEED_URL || ''

// Pending local update info (set by checkLocalUpdate when a newer installer
// is found on disk). When non-null, update:install spawns the local installer
// instead of calling autoUpdater.quitAndInstall().
let pendingLocalUpdate = null // { version, installerPath }

// ── Poll the server's health endpoint until it responds 200 ──────────
function waitForServer(retries = 80, interval = 100) {
  return new Promise((resolve, reject) => {
    let remaining = retries
    const check = () => {
      const req = http.get(`${SERVER_URL}/api/health`, (res) => {
        if (res.statusCode === 200) {
          res.resume() // consume response data to free up memory
          resolve()
        } else if (--remaining > 0) {
          setTimeout(check, interval)
        } else {
          reject(new Error(`Server returned ${res.statusCode} after ${retries} retries`))
        }
      })
      req.on('error', () => {
        if (--remaining > 0) {
          setTimeout(check, interval)
        } else {
          reject(new Error(`Server did not start on ${SERVER_URL} after ${retries * interval / 1000}s`))
        }
      })
      req.setTimeout(2000, () => {
        req.destroy()
        if (--remaining > 0) setTimeout(check, interval)
        else reject(new Error('Health check timed out'))
      })
    }
    check()
  })
}

// ── Create the main application window (hidden until splash finishes) ──
function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Kurōdo',
    backgroundColor: '#0e0e10',
    show: false, // hidden — shown after splash finishes
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
      // Prevent background throttling — keeps UI responsive during navigation
      backgroundThrottling: false,
    },
    icon: path.join(__dirname, '..', 'dist', 'icon-256.png'),
    autoHideMenuBar: true,
  })

  win.setMenuBarVisibility(false)
  win.removeMenu()

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  return win
}

// ── Create the splash window (frameless overlay with the animation) ──
function createSplashWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#000',
    alwaysOnTop: true,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, '..', 'dist', 'icon-256.png'),
  })

  win.setMenuBarVisibility(false)
  win.removeMenu()

  // Center on screen
  win.center()

  return win
}

// ── App lifecycle ────────────────────────────────────────────────────

// ── Updater error logging (shared helper) ───────────────────────────
//
// The packaged app ships with a placeholder publish URL
// (https://updates.kurodo.app) that has no real DNS. Until the user
// configures a real feed (UPDATE_FEED_URL or build.publish), every
// update check fails with a network error. We log those as a friendly
// warning instead of a scary console.error, and we route the message
// through console.warn so it lands in stderr where users actually
// tail diagnostic output.
const TRANSIENT_NETWORK_ERRORS = [
  // Node.js / c-ares DNS errors
  'ERR_NAME_NOT_RESOLVED',  // placeholder host has no DNS
  'ENOTFOUND',              // DNS lookup failed (alias of the above on some platforms)
  // Node.js / undici network errors
  'ETIMEDOUT',              // request to feed server timed out (Node)
  'ECONNREFUSED',           // feed server actively refused the connection
  'ECONNRESET',             // feed server dropped the connection mid-request
  'ERR_CONNECTION_TIMED_OUT', // Chromium-flavored timeout (distinct from Node's ETIMEDOUT)
  'CERT_HAS_EXPIRED',       // feed server cert expired
  // Chromium network-stack errors seen when running through Electron's
  // net module (offline users, captive portals, corporate proxies)
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NETWORK_CHANGED',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TUNNEL_CONNECTION_FAILED',
  // electron-updater-specific: thrown when the feed returns empty or is
  // missing the expected `version` field.
  'No published versions',
]

/** True when the error message looks like a known transient network/feed
 *  failure. Patterns are matched as standalone tokens (preceded by a
 *  space, parenthesis, or at the start of the string) so that a real
 *  upstream error message that *mentions* one of these patterns in
 *  prose ("Feed server logged ECONNRESET") isn't misclassified. */
function isTransientNetworkError(msg) {
  return TRANSIENT_NETWORK_ERRORS.some((pattern) => {
    const i = msg.indexOf(pattern)
    if (i === -1) return false
    const before = i === 0 ? '' : msg[i - 1]
    // Acceptable left-boundary chars: start-of-string, space, paren, or
    // a colon/brace (for `Error: ETIMEDOUT` style messages).
    return before === '' || before === ' ' || before === '(' || before === ':' || before === '{'
  })
}

/** Per-check-cycle dedupe guard. electron-updater fires BOTH an 'error'
 *  event AND rejects the checkForUpdatesAndNotify() promise when the
 *  check fails, so without this guard the same friendly warning would
 *  print twice in a row. Reset to false at the start of each check. */
let reportedFeedError = false

/** Log an updater error. Network/placeholder-feed issues get a friendly
 *  console.warn (stderr) instead of a scary console.error, so the
 *  packaged app's stderr stays clean until the user configures a real
 *  feed. Real errors still flow through console.error with the original
 *  context label (e.g. "Error", "Check failed"). */
function logUpdaterError(err, context = 'Error') {
  const msg = String(err?.message || err || '')
  if (isTransientNetworkError(msg)) {
    if (reportedFeedError) return
    reportedFeedError = true
    console.warn(
      '[updater] No feed configured (or feed unreachable) — skipping update check. ' +
      'Set UPDATE_FEED_URL or configure build.publish to enable.',
    )
  } else {
    console.error(`[updater] ${context}:`, msg)
  }
}

/** Reset the per-check-cycle dedupe guard. Called right before
 *  checkForUpdatesAndNotify() so the next check can warn again if the
 *  feed is still misconfigured. */
function resetFeedErrorGuard() { reportedFeedError = false }

// ── Auto-update (electron-updater) ──────────────────────────────────
//
// In development (`electron .`) the update check is skipped because there's
// no published update feed to compare against. In production (packaged via
// electron-builder) the updater reads the publish config from the built
// app's package.json > build.publish, or falls back to the UPDATE_FEED_URL
// env var for custom/generic servers.
//
// Providers supported:
//   - GitHub Releases: set build.publish.provider to "github"
//   - Generic HTTP:    set build.publish.provider to "generic" + url
//   - Custom:           set UPDATE_FEED_URL env var (overrides package.json)
//
// To disable auto-update entirely, set DISABLE_AUTO_UPDATE=true.

// ── Auto-update (electron-updater) ──────────────────────────────────
//
// In development (`electron .`) the update check is skipped because there's
// no published update feed to compare against. In production (packaged via
// electron-builder) the updater reads the publish config from the built
// app's package.json > build.publish, or falls back to the UPDATE_FEED_URL
// env var for custom/generic servers.
//
// Providers supported:
//   - GitHub Releases: set build.publish.provider to "github"
//   - Generic HTTP:    set build.publish.provider to "generic" + url
//   - Custom:           set UPDATE_FEED_URL env var (overrides package.json)
//
// To disable auto-update entirely, set DISABLE_AUTO_UPDATE=true.

function setupAutoUpdater() {
  // Skip in development (no published versions to compare)
  if (!app.isPackaged || process.env.DISABLE_AUTO_UPDATE === 'true') {
    console.log('[updater] Skipped — not packaged or DISABLE_AUTO_UPDATE=true')
    return
  }

  // Allow overriding the update feed URL via env var (useful for
  // self-hosted update servers or testing)
  if (process.env.UPDATE_FEED_URL) {
    currentFeedUrl = process.env.UPDATE_FEED_URL
    autoUpdater.setFeedURL(process.env.UPDATE_FEED_URL)
    console.log('[updater] Using custom feed URL:', process.env.UPDATE_FEED_URL)
  }

  // Route updater logs through the normal console so they appear in the
  // packaged app's log file (useful for debugging update failures)
  autoUpdater.logger = console

  // ── Events ────────────────────────────────────────────────────────
  autoUpdater.on('error', (err) => {
    logUpdaterError(err, 'Error')

    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-error', String(err?.message || err || 'Unknown error'))
    }
  })

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for updates...')

    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-checking')
    }
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version)

    // Notify renderer so it can show "Downloading update..." with a progress bar
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
      })
    }
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] Already up to date')

    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-not-available')
    }
  })

  autoUpdater.on('download-progress', ({ percent, transferred, total, bytesPerSecond }) => {
    console.log(`[updater] Downloading... ${Math.round(percent)}%`)

    // Forward progress to the renderer so UpdateNotification can show a progress bar
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-download-progress', {
        percent: Math.round(percent),
        transferred,
        total,
        bytesPerSecond,
      })
    }
  })

  autoUpdater.on('update-downloaded', ({ version, releaseDate }) => {
    console.log(`[updater] ✓ v${version} downloaded (released ${releaseDate})`)

    // Notify the renderer so it can show an "Update ready — restart now?"
    // prompt instead of silently installing on quit.
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-ready', { version, releaseDate })
    }

    // Install immediately — quits the app, installs the new version, and
    // relaunches. If you prefer to ask the user first, listen for the
    // 'update-ready' IPC in the renderer and call quitAndInstall() from
    // there when the user clicks "Restart".
    // autoUpdater.quitAndInstall()
  })

  // Start checking in the background. We wait 5 seconds before checking
  // so the renderer has time to finish loading and register its IPC
  // listeners (the 'update-ready' event would be missed otherwise).
  setTimeout(() => {
    // Reset the dedupe guard so the warning can fire again on a
    // subsequent check after the user configures a real feed.
    resetFeedErrorGuard()
    autoUpdater.checkForUpdatesAndNotify().catch((err) => logUpdaterError(err, 'Check failed'))
  }, 5000)
}

// ── Local file-based update check ──────────────────────────────────
//
// Before hitting the network (electron-updater), check if a newer
// installer exists on the local filesystem. This is the fast path:
// rebuild → app detects new release/ folder → one-click update.
//
// Searches in order:
//   1. LOCAL_UPDATE_PATH env var (explicit path to a release/ folder)
//   2. ../release relative to the install directory (portable setups)
//   3. ../../../release relative to the asar (project root, dev workflow)
//   4. ~/Downloads/kurodo/repo/release/ (common Windows dev layout)
//
// If a newer version is found, sends update-available + update-ready IPC
// so the existing UpdateNotification modal handles the rest.

function checkLocalUpdate() {
  // Helper: write diagnostic to both console and the startup.log file
  const log = (...args) => {
    const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
    console.log(line)
    try {
      const logPath = path.join(app.getPath('userData'), 'startup.log')
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`)
    } catch { /* ignore */ }
  }

  // Only meaningful when packaged — in dev mode the project IS the source.
  if (!app.isPackaged) {
    log('[local-update] Skipped — running in dev mode (not packaged)')
    return
  }

  const searchPaths = []

  // 1. Explicit env var
  if (process.env.LOCAL_UPDATE_PATH) {
    searchPaths.push(process.env.LOCAL_UPDATE_PATH)
  }

  // 2. ../release relative to install dir (e.g. portable app next to build output)
  try {
    const installDir = path.dirname(app.getPath('exe'))
    searchPaths.push(path.join(installDir, '..', 'release'))
  } catch { /* ignore */ }

  // 3. Project root release/ (../../../ relative to asar:electron/main.js)
  //    In packaged app: resources/app.asar/electron/main.js
  //    We want: the repo root (4 levels up from electron/)
  try {
    const asarRoot = path.resolve(__dirname, '..', '..', '..', '..')
    searchPaths.push(path.join(asarRoot, 'release'))
  } catch { /* ignore */ }

  // 4. Common Windows dev layout: ~/Downloads/kurodo/repo/release/
  try {
    searchPaths.push(path.join(app.getPath('home'), 'Downloads', 'kurodo', 'repo', 'release'))
  } catch { /* ignore */ }

  for (const dir of searchPaths) {
    const ymlPath = path.join(dir, 'latest.yml')
    if (!fs.existsSync(ymlPath)) continue

    try {
      const content = fs.readFileSync(ymlPath, 'utf-8')
      const versionMatch = content.match(/^version:\s*(\S+)/m)
      if (!versionMatch) continue

      const newVersion = versionMatch[1]
      const currentVersion = app.getVersion()

      log('[local-update] Found latest.yml in', dir, '→ version', newVersion, '(current:', currentVersion + ')')

      if (newVersion === currentVersion) {
        log('[local-update] Already at latest version:', currentVersion)
        return
      }

      if (compareVersions(newVersion, currentVersion) <= 0) {
        log('[local-update] Installed version is same or newer:', currentVersion, '>=', newVersion)
        return
      }

      // Find the installer .exe in the same directory
      let installer = null
      try {
        const files = fs.readdirSync(dir)
        installer = files.find((f) => f.endsWith('.exe') && f.includes('Setup'))
      } catch { /* ignore */ }

      if (!installer) {
        log('[local-update] latest.yml found but no installer .exe in', dir)
        continue
      }

      const installerPath = path.join(dir, installer)
      pendingLocalUpdate = { version: newVersion, installerPath }

      log('[local-update] ✓ New version found:', newVersion, '→', installerPath)

      // Notify renderer: update available
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-available', {
          version: newVersion,
          releaseDate: new Date().toISOString(),
        })
        // Local files don't need downloading — transition to "ready" after
        // a brief pause so the UI shows "available" before the restart button.
        setTimeout(() => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('update-ready', {
              version: newVersion,
              releaseDate: new Date().toISOString(),
            })
          }
        }, 1500)
      }

      return // Found an update — stop searching
    } catch (err) {
      log('[local-update] Error checking', dir, ':', err.message)
    }
  }

  log('[local-update] No local updates found')
}

/** Simple semver comparison. Returns positive if a > b, negative if a < b, 0 if equal. */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

// ── App restart IPC (error page retry button) ───────────────────────
ipcMain.on('app:restart', () => {
  console.log('[electron] Restart requested — relaunching app')
  app.relaunch()
  app.exit(0)
})

// ── Clear renderer cache and storage (error page hard reload) ───────
ipcMain.handle('app:clearCache', async () => {
  try {
    const sess = mainWindow?.webContents?.session || session.defaultSession
    if (!sess) {
      return { success: false, error: 'No session available' }
    }
    // Clear the HTTP/Disk cache (this is what holds stale Vite chunks).
    await sess.clearCache()
    // Only purge cache-backed storage types — never localStorage/cookies,
    // because the user's AniList auth and settings live there.
    await sess.clearStorageData({
      storages: ['appcache', 'filesystem', 'shadercache', 'serviceworkers'],
    })
    return { success: true }
  } catch (err) {
    console.error('[electron] clearCache failed:', err.message)
    return { success: false, error: err.message || 'Unknown error' }
  }
})

// ── Window control IPC handlers ──────────────────────────────────────
ipcMain.on('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})
ipcMain.on('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win?.isMaximized()) {
    win.unmaximize()
  } else {
    win?.maximize()
  }
})
ipcMain.on('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

// ── Download history — global array tracked across all downloads ──────
// Every download that passes through Electron's download manager is
// recorded here so the renderer can display a persistent history panel.
const downloadHistory = []
let downloadIdCounter = 0

/** Push a history update to all renderer windows. */
function broadcastHistory() {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('downloads:historyUpdate', downloadHistory)
  })
}

/** Find an existing entry by URL (for deduplication). */
function findHistoryEntry(url) {
  return downloadHistory.find((e) => e.url === url && (e.state === 'preparing' || e.state === 'downloading'))
}

// ── Download handler — uses Electron's native download manager ────────
// The renderer sends 'download:start' with { url, channel }.
// We call downloadURL() which triggers the will-download event on the
// session. Progress updates are sent back via the named IPC channel.
//
// IMPORTANT: downloadURL() requires an ABSOLUTE URL. If the renderer
// sends a relative path like "/api/anidap/download/...", we resolve it
// against http://localhost:PORT before passing to Chromium.
ipcMain.on('download:start', (event, { url, channel }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return

  // Resolve relative URLs to absolute — downloadURL() requires full URLs
  let resolvedUrl = url
  try {
    // If it's already absolute, use as-is; otherwise prepend server origin
    new URL(url)
  } catch {
    resolvedUrl = `${SERVER_URL}${url.startsWith('/') ? '' : '/'}${url}`
    console.log(`[download] Resolved relative URL: ${url} → ${resolvedUrl}`)
  }

  const send = (data) => {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  }

  // Notify the renderer we're starting
  send({ state: 'preparing', percent: 0 })

  // Listen for the actual download item on the session.
  // safetyTimer is declared after this closure but captured by reference,
  // so it is available when the 'will-download' event fires later.
  const onWillDownload = (_evt, item) => {
    clearTimeout(safetyTimer)
    const filename = item.getFilename()
    const savePath = item.getSavePath?.() || ''

    // Create or find the history entry for this download
    let entry = findHistoryEntry(resolvedUrl)
    if (!entry) {
      entry = {
        id: ++downloadIdCounter,
        url: resolvedUrl,
        filename,
        savePath,
        state: 'preparing',
        percent: 0,
        received: 0,
        total: 0,
        startTime: Date.now(),
        endTime: null,
      }
      downloadHistory.push(entry)
      broadcastHistory()
    } else {
      entry.filename = filename
      entry.savePath = savePath
    }

    item.on('updated', () => {
      const total = item.getTotalBytes()
      const received = item.getReceivedBytes()
      entry.total = total
      entry.received = received
      entry.state = 'downloading'
      if (total > 0) {
        entry.percent = Math.round((received / total) * 100)
      }
      broadcastHistory()

      send({
        state: 'downloading',
        percent: entry.percent,
        received,
        total,
        filename,
      })
    })

    item.on('done', (_evt, state) => {
      entry.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      if (state === 'completed') entry.percent = 100
      entry.endTime = Date.now()
      entry.savePath = item.getSavePath?.() || entry.savePath
      broadcastHistory()

      send({
        state: entry.state,
        percent: entry.percent,
        filename,
      })
      // Remove the listener once this download is done
      clearTimeout(safetyTimer)
      win.webContents.session.removeListener('will-download', onWillDownload)
    })
  }

  // Use session.on (persistent) instead of session.once so concurrent
  // downloads each get their own handler. The safety timeout below
  // removes the listener if downloadURL() never triggers will-download
  // (e.g. invalid URL), preventing listener leaks over time.
  win.webContents.session.on('will-download', onWillDownload)
  const safetyTimer = setTimeout(() => {
    win.webContents.session.removeListener('will-download', onWillDownload)
  }, 30000)

  // Trigger the download
  win.webContents.downloadURL(resolvedUrl)
})

// ── Download history IPC ──────────────────────────────────────────────
ipcMain.on('downloads:getHistory', (event) => {
  event.returnValue = downloadHistory
})

ipcMain.on('downloads:clearHistory', () => {
  // Only remove completed/cancelled/interrupted entries
  for (let i = downloadHistory.length - 1; i >= 0; i--) {
    if (downloadHistory[i].state !== 'preparing' && downloadHistory[i].state !== 'downloading') {
      downloadHistory.splice(i, 1)
    }
  }
  broadcastHistory()
})

ipcMain.on('downloads:openFile', (_event, savePath) => {
  shell.openPath(savePath)
})

ipcMain.on('downloads:openFolder', (_event, savePath) => {
  shell.showItemInFolder(savePath)
})

ipcMain.on('downloads:openTorrentFolder', () => {
  shell.openPath(torrentDownloadPath)
})

// Auto-update IPC: renderer calls this when the user clicks "Restart now"
ipcMain.on('update:install', () => {
  // Local update path: spawn the new installer, then exit
  if (pendingLocalUpdate) {
    console.log('[local-update] Installing from:', pendingLocalUpdate.installerPath || '(relaunch)')
    const update = pendingLocalUpdate
    pendingLocalUpdate = null // clear before spawn to prevent re-entry

    // If no installer path (forced/demo update), just relaunch the app
    if (!update.installerPath) {
      console.log('[local-update] No installer — relaunching app')
      app.relaunch()
      app.exit(0)
      return
    }

    try {
      // Find the current install directory so we can pass /D= to NSIS
      const installDir = path.dirname(app.getPath('exe'))

      // ── CRITICAL: NSIS can't overwrite in-use files on Windows.
      // We must exit the app FIRST and let all file handles release
      // before spawning the installer. A batch file solves this:
      // it waits for the app PID to exit, then runs the installer.
      const batchPath = path.join(app.getPath('temp'), 'kurodo-update.bat')
      const batchContent = [
        '@echo off',
        'title Kurodo Update',
        // Wait for the old app process to exit (poll every 200ms, max 30 tries)
        `set /a tries=0`,
        `:wait`,
        `tasklist /FI "PID eq ${process.pid}" 2>NUL | find /I "${process.pid}" >NUL`,
        `if errorlevel 1 goto install`,
        `timeout /t 1 /nobreak >NUL`,
        `set /a tries+=1`,
        `if %tries% lss 30 goto wait`,
        `:install`,
        `echo Installing Kurodo update...`,
        // NSIS: /S silent, /D= MUST be last arg and NOT quoted
        `"${update.installerPath}" /S /D=${installDir}`,
        `if errorlevel 1 echo Update may have failed — please re-run the installer.`,
        // Self-destruct: delete this batch file after running
        `del "%~f0"`,
      ].join('\r\n')
      fs.writeFileSync(batchPath, batchContent, 'utf-8')

      // Spawn the batch file detached so it survives app exit
      const child = spawn('cmd.exe', ['/c', batchPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
      child.unref()

      console.log('[local-update] Batch update script spawned — exiting app (PID ' + process.pid + ')')

      // Exit immediately — the batch file polls for our PID to disappear,
      // then runs the installer. This guarantees no file-lock conflicts.
      app.exit(0)
    } catch (err) {
      console.error('[local-update] Failed to spawn update:', err.message)
      // Restore pending state so user can retry
      pendingLocalUpdate = update
    }
    return
  }

  // Remote update path (electron-updater)
  console.log('[updater] User requested install — quitting and installing update...')
  autoUpdater.quitAndInstall()
})

// ── Update settings IPC ──────────────────────────────────────────────
ipcMain.on('update:getVersion', (event) => {
  event.returnValue = app.getVersion()
})

ipcMain.on('update:getFeedUrl', (event) => {
  event.returnValue = currentFeedUrl
})

ipcMain.on('update:setFeedUrl', (_event, url) => {
  currentFeedUrl = typeof url === 'string' ? url.trim() : ''
  if (currentFeedUrl) {
    autoUpdater.setFeedURL(currentFeedUrl)
    console.log('[updater] Feed URL updated to:', currentFeedUrl)
  }
})

ipcMain.on('update:check', () => {
  console.log('[updater] Manual update check triggered from settings')

  // Check locally first — no network needed
  checkLocalUpdate()

  // Also check remote if a feed URL is configured
  if (currentFeedUrl) {
    resetFeedErrorGuard()
    autoUpdater.checkForUpdates().catch((err) => {
      logUpdaterError(err, 'Manual check failed')
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-error', String(err?.message || err || 'Check failed'))
      }
    })
  }
})

// ── Torrent download system (WebTorrent) ────────────────────────────
// WebTorrent downloads run in the Electron main process. Individual files
// can be selected/deselected for selective downloading. Progress is
// broadcast to all renderer windows every second via 'torrent:progress'.
//
// A mini HTTP server on port 64622 streams torrent files via byte-range
// requests so the browser can play partially-downloaded video files.
//
// Downloads go to ~/Downloads/KurodoTorrents by default.

const TORRENT_STREAM_PORT = 64622
const torrentDownloadPath = path.join(app.getPath('downloads'), 'KurodoTorrents')
// Extracted subtitles live in a temp directory (cleaned on quit)
const subtitleCachePath = path.join(app.getPath('temp'), 'kurodo-subs')
const torrentClient = new WebTorrent({
  downloadLimit: -1,
  uploadLimit: 0,
})

// Ensure directories exist
if (!fs.existsSync(torrentDownloadPath)) {
  fs.mkdirSync(torrentDownloadPath, { recursive: true })
}
if (!fs.existsSync(subtitleCachePath)) {
  fs.mkdirSync(subtitleCachePath, { recursive: true })
}

// Lazy-resolve ffprobe path from the bundled ffmpeg-static binary
let _ffprobePath = null
async function getFfprobePath() {
  if (_ffprobePath) return _ffprobePath
  try {
    const ffmpegStatic = await import('ffmpeg-static')
    const ffmpegPath = ffmpegStatic.default || ffmpegStatic
    // ffprobe sits next to ffmpeg in the same directory
    const ffmpegDir = path.dirname(ffmpegPath)
    const ext = process.platform === 'win32' ? '.exe' : ''
    const probePath = path.join(ffmpegDir, `ffprobe${ext}`)
    if (fs.existsSync(probePath)) {
      _ffprobePath = probePath
      console.log('[subs] Using bundled ffprobe:', probePath)
    } else {
      _ffprobePath = 'ffprobe' // fallback to system PATH
    }
  } catch {
    _ffprobePath = 'ffprobe'
    console.warn('[subs] ffmpeg-static not available, using system ffprobe')
  }
  return _ffprobePath
}

// In-memory cache for probe results (capped at 100 entries)
const subtitleProbeCache = new Map()

// ── Torrent stream HTTP server ─────────────────────────────────────
// Serves torrent file data with HTTP 206 Range support so the browser
// can play video while the torrent is still downloading (progressive
// playback). Each URL includes the filename so the browser can guess
// the MIME type from the extension.
// Route: /stream/:infoHash/:fileIndex/:filename

const torrentStreamServer = http.createServer((req, res) => {
  // CORS: allow requests from the main app (localhost:5173)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Range')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  const match = req.url?.match(/^\/stream\/([a-fA-F0-9]+)\/(\d+)\/(.+)$/)

  // ── Wyzie subtitle serving ─────────────────────────────────────
  const wyzieSubMatch = req.url?.match(/^\/subtitles\/wyzie\/([\w-]+)\.vtt$/)
  if (wyzieSubMatch) {
    const subFile = path.join(subtitleCachePath, `wyzie_${wyzieSubMatch[1]}.vtt`)
    if (!fs.existsSync(subFile)) {
      res.writeHead(404)
      return res.end('Subtitle not found')
    }
    res.writeHead(200, {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    })
    try {
      res.end(fs.readFileSync(subFile))
      // CRITICAL: return here — without it, execution falls through to the
      // /stream regex below, which calls res.writeHead(404) AFTER res.end()
      // already sent the 200 + subtitle body. That throws
      // ERR_HTTP_HEADERS_SENT as an uncaught exception on every successful
      // Wyzie subtitle request.
      return
    } catch {
      // writeHead(200) already sent the headers — never call writeHead again
      // here (throws ERR_HTTP_HEADERS_SENT if readFileSync raced a temp-folder
      // cleanup between existsSync and the read). Just end the response.
      if (!res.headersSent) res.writeHead(500)
      return res.end('Subtitle read failed')
    }
  }

  // ── Embedded subtitle serving ──────────────────────────────────
  const subMatch = req.url?.match(/^\/subtitles\/([a-fA-F0-9]+)\/(\d+)\.vtt$/)
  if (subMatch) {
    const [, subInfoHash, subStreamIdx] = subMatch
    const subFile = path.join(subtitleCachePath, `${subInfoHash}_${subStreamIdx}.vtt`)
    if (!fs.existsSync(subFile)) {
      res.writeHead(404)
      return res.end('Subtitle not found (not extracted yet)')
    }
    try {
      const vttContent = fs.readFileSync(subFile)
      res.writeHead(200, {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      })
      return res.end(vttContent)
    } catch {
      // writeHead(200) above may have already flushed headers — don't call
      // writeHead again (would throw ERR_HTTP_HEADERS_SENT).
      if (!res.headersSent) res.writeHead(500)
      return res.end('Subtitle read failed')
    }
  }

  if (!match) {
    res.writeHead(404)
    return res.end('Not found')
  }

  const [, infoHash, fileIndexStr, filename] = match
  const fileIndex = Number(fileIndexStr)

  const torrent = torrentClient.get(infoHash)
  if (!torrent) {
    res.writeHead(404)
    return res.end('Torrent not found')
  }

  const file = torrent.files[fileIndex]
  if (!file) {
    res.writeHead(404)
    return res.end('File not found in torrent')
  }

  // Derive content-type from file extension
  const ext = path.extname(filename).toLowerCase()
  const mimeMap = {
    '.mkv': 'video/x-matroska',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
  }
  const contentType = mimeMap[ext] || 'video/mp4'

  const fileSize = file.length
  const rangeHeader = req.headers.range

  if (!rangeHeader) {
    // No Range — stream whatever is available so far (chunked transfer).
    // Omitting Content-Length lets the browser handle partial data gracefully
    // instead of waiting for bytes that haven't been downloaded yet.
    res.writeHead(200, {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Transfer-Encoding': 'chunked',
    })
    const stream = file.createReadStream()
    stream.pipe(res)
    stream.on('error', (err) => {
      console.error('[torrent-stream] Error:', err.message)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
    req.on('close', () => stream.destroy())
    return
  }

  // Byte-range request — allow seeking within partially downloaded data
  const positions = rangeHeader.replace(/bytes=/, '').split('-')
  const start = parseInt(positions[0], 10) || 0
  const end = positions[1] ? parseInt(positions[1], 10) : fileSize - 1
  const chunkSize = end - start + 1

  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': contentType,
  })

  const stream = file.createReadStream({ start, end })
  stream.pipe(res)
  stream.on('error', (err) => {
    console.error('[torrent-stream] Error:', err.message)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
  req.on('close', () => stream.destroy())
})

// listen() moved inside app.whenReady() to avoid port binding before Electron init

/** Broadcast torrent progress to all renderer windows. */
function broadcastTorrentProgress() {
  const data = torrentClient.torrents.map((t) => ({
    infoHash: t.infoHash,
    name: t.name,
    magnetURI: t.magnetURI,
    progress: Math.round(t.progress * 100),
    downloadSpeed: t.downloadSpeed,
    uploadSpeed: t.uploadSpeed,
    downloaded: t.downloaded,
    total: t.length,
    numPeers: t.numPeers,
    done: t.done,
    files: t.files.map((f) => ({
      name: f.name,
      length: f.length,
      downloaded: f.downloaded,
      progress: Math.round(f.progress * 100),
    })),
  }))
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('torrent:progress', data)
  })
}

// Push progress every second (cleaned up on app quit to prevent leaks)
let torrentProgressInterval = setInterval(broadcastTorrentProgress, 1000)

// ── Torrent IPC handlers ──────────────────────────────────────────────

ipcMain.handle('torrent:add', async (_event, magnetUri) => {
  const existing = torrentClient.get(magnetUri)
  if (existing) {
    return {
      infoHash: existing.infoHash,
      name: existing.name,
      magnetURI: existing.magnetURI,
      files: existing.files.map((f) => ({ name: f.name, length: f.length })),
    }
  }

  return new Promise((resolve, reject) => {
    const torrent = torrentClient.add(magnetUri, { path: torrentDownloadPath })
    torrent.on('ready', () => {
      torrent.deselect(0, torrent.files.length - 1, false)
      resolve({
        infoHash: torrent.infoHash,
        name: torrent.name,
        magnetURI: torrent.magnetURI,
        files: torrent.files.map((f) => ({ name: f.name, length: f.length })),
      })
    })
    torrent.on('error', (err) => reject(err.message || 'Torrent add failed'))
    torrent.on('warning', (warn) => console.warn('[torrent]', warn))
  })
})

ipcMain.on('torrent:selectFile', (_event, { infoHash, fileIndex }) => {
  const torrent = torrentClient.get(infoHash)
  if (!torrent) return
  const file = torrent.files[fileIndex]
  if (file) file.select()
})

ipcMain.on('torrent:deselectFile', (_event, { infoHash, fileIndex }) => {
  const torrent = torrentClient.get(infoHash)
  if (!torrent) return
  const file = torrent.files[fileIndex]
  if (file) file.deselect()
})

ipcMain.on('torrent:remove', (_event, infoHash) => {
  const torrent = torrentClient.get(infoHash)
  if (torrent) {
    torrent.destroy({ destroyStore: true }, (err) => {
      if (err) console.error('[torrent] Error removing:', err.message)
    })
  }
})

ipcMain.handle('torrent:getFileDetails', async (_event, { infoHash, fileIndex }) => {
  const torrent = torrentClient.get(infoHash)
  if (!torrent) return null
  const file = torrent.files[fileIndex]
  if (!file) return null
  return {
    name: file.name,
    length: file.length,
    downloaded: file.downloaded,
    progress: Math.round(file.progress * 100),
  }
})

ipcMain.handle('torrent:getStreamUrl', async (_event, { infoHash, fileIndex }) => {
  const torrent = torrentClient.get(infoHash)
  if (!torrent) return null
  const file = torrent.files[fileIndex]
  if (!file) return null
  const encName = encodeURIComponent(file.name)
  return `http://127.0.0.1:${TORRENT_STREAM_PORT}/stream/${infoHash}/${fileIndex}/${encName}`
})

// ── Wyzie Subs API integration ─────────────────────────────────────
// Wyzie Subs (sub.wyzie.io) is a free subtitle aggregation API.
// Free tier: 1,000 req/day. Requires an API key (stored in userData).
// The key MUST be server-side; we proxy all requests through main process.

const WYZIE_API = 'https://sub.wyzie.io'
const wyzieKeyPath = path.join(app.getPath('userData'), 'wyzie-key.json')

function getWyzieKey() {
  try {
    if (fs.existsSync(wyzieKeyPath)) {
      return JSON.parse(fs.readFileSync(wyzieKeyPath, 'utf-8')).key || ''
    }
  } catch { /* ignore */ }
  return ''
}

function setWyzieKey(key) {
  try {
    fs.writeFileSync(wyzieKeyPath, JSON.stringify({ key: key.trim() }), 'utf-8')
  } catch { /* ignore */ }
}

ipcMain.on('settings:getWyzieKey', (event) => {
  event.returnValue = getWyzieKey()
})

ipcMain.handle('settings:setWyzieKey', async (_event, key) => {
  try {
    setWyzieKey(String(key || ''))
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message || 'Failed to save key' }
  }
})

// ── AniList credentials persistence ───────────────────────────────
// Saves the Client ID + Client Secret to a JSON file in userData so
// the user never has to re-enter them after the first sign-in.
// Mirrors the Wyzie key pattern above.
const anilistCredsPath = path.join(app.getPath('userData'), 'anilist-creds.json')

function getAnilistCreds() {
  try {
    if (fs.existsSync(anilistCredsPath)) {
      return JSON.parse(fs.readFileSync(anilistCredsPath, 'utf-8'))
    }
  } catch { /* ignore */ }
  return { clientId: '', clientSecret: '' }
}

function setAnilistCreds(clientId, clientSecret) {
  try {
    fs.writeFileSync(anilistCredsPath, JSON.stringify({
      clientId: String(clientId || '').trim(),
      clientSecret: String(clientSecret || '').trim(),
      savedAt: Date.now(),
    }, null, 2), 'utf-8')
    console.log('[anilist-creds] Saved to:', anilistCredsPath)
  } catch (err) {
    console.error('[anilist-creds] Failed to save:', err.message)
  }
}

ipcMain.on('settings:getAnilistCreds', (event) => {
  event.returnValue = getAnilistCreds()
})

ipcMain.handle('settings:setAnilistCreds', async (_event, { clientId, clientSecret }) => {
  try {
    setAnilistCreds(clientId, clientSecret)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message || 'Failed to save credentials' }
  }
})

ipcMain.handle('wyzie:search', async (_event, { query, season, episode, language }) => {
  const key = getWyzieKey()
  if (!key) return { error: 'No Wyzie API key configured. Add it in Settings.', results: [] }

  const params = new URLSearchParams({ id: String(query), key })
  if (season != null) params.set('season', String(season))
  if (episode != null) params.set('episode', String(episode))
  if (language) params.set('language', language)
  params.set('format', 'srt,ass,vtt')

  try {
    const res = await fetch(`${WYZIE_API}/search?${params.toString()}`)
    if (!res.ok) {
      if (res.status === 429) return { error: 'Wyzie rate limit reached. Try again later.', results: [] }
      if (res.status === 401 || res.status === 403) return { error: 'Invalid Wyzie API key.', results: [] }
      return { error: `Wyzie API returned ${res.status}`, results: [] }
    }
    const data = await res.json()
    const results = (Array.isArray(data) ? data : data?.results ?? data?.subtitles ?? []).map((s) => ({
      id: s.id || '',
      url: s.url || '',
      format: s.format || '',
      language: s.language || '',
      display: s.display || '',
      release: s.release || '',
      encoding: s.encoding || '',
      hearingImpaired: s.isHearingImpaired || s.hi || false,
      source: s.source || [],
      downloadCount: s.downloadCount ?? null,
    }))
    return { results, query: String(query) }
  } catch (err) {
    return { error: err.message || 'Wyzie request failed', results: [] }
  }
})

ipcMain.handle('wyzie:download', async (_event, { url, format }) => {
  if (!url) return { error: 'No subtitle URL provided' }

  const hash = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_').slice(0, 32)
  const ext = format === 'ass' ? '.ass' : '.srt'
  const rawPath = path.join(subtitleCachePath, `wyzie_${hash}${ext}`)
  const vttPath = path.join(subtitleCachePath, `wyzie_${hash}.vtt`)

  // Serve from cache if already converted
  if (fs.existsSync(vttPath)) {
    return { url: `http://127.0.0.1:${TORRENT_STREAM_PORT}/subtitles/wyzie/${hash}.vtt`, cached: true }
  }

  try {
    // Download the subtitle file
    const dlRes = await fetch(url)
    if (!dlRes.ok) return { error: `Download failed: ${dlRes.status}` }
    const buf = Buffer.from(await dlRes.arrayBuffer())
    fs.writeFileSync(rawPath, buf)

    // Convert to VTT with ffmpeg (supports srt→vtt and ass→vtt)
    const mod = await import('ffmpeg-static')
    const ffmpegPath = mod.default || mod

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-y', '-i', rawPath, '-f', 'webvtt', vttPath,
      ], { timeout: 15000 })
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(vttPath)) resolve()
        else reject(new Error('ffmpeg VTT conversion failed'))
      })
      proc.on('error', reject)
      let stderr = ''
      proc.stderr.on('data', (d) => stderr += d)
    })

    // Clean up raw file
    try { fs.unlinkSync(rawPath) } catch {}

    return { url: `http://127.0.0.1:${TORRENT_STREAM_PORT}/subtitles/wyzie/${hash}.vtt`, cached: false }
  } catch (err) {
    // Clean up partial download on failure
    try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath) } catch {}
    try { if (fs.existsSync(vttPath)) fs.unlinkSync(vttPath) } catch {}
    return { error: err.message || 'Wyzie download failed' }
  }
})

// ── Subtitle extraction IPC ──────────────────────────────────────────

ipcMain.handle('torrent:probeSubtitles', async (_event, { infoHash, fileIndex }) => {
  const torrent = torrentClient.get(infoHash)
  if (!torrent) return { error: 'Torrent not found', streams: [] }
  const file = torrent.files[fileIndex]
  if (!file) return { error: 'File not found', streams: [] }

  // Only probe video files
  const ext = path.extname(file.name).toLowerCase()
  if (!['.mkv', '.mp4', '.avi', '.webm', '.mov'].includes(ext)) {
    return { error: 'Not a video file', streams: [] }
  }

  // Check cache first
  const cacheKey = `${infoHash}:${fileIndex}`
  const cached = subtitleProbeCache.get(cacheKey)
  if (cached) return { streams: cached }

  const filePath = path.join(torrentDownloadPath, file.path || file.name)
  if (!fs.existsSync(filePath)) {
    return { error: 'File not fully downloaded yet', streams: [] }
  }

  try {
    const ffprobePath = await getFfprobePath()
    const streams = await new Promise((resolve) => {
      const proc = spawn(ffprobePath, [
        '-v', 'error',
        '-show_entries', 'stream=index:stream_tags=language,title',
        '-select_streams', 's',
        '-of', 'json',
        filePath,
      ], { timeout: 15000 })

      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (d) => stdout += d)
      proc.stderr.on('data', (d) => stderr += d)
      proc.on('close', (code) => {
        if (code !== 0) {
          console.warn('[subs] ffprobe error:', stderr.slice(0, 200))
          return resolve([])
        }
        try {
          const parsed = JSON.parse(stdout)
          resolve((parsed.streams || []).map((s) => ({
            index: s.index,
            language: s.tags?.language || 'und',
            title: s.tags?.title || `Track ${s.index}`,
          })))
        } catch {
          resolve([])
        }
      })
      proc.on('error', () => resolve([]))
    })

    // Cap the cache at 100 entries (FIFO eviction)
    if (subtitleProbeCache.size >= 100) {
      const firstKey = subtitleProbeCache.keys().next().value
      if (firstKey) subtitleProbeCache.delete(firstKey)
    }
    subtitleProbeCache.set(cacheKey, streams)
    return { streams }
  } catch {
    return { error: 'ffprobe unavailable', streams: [] }
  }
})

ipcMain.handle('torrent:extractSubtitle', async (_event, { infoHash, fileIndex, streamIndex }) => {
  const torrent = torrentClient.get(infoHash)
  if (!torrent) return { error: 'Torrent not found' }
  const file = torrent.files[fileIndex]
  if (!file) return { error: 'File not found' }

  const filePath = path.join(torrentDownloadPath, file.path || file.name)
  if (!fs.existsSync(filePath)) {
    return { error: 'File not fully downloaded yet' }
  }

  // Check if already extracted
  const vttFilePath = path.join(subtitleCachePath, `${infoHash}_${streamIndex}.vtt`)
  if (fs.existsSync(vttFilePath)) {
    return {
      url: `http://127.0.0.1:${TORRENT_STREAM_PORT}/subtitles/${infoHash}/${streamIndex}.vtt`,
      cached: true,
    }
  }

  try {
    const mod = await import('ffmpeg-static')
    const ffmpegPath = mod.default || mod
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-y', '-i', filePath,
        '-map', `0:s:${streamIndex}`,
        '-f', 'webvtt',
        vttFilePath,
      ], { timeout: 30000 })

      let stderr = ''
      proc.stderr.on('data', (d) => stderr += d)
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(vttFilePath)) {
          console.log('[subs] Extracted:', vttFilePath)
          resolve()
        } else {
          console.warn('[subs] ffmpeg extraction failed:', stderr.slice(0, 200))
          reject(new Error('ffmpeg extraction failed'))
        }
      })
      proc.on('error', (err) => reject(err))
    })

    return {
      url: `http://127.0.0.1:${TORRENT_STREAM_PORT}/subtitles/${infoHash}/${streamIndex}.vtt`,
      cached: false,
    }
  } catch (err) {
    return { error: err.message || 'Extraction failed' }
  }
})



app.whenReady().then(async () => {
  console.log('[electron] Starting Kurōdo...')

  // Start the torrent streaming server
  torrentStreamServer.listen(TORRENT_STREAM_PORT, '127.0.0.1', () => {
    console.log(`[torrent] Stream server listening on http://127.0.0.1:${TORRENT_STREAM_PORT}`)
  })

  // ── File-based diagnostic log ──────────────────────────────────
  const diagLog = path.join(app.getPath('userData'), 'startup.log')
  const diag = (...args) => {
    const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n'
    try { fs.appendFileSync(diagLog, `[${new Date().toISOString()}] ${line}`) } catch {}
  }
  diag('=== Kurōdo starting v' + app.getVersion() + ' ===')

  // Force the Express server to bind to the same port as dev mode
  process.env.PORT = process.env.PORT || '5173'

  // Expose the backend origin to the renderer so relative API/image URLs
  // resolve correctly even if the page is ever loaded from file:// or a
  // different origin. The preload reads this and sets
  // window.__KURODO_BACKEND_ORIGIN__.
  process.env.KURODO_BACKEND_ORIGIN = `http://localhost:${process.env.PORT}`

  // ── Server-side env (.env.local) for the in-process backend ─────
  // The Express server is imported in-process below. Its own dotenv
  // loader resolves .env.local relative to server/index.js — a path that
  // doesn't exist inside the packaged asar. .env.local is shipped via
  // electron-builder extraResources to <resources>/.env.local in
  // packaged builds; in dev it sits next to electron/. Load it here so
  // keys like TMDB_API_KEY land in process.env BEFORE the server module
  // is imported (same-process env sharing). Never overrides variables
  // the launcher/shell already set explicitly.
  try {
    const envCandidates = app.isPackaged
      ? [path.join(process.resourcesPath, '.env.local')]
      : [path.join(__dirname, '..', '.env.local')]
    for (const envPath of envCandidates) {
      if (!fs.existsSync(envPath)) continue
      const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        // Only forward server-side keys (TMDB + proxy config). Never
        // touch PORT/KURODO_BACKEND_ORIGIN which we set above.
        if (!/^(TMDB_|RESIDENTIAL_PROXY_URL|GOGO_PROXIES|ANIWATCH_DOMAIN)/.test(key)) continue
        if (process.env[key] !== undefined) continue
        process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      }
      console.log('[electron] Loaded server env from:', envPath)
      break
    }
  } catch (err) {
    console.warn('[electron] Could not load .env.local:', err.message)
  }

  // ── Create splash window ───────────────────────────────────────
  // Shows immediately — the Netflix-style animation starts right away.
  const splashWin = createSplashWindow()
  const splashPath = path.join(__dirname, 'splash.html')
  console.log('[electron] Loading splash:', splashPath)
  diag('Loading splash:', splashPath)
  splashWin.loadFile(splashPath)

  // ── Create main window (hidden) — will load app when server is ready
  const mainWin = createMainWindow()
  mainWindow = mainWin
  diag('Main window created (hidden)...')

  // Reset renderer crash retry counter once the app successfully loads,
  // so a later transient crash can still trigger an auto-reload.
  mainWin.webContents.on('did-finish-load', () => {
    renderCrashReloadCount = 0
  })

  // ── Start server in parallel ───────────────────────────────────
  let serverReady = false
  let serverError = null

  const startServer = Promise.race([
    (async () => {
      try {
        diag('Importing server module...')
        // In packaged app, server is in extraResources (outside asar).
        // In dev mode, server is a sibling of electron/.
        // Packaged: server lives inside the asar (asarUnpack redirects file
        // reads to app.asar.unpacked automatically) so its bare imports
        // resolve against app.asar/node_modules. Dev: sibling of electron/.
        const serverPath = app.isPackaged
          ? path.join(process.resourcesPath, 'app.asar', 'server', 'index.js')
          : path.join(__dirname, '..', 'server', 'index.js')
        // Windows ESM loader rejects bare absolute paths ("Received protocol 'c:'");
        // always convert to a file:// URL.
        await import(pathToFileURL(serverPath).href)
        diag('Server module loaded, waiting for HTTP...')
        console.log('[electron] Backend module loaded, waiting for HTTP server...')
        await waitForServer()
        serverReady = true
        diag('Server ready')
        console.log('[electron] Backend ready')
      } catch (err) {
        serverError = err
        diag('Server start failed:', err?.message || String(err))
        console.error('[electron] Failed to start backend:', err)
      }
    })(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Server startup timed out after 30 s')), 30000),
    ),
  ]).catch((err) => {
    if (!serverError && !serverReady) serverError = err
    diag('Server startup race failed:', err?.message || String(err))
  })

  // ── Emergency quit at 35 s ─────────────────────────────────────
  setTimeout(() => {
    if (!serverReady) {
      diag('EMERGENCY QUIT: server never started after 35 s')
      console.error('[electron] Emergency quit — server never started')
      app.quit()
    }
  }, 35000)

  // ── Transition: splash → app ───────────────────────────────────
  // When both splash animation finishes AND server is ready, swap windows.
  let splashDone = false

  const showApp = async () => {
    if (splashDone) return
    splashDone = true

    // Wait for server if still starting
    if (!serverReady && !serverError) {
      console.log('[electron] Splash done — waiting for server...')
      diag('Splash done, waiting for server...')
      await startServer
    }

    if (serverError) {
      console.error('[electron] Server failed to start — showing error page instead of quitting')
      diag('Server failed, showing error page:', serverError?.message || String(serverError))
      if (!splashWin.isDestroyed()) splashWin.close()

      // Show an error page instead of quitting — the user can retry.
      const errorMsg = serverError?.message || String(serverError)
      // Escape & first, then < and > to avoid double-escaping
      const safeError = errorMsg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      mainWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html><html><head><meta charset="utf-8">
        <title>Kurōdo - Startup Error</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { background: #0a0a0a; color: #fff; font-family: 'Segoe UI', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; overflow: hidden; }
          .container { text-align: center; max-width: 560px; padding: 2rem; }
          .logo { font-size: 42px; font-weight: 900; letter-spacing: 0.08em; background: linear-gradient(135deg, #ff4d9d, #a855f7); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 1.5rem; }
          h1 { font-size: 18px; font-weight: 600; color: rgba(255,255,255,0.9); margin-bottom: 0.5rem; }
          p { font-size: 14px; color: rgba(255,255,255,0.5); line-height: 1.6; margin-bottom: 1.5rem; }
          .error-box { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; text-align: left; }
          .error-box code { font-size: 12px; color: rgba(255,100,100,0.85); word-break: break-all; font-family: 'Cascadia Code', 'Consolas', monospace; }
          .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 24px; border-radius: 10px; background: linear-gradient(135deg, #ff4d9d, #a855f7); color: #fff; font-size: 14px; font-weight: 600; border: none; cursor: pointer; transition: transform 200ms, box-shadow 200ms; }
          .btn:hover { transform: translateY(-2px); box-shadow: 0 8px 24px -8px rgba(168,85,247,0.5); }
          .hint { font-size: 12px; color: rgba(255,255,255,0.3); margin-top: 1rem; }
        </style>
        </head><body><div class="container">
          <div class="logo">KURŌDO</div>
          <h1>Couldn't start the backend server</h1>
          <p>The app needs its backend to load anime content. This usually means another instance is already running or a port is in use.</p>
          <div class="error-box"><code>${safeError}</code></div>
          <button class="btn" id="retryBtn">Retry</button>
          <p class="hint">Close any other Kurōdo instances and click Retry. Check startup.log in %APPDATA%/kurodo/ for details.</p>
          <script>
            document.getElementById('retryBtn').addEventListener('click', function() {
              if (window.electronAPI && window.electronAPI.restartApp) {
                window.electronAPI.restartApp();
              } else {
                window.location.reload();
              }
            });
          </script>
        </div></body></html>
      `)}`)
      mainWin.show()
      mainWin.focus()
      return
    }

    console.log('[electron] Showing app...')
    diag('Showing app, loading URL...')

    // Load the app URL now that the server is confirmed ready
    mainWin.loadURL(SERVER_URL)
    mainWin.show()
    mainWin.focus()

    // Close splash with a tiny delay so the main window renders first
    setTimeout(() => {
      if (!splashWin.isDestroyed()) splashWin.close()
    }, 150)


    // Start checking for updates (local first, remote only if feed URL is set).
    // Delay 3s so the React app has time to mount and register its IPC
    // listeners — otherwise the update-available / update-ready events are
    // silently dropped because no one is listening yet.
    setTimeout(() => {
      try {
        const logPath = path.join(app.getPath('userData'), 'startup.log')
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] [updater] Starting local update check...\n`)
      } catch { /* ignore */ }
      checkLocalUpdate()
      if (currentFeedUrl) {
        setupAutoUpdater()
      } else {
        try {
          const logPath = path.join(app.getPath('userData'), 'startup.log')
          fs.appendFileSync(logPath, `[${new Date().toISOString()}] [updater] No remote feed configured — local-only update mode\n`)
        } catch { /* ignore */ }
        console.log('[updater] No remote feed configured — local-only update mode')
      }
    }, 3000)
  }

  ipcMain.once('splash:done', () => showApp())

  // Safety timeout: 8 s
  setTimeout(() => showApp(), 8000)
})

app.on('window-all-closed', () => {
  // Clean up torrent progress interval to prevent leaks
  if (torrentProgressInterval) clearInterval(torrentProgressInterval)
  // Close torrent stream server
  torrentStreamServer.close(() => console.log('[torrent] Stream server closed'))
  // Clean up extracted subtitle cache
  try {
    for (const f of fs.readdirSync(subtitleCachePath)) {
      fs.unlinkSync(path.join(subtitleCachePath, f))
    }
  } catch { /* ignore */ }
  // On macOS, apps typically stay active until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    const win = createMainWindow()
    win.loadURL(SERVER_URL)
    win.show()

    // Re-start torrent services that were stopped on window-all-closed
    if (!torrentStreamServer.listening) {
      torrentStreamServer.listen(TORRENT_STREAM_PORT, '127.0.0.1', () => {
        console.log(`[torrent] Stream server re-started on port ${TORRENT_STREAM_PORT}`)
      })
    }
    // Re-start the progress broadcast if it was cleared
    if (!torrentProgressInterval) {
      torrentProgressInterval = setInterval(broadcastTorrentProgress, 1000)
    }
  }
})

// ── Global crash handlers — prevent silent termination ───────────
// Without these, any unhandled error in WebTorrent, ffprobe/ffmpeg
// spawns, or fetch calls will silently crash the entire app.
//
// In addition to logging, we send a toast to the renderer so the user
// knows something went wrong and can help diagnose the issue.
function sendCrashToast(msg) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('app:crash', msg)
  })
}

process.on('uncaughtException', (err) => {
  const msg = err.message || String(err)
  console.error('[FATAL] uncaughtException:', err.stack || msg)
  sendCrashToast(msg)
})

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason || 'Unknown rejection')
  console.error('[FATAL] unhandledRejection:', reason)
  sendCrashToast(msg)
})

// Log warning on torrent stream server errors but don't crash
torrentStreamServer.on('error', (err) => {
  console.error('[torrent-stream-server] Error:', err.message)
})


