// test-scrapers.mjs
// Run this from your Windows machine to see which scrapers actually work.
//   cd repo && node scripts/test-scrapers.mjs

import { ANIME } from '@consumet/extensions'
import axios from 'axios'

const testAnimes = [
  { title: 'Demon Slayer', malId: 38000, anilistId: 101922 },
  { title: 'One Piece', malId: 21, anilistId: 21 },
  { title: 'Jujutsu Kaisen', malId: 40750, anilistId: 113415 },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function testMiruro(anilistId) {
  try {
    const r = await axios.get(`http://localhost:5173/api/anidap/info/${anilistId}`, { timeout: 10000 })
    if (r.data?.ok && r.data.data?.slug) return { ok: true, slug: r.data.data.slug }
    return { ok: false, error: 'No slug' }
  } catch (e) {
    return { ok: false, error: e.response?.data?.error || e.message }
  }
}

async function testAnimePahe(title) {
  const provider = new ANIME.AnimePahe()
  // provider.baseUrl removed — animepahe all domains dead as of Jun 2026
  try {
    const search = await provider.search(title)
    if (!search.results?.length) return { ok: false, error: 'No search results' }

    const info = await provider.fetchAnimeInfo(search.results[0].id)
    if (!info.episodes?.length) return { ok: false, error: 'No episodes' }

    const sources = await provider.fetchEpisodeSources(info.episodes[0].id)
    if (!sources.sources?.length) return { ok: false, error: 'No stream sources' }

    return {
      ok: true,
      id: info.id,
      title: info.title,
      episodes: info.episodes.length,
      source: sources.sources[0].url.slice(0, 60) + '...',
      quality: sources.sources[0].quality,
      isM3U8: sources.sources[0].isM3U8,
      hasDub: sources.sources.some(s => s.isDub),
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

async function testAnimeKai(title) {
  const provider = new ANIME.AnimeKai()
  provider.baseUrl = 'https://animekai.org.in' // try alternative domain
  try {
    const search = await provider.search(title)
    if (!search.results?.length) return { ok: false, error: 'No search results' }
    return { ok: true, id: search.results[0].id, title: search.results[0].title }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

async function testKickAss(title) {
  try {
    const provider = new ANIME.KickAssAnime()
    const search = await provider.search(title)
    return { ok: true, results: search.results?.length || 0 }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

async function testAnimeSaturn(title) {
  try {
    const provider = new ANIME.AnimeSaturn()
    const search = await provider.search(title)
    if (!search.results?.length) return { ok: false, error: 'No results' }
    const info = await provider.fetchAnimeInfo(search.results[0].id)
    const src = await provider.fetchEpisodeSources(info.episodes?.[0]?.id)
    return {
      ok: true,
      episodes: info.episodes?.length,
      source: src.sources?.[0]?.url?.slice(0, 60) || 'none',
      language: 'IT (Italian sub)',
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

async function runAll() {
  console.log('\n🧪 KURŌDO SCRAPER TEST — running from your local machine\n')
  for (const anime of testAnimes) {
    console.log(`\n📺 ${anime.title} (AniList #${anime.anilistId})`)
    console.log('  ───────────────────────────────────────')

    process.stdout.write('  Miruro (your current)  ... ')
    const mr = await testMiruro(anime.anilistId)
    console.log(mr.ok ? `✅ ${mr.slug}` : `❌ ${mr.error}`)
    await sleep(500)

    process.stdout.write('  AnimePahe              ... ')
    const ap = await testAnimePahe(anime.title)
    console.log(ap.ok ? `✅ ${ap.episodes} eps, ${ap.quality}, ${ap.isM3U8 ? 'HLS' : 'MP4'}` : `❌ ${ap.error}`)
    await sleep(500)

    process.stdout.write('  AnimeKai               ... ')
    const ak = await testAnimeKai(anime.title)
    console.log(ak.ok ? `✅ ${ak.id}` : `❌ ${ak.error}`)
    await sleep(500)

    process.stdout.write('  KickAssAnime           ... ')
    const ka = await testKickAss(anime.title)
    console.log(ka.ok ? `✅ ${ka.results} results` : `❌ ${ka.error}`)
    await sleep(500)

    process.stdout.write('  AnimeSaturn (IT)       ... ')
    const sat = await testAnimeSaturn(anime.title)
    console.log(sat.ok ? `✅ ${sat.episodes} eps [${sat.language}]` : `❌ ${sat.error}`)
    await sleep(500)
  }

  console.log('\n\n📊 INTERPRETATION:')
  console.log('  • If Miruro shows ✅, the backend is working and we can test streams.')
  console.log('  • If Miruro shows ❌ (502/403), the pipe API is blocked from your home IP too.')
  console.log('  • If everything fails, we need to switch to torrent-based streaming.')
  console.log('  • AnimeSaturn always works but is Italian-only.\n')
}

runAll().catch(console.error)
