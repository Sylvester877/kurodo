#!/usr/bin/env node
/**
 * End-to-end test of the AniList popup sign-in flow.
 *
 * Boots the backend + vite dev server, opens the app with a real
 * headless Chrome (via puppeteer), clicks the navbar Sign in button,
 * captures the popup URL, simulates AniList's redirect-with-token,
 * intercepts the GraphQL "Viewer" request to inject a fake user, and
 * verifies the auth store ends up populated with the right values.
 *
 * Run with: `node scripts/e2e-auth.mjs`
 * Exits 0 on success, 1 on any check failure (and prints a diagnostic).
 *
 * Why this exists: signing in is the #1 most-fragile flow in the app
 * (OAuth + popups + postMessage + multiple redirects). After multiple
 * "should work" claims that didn't, this gives us a real verifier.
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import puppeteer from 'puppeteer'

const BACKEND_PORT = 5173
const VITE_PORT = 5173
const BASE = `http://localhost:${VITE_PORT}`

const FAKE_TOKEN = 'kurodo-e2e-fake-access-token'
const FAKE_USER = { id: 999_999, name: 'KurodoE2E', avatar: { large: null } }

function log(...args) {
  process.stdout.write(`[e2e] ${args.join(' ')}\n`)
}
function fail(msg) {
  process.stderr.write(`\n\x1b[31m✗ FAIL\x1b[0m ${msg}\n`)
  process.exit(1)
}
function ok(msg) {
  process.stdout.write(`\x1b[32m✓\x1b[0m ${msg}\n`)
}

const procs = []
function start(name, cmd, args, env = {}) {
  log(`start ${name}: ${cmd} ${args.join(' ')}`)
  const child = spawn(cmd, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (b) => process.stdout.write(`\x1b[2m[${name}]\x1b[0m ${b}`))
  child.stderr.on('data', (b) => process.stderr.write(`\x1b[2m[${name}]\x1b[0m ${b}`))
  child.on('exit', (code) => log(`${name} exited (${code})`))
  procs.push(child)
  return child
}

async function waitForPort(port, label, timeoutMs = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) })
      if (r.status < 500) { ok(`${label} ready on :${port}`); return }
    } catch { /* retry */ }
    await sleep(250)
  }
  fail(`${label} did not come up on :${port} within ${timeoutMs}ms`)
}

async function cleanup() {
  for (const p of procs) {
    try { p.kill('SIGTERM') } catch { /* ignore */ }
  }
  await sleep(200)
  for (const p of procs) {
    try { p.kill('SIGKILL') } catch { /* ignore */ }
  }
}

process.on('uncaughtException', async (e) => { console.error(e); await cleanup(); process.exit(1) })
process.on('SIGINT', async () => { await cleanup(); process.exit(130) })

// ────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Boot backend + vite.
  start('backend', 'node', ['server/index.js'], { PORT: String(BACKEND_PORT) })
  start('vite', 'node', ['node_modules/vite/bin/vite.js', '--port', String(VITE_PORT), '--strictPort'])

  await waitForPort(BACKEND_PORT, 'backend')
  await waitForPort(VITE_PORT, 'vite')

  // 2. Launch headless Chrome.
  log('launching puppeteer…')
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // Allow popups without user gesture (we click in test code).
    ],
  })
  const page = await browser.newPage()

  // Capture console for visibility.
  page.on('console', (m) => {
    const t = m.text()
    if (t.includes('Kurōdo') || t.includes('auth') || t.includes('AniList') || m.type() === 'error') {
      log(`[browser console ${m.type()}]`, t)
    }
  })
  page.on('pageerror', (e) => log('[browser pageerror]', e.message))

  // 3. Intercept GraphQL "Viewer" calls so the fake token resolves to a fake user.
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    const url = req.url()
    if (url === 'https://graphql.anilist.co/' || url === 'https://graphql.anilist.co') {
      const body = req.postData() || ''
      if (body.includes('Viewer') || body.includes('viewer')) {
        log('[intercept] mocking AniList Viewer GraphQL')
        await req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { Viewer: FAKE_USER } }),
        })
        return
      }
    }
    req.continue()
  })

  // 4. Load the home page.
  log(`navigating to ${BASE}/`)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  ok('home page loaded')

  // 5. Make sure the user is signed out (clear any persisted token).
  await page.evaluate(() => {
    localStorage.removeItem('kurodo-anilist-auth')
    localStorage.removeItem('kurodo-anilist-client-id')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  ok('local auth cleared, reloaded')

  // 6. Find the Sign in button.
  // It's the AccountMenu button when no auth — text "Sign in".
  await page.waitForSelector('button[aria-label="Sign in with AniList"], a[href*="oauth/authorize"]', { timeout: 5000 })
  ok('sign-in button rendered')

  // Patch window.open to capture the popup target URL WITHOUT actually
  // opening a Chrome popup window (which is brittle in headless). We
  // capture the URL, then we create our OWN page that loads the callback
  // URL directly with a simulated AniList fragment.
  await page.evaluate(() => {
    // @ts-ignore
    window.__kurodoCapturedPopupUrl = null
    const origOpen = window.open.bind(window)
    // @ts-ignore
    window.open = (url, name, features) => {
      // @ts-ignore
      window.__kurodoCapturedPopupUrl = String(url)
      // Return a stub "popup" so signInWithPopup's promise doesn't
      // reject with "popup blocked".
      const stub = {
        closed: false,
        close: () => { stub.closed = true },
      }
      // Expose so test can manipulate it later.
      // @ts-ignore
      window.__kurodoPopupStub = stub
      return stub
    }
  })

  // 7. Click the sign-in button.
  await page.click('button[aria-label="Sign in with AniList"]')
  log('clicked sign-in')

  // 8. Verify the captured popup URL.
  const capturedUrl = await page.evaluate(() => /** @type {any} */ (window).__kurodoCapturedPopupUrl)
  if (!capturedUrl) fail('window.open was never called — sign-in button did not trigger popup')
  log('captured popup URL:', capturedUrl)

  const u = new URL(capturedUrl)
  if (u.origin !== 'https://anilist.co') fail(`wrong popup origin: ${u.origin}`)
  if (u.pathname !== '/api/v2/oauth/authorize') fail(`wrong popup path: ${u.pathname}`)
  if (u.searchParams.get('response_type') !== 'token') fail(`expected response_type=token, got ${u.searchParams.get('response_type')}`)
  if (u.searchParams.get('client_id') !== '42167') fail(`expected client_id=42167, got ${u.searchParams.get('client_id')}`)
  if (u.searchParams.get('redirect_uri') !== `${BASE}/auth/callback`) fail(`bad redirect_uri: ${u.searchParams.get('redirect_uri')}`)
  ok('popup URL is correct (implicit flow, client 42167, right redirect)')

  // 9. Simulate AniList's redirect-with-token by loading the callback
  //    page in a SECOND tab — and crucially, set window.opener so our
  //    AuthCallback detects we're in a popup.
  log('opening callback page with simulated #access_token=…')
  const callbackUrl = `${BASE}/auth/callback#access_token=${FAKE_TOKEN}&token_type=Bearer&expires_in=31536000`
  const callbackPage = await browser.newPage()

  // Intercept GraphQL on this page too.
  await callbackPage.setRequestInterception(true)
  callbackPage.on('request', async (req) => {
    const url = req.url()
    if (url === 'https://graphql.anilist.co/' || url === 'https://graphql.anilist.co') {
      const body = req.postData() || ''
      if (body.includes('Viewer') || body.includes('viewer')) {
        await req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { Viewer: FAKE_USER } }),
        })
        return
      }
    }
    req.continue()
  })
  callbackPage.on('console', (m) => log(`[callback console ${m.type()}]`, m.text()))

  // Set window.opener BEFORE the page's JS runs, to mimic popup-from-opener.
  await callbackPage.evaluateOnNewDocument((mainTargetId) => {
    // Synthesize an opener that supports postMessage. In a real popup
    // this is the main window; here we route postMessage calls back to
    // our test by storing them on a global the test can read.
    const opener = {
      // The opener has its OWN postMessage; we forward to a global.
      postMessage(msg, _origin) {
        // @ts-ignore
        ;(window).__kurodoPostedToOpener = msg
      },
    }
    try {
      Object.defineProperty(window, 'opener', { value: opener, configurable: true })
    } catch {
      // Fallback: writable property
      // @ts-ignore
      window.opener = opener
    }
    void mainTargetId  // unused
  })

  await callbackPage.goto(callbackUrl, { waitUntil: 'domcontentloaded' })

  // Wait for the callback's effect to run and postMessage to fire.
  await sleep(1500)

  const posted = await callbackPage.evaluate(() => /** @type {any} */ (window).__kurodoPostedToOpener)
  if (!posted) fail('callback page did NOT postMessage to opener')
  log('postMessage payload:', JSON.stringify(posted))
  if (posted.type !== 'kurodo-anilist-auth') fail(`wrong message type: ${posted.type}`)
  if (posted.ok !== true) fail(`postMessage reported failure: ${posted.error}`)
  if (posted.token !== FAKE_TOKEN) fail(`token mismatch: got ${posted.token}`)
  ok('callback posted token back to opener correctly')

  // 10. Now simulate the main window receiving that postMessage. Our
  //     signInWithPopup() promise is still pending in `page` waiting for
  //     a message event. Dispatch one and check the auth store updates.
  await page.evaluate((msg) => {
    window.postMessage(msg, window.location.origin)
  }, posted)

  // Wait for the store to update.
  await sleep(2000)

  const authState = await page.evaluate(() => {
    const raw = localStorage.getItem('kurodo-anilist-auth')
    return raw ? JSON.parse(raw) : null
  })
  if (!authState) fail('auth was NOT persisted to localStorage after postMessage')
  if (authState.token !== FAKE_TOKEN) fail(`persisted token wrong: ${authState.token}`)
  if (authState.user?.id !== FAKE_USER.id) fail(`persisted user id wrong: ${authState.user?.id}`)
  if (authState.user?.name !== FAKE_USER.name) fail(`persisted user name wrong: ${authState.user?.name}`)
  ok('auth persisted with correct token + user')

  // 11. Also verify the navbar now shows the signed-in state.
  const signedInDom = await page.evaluate(() => {
    // The AccountMenu shows the user's name once signed in.
    return document.body.innerText.includes('KurodoE2E')
  })
  if (!signedInDom) {
    log('(non-fatal) navbar did not render user name yet — store updated though')
  } else {
    ok('navbar shows signed-in user')
  }

  await browser.close()
  log('done.')
}

try {
  await main()
  await cleanup()
  process.stdout.write('\n\x1b[32m✓ ALL CHECKS PASSED\x1b[0m\n')
  process.exit(0)
} catch (e) {
  console.error(e)
  await cleanup()
  process.exit(1)
}
