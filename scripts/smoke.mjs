#!/usr/bin/env node
/**
 * Kurōdo end-to-end smoke test.
 *
 * Spins up assumptions about a running backend at $KURODO_BASE (default
 * http://localhost:3001) and exercises every critical API surface that
 * a real user touches during a session: health, scraper info / episodes
 * / servers / sources, the HLS proxy round-trip with manifest rewriting,
 * the subtitle MIME rewrite, the download endpoint, AniList exchange
 * input validation, and the /api/diag pipeline.
 *
 * Exits 0 when all probes pass, 1 on any failure. Designed to be a
 * single npm script you can run before pushing — `npm run smoke`.
 *
 * Run the dev server in another terminal first: `npm run dev:server`.
 */

import axios from 'axios'

const BASE = process.env.KURODO_BASE || 'http://localhost:5173'
const TIMEOUT = Number(process.env.KURODO_TIMEOUT_MS || 30000)

// Stable test data — known-good slugs we've verified against real anidap.
// If a slug rotates, update here.
const TESTS = {
  // [AniList ID, slug, anime label]
  ONE_PIECE:      [21,    'one-piece-p8k27',                  'One Piece'],
  DEMON_SLAYER:   [101922, 'demon-slayer-kimetsu-no-yaiba-j2hzd', 'Demon Slayer'],
  HXH:            [11061, 'hunter-x-hunter-2011-kr5xd',       'Hunter x Hunter'],
}

const results = []
let exitCode = 0

const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`
const green = (s) => c(32, s)
const red = (s) => c(31, s)
const yellow = (s) => c(33, s)
const dim = (s) => c(2, s)

async function check(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    const ms = Date.now() - t0
    results.push({ name, ok: true, ms, detail })
    console.log(`  ${green('✓')} ${name.padEnd(56)} ${dim(`${ms}ms`)}${detail ? '  ' + dim(detail) : ''}`)
  } catch (e) {
    const ms = Date.now() - t0
    results.push({ name, ok: false, ms, error: e.message })
    console.log(`  ${red('✗')} ${name.padEnd(56)} ${dim(`${ms}ms`)}  ${red(e.message)}`)
    exitCode = 1
  }
}

function header(s) {
  console.log()
  console.log(c(1, s))
  console.log(c(2, '─'.repeat(s.length)))
}

// Browser-like headers to avoid Cloudflare / CDN anti-bot blocks.
// Some endpoints inspect User-Agent + sec-ch-ua to distinguish real
// browsers from scripted HTTP clients.
const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'sec-ch-ua':
    '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
  'sec-ch-ua-platform': '"Windows"',
  'sec-ch-ua-mobile': '?0',
  'accept': 'application/json, */*',
  'accept-language': 'en-US,en;q=0.9',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
}

async function get(path, opts = {}) {
  const r = await axios.get(`${BASE}${path}`, {
    timeout: TIMEOUT,
    validateStatus: () => true,
    headers: { ...BROWSER_HEADERS, ...(opts.headers || {}) },
    ...opts,
  })
  return r
}

console.log(`Kurōdo smoke test against ${BASE}`)
console.log(`(timeout: ${TIMEOUT}ms — set KURODO_TIMEOUT_MS to override)`)

header('1. Backend health')

await check('GET /api/health', async () => {
  const r = await get('/api/health')
  if (r.status !== 200 || !r.data?.ok) throw new Error(`HTTP ${r.status}`)
  return r.data.service
})

header('2. Anidap scraper pipeline')

for (const [, slug, label] of [TESTS.ONE_PIECE, TESTS.DEMON_SLAYER]) {
  const [id] = label === 'One Piece' ? TESTS.ONE_PIECE : TESTS.DEMON_SLAYER

  await check(`${label} → /api/anidap/info`, async () => {
    const r = await get(`/api/anidap/info/${id}`)
    if (!r.data?.data?.slug) throw new Error('no slug returned')
    return `slug=${r.data.data.slug}`
  })

  await check(`${label} → /api/anidap/episodes`, async () => {
    const r = await get(`/api/anidap/episodes/${slug}?anilistId=${id}`)
    const list = r.data?.data?.episodes ?? []
    if (list.length === 0) throw new Error('empty episode list')
    return `${list.length} episodes`
  })

  await check(`${label} → /api/anidap/servers (ep 1)`, async () => {
    const r = await get(`/api/anidap/servers/${slug}/1?anilistId=${id}`)
    const provs = r.data?.data?.providers ?? []
    if (provs.length === 0) throw new Error('no providers')
    return `${provs.length} providers · source=${r.data.data.source}`
  })

  await check(`${label} → /api/anidap/sources/yuki/sub`, async () => {
    const r = await get(`/api/anidap/sources/${slug}/1/yuki/sub?anilistId=${id}`)
    if (!r.data?.data?.url) throw new Error(r.data?.error || 'no url')
    return `host=${new URL(r.data.data.url).host}`
  })
}

header('3. HLS proxy + manifest rewriting')

const [opId, opSlug] = TESTS.ONE_PIECE
const srcResp = await get(`/api/anidap/sources/${opSlug}/1/yuki/sub?anilistId=${opId}`)
const proxiedUrl = srcResp.data?.data?.proxiedUrl
if (!proxiedUrl) {
  console.log(`  ${yellow('!')} no proxiedUrl in sources response — skipping HLS proxy checks`)
} else {
  await check('Proxy master.m3u8 round-trip', async () => {
    const r = await get(proxiedUrl, { responseType: 'text' })
    const body = String(r.data)
    if (!body.startsWith('#EXTM3U')) throw new Error(`not a manifest: ${body.slice(0, 80)}`)
    const ct = String(r.headers['content-type'] || '')
    if (!ct.includes('mpegurl')) throw new Error(`wrong content-type: ${ct}`)
    return `${body.split('\n').length} lines · ct=${ct.slice(0, 30)}`
  })

  await check('Proxy rewrote segment URLs (relative → /proxy)', async () => {
    const r = await get(proxiedUrl, { responseType: 'text' })
    const lines = String(r.data).split('\n').filter((l) => l && !l.startsWith('#'))
    const allProxied = lines.every((l) => l.startsWith('/proxy'))
    if (!allProxied) throw new Error(`some segments not rewritten: ${lines[0]}`)
    return `all ${lines.length} segment URLs proxied`
  })

  await check('Proxy preserves h= param into segments', async () => {
    const r = await get(proxiedUrl, { responseType: 'text' })
    const lines = String(r.data).split('\n').filter((l) => l && !l.startsWith('#'))
    if (!lines[0]?.includes('&h=')) throw new Error('first segment URL missing h=')
    return `${lines[0].length}-char rewritten URL`
  })
}

header('4. Subtitle proxy (text/vtt MIME rewrite)')

const subFile = srcResp.data?.data?.subtitles?.[0]?.file
if (!subFile) {
  console.log(`  ${yellow('!')} no subtitle tracks for this stream — skipping VTT checks`)
} else {
  const headers = srcResp.data?.data?.headers || {}
  const h = Buffer.from(JSON.stringify(headers)).toString('base64')
  const subProxied = `/proxy?url=${encodeURIComponent(subFile)}&h=${encodeURIComponent(h)}`

  await check('Proxy subtitle returns text/vtt', async () => {
    const r = await get(subProxied, { responseType: 'text' })
    const ct = String(r.headers['content-type'] || '')
    if (!ct.includes('text/vtt')) throw new Error(`wrong ct: ${ct}`)
    if (!String(r.data).startsWith('WEBVTT')) throw new Error('body not WEBVTT')
    return `ct=${ct}`
  })
}

header('5. Download endpoint')

await check('GET /api/anidap/download/.../yuki/sub', async () => {
  // Some CDNs (Cloudflare, chad.anidap.se) inspect the full request
  // chain including Referer/Origin. Use anidap.se as the referer so
  // the backend's outbound request to chad gets a friendly referer.
  // Pass anilistId so the router's cross-provider fallback can resolve
  // slugs for providers other than anidap (miruro, saturn, etc.).
  const r = await get(`/api/anidap/download/${opSlug}/1/yuki/sub?anilistId=${opId}`, {
    headers: {
      referer: 'https://anidap.se/',
      origin: 'https://anidap.se',
    },
  })
  if (!r.data?.ok) throw new Error(r.data?.error || 'not ok')
  const kind = r.data.data?.kind
  return `kind=${kind}`
})


header('5b. Server probe endpoint (parallel health check)')

await check('GET /api/anidap/probe/.../1 — finds ≥1 working server', async () => {
  const r = await get(`/api/anidap/probe/${opSlug}/1?anilistId=${opId}&max=8`, {
    timeout: 60_000,
  })
  if (!r.data?.ok) throw new Error(r.data?.error || `HTTP ${r.status}`)
  const { results, working } = r.data.data
  if (!Array.isArray(results) || results.length === 0) throw new Error('no probe results')
  // From a datacenter IP we often only get yuki — that's still a valid result.
  // On residential the user typically sees 3-6 working servers.
  if (working.length === 0) {
    throw new Error(`0/${results.length} servers worked from this IP — ` +
      `expected ≥1 (try residential network if running locally)`)
  }
  return `${working.length}/${results.length} working · fastest=${working[0].name}@${working[0].ms}ms`
})

header('6. AniList exchange endpoint (input validation)')

await check('POST /api/anilist/exchange (missing body)', async () => {
  const r = await axios.post(`${BASE}/api/anilist/exchange`, {}, {
    timeout: 5000,
    validateStatus: () => true,
  })
  if (r.data?.ok) throw new Error('should have rejected empty body')
  if (!r.data?.error?.includes('Missing')) throw new Error(`unexpected: ${r.data?.error}`)
  return 'rejected with friendly error'
})

header('7. Full diag pipeline (/api/diag)')

await check('GET /api/diag?anilistId=101922&ep=1 — all probes pass', async () => {
  const r = await get(`/api/diag?anilistId=101922&ep=1`)
  const steps = r.data?.data?.steps ?? []
  if (steps.length === 0) throw new Error('no steps')
  const fails = steps.filter((s) => !s.ok)
  if (fails.length > 0) {
    throw new Error(`${fails.length}/${steps.length} probes failed: ${fails[0].label}`)
  }
  return `${steps.length}/${steps.length} probes OK`
})

// ─── Summary ─────────────────────────────────────────────────────────
console.log()
const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok).length
const total = results.length
const totalMs = results.reduce((s, r) => s + r.ms, 0)

if (exitCode === 0) {
  console.log(green(`✓ ${passed}/${total} checks passed`) + dim(` in ${totalMs}ms total`))
} else {
  console.log(red(`✗ ${failed}/${total} checks FAILED`) + dim(` (${passed} passed, ${totalMs}ms total)`))
  console.log()
  console.log(red('Failed checks:'))
  for (const r of results.filter((r) => !r.ok)) {
    console.log(red(`  · ${r.name}: ${r.error}`))
  }
}

process.exit(exitCode)
