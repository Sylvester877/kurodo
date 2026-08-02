// anidap provider — thin wrapper around server/anidap.js to match the
// unified ScraperProvider interface used by router.js.
//
// All the real logic lives in server/anidap.js (DOM extraction via
// Puppeteer/cf-harvester.js).

import {
  getInfoByAniListId,
  getEpisodes,
  getProviders,
  getStream,
} from '../anidap.js'

// Slug cache: anilistId → slug
const slugCache = new Map()
const SLUG_CACHE_TTL = 30 * 60 * 1000

async function resolveSlug(slug, anilistId) {
  if (slug && /-[a-z0-9]{4,6}$/i.test(slug)) return slug
  if (anilistId) {
    const cached = slugCache.get(anilistId)
    if (cached && Date.now() - cached.at < SLUG_CACHE_TTL) return cached.slug
    try {
      const info = await getInfoByAniListId(anilistId)
      if (info?.slug) {
        slugCache.set(anilistId, { at: Date.now(), slug: info.slug })
        return info.slug
      }
    } catch { /* fall through */ }
  }
  if (slug && /^\d+$/.test(slug)) {
    try {
      const info = await getInfoByAniListId(Number(slug))
      if (info?.slug) return info.slug
    } catch { /* fall through */ }
  }
  return slug
}

/** @type {import('./types.js').ScraperProvider} */
export const anidapProvider = {
  name: 'anidap',

  async getInfoByAniListId(anilistId) {
    return getInfoByAniListId(anilistId)
  },

  async getEpisodes(slug, anilistId, titles = {}) {
    const resolved = await resolveSlug(slug, anilistId)
    if (!resolved) return []
    return getEpisodes(resolved, anilistId, titles)
  },

  async getProviders(slug, ep, anilistId, titles = {}) {
    const resolved = await resolveSlug(slug, anilistId)
    if (!resolved) return []
    const list = await getProviders(resolved, ep, anilistId, titles)
    return list.map(p => ({ ...p, name: `anidap-${p.name}` }))
  },

  async getStream(slug, ep, providerName, type, anilistId, opts = {}) {
    if (!providerName || !providerName.startsWith('anidap-')) return null
    const resolved = await resolveSlug(slug, anilistId)
    if (!resolved) return null
    const realName = providerName.replace(/^anidap-/, '')
    return getStream(resolved, ep, realName, type, anilistId, opts)
  },
}
