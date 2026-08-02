// server/lib/cf-harvester/electron.js — Hidden BrowserWindow implementation.

import fs from 'node:fs'
import { ANIDAP_BASE, slugCache, isCloudflareChallenge, IS_ELECTRON, trimUrl, makeRemainingBudget, CLICK_DUB_TAB_JS, CLICK_FIRST_SERVER_JS, EXTRACT_IFRAME_JS, resolveSlugFromAniList, formatCookieHeader, directFetchChadSources } from './shared.js'
import { getRandomGogoProxy, markProxyDead } from '../../proxy-config.js'

//  ELECTRON MODE — internal implementation (hidden BrowserWindow)
// ═══════════════════════════════════════════════════════════════════

let _electronImpl = null  // lazily initialized

async function electronInit() {
  if (_electronImpl) return _electronImpl
  const { BrowserWindow } = await import('electron')
  console.log('[cf-harvester] Electron mode — using hidden BrowserWindow (no Cloudflare blocking)')

  // Two independent browser contexts: anidap and gogoanime.
  // Gogoanime pages are heavy with ads/Cloudflare and must not block
  // anidap extraction (or vice-versa). Each has its own mutex so the
  // two provider families can operate concurrently.
  const _contexts = {
    anidap:  { hiddenWin: null, ready: false, mutex: Promise.resolve(), currentProxy: null },
    gogoanime: { hiddenWin: null, ready: false, mutex: Promise.resolve(), currentProxy: null },
  }

  // Bounded mutex: if an operation hangs (e.g. loadURL stalls), don't
  // block the queue forever. Subsequent callers wait up to 20s for the
  // mutex; if it's still held, they reject so the router can fall back.
  const MUTEX_ACQUIRE_TIMEOUT = 20_000
  function withMutex(fn, context = 'anidap') {
    const ctx = _contexts[context] || _contexts.anidap
    const prev = ctx.mutex
    let release
    ctx.mutex = new Promise(r => { release = r })
    return prev.then(async () => {
      try { return await fn() }
      finally { release() }
    })
  }
  function withMutexBounded(fn, context = 'anidap') {
    // Gogoanime pages are much heavier (ads, redirects, iframe setup),
    // so give them a longer leash while keeping anidap tight.
    const timeout = context === 'gogoanime' ? 60_000 : MUTEX_ACQUIRE_TIMEOUT
    return Promise.race([
      withMutex(fn, context),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`cf-harvester mutex acquisition timeout (${context})`)), timeout),
      ),
    ])
  }

  // ── Safe executeJavaScript wrapper ──────────────────────────────
  // Checks if the BrowserWindow and its webContents are still valid
  // before executing JS. If the frame was detached (e.g. by a timeout
  // in safeLoadURL calling win.stop()), we throw a clean error instead
  // of crashing with "Attempted to use detached Frame".
  async function safeExecuteJS(win, jsCode, ...args) {
    if (!win || win.isDestroyed()) {
      throw new Error('BrowserWindow destroyed before executeJavaScript')
    }
    const wc = win.webContents
    if (!wc || wc.isDestroyed() || wc.isCrashed()) {
      throw new Error('WebContents destroyed or crashed before executeJavaScript')
    }
    // The actual executeJavaScript call may still throw "Attempted to use
    // detached Frame" if the frame was detached by a previous win.stop().
    // We catch that specific error and re-throw a clean message, and mark
    // the window as not ready so ensureWindow() recreates it next time.
    try {
      return await wc.executeJavaScript(jsCode, ...args)
    } catch (e) {
      if (e.message && (e.message.toLowerCase().includes('detached') || e.message.toLowerCase().includes('destroyed'))) {
        // A frame detachment means the calling context's window is unusable.
        // Mark all contexts as not-ready; the next ensureWindow will recreate
        // whichever one is needed.
        for (const ctx of Object.values(_contexts)) ctx.ready = false
        throw new Error('Frame detached during executeJavaScript (window will be recreated)')
      }
      throw e
    }
  }

  async function ensureWindow(useProxy = false, forceRotate = false, context = 'anidap') {
    const ctx = _contexts[context] || _contexts.anidap
    const wantsProxy = useProxy ? getRandomGogoProxy() : null
    const proxyKey = wantsProxy ? `${wantsProxy.protocol}://${wantsProxy.host}:${wantsProxy.port}` : 'direct'

    if (ctx.hiddenWin && !ctx.hiddenWin.isDestroyed() && ctx.ready) {
      const currentKey = ctx.currentProxy
        ? `${ctx.currentProxy.protocol}://${ctx.currentProxy.host}:${ctx.currentProxy.port}`
        : 'direct'
      if (currentKey === proxyKey && !forceRotate) return ctx.hiddenWin
      // Proxy mode changed or force-rotate requested — destroy so we recreate
      // with the right (or a fresh random) proxy.
      try { ctx.hiddenWin.destroy() } catch {}
      ctx.hiddenWin = null
      ctx.ready = false
    }

    if (ctx.hiddenWin && !ctx.hiddenWin.isDestroyed()) { try { ctx.hiddenWin.destroy() } catch {} }

    ctx.hiddenWin = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, autoplayPolicy: 'user-gesture-required' },
    })
    // Mute the hidden window to prevent any auto-playing audio from bleeding
    // into the user's session (ads, trailers, episode auto-play on anidap.se).
    ctx.hiddenWin.webContents.setAudioMuted(true)

    ctx.currentProxy = wantsProxy

    // Apply gogo proxy to this window's session if requested.
    if (ctx.currentProxy) {
      console.log(`[cf-harvester] Electron window (${context}) using proxy: ${proxyKey}`)
      await ctx.hiddenWin.webContents.session.setProxy({
        proxyRules: `${ctx.currentProxy.protocol}://${ctx.currentProxy.host}:${ctx.currentProxy.port}`,
      })
      if (ctx.currentProxy.auth) {
        // Capture the proxy used for this window so the handler isn't
        // affected by later currentProxy reassignments.
        const proxyForLogin = ctx.currentProxy
        ctx.hiddenWin.webContents.on('login', (event, details, authInfo, callback) => {
          event.preventDefault()
          callback(proxyForLogin.auth.username, proxyForLogin.auth.password)
        })
      }
    }

    const startUrl = context === 'gogoanime' ? 'https://gogoanime.by/' : ANIDAP_BASE
    console.log(`[cf-harvester] Hidden BrowserWindow created (${context}) — navigating…`)
    // The initial warmup load can hang (ads, heavy home page). Cap it so a
    // stuck page doesn't hold the gogoanime mutex forever.
    await Promise.race([
      ctx.hiddenWin.loadURL(startUrl, {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      }),
      new Promise((_, reject) =>
        setTimeout(() => {
          try { ctx.hiddenWin.stop() } catch {}
          reject(new Error(`ensureWindow warmup timeout (${context})`))
        }, 12_000),
      ),
    ])
    await new Promise(r => setTimeout(r, 3000))
    ctx.ready = true
    console.log(`[cf-harvester] Hidden BrowserWindow ready (${context})`)
    return ctx.hiddenWin
  }

  async function safeLoadURL(win, url, options = {}) {
    // Cap retries and per-attempt load time so a stalled navigation
    // cannot hold the shared mutex for 36s (old: 3 attempts × 12s).
    // Callers that need more time can still override these defaults.
    const { maxRetries = 1, loadTimeoutMs = 8_000, context = 'anidap' } = options
    const ctx = _contexts[context] || _contexts.anidap
    for (let i = 0; i <= maxRetries; i++) {
      try {
        // Electron's loadURL can hang indefinitely if a page asset stalls.
        // Race it against a caller-provided timeout (default 12s) so the
        // mutex isn't held longer than the extraction budget allows.
        let loadTimeoutId
        try {
          await Promise.race([
            win.loadURL(url, {
              userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
            }),
            new Promise((_, reject) => {
              loadTimeoutId = setTimeout(() => {
                try { win.stop() } catch {}
                // Mark the window as not ready so ensureWindow() recreates
                // it on the next call. win.stop() detaches the main frame,
                // and subsequent executeJavaScript calls would crash with
                // "Attempted to use detached Frame".
                ctx.ready = false
                reject(new Error(`loadURL timeout for ${trimUrl(url)}`))
              }, loadTimeoutMs)
            }),
          ])
        } finally {
          clearTimeout(loadTimeoutId)
        }
        return
      } catch (e) {
        if (i === maxRetries) throw e
        if (e.message?.includes('ERR_ABORTED') || e.message?.includes('timeout')) {
          console.warn(`[cf-harvester] ${e.message} on ${trimUrl(url)}, retry ${i + 1}/${maxRetries}…`)
          await new Promise(r => setTimeout(r, 1000))
        } else {
          throw e
        }
      }
    }
  }

  async function _extractVideo(win, timeoutMs = 25_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const url = await safeExecuteJS(win, `
        (() => {
          // 1. Sniff actual network requests for HLS playlists or MP4 fragments.
          //    Modern players (yuki, gojo, etc.) fetch an .m3u8 then feed it
          //    through Media Source Extensions, so the <video src> becomes a
          //    blob: URL. The real stream URL only appears in the resource list.
          try {
            const resources = performance.getEntriesByType('resource')
            for (const r of resources) {
              // Skip img/beacon/css to avoid false-positives on ad pixels
              if (r.initiatorType === 'img' || r.initiatorType === 'beacon' || r.initiatorType === 'css') continue
              const name = r.name || ''
              if (name.includes('.m3u8') || name.endsWith('.m3u8')) return name
              if (/\\.(mp4|webm|mkv|mov)(\\?|$)/i.test(name)) return name
            }
          } catch {}

          // 2. Fallback to direct DOM video source.
          const video = document.querySelector('video')
          if (video && video.src && !video.src.startsWith('blob:')) return video.src
          const source = document.querySelector('video source[src]')
          if (source) return source.getAttribute('src')
          return null
        })()
      `)
      if (url) return url
      await new Promise(r => setTimeout(r, 1000))
    }
    return null
  }

  // ── Cookie helper for direct-HTTP fast path ──
  async function getChadCookies(win) {
    try {
      const chad = await win.webContents.session.cookies.get({ url: 'https://chad.anidap.lol' })
      if (chad && chad.length) return chad
      const base = await win.webContents.session.cookies.get({ url: 'https://anidap.lol' })
      if (base && base.length) return base
    } catch (e) {
      console.warn('[cf-harvester] Failed to export cookies:', e.message)
    }
    return []
  }

  // ── Impl functions ──

  async function fetchChadApiImpl(apiUrl, watchReferer) {
    return withMutexBounded(async () => {
      // Anidap API calls always go direct (no gogo proxy).
      const win = await ensureWindow(false, false, 'anidap')
      const watchUrl = watchReferer || ANIDAP_BASE

      console.log(`[cf-harvester] Navigating to: ${watchUrl.slice(0, 100)}`)
      await safeLoadURL(win, watchUrl, { context: 'anidap' })

      const pageStatus = await safeExecuteJS(win, `
        (() => {
          const body = document.body?.textContent?.toLowerCase() || ''
          if (body.includes('anime not found')) return 'not_found'
          return 'ok'
        })()
      `)
      if (pageStatus === 'not_found') throw new Error('Anime not available on anidap')

      console.log(`[cf-harvester] Fetching API: ${apiUrl.slice(0, 100)}`)
      await new Promise(r => setTimeout(r, 1500))

      const resultJson = await safeExecuteJS(win, `
        (async () => {
          try {
            const resp = await fetch(${JSON.stringify(apiUrl)}, {
              headers: { 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9' },
              credentials: 'include',
            })
            const text = await resp.text()
            return JSON.stringify({ ok: resp.ok, status: resp.status, body: text })
          } catch (e) {
            return JSON.stringify({ ok: false, status: 0, body: e.message })
          }
        })()
      `)

      const result = JSON.parse(resultJson)
      if (!result.ok) {
        console.warn(`[cf-harvester] API fetch failed: status=${result.status}`)
        const isSources = apiUrl.includes('/rest/api/sources')
        if (isSources) {
          console.log('[cf-harvester] API failed — trying DOM extraction')
          let streamUrl = await _extractVideo(win, 8_000)
          if (!streamUrl) {
            // Some anidap providers (e.g. uwu) embed the player in an iframe.
            // Poll for it, then navigate into it and look for the video there.
            let iframeSrc = null
            for (let poll = 0; poll < 5 && !iframeSrc; poll++) {
              await new Promise(r => setTimeout(r, 1000))
              iframeSrc = await safeExecuteJS(win, EXTRACT_IFRAME_JS)
            }
            if (iframeSrc) {
              console.log(`[cf-harvester] API fallback iframe -> ${trimUrl(iframeSrc)}`)
              await safeLoadURL(win, iframeSrc, { context: 'anidap' })
              streamUrl = await _extractVideo(win, 10_000)
            }
          }
          if (streamUrl) {
            console.log('[cf-harvester] ✓ Extracted video from DOM after API failure')
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

      const data = JSON.parse(result.body)
      console.log(`[cf-harvester] ✓ API response: ${Object.keys(data).join(', ')}`)
      return data
    })
  }

  async function fetchChadSourcesImpl(anilistId, slug, ep, provider, type) {
    return withMutexBounded(async () => {
      // Hard ceiling for the whole chad-sources operation so a stuck
      // page load or a hung in-browser fetch cannot outlive the router's
      // per-try timeout (15s). Keeps the UI responsive.
      const operationDeadline = Date.now() + 20_000
      const timeLeft = () => Math.max(0, operationDeadline - Date.now())
      const context = 'anidap'

      const win = await ensureWindow(false, false, context)
      const tStart = Date.now()
      let resolvedSlug = slug || slugCache.get(anilistId) || null

      // We need a real text slug for the chad API. If the caller already
      // passed one (or we cached one), skip the expensive watch-page load
      // and 8 s slug poll entirely.
      if (resolvedSlug) {
        console.log(`[cf-harvester] Using pre-resolved slug: ${resolvedSlug}`)
      } else if (!resolvedSlug && anilistId) {
        const watchUrl = `${ANIDAP_BASE}/watch?id=${anilistId}&ep=${ep}&type=${type}&provider=${provider}`
        console.log(`[cf-harvester] Resolving slug for anilistId=${anilistId}: ${watchUrl.slice(0, 100)}`)
        // Tight page-load budget for slug resolution; if it can't load in
        // 6s the session is probably stuck and we should fail fast.
        await safeLoadURL(win, watchUrl, { loadTimeoutMs: Math.min(10_000, timeLeft()), context })

        // Poll performance entries for up to 4 s — the SPA usually fires the
        // chad API within 1-3 s. If it hasn't fired by then, the pathname
        // fallback below is authoritative and avoids wasting 10 s on every
        // cold slug resolution.
        for (let poll = 0; poll < 8 && !resolvedSlug; poll++) {
          await new Promise(r => setTimeout(r, 1000))
          resolvedSlug = await safeExecuteJS(win, `
            (() => {
              const resources = performance.getEntriesByType('resource')
              const anilistIdStr = ${JSON.stringify(String(anilistId))}
              for (const r of resources) {
                // Consider any chad API endpoint (episodes/servers fire before sources)
                if (r.name.includes('chad.anidap.lol/rest/api/')) {
                  const m = r.name.match(/[?&]id=([^&]+)/)
                  if (m) {
                    const val = decodeURIComponent(m[1])
                    // Ignore the SPA's initial failed request that uses the raw AniList ID.
                    // We need the actual text slug, not the numeric ID.
                    if (val !== anilistIdStr) return val
                  }
                }
              }
              return null
            })()
          `)
        }

        // Fallback: the SPA redirects /watch?id=... to /watch/<slug>?...
        // once the title resolves. The slug in the pathname is authoritative
        // and avoids mis-reading the AniList ID from an earlier chad call.
        if (!resolvedSlug) {
          resolvedSlug = await safeExecuteJS(win, `
            (() => {
              const parts = location.pathname.split('/')
              if (parts[1] === 'watch' && parts[2]) return decodeURIComponent(parts[2])
              return null
            })()
          `)
        }


        // Fallback 2: Check DOM data attributes and meta tags for slug.
        // Ignore values that are just the raw AniList ID — we need the text slug.
        if (!resolvedSlug) {
          resolvedSlug = await safeExecuteJS(win, `
            (() => {
              const anilistIdStr = ${JSON.stringify(String(anilistId))}
              const el = document.querySelector('[data-anime-id], [data-slug], [data-id]')
              if (el) {
                const val = el.getAttribute('data-anime-id') || el.getAttribute('data-slug') || el.getAttribute('data-id')
                if (val && val.length > 2 && val !== anilistIdStr) return val
              }
              const ogUrl = document.querySelector('meta[property="og:url"]')
              if (ogUrl) {
                const m = ogUrl.content.match(/\/watch\/([^?/]+)/)
                if (m) {
                  const val = decodeURIComponent(m[1])
                  if (val !== anilistIdStr) return val
                }
              }
              return null
            })()
          `)
        }

        // Fallback 3: Grep the static HTML for chad API URLs. The SPA's
        // initial SSR/inline data contains the slug even when the player
        // never fires a network request in headless mode.
        if (!resolvedSlug) {
          resolvedSlug = await safeExecuteJS(win, `
            (() => {
              const anilistIdStr = ${JSON.stringify(String(anilistId))}
              const html = document.documentElement.innerHTML
              const m = html.match(/chad\.anidap\.lol\/rest\/api\/(?:episodes|servers|sources)\?id=([^"&\s]+)/)
              if (m) {
                const val = decodeURIComponent(m[1])
                if (val !== anilistIdStr) return val
              }
              return null
            })()
          `)
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
        const cookies = await getChadCookies(win)
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

      // If we've already blown the hard deadline, don't even start the
      // chad API fetch — the router will handle it as a timeout.
      if (timeLeft() <= 0) {
        throw new Error('chad sources operation exceeded hard deadline')
      }

      const resultJson = await safeExecuteJS(win, `
        (async () => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 8_000)
          try {
            const resp = await fetch(${JSON.stringify(sourcesUrl)}, {
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
            return JSON.stringify({ ok: resp.ok, status: resp.status, body: text })
          } catch (e) {
            clearTimeout(timeoutId)
            return JSON.stringify({ ok: false, status: 0, body: e.message || 'aborted' })
          }
        })()
      `)

      const result = JSON.parse(resultJson)
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

  async function extractStreamImpl(watchUrl, options = {}) {
    const isGogo = watchUrl.includes('gogoanime')
    const context = isGogo ? 'gogoanime' : 'anidap'
    const ctx = _contexts[context]

    // ── Gogoanime retry loop with per-attempt proxy rotation ───────────
    // Cloudflare rate-limits heavily. Each attempt uses a fresh proxy and
    // a fresh hidden window so failures don't reuse a blocked IP.
    const GOGO_MAX_RETRIES = isGogo ? 2 : 0
    for (let attempt = 0; attempt <= GOGO_MAX_RETRIES; attempt++) {
      try {
        return await withMutexBounded(async () => {
          const win = await ensureWindow(isGogo, isGogo && attempt > 0, context)
          console.log(`[cf-harvester] DOM extraction: ${watchUrl.slice(0, 100)}`)
      const totalBudgetMs = options.maxDurationMs ?? 30_000
      const remainingBudget = makeRemainingBudget(Date.now(), totalBudgetMs)
      const loadTimeout = () => Math.min(12_000, Math.max(2_000, remainingBudget()))
      await safeLoadURL(win, watchUrl, { loadTimeoutMs: loadTimeout(), context })

      // ── Select gogoanime server (sub/dub) ──
      // gogoanime.by only loads the player after a server in #w-servers
      // is clicked. Click the first matching server, then give the page
      // time to render the player/iframe.
      if (isGogo) {
        try {
          const serverType = options.preferDub ? 'dub' : 'sub'
          const clicked = await safeExecuteJS(win, `${CLICK_FIRST_SERVER_JS}('${serverType}')`)
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
          const clicked = await safeExecuteJS(win, CLICK_DUB_TAB_JS)
          console.log(`[cf-harvester] DUB tab click: ${clicked ? 'clicked ✓' : 'not found'}`)
          if (clicked) await new Promise(r => setTimeout(r, 2_000)) // wait for dub player to load
        } catch (e) { console.warn('[cf-harvester] DUB tab click failed:', e.message) }
      } else if (isGogo && options.preferDub && isDubUrl) {
        console.log('[cf-harvester] Already on dub URL — skipping tab click')
      }

      const pageStatus = await safeExecuteJS(win, `
        (() => {
          const body = document.body?.textContent?.toLowerCase() || ''
          if (body.includes('anime not found')) return 'not_found'
          return 'ok'
        })()
      `)
      if (pageStatus === 'not_found') throw new Error('Anime not available')

      // ── Fast path for non-gogo URLs (anidap providers: yuki, gojo, etc.) ──
      // Anidap embeds video directly — no iframes. Polling for iframes first
      // wastes 10s on every request. Try direct video immediately.
      let streamUrl = null

      if (!isGogo) {
        console.log('[cf-harvester] Non-gogo URL — trying direct video first (skip iframe polling)')
        // Fast-path direct video: most anidap providers expose a <video>
        // tag within 3-5 s. Cap at 8 s so we still have budget for the
        // iframe walk if this fails.
        const fastTimeout = Math.min(8_000, remainingBudget())
        streamUrl = await _extractVideo(win, fastTimeout)
        if (streamUrl) {
          console.log(`[cf-harvester] ✓ Direct video: ${streamUrl.slice(0, 80)}`)
          return { sources: [{ url: streamUrl, quality: 'auto' }], tracks: [] }
        }
        console.log('[cf-harvester] Direct video not found — falling back to iframe walk')
      }

      // Walk nested iframes up to 3 levels deep (gogoanime uses 2 levels).
      // Check for iframes FIRST (gogoanime) then fall back to direct video.
      const MAX_DEPTH = 3
      for (let depth = 0; depth < MAX_DEPTH; depth++) {
        // Fail fast if we have run out of extraction budget.
        if (remainingBudget() < 3_000) {
          console.log(`[cf-harvester] Extraction budget exhausted at depth ${depth}`)
          break
        }

        // Poll for iframes — gogoanime JS decrypts data-encrypted-url attributes
        // and may take longer than a single wait. Poll every 1s for snappier detection.
        const pollAttempts = depth === 0 ? 8 : 3   // 8s vs 3s max wait (1s interval)
        let iframeSrc = null
        for (let poll = 0; poll < pollAttempts && !iframeSrc; poll++) {
          if (remainingBudget() < 2_000) {
            console.log(`[cf-harvester] Budget too low for iframe poll at depth ${depth}`)
            break
          }
          await new Promise(r => setTimeout(r, 1000))
          iframeSrc = await safeExecuteJS(win, EXTRACT_IFRAME_JS)
        }

        if (iframeSrc) {            console.log(`[cf-harvester] Depth ${depth} iframe -> ${trimUrl(iframeSrc)}`)
          await safeLoadURL(win, iframeSrc, { loadTimeoutMs: loadTimeout(), context })
          streamUrl = await _extractVideo(win, Math.min(10_000, remainingBudget()))
          if (streamUrl) break
          continue
        }

      // No iframe — try direct video
      streamUrl = await _extractVideo(win, Math.min(10_000, remainingBudget()))
      if (streamUrl) break

      // At depth 0: retry once with page refresh for gogoanime only.
      // Non-gogo URLs skip this — if direct extraction failed, refreshing won't help.
      if (depth === 0 && isGogo) {
        console.log(`[cf-harvester] Depth 0 failed — retrying with page refresh…`)
        await safeLoadURL(win, watchUrl, { loadTimeoutMs: loadTimeout(), context })
          // Poll for iframe on refreshed page
          iframeSrc = null
          for (let poll = 0; poll < 3 && !iframeSrc; poll++) {
            await new Promise(r => setTimeout(r, 1000))
            iframeSrc = await safeExecuteJS(win, EXTRACT_IFRAME_JS)
          }
          if (iframeSrc) {
            console.log(`[cf-harvester] Depth 0 retry iframe -> ${trimUrl(iframeSrc)}`)
            await safeLoadURL(win, iframeSrc, { loadTimeoutMs: loadTimeout(), context })
            streamUrl = await _extractVideo(win, 15_000)
            if (streamUrl) break
            continue
          }
          streamUrl = await _extractVideo(win, 15_000)
          if (streamUrl) break
        }

        console.log(`[cf-harvester] No video or iframe at depth ${depth}`)
        // ── Fast-fail: check if the anidap SPA shows a "stream unavailable" state.
        if (depth === 0 && !isGogo) {
          try {
            const streamStatus = await safeExecuteJS(win, `(() => {
              const body = (document.body?.textContent || '').toLowerCase()
              const noStreamPatterns = [
                'source not found', 'stream not available', 'no stream',
                'video unavailable', 'no source', 'stream unavailable',
                'no video', 'player error', 'failed to load',
              ]
              for (const p of noStreamPatterns) if (body.includes(p)) return p
              if (body.length < 300) return 'empty-body:' + body.length
              return null
            })()`)
            if (streamStatus) {
              console.log(`[cf-harvester] Stream unavailable detected: "${streamStatus}" — failing fast`)
              throw new Error('Stream not available on this provider')
            }
          } catch (e) {
            if (e.message === 'Stream not available on this provider') throw e
          }
        }
        break
      }

      if (!streamUrl) {
        // Log body snippet to help refine the stream-unavailable pattern list
        if (!isGogo) {
          try {
            const bodySnippet = await safeExecuteJS(win, `(() => (document.body?.textContent || '').slice(0, 200))()`)
            console.log(`[cf-harvester] Final body snippet: ${JSON.stringify(bodySnippet)}`)
          } catch {}
        }
        throw new Error('No video element found after navigating up to 3 iframe levels')
      }

      console.log(`[cf-harvester] ✓ Extracted video: ${streamUrl.slice(0, 80)}`)
      return { sources: [{ url: streamUrl, quality: 'auto' }], tracks: [] }
    }, context)
  } catch (err) {
    const isRotateError = err?.message?.includes('ERR_ABORTED') ||
      err?.message?.includes('ERR_PROXY_CONNECTION_FAILED') ||
      err?.message?.includes('Cloudflare challenge') ||
      err?.message?.includes('too_many_requests') ||
      err?.message?.includes('rate limit')
    if (!isGogo || attempt === GOGO_MAX_RETRIES || !isRotateError) throw err

    console.warn(`[cf-harvester] Gogoanime attempt ${attempt + 1} failed with ${err.message}, rotating proxy...`)
    if (ctx.currentProxy) markProxyDead(ctx.currentProxy)
    try { ctx.hiddenWin?.destroy() } catch {}
    ctx.ready = false
    ctx.hiddenWin = null
    ctx.currentProxy = null
    await new Promise(r => setTimeout(r, 1000))
  }
 }
}

  async function exportCookiesImpl(url, outPath) {
    return withMutexBounded(async () => {
      const win = await ensureWindow(false, false, 'anidap')
      const dest = outPath || '/tmp/ytdlp-cookies.txt'
      console.log(`[cf-harvester] Exporting cookies for ${url.slice(0, 80)}...`)

      // Navigate and wait for Cloudflare
      await safeLoadURL(win, url, { context: 'anidap' })
      await new Promise(r => setTimeout(r, 3000))

      const cookies = await win.webContents.session.cookies.get({})
      const lines = ['# Netscape HTTP Cookie File', '# Auto-generated by cf-harvester']
      for (const c of cookies) {
        const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`
        const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE'
        const path = c.path || '/'
        const secure = c.secure ? 'TRUE' : 'FALSE'
        const expiry = c.expirationDate > 0 ? Math.floor(c.expirationDate) : 9999999999
        lines.push([domain, flag, path, secure, String(expiry), c.name, c.value].join('\t'))
      }

      fs.writeFileSync(dest, lines.join('\n'), 'utf-8')
      console.log(`[cf-harvester] ✓ Exported ${cookies.length} cookies to ${dest}`)
      return dest
    })
  }

  function isReadyImpl() {
    return Object.values(_contexts).some(ctx => ctx.ready && ctx.hiddenWin && !ctx.hiddenWin.isDestroyed())
  }

  async function warmUpImpl() {
    try {
      await ensureWindow(false, false, 'anidap')
      console.log('[cf-harvester] Pre-warmed hidden BrowserWindow')
    } catch (e) { console.warn('[cf-harvester] Pre-warm failed:', e.message) }
  }

  async function shutdownImpl() {
    console.log('[cf-harvester] Shutting down...')
    for (const ctx of Object.values(_contexts)) {
      ctx.ready = false
      try { ctx.hiddenWin?.destroy() } catch {}
      ctx.hiddenWin = null
    }
    console.log('[cf-harvester] Shutdown complete')
  }

  _electronImpl = {
    fetchChadApi: fetchChadApiImpl,
    fetchChadSources: fetchChadSourcesImpl,
    extractStreamFromWatchPage: extractStreamImpl,
    exportCookies: exportCookiesImpl,
    isReady: isReadyImpl,
    warmUp: warmUpImpl,
    shutdown: shutdownImpl,
  }

  return _electronImpl
}

// ═══════════════════════════════════════════════════════════════════

export { electronInit }
