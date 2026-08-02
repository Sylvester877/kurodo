// server/lib/cf-harvester/index.js — Public API for the anidap browser bridge.

import { IS_ELECTRON } from './shared.js'
import { electronInit } from './electron.js'
import { puppeteerInit } from './puppeteer.js'

//  PUBLIC API — top-level exports, dispatches to active mode
// ═══════════════════════════════════════════════════════════════════

let activeImpl = null
let initPromise = null

async function getImpl() {
  if (activeImpl) return activeImpl
  if (!initPromise) {
    initPromise = (IS_ELECTRON ? electronInit() : puppeteerInit())
      .then(impl => { activeImpl = impl; return impl })
      .catch(e => { initPromise = null; throw e })
  }
  return initPromise
}

export async function fetchChadApi(apiUrl, watchReferer) {
  const impl = await getImpl()
  return impl.fetchChadApi(apiUrl, watchReferer)
}

export async function fetchChadSources(anilistId, slug, ep, provider, type) {
  const impl = await getImpl()
  return impl.fetchChadSources(anilistId, slug, ep, provider, type)
}

export async function extractStreamFromWatchPage(watchUrl, options = {}) {
  const impl = await getImpl()
  return impl.extractStreamFromWatchPage(watchUrl, options)
}

export async function exportCookies(url, outPath) {
  const impl = await getImpl()
  return impl.exportCookies(url, outPath)
}

export async function isReady() {
  try {
    const impl = await getImpl()
    return impl.isReady()
  } catch { return false }
}

export async function warmUp() {
  try {
    const impl = await getImpl()
    await impl.warmUp()
  } catch (e) {
    console.warn('[cf-harvester] warmUp failed:', e.message)
  }
}

export async function shutdown() {
  try {
    const impl = activeImpl ? await activeImpl : null
    activeImpl = null
    initPromise = null
    if (impl && impl.shutdown) await impl.shutdown()
  } catch {}
}

