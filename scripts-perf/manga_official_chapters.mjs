// How widespread are the "publisher notice image" chapters?
//
// MangaDex lists official publisher chapters (Manga UP!, MANGA Plus, etc) that
// it cannot host. It serves a single PNG notice as the chapter's only page —
// that PNG is the "EXTERNAL CHAPTER … paid subscription" card users see, and
// it renders as though it were real content.
//
// This measures: how many chapters per title are affected, whether the
// authoritative `externalUrl` flag is available, and whether a scanlation
// duplicate of the same chapter number exists to fall back to.
const MD = 'https://api.mangadex.org'

const raw = async (p) => {
  const r = await fetch(MD + p, { headers: { Accept: 'application/json' } })
  return r.json()
}

const titles = process.argv.slice(2)
const list = titles.length
  ? titles
  : ['My Dress-Up Darling', 'One Piece', 'Bleach', 'Jujutsu Kaisen', 'Dandadan']

for (const title of list) {
  const s = await raw(`/manga?title=${encodeURIComponent(title)}&limit=5&contentRating[]=safe&contentRating[]=suggestive`)
  const exact = s.data.find((m) => {
    const t = m.attributes.title
    return (t.en || Object.values(t)[0] || '').toLowerCase() === title.toLowerCase()
  }) || s.data[0]
  if (!exact) {
    console.log(`${title}: no MangaDex match`)
    continue
  }
  const name = exact.attributes.title.en || Object.values(exact.attributes.title)[0]
  let feed = []
  let offset = 0
  for (let i = 0; i < 6; i++) {
    const page = await raw(
      `/manga/${exact.id}/feed?translatedLanguage[]=en&limit=500&offset=${offset}&order[chapter]=asc`,
    )
    feed = feed.concat(page.data || [])
    if (!page.data || page.data.length < 500) break
    offset += 500
  }

  let external = 0
  let noticeOnly = 0
  const groups = new Map()
  const byNumber = new Map()
  for (const c of feed) {
    const a = c.attributes
    const group = (a.scanlationGroups ?? []).join?.() // not included by default
    if (a.externalUrl) external++
    if (a.pages === 1) noticeOnly++
    const g = c.relationships?.filter((r) => r.type === 'scanlation_group').map((r) => r.id) || []
    for (const id of g) groups.set(id, (groups.get(id) || 0) + 1)
    const key = a.chapter
    if (!byNumber.has(key)) byNumber.set(key, [])
    byNumber.get(key).push(c)
  }

  // Resolve the group names we care about.
  const ids = [...groups.keys()]
  const names = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const res = await raw(`/group?${chunk.map((id) => `ids[]=${id}`).join('&')}&limit=100`)
    for (const g of res.data || []) names.push({ id: g.id, name: g.attributes?.name })
  }
  const nameOf = new Map(names.map((n) => [n.id, n.name]))

  const officialCount = {}
  for (const c of feed) {
    for (const r of c.relationships || []) {
      if (r.type !== 'scanlation_group') continue
      const nm = nameOf.get(r.id)
      if (nm && /manga ?up|shueisha|viz|kodansha|square ?enix|official/i.test(nm)) {
        officialCount[nm] = (officialCount[nm] || 0) + 1
      }
    }
  }

  let dupWithScanlation = 0
  for (const [, arr] of byNumber) {
    if (arr.length < 2) continue
    const hasOfficial = arr.some((c) =>
      (c.relationships || []).some(
        (r) => r.type === 'scanlation_group' && /manga ?up|official/i.test(nameOf.get(r.id) || ''),
      ),
    )
    const hasScan = arr.some((c) => (c.attributes.pages || 0) > 2)
    if (hasOfficial && hasScan) dupWithScanlation++
  }

  console.log(`\n${name}  (${feed.length} EN chapters)`)
  console.log(`  publisher groups: ${Object.entries(officialCount).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`)
  console.log(`  pages===1 (notice images): ${noticeOnly}`)
  console.log(`  duplicate numbers with BOTH official + readable scanlation: ${dupWithScanlation}`)
}
