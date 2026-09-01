// server/lib/cf-harvester/puppeteer.js — Puppeteer fallback implementation.

import fs from 'node:fs'
import { ANIDAP_BASE, slugCache, isCloudflareChallenge, IS_ELECTRON, trimUrl, makeRemainingBudget, CLICK_DUB_TAB_JS, CLICK_FIRST_SERVER_JS, EXTRACT_IFRAME_JS, EXTRACT_SLUG_JS, resolveSlugFromAniList, formatCookieHeader, directFetchChadSources } from './shared.js'
import { getRandomGogoProxy, markProxyDead } from '../../proxy-config.js'

//  PUPPETEER MODE — internal implementation (standalone fallback)
// ═══════════════════════════════════════════════════════════════════

let _puppeteerImpl = null

async function puppeteerInit() {
  if (_puppeteerImpl) return _puppeteerImpl
  let puppeteer
  try {
    // Use puppeteer-extra with the stealth plugin to avoid Cloudflare
    // Turnstile detection on gogoanime.by in standalone (Puppeteer) mode.
    const { default: puppeteerExtra } = await import('puppeteer-extra')
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default
    puppeteerExtra.use(StealthPlugin())
    puppeteer = puppeteerExtra
  } catch (err) {
    console.error('[cf-harvester] Puppeteer not available in this environment — browser bridge disabled')
    throw err
  }
  console.log('[cf-harvester] Standalone mode — using Puppeteer (may hit Cloudflare blocks)')

  function findChrome() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH
    const candidates = [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
    ].filter(Boolean)
    for (const c of candidates) { try { if (fs.existsSync(c)) return c } catch {} }
    return undefined
  }

  async function safeGoto(pg, url, maxRetries = 3) {
    const isGogo = url.includes('gogoanime')
    // Gogoanime pages are heavy with ads; don't wait forever for the
    // main document. 15s is enough for the HTML + player iframe to load.
    // Non-gogo (anidap) pages should load much faster; 12s leaves
    // enough budget for the actual video extraction within the 35s
    // route-level timeout.
    const gotoTimeout = isGogo ? 15_000 : 12_000
    for (let i = 0; i <= maxRetries; i++) {
      try {
        console.log(`[cf-harvester] safeGoto start: ${trimUrl(url)}`)
        const start = Date.now()
        await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: gotoTimeout })
        console.log(`[cf-harvester] safeGoto done: ${trimUrl(url)} in ${Date.now() - start}ms`)
        return
      } catch (e) {
        if (i === maxRetries) throw e
        if (e.message?.includes('ERR_ABORTED')) {
          console.warn(`[cf-harvester] ERR_ABORTED on ${trimUrl(url)}, retrying ${i + 1}/${maxRetries}…`)
          await new Promise(r => setTimeout(r, 1500))
        } else { throw e }
      }
    }
  }

  // ── Browser state ──
  let browser = null
  let page = null
  let ready = false
  let initPromise = null
  let lastUsed = 0
  let warmupDone = false
  const IDLE_TIMEOUT_MS = 10 * 60 * 1000
  let idleTimer = null
  // Track the proxy currently assigned to the shared browser so anidap
  // traffic never accidentally rides a gogo proxy. `null` means direct.
  let _currentProxy = null
  // Mutex just for browser launch so concurrent callers can't race the
  // initPromise and end up sharing a browser with the wrong proxy.
  let _launchMutex = Promise.resolve()
  function withLaunchMutex(fn) {
    const prev = _launchMutex
    let release
    _launchMutex = new Promise(r => { release = r })
    return prev.then(async () => {
      try { return await fn() }
      finally { release() }
    })
  }

  // ── Gogoanime request throttle ──
  // Cloudflare rate-limits aggressively; spacing requests 5s apart and
  // recycling browser sessions between requests avoids detection.
  const GOGO_THROTTLE_MS = 5000
  let _lastGogoRequest = 0

  // ── Page pool (ROOT FIX — replaces the single-page mutex) ──
  // One shared page meant every extraction for EVERY anime queued on ONE
  // mutex. Under load each extra waiter hit the 18s cap → "Page operation
  // timed out" → provider cooldown → a server that actually works marked
  // dead. A small pool of interchangeable pages lets N extractions run
  // concurrently: same browser + context, so cookies and Cloudflare
  // clearance are shared — it still looks like one user with a few tabs.
  // Pool size 2: measured on the target machine, 3 concurrent SPA extractions
  // thrash CPU and push every load past the work budget; 2 keeps both loads
  // within it while still covering a winner + a race loss in parallel.
  const PAGE_POOL_SIZE = 2
  const pagePoolFree = []
  const pagePoolAll = new Set()
  const poolWaiters = []
  let poolCreating = false

  function isBrokenPageErr(e) {
    const m = String(e?.message || '')
    return /Target closed|detached|Execution context was destroyed|Session closed|page has been closed|Navigating context was destroyed/i.test(m)
  }

  function teardownPool() {
    for (const p of pagePoolAll) { try { p.close() } catch {} }
    pagePoolAll.clear()
    pagePoolFree.length = 0
    const waiters = poolWaiters.splice(0, poolWaiters.length)
    for (const w of waiters) { try { w(false) } catch {} }
  }

  /** Shared per-page setup: viewport, proxy auth, ad-blocking, stealth. */
  async function setupPage(p) {
    await p.setViewport({ width: 1280, height: 720 })
    if (_currentProxy && _currentProxy.auth) {
      await p.authenticate({
        username: _currentProxy.auth.username,
        password: _currentProxy.auth.password,
      })
    }
    await p.setRequestInterception(true)
    p.on('request', (req) => {
      const type = req.resourceType()
      const url = req.url()
      if (['image', 'stylesheet', 'font'].includes(type)) {
        return req.abort('aborted')
      }
      if (url.includes('google') || url.includes('doubleclick') || url.includes('facebook') || url.includes('googletagmanager') || url.includes('adsystem')) {
        return req.abort('aborted')
      }
      req.continue()
    })
    await p.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })
    await p.evaluateOnNewDocument(() => {
      window.chrome = { runtime: {} }
    })
    await p.evaluateOnNewDocument(() => {
      const originalQuery = window.navigator.permissions.query
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters)
      )
    })
    return p
  }

  async function acquirePoolPage(signal) {
    for (;;) {
      if (signal?.aborted) throw new Error('cf-harvester aborted (caller timed out)')
      if (pagePoolFree.length) return pagePoolFree.pop()
      // Lazy-launch: the pool no longer sits behind ensureBrowser, so make
      // sure the browser exists before creating pool pages (idempotent —
      // concurrent callers share the same initPromise).
      if (!browser || !ready) {
        await ensureBrowser(false)
        continue
      }
      if (pagePoolAll.size < PAGE_POOL_SIZE && !poolCreating) {
        poolCreating = true
        try {
          const p = await browser.newPage()
          await setupPage(p)
          pagePoolAll.add(p)
          return p
        } finally { poolCreating = false }
      }
      // Pool exhausted — wait for a release (or abort). The outer bounded
      // guard still enforces the overall deadline.
      const woke = await new Promise((resolve) => {
        poolWaiters.push(resolve)
        if (signal) {
          signal.addEventListener('abort', () => {
            const i = poolWaiters.indexOf(resolve)
            if (i >= 0) poolWaiters.splice(i, 1)
            resolve(false)
          }, { once: true })
        }
      })
      if (woke === false) throw new Error('cf-harvester aborted (caller timed out)')
      // released — loop and take the freed page
    }
  }

  function releasePoolPage(pg) {
    if (!pg || pg.isClosed() || !pagePoolAll.has(pg)) {
      pagePoolAll.delete(pg)
      return
    }
    pagePoolFree.push(pg)
    const w = poolWaiters.shift()
    if (w) { try { w(true) } catch {} }
  }

  // Bounded pool checkout. IMPORTANT deadline semantics (the first pool
  // version got this wrong and it WORSED timeouts): the 18s work deadline
  // starts when the page is GRANTED, not when the call was made. Waiting
  // for a page is bounded only by the caller's abort signal plus a generous
  // outer queue cap — racing providers queue, then each gets a fair full
  // work budget once checked out.
  const PAGE_MUTEX_TIMEOUT = 20_000   // work budget once a page is granted
  const PAGE_QUEUE_TIMEOUT = 32_000   // hard cap on waiting for a page
  async function withPageMutexBounded(fn, signal) {
    if (signal?.aborted) return Promise.reject(new Error('cf-harvester aborted (caller timed out)'))

    // Outer guards: queue wait + total abort safety.
    const outerGuards = [
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Page queue timed out')), PAGE_QUEUE_TIMEOUT)),
    ]
    if (signal) {
      outerGuards.push(
        new Promise((_, reject) => {
          signal.addEventListener('abort', () =>
            reject(new Error('cf-harvester aborted (caller timed out)')), { once: true })
        }),
      )
    }
    for (const g of outerGuards) g.catch(() => {})

    const work = (async () => {
      const pg = await acquirePoolPage(signal)
      // Inner guards: the WORK budget starts now (page in hand).
      let workTimer = null
      const innerGuards = [
        new Promise((_, reject) => {
          workTimer = setTimeout(() => reject(new Error('Page operation timed out')), PAGE_MUTEX_TIMEOUT)
        }),
      ]
      if (signal) {
        innerGuards.push(
          new Promise((_, reject) => {
            signal.addEventListener('abort', () =>
              reject(new Error('cf-harvester aborted (caller timed out)')), { once: true })
          }),
        )
      }
      for (const g of innerGuards) g.catch(() => {})

      let broken = false
      try {
        return await Promise.race([fn(pg), ...innerGuards])
      } catch (e) {
        // A page whose context/frame died is poisoned — recycle it instead
        // of handing a broken page to the next extraction.
        if (isBrokenPageErr(e)) broken = true
        throw e
      } finally {
        clearTimeout(workTimer)
        if (broken || pg.isClosed()) {
          pagePoolAll.delete(pg)
          try { await pg.close() } catch {}
          // A freed SLOT isn't a free PAGE — wake one waiter so it can create.
          const w = poolWaiters.shift()
          if (w) { try { w(true) } catch {} }
        } else {
          releasePoolPage(pg)
        }
      }
    })()

    const result = await Promise.race([work, ...outerGuards])
    // An outer guard won but the work may still be running in the background
    // holding its page; its own inner guards/abort checks end it shortly.
    work.catch(() => {})
    return result
  }

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(async () => {
      if (browser && Date.now() - lastUsed >= IDLE_TIMEOUT_MS) {
        console.log('[cf-harvester] Closing idle browser')
        ready = false
        teardownPool()
        try { await page?.close() } catch {}
        try { await browser.close() } catch {}
        browser = null; page = null
      }
    }, IDLE_TIMEOUT_MS)
  }

  async function ensureBrowser(useProxy = false) {
    return withLaunchMutex(async () => {
      const now = Date.now()
      const wantsProxy = useProxy ? getRandomGogoProxy() : null
      const proxyKey = wantsProxy ? `${wantsProxy.protocol}://${wantsProxy.host}:${wantsProxy.port}` : 'direct'

      if (ready && page && !page.isClosed()) {
        const currentKey = _currentProxy
          ? `${_currentProxy.protocol}://${_currentProxy.host}:${_currentProxy.port}`
          : 'direct'
        if (currentKey === proxyKey) { lastUsed = now; resetIdleTimer(); return page }
        // Proxy mode changed — close the browser so we relaunch with the right proxy.
        teardownPool()
        try { await browser.close() } catch {}
        browser = null; page = null; ready = false
      }
      if (initPromise) return initPromise

      initPromise = (async () => {
      try {
        if (browser) { try { await browser.close() } catch {} }
        console.log('[cf-harvester] Launching headless Chrome...')
        const chromePath = findChrome()
        if (chromePath) console.log(`[cf-harvester] Using Chrome: ${chromePath}`)
        _currentProxy = wantsProxy
        if (_currentProxy) {
          console.log(`[cf-harvester] Using gogoanime proxy: ${proxyKey}`)
        }
        const launchArgs = [
          '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
          '--disable-gpu','--disable-extensions','--mute-audio','--window-size=1280,720',
          // Anti-fingerprinting: hide headless Chrome from Cloudflare
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--no-first-run','--no-default-browser-check',
          '--password-store=basic','--use-mock-keychain',
        ]
        if (_currentProxy) {
          launchArgs.push(`--proxy-server=${_currentProxy.protocol}://${_currentProxy.host}:${_currentProxy.port}`)
        }
        browser = await puppeteer.launch({
          headless: 'new',
          args: launchArgs,
          executablePath: chromePath || undefined,
          ignoreDefaultArgs: ['--enable-automation'],  // removes the "Chrome is being controlled by automated test software" banner
        })
        page = await setupPage(await browser.newPage())

        if (!warmupDone) {
          console.log(`[cf-harvester] Warming up on ${ANIDAP_BASE}...`)
          await safeGoto(page, ANIDAP_BASE)
          await new Promise(r => setTimeout(r, 2000))
          warmupDone = true
        }
        ready = true; lastUsed = now; resetIdleTimer()
        console.log('[cf-harvester] Browser ready')
        return page
      } catch (e) {
        console.error('[cf-harvester] Browser init failed:', e.message)
        ready = false
        try { await browser?.close() } catch {}; browser = null; page = null
        teardownPool()
        throw e
      } finally { initPromise = null }
    })()
    return initPromise
  })
}

  async function _extractVideo(pg, timeoutMs = 30_000, signal) {
    const deadline = Date.now() + timeoutMs
    const probe = () => pg.evaluate(() => {
      // 1. Prefer actual network stream URLs captured by the Performance API.
      try {
        const resources = performance.getEntriesByType('resource')
        for (const r of resources) {
          if (r.initiatorType === 'img' || r.initiatorType === 'beacon' || r.initiatorType === 'css') continue
          const name = r.name || ''
          if (name.includes('.m3u8') || name.endsWith('.m3u8')) return name
          if (/\.(mp4|webm|mkv|mov)(\?|$)/i.test(name)) return name
        }
      } catch {}

      // 2. Fallback to direct DOM video source.
      const video = document.querySelector('video')
      if (video && video.src && !video.src.startsWith('blob:')) return video.src
      const source = document.querySelector('video source[src]')
      if (source) return source.getAttribute('src')
      return null
    })
    // Poll every 1s instead of waitForFunction so an aborted request stops
    // at the next checkpoint rather than blocking the shared page until the
    // full timeout elapses (which held the mutex for 30-125s before).
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('cf-harvester aborted (caller timed out)')
      let url = null
      try { url = await probe() } catch (e) {
        if (signal?.aborted) throw new Error('cf-harvester aborted (caller timed out)')
        console.warn('[cf-harvester] _extractVideo probe error:', e.message)
      }
      if (url) return url
      await new Promise(r => setTimeout(r, 1000))
    }
    return null
  }

  // ── Cookie helper for direct-HTTP fast path ──
  async function getChadCookies(pg) {
    try {
      const chad = await pg.cookies('https://chad.anidap.lol')
      if (chad && chad.length) return chad
      const base = await pg.cookies('https://anidap.lol')
      if (base && base.length) return base
    } catch (e) {
      console.warn('[cf-harvester] Failed to export cookies:', e.message)
    }
    return []
  }

  // ── Impl functions ──

  async function fetchChadApiImpl(apiUrl, watchReferer) {
    const watchUrl = watchReferer || ANIDAP_BASE
    return withPageMutexBounded(async (pg) => {
      // Anidap API calls always go direct (no gogo proxy).
      console.log(`[cf-harvester] Navigating to: ${watchUrl.slice(0, 100)}`)
      await safeGoto(pg, watchUrl)

      const pageStatus = await pg.evaluate(() => {
        const body = document.body?.textContent?.toLowerCase() || ''
        if (body.includes('anime not found') || (body.includes('not found') && body.length < 500)) return 'not_found'
        return 'ok'
      })
      if (pageStatus === 'not_found') throw new Error('Anime not available on anidap')

      console.log(`[cf-harvester] Fetching API: ${apiUrl.slice(0, 100)}`)
      await new Promise(r => setTimeout(r, 1500))

      const result = await pg.evaluate(async (url) => {
        try {
          const resp = await fetch(url, {
            headers: { 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9' },
            credentials: 'include',
          })
          const text = await resp.text()
          return { ok: resp.ok, status: resp.status, body: text }
        } catch (e) { return { ok: false, status: 0, body: e.message } }
      }, apiUrl)

      if (!result.ok) {
        console.warn(`[cf-harvester] API fetch failed: status=${result.status}`)
        const isSources = apiUrl.includes('/rest/api/sources')
        if (isSources) {
          console.log('[cf-harvester] API failed — trying DOM extraction')
          let streamUrl = await _extractVideo(pg, 8_000)
          if (!streamUrl) {
            // Some anidap providers (e.g. uwu) embed the player in an iframe.
            // Poll for it, then navigate into it and look for the video there.
            let iframeSrc = null
            for (let poll = 0; poll < 5 && !iframeSrc; poll++) {
              await new Promise(r => setTimeout(r, 1000))
              iframeSrc = await pg.evaluate(EXTRACT_IFRAME_JS)
            }
            if (iframeSrc) {
              console.log(`[cf-harvester] API fallback iframe -> ${trimUrl(iframeSrc)}`)
              await safeGoto(pg, iframeSrc)
              streamUrl = await _extractVideo(pg, 10_000)
            }
          }
          if (streamUrl) {
            console.log('[cf-harvester] ✓ Extracted video from DOM')
            return { sources: [{ url: streamUrl, quality: 'auto' }], tracks: [] }
          }
        }
        try {
          const errData = JSON.parse(result.body)
          if (errData?.error === 'too_many_requests') {
            // Notify the rate-limit tracker so the router can fall back
            (await import('../../anidap.js')).markProviderRateLimited((apiUrl.match(/providerId=([^&]+)/)||[])[1]||'unknown', 15)
            throw Object.assign(new Error('too_many_requests'), { upstream: 429 })
          }
        } catch (e) { if (e.upstream) throw e }
        throw new Error(`chad API returned ${result.status}: ${(result.body || '').slice(0, 100)}`)
      }

      try {
        const data = JSON.parse(result.body)
        console.log(`[cf-harvester] ✓ API response: ${Object.keys(data).join(', ')}`)
        return data
      } catch { throw new Error('Failed to parse chad API response') }
    })
  }

  async function extractStreamImpl(watchUrl, options = {}) {
    const isGogo = watchUrl.includes('gogoanime')
    // Hard cap for gogoanime: if Puppeteer hangs on navigation or video
    // polling, reject quickly so the router's Promise.race can fall back.
    // Gogoanime needs more time: safeGoto allows 15s per attempt (× up to
    // 3 retries for ERR_ABORTED), plus DUB tab wait (~2s), iframe polling
    // (~6s), and video extraction (~5s). 10s was mathematically impossible;
    // 28s gives enough budget while still fitting under the 35s route cap.
    const HARD_GOTO_TIMEOUT = isGogo ? 28_000 : PAGE_MUTEX_TIMEOUT
    // The mutex serializes all page work and the signal checks inside
    // _doExtractStream stop a timed-out extraction at its next checkpoint,
    // so no browser recycling is needed — that would only force a costly
    // relaunch (and detached-frame races) on the very next request.
    const signal = options.signal
    if (signal?.aborted) return Promise.reject(new Error('cf-harvester aborted (caller timed out)'))
    return withPageMutexBounded(async (pg) => {
      if (signal?.aborted) throw new Error('cf-harvester aborted (caller timed out)')
      return Promise.race([
        _doExtractStream(watchUrl, { ...options, poolPage: pg }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('DOM extraction hard timeout')), HARD_GOTO_TIMEOUT),
        ),
      ])
    }, signal)
  }

  async function fetchChadSourcesImpl(anilistId, slug, ep, provider, type) {
    return withPageMutexBounded(async (pg) => {
    const tStart = Date.now()

    let resolvedSlug = slug || slugCache.get(anilistId) || null
    if (resolvedSlug) {
      console.log(`[cf-harvester] Using pre-resolved slug: ${resolvedSlug}`)
    } else if (!resolvedSlug && anilistId) {
      const watchUrl = `${ANIDAP_BASE}/watch?id=${anilistId}&ep=${ep}&type=${type}&provider=${provider}`
      console.log(`[cf-harvester] Resolving slug for anilistId=${anilistId}: ${watchUrl.slice(0, 100)}`)
      await safeGoto(pg, watchUrl)

      // The slug is static SSR data (a React prop in the watch page HTML),
      // so it is available the moment the page loads — no need to wait for
      // the SPA to fire chad network requests (the old perf-entry poll cost
      // up to 8 s of the extraction budget). Try it immediately, then a few
      // 1 s retries in case the page is mid-render.
      try { resolvedSlug = await pg.evaluate(EXTRACT_SLUG_JS) } catch {}
      for (let poll = 0; poll < 5 && !resolvedSlug; poll++) {
        await new Promise(r => setTimeout(r, 1000))
        try { resolvedSlug = await pg.evaluate(EXTRACT_SLUG_JS) } catch {}
      }

      if (resolvedSlug) {
        slugCache.set(anilistId, resolvedSlug)
        console.log(`[cf-harvester] Resolved slug: ${resolvedSlug} (${Date.now() - tStart}ms)`)
      }
    }

    // Final fallback: build a slug from the AniList title. This is less
    // reliable than the real anidap slug but lets the request proceed
    // when the watch page never exposes one.
    if (!resolvedSlug) {
      resolvedSlug = await resolveSlugFromAniList(anilistId)
    }

    if (!resolvedSlug) {
      throw new Error('Could not resolve anidap slug for chad API')
    }

    const tApiStart = Date.now()
    const sourcesUrl = `https://chad.anidap.lol/rest/api/sources?id=${encodeURIComponent(resolvedSlug)}&epNum=${ep}&type=${type}&providerId=${provider}`
    console.log(`[cf-harvester] Fetching chad sources: ${sourcesUrl.slice(0, 120)}`)
    // No artificial settle delay: the page is already on anidap.lol
    // (either from warmup or from slug resolution above), so cookies
    // are present. Execute the chad API fetch immediately.

    // Fast path: try a direct Node.js HTTP request using the browser's
    // cookies. This avoids the executeJavaScript round-trip and is
    // typically 50-200 ms vs 1-3 s for the in-browser fetch.
    try {
      const cookies = await getChadCookies(pg)
      const cookieHeader = formatCookieHeader(cookies)
      console.log(`[cf-harvester] Trying direct HTTP chad fetch (${cookies.length} cookies)`)
      const directResult = await directFetchChadSources(sourcesUrl, cookieHeader)
      if (directResult.ok) {
        const data = JSON.parse(directResult.body)
        const sourcesCount = Array.isArray(data?.sources) ? data.sources.length : 'N/A'
        console.log(`[cf-harvester] ✓ Direct chad sources response keys: ${Object.keys(data || {}).join(', ')} count=${sourcesCount} total=${Date.now() - tStart}ms`)
        return data
      }
      console.log(`[cf-harvester] Direct HTTP chad fetch failed: status=${directResult.status} body=${(directResult.body || '').slice(0, 120)}`)
      if (directResult.status === 429) {
        const providerName = provider || 'unknown'
        const { markProviderRateLimited } = await import('../../anidap.js')
        markProviderRateLimited(providerName, 15)
        throw Object.assign(new Error('too_many_requests'), { upstream: 429 })
      }
      // Non-2xx without a 429 — fall through to in-browser fetch in case
      // the endpoint requires headers/cookies only the browser can supply.
    } catch (e) {
      if (e.upstream === 429) throw e
      console.warn(`[cf-harvester] Direct HTTP chad fetch error: ${e.message} — falling back to in-browser fetch`)
    }

    const result = await pg.evaluate(async (url) => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10_000)
      try {
        const resp = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'Referer': 'https://anidap.lol/',
            'Origin': 'https://anidap.lol',
          },
          credentials: 'include',
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        const text = await resp.text()
        return { ok: resp.ok, status: resp.status, body: text }
      } catch (e) {
        clearTimeout(timeoutId)
        return { ok: false, status: 0, body: e.message || 'aborted' }
      }
    }, sourcesUrl)

    if (!result.ok && result.body?.includes('aborted')) {
      console.warn(`[cf-harvester] chad sources fetch aborted after 10s timeout`)
    }
    console.log(`[cf-harvester] Chad API response: status=${result.status} time=${Date.now() - tApiStart}ms`)

    if (!result.ok) {
      console.warn(`[cf-harvester] chad sources API failed: status=${result.status}`)
      if (result.status === 429) {
        const { markProviderRateLimited } = await import('../../anidap.js')
        markProviderRateLimited(provider, 15)
        throw Object.assign(new Error('too_many_requests'), { upstream: 429 })
      }
      throw new Error(`chad sources API returned ${result.status}: ${(result.body || '').slice(0, 100)}`)
    }
    const data = JSON.parse(result.body)
      const sourcesCount = Array.isArray(data?.sources) ? data.sources.length : 'N/A'
      console.log(`[cf-harvester] ✓ chad sources response keys: ${Object.keys(data || {}).join(', ')} count=${sourcesCount} total=${Date.now() - tStart}ms`)
      return data
    })
  }

  async function _doExtractStream(watchUrl, options = {}) {
    const totalBudgetMs = options.maxDurationMs ?? 30_000
    const remainingBudget = makeRemainingBudget(Date.now(), totalBudgetMs)
    const isGogo = watchUrl.includes('gogoanime')

    // Gogoanime is aggressively Cloudflare-protected. In standalone
    // Puppeteer mode, the headless browser is detected ~90% of the time
    // even with the stealth plugin, causing the player JavaScript to
    // never execute. Rather than wasting 28s per request (which causes
    // black screens and timeout errors in the UI), fail immediately so
    // the router falls back to anidap providers immediately.
    // Electron mode uses a real hidden BrowserWindow and can bypass
    // Cloudflare, so it still attempts gogoanime extraction.
    if (isGogo && !IS_ELECTRON) {
      console.log('[cf-harvester] Standalone Puppeteer attempting gogoanime extraction...')
    }

    // ── Gogoanime retry loop with proxy rotation ─────────────────────
    // Cloudflare rate-limits aggressively. Each attempt launches the
    // browser with a fresh proxy so consecutive failures don't reuse the
    // same blocked IP. Dead proxies are temporarily blacklisted.
    const GOGO_MAX_RETRIES = 2
    for (let attempt = 0; attempt <= GOGO_MAX_RETRIES; attempt++) {
      try {
        if (options.signal?.aborted) throw new Error('cf-harvester aborted (caller timed out)')
        return await __doExtract(watchUrl, options)
      } catch (err) {
    const isRotateError = err?.message?.includes('ERR_ABORTED') ||
      err?.message?.includes('ERR_PROXY_CONNECTION_FAILED') ||
      err?.message?.includes('Cloudflare challenge') ||
      err?.message?.includes('too_many_requests') ||
      err?.message?.includes('rate limit')
        if (!isGogo || attempt === GOGO_MAX_RETRIES || !isRotateError) throw err

    console.warn(`[cf-harvester] Gogoanime attempt ${attempt + 1} failed with ${err.message}, rotating proxy...`)
    if (_currentProxy) markProxyDead(_currentProxy)
    // Force the next ensureBrowser call to relaunch with a new proxy.
    try { await browser?.close() } catch {}
    ready = false; page = null; browser = null; initPromise = null; _currentProxy = null
    teardownPool()
        // Small backoff before retry
        await new Promise(r => setTimeout(r, 1000))
      }
    }


  }

  async function __doExtract(watchUrl, options = {}) {
    const totalBudgetMs = options.maxDurationMs ?? 30_000
    const remainingBudget = makeRemainingBudget(Date.now(), totalBudgetMs)
    const isGogo = watchUrl.includes('gogoanime')
    // Gogoanime rides the rotating residential proxy pool; anidap always
    // goes direct. The retry loop in _doExtractStream closes the browser
    // between attempts, so each relaunch here picks a FRESH random proxy
    // (previously we passed `false` unconditionally, which meant every
    // retry reused the same direct IP — the rotation was a no-op).
    // Anidap runs on a checked-out POOL page (root fix: concurrent
    // extractions); gogo keeps the single-page proxy-rotation path.
    const pg = options.poolPage && !isGogo ? options.poolPage : await ensureBrowser(isGogo)
    if (options.signal?.aborted) throw new Error('cf-harvester aborted (caller timed out)')
    console.log(`[cf-harvester] DOM extraction: ${watchUrl.slice(0, 100)}`)
    await safeGoto(pg, watchUrl)

    // ── Fail fast on Cloudflare challenge pages ──
    const cfCheck = await pg.evaluate(() => ({
      title: document.title || '',
      body: document.body?.textContent?.slice(0, 500) || '',
    }))
    if (isCloudflareChallenge(cfCheck.body, cfCheck.title)) {
      console.warn(`[cf-harvester] Cloudflare challenge detected on ${trimUrl(watchUrl)} — recycling session`)
      ready = false
      teardownPool()
      try { await page?.close() } catch {}
      try { await browser.close() } catch {}
      browser = null; page = null; warmupDone = false; initPromise = null
      throw new Error('Cloudflare challenge blocked extraction')
    }

    // ── Select gogoanime server (sub/dub) ──
    // gogoanime.by only loads the player after a server in #w-servers
    // is clicked. Click the first matching server, then give the page
    // time to render the player/iframe.
    if (isGogo) {
      try {
        const serverType = options.preferDub ? 'dub' : 'sub'
        const clicked = await pg.evaluate(`${CLICK_FIRST_SERVER_JS}('${serverType}')`)
        console.log(`[cf-harvester] gogoanime server click (${serverType}): ${clicked ? 'clicked ✓' : 'not found'}`)
        if (clicked) await new Promise(r => setTimeout(r, 3_000))
      } catch (e) { console.warn('[cf-harvester] gogoanime server click failed:', e.message) }
    }

    // ── Click DUB tab if requested (legacy fallback) ──
    // Gogoanime uses a single page for both sub and dub; the dub players
    // are hidden behind a tab/button that must be clicked to reveal them.
    const isDubUrl = /\b(dub|dubbed|dub-)\b/i.test(watchUrl)
    if (isGogo && options.preferDub && !isDubUrl) {
      try {
        const clicked = await pg.evaluate(CLICK_DUB_TAB_JS)
        console.log(`[cf-harvester] DUB tab click: ${clicked ? 'clicked ✓' : 'not found'}`)
        if (clicked) await new Promise(r => setTimeout(r, 2_000)) // wait for dub player to load
      } catch (e) { console.warn('[cf-harvester] DUB tab click failed:', e.message) }
    } else if (isGogo && options.preferDub && isDubUrl) {
      console.log('[cf-harvester] Already on dub URL — skipping tab click')
    }

    const pageStatus = await pg.evaluate(() => {
      const body = document.body?.textContent?.toLowerCase() || ''
      if (body.includes('anime not found') || (body.includes('not found') && body.length < 500)) return 'not_found'
      return 'ok'
    })
    if (pageStatus === 'not_found') throw new Error('Anime not available')

    // ── Unified direct-video / no-stream poll (non-gogo only) ──
    // Anidap embeds video directly — no iframes. Every 1s probe checks for
    // a stream AND the SPA's no-stream error state: working providers win
    // as soon as the video appears, dead providers fail in ~3-4s (after a
    // 2s render grace) instead of wasting the full video timeout.
    let streamUrl = null

    if (!isGogo) {
      console.log('[cf-harvester] Non-gogo URL — polling for direct video / no-stream state')
      const fastTimeout = Math.min(8_000, remainingBudget())
      const pollStart = Date.now()
      const deadline = pollStart + fastTimeout
      while (Date.now() < deadline) {
        if (options.signal?.aborted) throw new Error('cf-harvester aborted (caller timed out)')
        let probe = null
        try {
          probe = await pg.evaluate((pollStartMs) => {
          // 1. Stream via Performance API.
          try {
            const resources = performance.getEntriesByType('resource')
            for (const r of resources) {
              if (r.initiatorType === 'img' || r.initiatorType === 'beacon' || r.initiatorType === 'css') continue
              const name = r.name || ''
              if (name.includes('.m3u8') || name.endsWith('.m3u8')) return { kind: 'stream', value: name }
              if (/\.(mp4|webm|mkv|mov)(\?|$)/i.test(name)) return { kind: 'stream', value: name }
            }
          } catch {}
          // 2. Direct video element.
          const video = document.querySelector('video')
          if (video && video.src && !video.src.startsWith('blob:')) return { kind: 'stream', value: video.src }
          const source = document.querySelector('video source[src]')
          if (source) return { kind: 'stream', value: source.getAttribute('src') }
          // 3. No-stream error state (only after a 2s render grace, scoped to
          // the player container so generic strings in the page shell can't
          // false-positive a working provider).
          // 3a. UPSTREAM-ERROR panel: when the provider simply doesn't have
          //     this title/type (kiwi/hsub everywhere), the SPA renders
          //     "HTTP error! status: 400 Try Again …" INSTEAD of a player —
          //     it lives OUTSIDE the [class*=player] container, so also
          //     check the page text. This is unambiguous: no provider page
          //     with a working stream ever shows it.
          const fullBody = (document.body?.textContent || '').toLowerCase()
          if (Date.now() - pollStartMs >= 2000 && fullBody.includes('http error!')) {
            return { kind: 'no-stream', value: 'upstream-http-error' }
          }
          if (Date.now() - pollStartMs >= 2000) {
            const player = document.querySelector('[class*="player" i], [id*="player" i], [class*="video" i]')
            if (player) {
              const body = (player.textContent || '').toLowerCase()
              const noStreamPatterns = [
                'source not found', 'stream not available', 'stream unavailable',
                'video unavailable', 'player error',
              ]
              for (const p of noStreamPatterns) if (body.includes(p)) return { kind: 'no-stream', value: p }
            }
          }
          return null
        }, pollStart)
        } catch (probeErr) {
          // SPA re-render / mid-navigation destroys the execution context —
          // this probe is simply lost, not a dead provider. Retry next tick.
          console.log(`[cf-harvester] probe retry (context lost): ${probeErr?.message?.slice(0, 60)}`)
          probe = null
        }
        if (probe) {
          if (probe.kind === 'stream') {
            console.log(`[cf-harvester] ✓ Direct video: ${probe.value.slice(0, 80)}`)
            return { sources: [{ url: probe.value, quality: 'auto' }], tracks: [] }
          }
          console.log(`[cf-harvester] Early no-stream detected ("${probe.value}") — failing fast`)
          throw new Error('Stream not available on this provider')
        }
        await new Promise(r => setTimeout(r, 1000))
      }
      console.log('[cf-harvester] Direct video not found — falling back to iframe walk')
    }

    // Walk nested iframes up to 2 levels deep (gogoanime uses 1-2 levels).
    // Check for iframes FIRST (gogoanime) then fall back to direct video.
    // Gogoanime gets tighter timeouts so the whole extraction fits inside
    // the 35s route cap even after navigation overhead.
    // Match Electron's extraction budget: gogoanime JS needs 5-8s to
    // decrypt data-encrypted-url attributes and create the player iframe.
    const MAX_DEPTH = 3
    // anidap's SPA hydrates slowly — the player iframe can take 5-15s to
    // render after the watch page loads (SSR shell first). Poll up to 6s at
    // depth 0 so we catch the player once it appears; the extraction budget
    // still bounds the total time (the loop bails when budget < 2s).
    const iframePollMax = isGogo ? 8 : 6
    console.log(`[cf-harvester] Starting extraction loop (isGogo=${isGogo}, maxDepth=${MAX_DEPTH}, iframePollMax=${iframePollMax})`)
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      // Fail fast if we have run out of extraction budget.
      if (remainingBudget() < 3_000) {
        console.log(`[cf-harvester] Extraction budget exhausted at depth ${depth}`)
        break
      }
      const videoTimeout = Math.min(10_000, remainingBudget())
      // Poll for iframes — gogoanime JS decrypts data-encrypted-url attributes
      // and may take longer than a single wait. Poll every 1s for snappier detection.
      const pollAttempts = depth === 0 ? iframePollMax : 3
      let iframeSrc = null
      for (let poll = 0; poll < pollAttempts && !iframeSrc; poll++) {
        if (options.signal?.aborted) throw new Error('cf-harvester aborted (caller timed out)')
        if (remainingBudget() < 2_000) {
          console.log(`[cf-harvester] Budget too low for iframe poll at depth ${depth}`)
          break
        }
        await new Promise(r => setTimeout(r, 1000))
        iframeSrc = await pg.evaluate(EXTRACT_IFRAME_JS)
      }

      if (iframeSrc) {
        console.log(`[cf-harvester] Depth ${depth} iframe -> ${trimUrl(iframeSrc)}`)
        await safeGoto(pg, iframeSrc)
        streamUrl = await _extractVideo(pg, videoTimeout, options.signal)
        if (streamUrl) break
        continue
      }

      // No iframe — try direct video
      streamUrl = await _extractVideo(pg, videoTimeout)
      if (streamUrl) break

      // At depth 0: check whether the anidap SPA rendered an error state.
      // Live case: unlisted provider+type combos render an "HTTP error!
      // status: 400 Try Again … If current server doesn't work try other
      // servers beside" panel INSTEAD of a player — the SPA shell itself
      // says the provider has nothing. The old pattern list only looked for
      // "source not found / stream not available"-style strings and never
      // matched, so kiwi/hsub burned the full 16-20s budget on every cold
      // request before failing.
      //
      // Two checks:
      //   1. EARLY (before the iframe walk): the body is the FULL page text,
      //      because the error panel renders OUTSIDE the [class*=player]
      //      container the later scoped check reads. "http error!" is an
      //      unambiguous upstream-error render — fail fast immediately and
      //      the route fails in <2s instead of eating the mutex for 18s.
      //   2. AFTER the walk (scoped check below) as before.
      if (depth === 0 && !isGogo) {
        try {
          const earlyBody = await pg.evaluate(() => (document.body?.textContent || '').toLowerCase())
          if (earlyBody.includes('http error!') || earlyBody.includes('try again') && earlyBody.includes('watching')) {
            console.log(`[cf-harvester] Provider error panel detected early ("${earlyBody.includes('http error!') ? 'upstream-http-error' : 'try-again-panel'}") — failing fast`)
            throw new Error('Stream not available on this provider')
          }
        } catch (e) {
          if (e.message === 'Stream not available on this provider') throw e
          // DOM check itself failed — continue the loop
        }
      }

      // At depth 0: retry once with page refresh for gogoanime only.
      // NOTE: disabled — the refresh retry often just wastes time and
      // pushes us over the 35s route cap. A single pass is enough.
      if (depth === 0 && false) {
        console.log(`[cf-harvester] Depth 0 failed — retrying with page refresh…`)
        await safeGoto(pg, watchUrl)
        // Poll for iframe on refreshed page
        iframeSrc = null
        for (let poll = 0; poll < 2 && !iframeSrc; poll++) {
          await new Promise(r => setTimeout(r, 1000))
          iframeSrc = await pg.evaluate(EXTRACT_IFRAME_JS)
        }
        if (iframeSrc) {
          console.log(`[cf-harvester] Depth 0 retry iframe -> ${trimUrl(iframeSrc)}`)
          await safeGoto(pg, iframeSrc)
          streamUrl = await _extractVideo(pg, videoTimeout, options.signal)
          if (streamUrl) break
          continue
        }
        streamUrl = await _extractVideo(pg, videoTimeout, options.signal)
        if (streamUrl) break
      }

      console.log(`[cf-harvester] No video or iframe at depth ${depth}`)
      // ── Fast-fail: check if the anidap SPA shows a "stream unavailable" state.
      // When the dub/sub simply doesn't exist on this provider, anidap.lol still
      // returns HTTP 200 (SPA shell), but the player area stays empty or shows
      // an error message. Detect this and fail fast instead of wasting 35s.
      if (depth === 0 && !isGogo) {
        try {
          const streamStatus = await pg.evaluate(() => {
            const body = (document.body?.textContent || '').toLowerCase()
            // Common "no stream" indicators in anidap's SPA player
            const noStreamPatterns = [
              'source not found', 'stream not available', 'no stream',
              'video unavailable', 'no source', 'stream unavailable',
              'no video', 'player error', 'failed to load',
            ]
            for (const p of noStreamPatterns) {
              if (body.includes(p)) return p
            }
            // Heuristic: the body is very short (< 300 chars) suggesting
            // the SPA rendered nothing useful
            if (body.length < 300) return 'empty-body:' + body.length
            return null
          })
          if (streamStatus) {
            console.log(`[cf-harvester] Stream unavailable detected: "${streamStatus}" — failing fast`)
            throw new Error('Stream not available on this provider')
          }
        } catch (e) {
          if (e.message === 'Stream not available on this provider') throw e
          // DOM check itself failed — continue the loop
        }
      }
      break
    }

    if (!streamUrl) {
      // Log body snippet to help refine the stream-unavailable pattern list
      if (!isGogo) {
        try {
          const bodySnippet = await pg.evaluate(() => (document.body?.textContent || '').slice(0, 200))
          console.log(`[cf-harvester] Final body snippet: ${JSON.stringify(bodySnippet)}`)
        } catch {}
      }
      // Recycle even on failure — Cloudflare may have flagged this session
      if (isGogo) {
        console.log(`[cf-harvester] Gogoanime extraction failed — recycling browser session`)
        ready = false
        teardownPool()
        try { await page?.close() } catch {}
        try { await browser.close() } catch {}
        browser = null; page = null; warmupDone = false; initPromise = null
      }
      throw new Error('No video element found after navigating up to 3 iframe levels')
    }

    // ── Browser recycling after gogoanime extraction ──
    // Cloudflare fingerprints the browser session; recycling forces a fresh
    // fingerprint for the next request, resetting any rate-limit counters.
    if (isGogo) {
      console.log(`[cf-harvester] Recycling browser session after gogoanime extraction…`)
      ready = false
      teardownPool()
      try { await page?.close() } catch {}
      try { await browser.close() } catch {}
      browser = null; page = null; warmupDone = false; initPromise = null
    }

    console.log(`[cf-harvester] ✓ Extracted video: ${streamUrl.slice(0, 80)}`)
    return { sources: [{ url: streamUrl, quality: 'auto' }], tracks: [] }
  }

  async function exportCookiesImpl(url, outPath) {
    const sharedPage = await ensureBrowser()
    const pg = await sharedPage.browser().newPage()
    const dest = outPath || '/tmp/ytdlp-cookies.txt'
    try {
      console.log(`[cf-harvester] Exporting cookies: ${url.slice(0, 80)}...`)
      await safeGoto(pg, url)
      await new Promise(r => setTimeout(r, 3000))
      const cookies = await pg.cookies()
      const lines = ['# Netscape HTTP Cookie File', '# Auto-generated by cf-harvester']
      for (const c of cookies) {
        const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`
        const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE'
        const path = c.path || '/'
        const secure = c.secure ? 'TRUE' : 'FALSE'
        const expiry = c.expires > 0 ? Math.floor(c.expires) : 9999999999
        lines.push([domain, flag, path, secure, String(expiry), c.name, c.value].join('\t'))
      }
      fs.writeFileSync(dest, lines.join('\n'), 'utf-8')
      console.log(`[cf-harvester] ✓ Exported ${cookies.length} cookies to ${dest}`)
      return dest
    } finally { try { await pg.close() } catch {} }
  }

  function isReadyImpl() { return ready && page && !page.isClosed() }

  async function warmUpImpl() {
    try { await ensureBrowser(); console.log('[cf-harvester] Pre-warmed browser') }
    catch (e) { console.warn('[cf-harvester] Pre-warm failed:', e.message) }
  }

  async function shutdownImpl() {
    console.log('[cf-harvester] Shutting down...')
    if (idleTimer) clearTimeout(idleTimer)
    ready = false
    teardownPool()
    try { await page?.close() } catch {}
    try { await browser.close() } catch {}
    browser = null; page = null
    console.log('[cf-harvester] Shutdown complete')
  }

  _puppeteerImpl = {
    fetchChadApi: fetchChadApiImpl,
    fetchChadSources: fetchChadSourcesImpl,
    extractStreamFromWatchPage: extractStreamImpl,
    exportCookies: exportCookiesImpl,
    isReady: isReadyImpl,
    warmUp: warmUpImpl,
    shutdown: shutdownImpl,
  }
  return _puppeteerImpl
}

// ═══════════════════════════════════════════════════════════════════

export { puppeteerInit }
