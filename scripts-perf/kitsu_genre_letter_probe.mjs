// Probe Kitsu for genre-category and letter-prefix fallback viability:
//  1. /anime?filter[categories]=action — does a category slug + include=mappings work?
//  2. Which categories exist (check a known anime's categories)?
//  3. Letter strategy: fetch a big text-search page and prefix-filter client-side.
import axios from 'axios'

const KITSU = 'https://kitsu.app/api/edge'
const H = {
  Accept: 'application/vnd.api+json',
  'User-Agent': 'kurodo/0.3.38 (anime desktop app; fallback probe)',
}

async function probe(label, url) {
  try {
    const t0 = Date.now()
    const { data } = await axios.get(url, { timeout: 12_000, headers: H, validateStatus: (c) => c < 500 })
    const ms = Date.now() - t0
    const rows = data?.data || []
    console.log(`\n=== ${label} → ${data ? 'HTTP ' + (data.errors ? 'ERR' : '200') : '??'} (${ms}ms) ===`)
    if (data?.errors) { console.log('errors:', JSON.stringify(data.errors).slice(0, 200)); return }
    console.log('rows:', rows.length, '| meta.count:', data?.meta?.count)
    // print first 3 titles + whether mappings resolved
    for (const a of rows.slice(0, 3)) {
      const title = a.attributes?.titles?.en_jp
      const maps = (a.relationships?.mappings?.data || [])
        .map((m) => (data.included || []).find((i) => i.id === m.id && i.type === 'mappings'))
        .filter(Boolean)
      const mal = maps.find((m) => m.attributes?.externalSite === 'myanimelist/anime')
      console.log(`  - ${title} | mal: ${mal?.attributes?.externalId ?? 'NONE'}`)
    }
    if (rows[0]) return rows[0].id
  } catch (e) {
    console.log(`\n=== ${label} → FAILED: ${e.message} ===`)
  }
}

// 1. category filter (slug guesses for MAL genre 1 = Action)
await probe('filter[categories]=action', `${KITSU}/anime?filter[categories]=action&sort=-userCount&page[limit]=5&include=mappings`)

// 2. fetch One Piece and list its categories (to see real slug inventory)
try {
  const { data } = await axios.get(`${KITSU}/anime?filter[text]=one piece&page[limit]=1&include=categories`, { timeout: 12_000, headers: H })
  const cats = (data?.included || []).filter((i) => i.type === 'categories').map((c) => c.attributes?.title)
  console.log('\nOne Piece categories (first 25):', JSON.stringify(cats.slice(0, 25)))
} catch (e) { console.log('category inventory failed:', e.message) }

// 3. letter strategy: text search on the letter, count + prefix-filter
try {
  const { data } = await axios.get(`${KITSU}/anime?filter[text]=B&page[limit]=20&page[offset]=0&sort=-userCount&include=mappings`, { timeout: 12_000, headers: H })
  const rows = data?.data || []
  const startB = rows.filter((a) => (a.attributes?.titles?.en_jp || a.attributes?.canonicalTitle || '').toUpperCase().startsWith('B'))
  console.log(`\nletter-B via text search: ${rows.length} rows, ${startB.length} start with B`)
  for (const a of startB.slice(0, 5)) console.log('  B:', a.attributes?.titles?.en_jp)
} catch (e) { console.log('letter probe failed:', e.message) }
