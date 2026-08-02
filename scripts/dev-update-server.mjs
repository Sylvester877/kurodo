/**
 * Dev Update Server — serves the electron-builder release/ folder over HTTP
 * so that an installed Kurōdo app can check for delta updates locally.
 *
 * Usage:
 *   node scripts/dev-update-server.mjs [port]
 *
 * The server serves static files from ../release/ with correct CORS headers.
 * electron-updater fetches latest.yml to discover new versions, then
 * downloads only the delta blocks (via .blockmap) instead of the full 193MB installer.
 *
 * After building with `npm run electron:build:win`, run this script, then
 * launch the installed Kurōdo app. It will detect the update, download only
 * changed bytes, and prompt to restart.
 *
 * To use with the installed app (not dev mode), set:
 *   UPDATE_FEED_URL=http://localhost:8080
 * before launching the installed app, OR repackage with the correct
 * build.publish.url in package.json.
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RELEASE_DIR = path.resolve(__dirname, '..', 'release')
const PORT = Number(process.argv[2]) || 8080

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.yml': 'application/x-yaml',
  '.yaml': 'application/x-yaml',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.dmg': 'application/octet-stream',
  '.AppImage': 'application/octet-stream',
  '.deb': 'application/octet-stream',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
}

const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    })
    res.end()
    return
  }

  // Parse the URL path (decode %-encoded characters for non-ASCII filenames like "Kurōdo")
  const rawPath = req.url === '/' ? '/latest.yml' : req.url.split('?')[0]
  let filePath = path.join(RELEASE_DIR, decodeURIComponent(rawPath))

  // Security: prevent directory traversal
  if (!filePath.startsWith(RELEASE_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  // Check if file exists
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // If file not found, list the directory for convenience
    if (req.url === '/' || req.url === '') {
      const files = fs.readdirSync(RELEASE_DIR)
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Kurōdo Update Server</title>
  <style>
    body { font-family: system-ui; background: #0a0a0a; color: #e0e0e0; padding: 2rem; }
    h1 { color: #a855f7; font-size: 1.5rem; margin-bottom: 1rem; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px;
             font-size: 0.7rem; font-weight: 600; background: #a855f722; color: #a855f7;
             margin-left: 0.5rem; }
    a { color: #818cf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul { list-style: none; padding: 0; }
    li { padding: 0.5rem 0; border-bottom: 1px solid #ffffff10; display: flex; align-items: center; gap: 0.5rem; }
    .size { color: #ffffff40; font-size: 0.8rem; margin-left: auto; }
    .tip { background: #818cf811; border: 1px solid #818cf822; border-radius: 0.75rem; padding: 1rem;
           margin-top: 1.5rem; font-size: 0.85rem; line-height: 1.5; }
    code { background: #ffffff10; padding: 0.15rem 0.4rem; border-radius: 0.25rem; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>🔮 Kurōdo Update Server <span class="badge">Dev</span></h1>
  <p style="color:#ffffff60;font-size:0.85rem;">Serving delta updates from <code>${RELEASE_DIR}</code></p>
  <ul>
    ${files.map((f) => {
      const stat = fs.statSync(path.join(RELEASE_DIR, f))
      const size = stat.size > 1024 * 1024
        ? `${(stat.size / 1024 / 1024).toFixed(1)} MB`
        : stat.size > 1024
          ? `${(stat.size / 1024).toFixed(1)} KB`
          : `${stat.size} B`
      const isDelta = f.endsWith('.blockmap')
      return `<li>
        <span>${isDelta ? '📦' : '📄'}</span>
        <a href="/${f}">${f}</a>
        ${isDelta ? '<span class="badge" style="background:#22c55e22;color:#22c55e;">delta</span>' : ''}
        <span class="size">${size}</span>
      </li>`
    }).join('')}
  </ul>
  <div class="tip">
    <strong>📋 How to use delta updates:</strong><br>
    1. Install the Kurōdo app (run <code>Kurōdo-Setup-0.1.0.exe</code>)<br>
    2. After making changes, run <code>npm run electron:build:win</code><br>
    3. Keep this server running<br>
    4. Launch the installed app — it checks <code>latest.yml</code>, downloads only changed blocks, and prompts to restart<br><br>
    <strong>Delta savings:</strong> Only ~200KB blockmap + changed ~5-50MB blocks instead of full 193MB download.
  </div>
</body>
</html>`)
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
    return
  }

  // Serve the file with correct MIME type and CORS headers
  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  res.writeHead(200, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-cache',
    'Content-Length': fs.statSync(filePath).size,
  })

  fs.createReadStream(filePath).pipe(res)
})

server.listen(PORT, () => {
  console.log('')
  console.log('  🔮  Kurōdo Dev Update Server')
  console.log('  ─────────────────────────────')
  console.log(`  Serving:  ${RELEASE_DIR}`)
  console.log(`  URL:      http://localhost:${PORT}`)
  console.log('')
  console.log('  Delta updates are active — installed apps will download')
  console.log('  only changed binary blocks, not the full 193 MB installer.')
  console.log('')
  console.log('  To test:')
  console.log(`    1. Build:   npm run electron:build:win`)
  console.log(`    2. Install: Kurōdo-Setup-0.1.0.exe`)
  console.log(`    3. Set env: UPDATE_FEED_URL=http://localhost:${PORT}`)
  console.log(`    4. Launch the installed app — it auto-updates!`)
  console.log('')
})
