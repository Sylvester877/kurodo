// Scraper diagnostic endpoint — used by the in-app /scraper/debug page.
// Probes each step of the production pipeline (anidap only as of Jun 2026)
// so we can see exactly which step fails when streams stop working.

import axios from 'axios'
import {
  routedGetInfo,
  routedGetEpisodes,
  routedGetProviders,
  routedGetStream,
} from './providers/router.js'

const ANIDAP = 'https://anidap.lol'

/**
 * Run a single probe and capture status + first chars of response.
 */
async function probe(label, fn) {
  const start = Date.now()
  try {
    const value = await fn()
    return { label, ok: true, ms: Date.now() - start, value }
  } catch (e) {
    const r = e?.response
    return {
      label, ok: false, ms: Date.now() - start,
      status: r?.status ?? null,
      code: e?.code ?? null,
      message: (e?.message || String(e)).slice(0, 240),
      body: typeof r?.data === 'string'
        ? r.data.slice(0, 240)
        : r?.data ? JSON.stringify(r.data).slice(0, 240) : null,
    }
  }
}

/**
 * Full pipeline probe. Each step goes through the router (anidap only).
 */
export async function runDiagnostics({ anilistId = 101922, episode = 1 } = {}) {
  const results = []

  // Step 0: Can we reach anidap.se?
  results.push(await probe('anidap.lol reachable', async () => {
    const r = await axios.get(`${ANIDAP}/`, {
      timeout: 6000,
      validateStatus: () => true,
      headers: { 'user-agent': 'Mozilla/5.0' },
    })
    return { status: r.status, contentType: r.headers['content-type'] }
  }))

  // Step 1: AniList ID → slug
  let slug = null
  results.push(await probe(`info: AniList ${anilistId} → slug`, async () => {
    const info = await routedGetInfo(anilistId)
    slug = info.slug
    return { slug: info.slug }
  }))

  // Step 2: Episodes
  results.push(await probe(`episodes: ${slug || String(anilistId)}`, async () => {
    const result = await routedGetEpisodes(anilistId, slug)
    const list = Array.isArray(result.episodes) ? result.episodes : []
    return {
      count: list.length,
      first: list[0]?.number ?? null,
    }
  }))

  // Step 3: Servers
  let providers = []
  results.push(await probe(`servers: ${slug || String(anilistId)} ep ${episode}`, async () => {
    const result = await routedGetProviders(anilistId, slug, episode)
    providers = result.providers
    return {
      count: providers.length,
      sample: providers.slice(0, 4).map((p) => `${p.name}/${p.type}`),
    }
  }))

  // Step 4: Stream
  if (providers.length > 0) {
    const p = providers[0]
    results.push(await probe(`stream: ${slug || String(anilistId)}/${p.name}/${p.type}`, async () => {
      const s = await routedGetStream(anilistId, slug, episode, p.name, p.type, {})
      return s
        ? { gotStream: true, host: new URL(s.url || s.raw).host }
        : { gotStream: false, note: 'No stream returned' }
    }))
  }

  return {
    at: new Date().toISOString(),
    test: { anilistId, episode },
    steps: results,
  }
}
