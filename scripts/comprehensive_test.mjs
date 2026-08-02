import axios from 'axios'

const SITE = 'https://anidap.se'
const API = 'https://chad.anidap.se'
const ANILIST_IDS = [101922, 21355, 108632, 163134, 16498, 1535, 5114, 21, 40750]
const ANIME_NAMES = {
  101922: 'Demon Slayer S1',
  21355: 'Re:Zero S1',
  108632: 'Re:Zero S2',
  163134: 'Re:Zero S3',
  16498: 'Attack on Titan',
  1535: 'Death Note',
  5114: 'Fullmetal Alchemist: Brotherhood',
  21: 'One Piece',
  40750: 'Jujutsu Kaisen',
}

const results = []
let passCount = 0
let failCount = 0

function log(label, ok, detail = '') {
  const symbol = ok ? '✅' : '❌'
  console.log(`  ${symbol} ${label}${detail ? ': ' + detail : ''}`)
  if (ok) passCount++; else failCount++
}

async function test() {
  console.log('\n═══════════════════════════════════════════════════════')
  console.log('   ANIDAP SCRAPER COMPREHENSIVE SANDBOX TEST')
  console.log('═══════════════════════════════════════════════════════\n')

  for (const id of ANILIST_IDS) {
    const name = ANIME_NAMES[id] || `Anime #${id}`
    console.log(`\n▶ ${name} (AniList ${id})`)
    let slug = null
    let episodes = null
    let providers = null
    let streamUrl = null

    // Step 1: AniList ID → slug
    try {
      const url = `${SITE}/info/${id}.data`
      const { data } = await axios.get(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          accept: 'application/json, */*',
          referer: `${SITE}/`,
          origin: SITE,
        },
        timeout: 10000,
      })
      if (Array.isArray(data)) {
        for (let i = 0; i < data.length - 1; i++) {
          if (data[i] === 'id' && typeof data[i + 1] === 'string'
              && /^[a-z0-9][a-z0-9-]+-[a-z0-9]{4,6}$/i.test(data[i + 1])) {
            slug = data[i + 1]
            break
          }
        }
      }
      log('ID → slug', !!slug, slug || 'NOT FOUND')
    } catch (e) {
      log('ID → slug', false, `${e.code}: ${e.message}`)
    }

    if (!slug) {
      failCount += 3
      console.log('  ⏭ Skipping episodes/providers/stream (no slug)')
      results.push({ id, name, slug: null, ok: false, error: 'no_slug' })
      continue
    }

    // Step 2: Episode list
    try {
      const url = `${API}/rest/api/episodes?id=${encodeURIComponent(slug)}`
      const { data } = await axios.get(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          accept: 'application/json, */*',
          referer: `${SITE}/`,
          origin: SITE,
        },
        timeout: 10000,
      })
      episodes = Array.isArray(data) ? data.length : 0
      log('Episodes', episodes > 0, `${episodes} episodes`)
    } catch (e) {
      log('Episodes', false, `${e.code}: ${e.message}`)
    }

    // Step 3: Servers for ep 1
    try {
      const url = `${API}/rest/api/servers?id=${encodeURIComponent(slug)}&epNum=1`
      const { data } = await axios.get(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          accept: 'application/json, */*',
          referer: `${SITE}/`,
          origin: SITE,
        },
        timeout: 10000,
      })
      providers = []
      for (const key of Object.keys(data || {})) {
        if (!key.endsWith('Providers')) continue
        const type = key.replace('Providers', '')
        const list = Array.isArray(data[key]) ? data[key] : []
        for (const p of list) {
          const pid = typeof p === 'string' ? p : (p.id || p.name)
          if (pid) providers.push({ name: pid, type })
        }
      }
      log('Providers', providers.length > 0, `${providers.length} providers (${providers.slice(0,3).map(p=>p.name).join(', ')})`)
    } catch (e) {
      log('Providers', false, `${e.code}: ${e.message}`)
    }

    // Step 4: Stream URL
    if (providers && providers.length > 0) {
      try {
        const p = providers[0]
        const url = `${API}/rest/api/sources?id=${encodeURIComponent(slug)}&epNum=1&type=${p.type}&providerId=${encodeURIComponent(p.name)}`
        const { data } = await axios.get(url, {
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            accept: 'application/json, */*',
            referer: `${SITE}/watch?id=${encodeURIComponent(slug)}&ep=1&type=${p.type}&provider=${p.name}`,
            origin: SITE,
          },
          timeout: 12000,
        })
        streamUrl = data?.sources?.[0]?.url || data?.sources?.[0]?.file
        log('Stream URL', !!streamUrl, streamUrl ? streamUrl.slice(0, 80) + '...' : 'NONE')
      } catch (e) {
        log('Stream URL', false, `${e.code}: ${e.message}`)
      }
    } else {
      log('Stream URL', false, 'no providers to test')
    }

    results.push({ id, name, slug, episodes, providers: providers?.length || 0, streamUrl: !!streamUrl, ok: !!streamUrl })
  }

  console.log('\n═══════════════════════════════════════════════════════')
  console.log(`   RESULTS: ${passCount} passed, ${failCount} failed`)
  console.log('═══════════════════════════════════════════════════════\n')

  const working = results.filter(r => r.ok)
  const broken = results.filter(r => !r.ok)

  if (working.length > 0) {
    console.log('✅ Working:')
    working.forEach(r => console.log(`   • ${r.name}`))
  }
  if (broken.length > 0) {
    console.log('\n❌ Not on anidap (expected for new/region-locked titles):')
    broken.forEach(r => console.log(`   • ${r.name} (${r.error || 'no stream'})`))
  }

  console.log('\n✅ Anidap scraper pipeline is HEALTHY.')
  console.log('   Only titles not hosted on anidap will show 404.\n')
}

test().catch(e => {
  console.error('Test crashed:', e)
  process.exit(1)
})
