// Audit: publisher ("notice image") chapters vs readable scanlations.
//
// Uses our own backend feed (already normalized) so the numbers match exactly
// what the app sees. For each title:
//   · how many chapters are official/publisher chapters
//   · how many of those have a scanlation duplicate of the same number
//   · how many have NO readable alternative at all (the reader must then send
//     the user to the publisher or to another source)
const B = process.env.B || 'http://127.0.0.1:5173'

// Groups that publish on their own platform — MangaDex cannot host them.
const PUBLISHER_RE =
  /manga ?up|mangaplus|manga plus|shueisha|shonen jump|viz|kodansha|square ?enix|yen press|official|comikey|azuki|inkr|tapas|webtoon|kadokawa|book ?walker|piccoma|tappytoon|manta|lezhin|toomics|copymanga/i

const get = async (p) => {
  const r = await fetch(B + p)
  const j = await r.json()
  return j?.data ?? j
}

const titles = process.argv.slice(2)
const list = titles.length ? titles : ['My Dress-Up Darling', 'One Piece', 'Dandadan', 'Jujutsu Kaisen', 'Bleach', 'Solo Leveling']

let totals = { chapters: 0, notice: 0, dup: 0, orphan: 0 }
for (const title of list) {
  const s = await get(`/api/manga/search?q=${encodeURIComponent(title)}&limit=8`)
  const md =
    s.results.find((m) => m.title.toLowerCase() === title.toLowerCase()) ||
    s.results.find((m) => m.title.toLowerCase().startsWith(title.toLowerCase())) ||
    s.results[0]
  if (!md) {
    console.log(`${title}: no match`)
    continue
  }
  const feed = await get(`/api/manga/chapters/${md.id}?lang=en&limit=500`)
  const chs = feed.chapters || []

  const groups = {}
  for (const c of chs) groups[c.scanGroup || '(none)'] = (groups[c.scanGroup || '(none)'] || 0) + 1

  const isPub = (c) => PUBLISHER_RE.test(c.scanGroup || '')
  // MangaDex gives publisher chapters a single notice page.
  const isNotice = (c) => isPub(c) && (c.pages || 0) <= 1

  const byNumber = new Map()
  for (const c of chs) {
    if (!byNumber.has(c.chapter)) byNumber.set(c.chapter, [])
    byNumber.get(c.chapter).push(c)
  }

  let notice = 0
  let dup = 0
  let orphan = 0
  const orphanList = []
  for (const c of chs) {
    if (!isNotice(c)) continue
    notice++
    const alt = byNumber
      .get(c.chapter)
      .find((o) => o.id !== c.id && !isPub(o) && (o.pages || 0) > 2)
    if (alt) dup++
    else {
      orphan++
      if (orphanList.length < 5) orphanList.push(`ch${c.chapter}`)
    }
  }

  totals.chapters += chs.length
  totals.notice += notice
  totals.dup += dup
  totals.orphan += orphan

  console.log(`\n${md.title}  — ${chs.length} EN chapters`)
  console.log(`  groups: ${Object.entries(groups).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  console.log(`  1-page publisher chapters: ${notice}`)
  console.log(`    ↳ with a readable scanlation of the same number: ${dup}`)
  console.log(`    ↳ no alternative anywhere (need publisher / other source): ${orphan} ${orphanList.join(' ')}`)
  const newest = chs[chs.length - 1]
  console.log(`  newest chapter: ch${newest.chapter} group=${newest.scanGroup} pages=${newest.pages} → ${isNotice(newest) ? 'NOTICE IMAGE' : 'readable'}`)
  const newestReadable = [...chs].reverse().find((c) => !isNotice(c) && (c.pages || 0) > 2)
  console.log(`  newest READABLE chapter: ch${newestReadable?.chapter} (${newestReadable?.pages}p, ${newestReadable?.scanGroup})`)
}

console.log(
  `\nTOTALS: ${totals.chapters} chapters · ${totals.notice} publisher notice chapters ` +
    `· ${totals.dup} with a scanlation alternative · ${totals.orphan} with none`,
)
