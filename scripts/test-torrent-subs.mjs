/**
 * Regression test for the Electron torrent-stream server subtitle routes.
 *
 * Extracts the REAL request handler from electron/main.js (the
 * torrentStreamServer createServer callback) and exercises it against a
 * stub WebTorrent client + temp subtitle files. Guards against the
 * ERR_HTTP_HEADERS_SENT class of bugs:
 *
 *   1. Wyzie subtitle success path must NOT fall through to the /stream
 *      regex (which called res.writeHead(404) after res.end()).
 *   2. Subtitle catch blocks must not call writeHead after headers were
 *      already sent.
 *
 * Also runs a CONTROL pass against the pre-fix version of main.js (git
 * show d7fd049~1) and asserts it FAILS the Wyzie success request — proving
 * the test would have caught the original bug.
 *
 * Usage: node scripts/test-torrent-subs.mjs
 */

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { Readable } from 'node:stream'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = join(__dirname, '..')

const START_MARKER = 'const torrentStreamServer = http.createServer((req, res) => {'
const END_MARKER = '// listen() moved inside app.whenReady()'

/** Extract the raw handler body from a main.js source string. */
function extractHandler(src) {
  const start = src.indexOf(START_MARKER)
  const end = src.indexOf(END_MARKER)
  if (start === -1 || end === -1) throw new Error('handler markers not found in main.js')
  let body = src.slice(start + START_MARKER.length, end)
  // Strip the handler's own closing "})" (closes arrow fn + createServer call).
  const lastClose = body.lastIndexOf('\n})')
  if (lastClose === -1) throw new Error('could not find handler closing brace')
  body = body.slice(0, lastClose)
  return body
}

/** Boot a server running the real handler with stubs. Returns { server, port }. */
async function bootServer(handlerBody, { subsDir, torClient }) {
  const fsMod = await import('node:fs')
  const pathMod = await import('node:path')
  const fn = new Function('http', 'fs', 'path', 'torrentClient', 'subtitleCachePath', 'console', `
    return (req, res) => {
${handlerBody}
    }
  `)
  const handler = fn(http, fsMod, pathMod, torClient, subsDir, console)
  const server = http.createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port })
    })
  })
}

function makeFakeTorrentClient() {
  const fakeFile = {
    length: 1024,
    name: 'episode.mkv',
    path: 'episode.mkv',
    createReadStream: () => Readable.from([Buffer.from('fake-video-bytes')]),
  }
  return {
    get: (h) => (h === 'abc123' ? { files: [fakeFile] } : null),
  }
}

async function runPass(label, src) {
  const subsDir = mkdtempSync(join(tmpdir(), 'kurodo-subs-test-'))
  writeFileSync(join(subsDir, 'wyzie_abc123.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello Wyzie\n')
  writeFileSync(join(subsDir, 'f00f00_0.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nEmbedded Sub\n')

  const { server, port } = await bootServer(extractHandler(src), {
    subsDir,
    torClient: makeFakeTorrentClient(),
  })

  // Capture any handler crash as a FAILURE instead of killing the run.
  let handlerError = null
  const onUncaught = (err) => { handlerError = err }
  process.on('uncaughtException', onUncaught)

  const request = async (pathname) => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`)
      const text = await res.text()
      return { status: res.status, text }
    } catch (e) {
      return { status: -1, text: String(e) }
    }
  }

  const results = []
  const check = (name, pass, detail) => results.push({ name, pass, detail })

  // 1. Wyzie subtitle — EXISTS. Must be 200 + body, and MUST NOT crash.
  const wyzie = await request('/subtitles/wyzie/abc123.vtt')
  check('wyzie existing → 200 + body',
    wyzie.status === 200 && wyzie.text.includes('Hello Wyzie') && handlerError === null,
    `status=${wyzie.status} crash=${handlerError ? handlerError.message : 'none'}`)

  // 2. Wyzie subtitle — MISSING. 404.
  const wyzie404 = await request('/subtitles/wyzie/nope.vtt')
  check('wyzie missing → 404',
    wyzie404.status === 404 && handlerError === null,
    `status=${wyzie404.status}`)

  // 3. Embedded subtitle — EXISTS. 200 + body, no crash.
  const emb = await request('/subtitles/f00f00/0.vtt')
  check('embedded existing → 200 + body',
    emb.status === 200 && emb.text.includes('Embedded Sub') && handlerError === null,
    `status=${emb.status} crash=${handlerError ? handlerError.message : 'none'}`)

  // 4. Embedded subtitle — MISSING. 404.
  const emb404 = await request('/subtitles/f00f00/9.vtt')
  check('embedded missing → 404',
    emb404.status === 404 && handlerError === null,
    `status=${emb404.status}`)

  // 5. Torrent stream — valid torrent + file, no Range. 200 chunked.
  const stream = await request('/stream/abc123/0/episode.mkv')
  check('torrent stream → 200',
    stream.status === 200 && handlerError === null,
    `status=${stream.status}`)

  // 6. Torrent stream — unknown torrent. 404.
  const stream404 = await request('/stream/deadbeef/0/x.mkv')
  check('torrent stream missing torrent → 404',
    stream404.status === 404 && handlerError === null,
    `status=${stream404.status}`)

  // 7. Unknown route. 404.
  const unknown = await request('/nope')
  check('unknown route → 404',
    unknown.status === 404 && handlerError === null,
    `status=${unknown.status}`)

  // Let any intentionally-crashed connection (control pass) settle before
  // tearing down — avoids a Windows libuv teardown assert.
  await new Promise((r) => setTimeout(r, 150))
  process.removeListener('uncaughtException', onUncaught)
  server.closeAllConnections?.()
  server.close()
  rmSync(subsDir, { recursive: true, force: true })

  console.log(`\n=== ${label} ===`)
  let allPass = true
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}  (${r.detail})`)
    if (!r.pass) allPass = false
  }
  return allPass
}

async function main() {
  const currentSrc = readFileSync(join(REPO, 'electron', 'main.js'), 'utf-8')

  // Pre-fix control source: parent of the Wyzie fix commit (d7fd049).
  let oldSrc = null
  try {
    oldSrc = execSync('git show d7fd049~1:electron/main.js', { cwd: REPO, encoding: 'utf-8' })
  } catch {
    console.warn('(!) Could not fetch pre-fix main.js from git — skipping control pass.')
  }

  const currentPass = await runPass('CURRENT main.js (with Wyzie fix)', currentSrc)
  let controlPass = null
  if (oldSrc) {
    controlPass = await runPass('CONTROL — pre-fix main.js (should FAIL Wyzie success)', oldSrc)
  }

  console.log('\n────────── SUMMARY ──────────')
  console.log(`  Current code passes:         ${currentPass ? '✅ YES' : '❌ NO'}`)
  if (oldSrc) {
    console.log(`  Pre-fix code caught by test:  ${controlPass === false ? '✅ YES (bug reproduced)' : controlPass === true ? '❌ NO — test missed the bug!' : 'n/a'}`)
  }

  process.exit(currentPass ? 0 : 1)
}

main().catch((e) => {
  console.error('Test harness error:', e)
  process.exit(2)
})
