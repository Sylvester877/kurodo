// Probe: how many chapters does MangaDex list with NO readable pages, and do
// they carry an externalUrl? Those are the "publisher-only" chapters that a
// reader cannot render (the screenshot's "EXTERNAL CHAPTER" notice).
const B = process.env.B || 'http://127.0.0.1:5173'

const get = async (p) => {
  const r = await fetch(B + p)
  const j = await r.json()
  return j?.data ?? j
}

const title = process.argv[2] || 'My Dress-Up Darling'
const found = await get(`/api/manga/search?q=${encodeURIComponent(title)}&limit=8`)
console.log(`search "${title}":`)
for (const m of found.results) {
  console.log(`  ${m.id}  ${m.title}  lastCh=${m.lastChapter ?? '?'}  chCount=${m.lastChapter ?? '?'}`)
}
// Prefer an exact title match — search happily returns "My Dress-Up Darling
// 107.5" for "My Dress-Up Darling".
const md = found.results.find((m) => m.title.toLowerCase() === title.toLowerCase()) || found.results[0]
const feed = await get(`/api/manga/chapters/${md.id}?lang=en&limit=500`)
const chs = feed.chapters || []
console.log(`\n${md.title} → ${chs.length} English chapters`)
console.log('keys on a chapter:', Object.keys(chs[0] || {}).join(', '))

let zero = 0
const zeroList = []
for (const c of chs) {
  if (!c.pages || c.pages === 0) {
    zero++
    if (zeroList.length < 12) zeroList.push(`ch${c.chapter}(pages=${c.pages}, group=${c.scanGroup ?? '-'}, hash=${c.hash ? 'y' : 'n'})`)
  }
}
console.log(`chapters reporting 0 pages: ${zero}/${chs.length}`)
zeroList.forEach((z) => console.log('   ', z))

const target = chs.find((c) => String(c.chapter) === '114.1')
console.log('\nchapter 114.1:', target ? JSON.stringify(target).slice(0, 400) : 'NOT IN FEED')
if (target) {
  const pages = await get(`/api/manga/pages/${target.id}`)
  console.log('  pages endpoint →', JSON.stringify(pages).slice(0, 300))
}

// Which chapters does the reader actually get served for a normal chapter?
const normal = chs.find((c) => c.pages > 10)
if (normal) {
  const pages = await get(`/api/manga/pages/${normal.id}`)
  console.log(`\nsanity — ch${normal.chapter} (${normal.pages} pages):`, JSON.stringify(pages.pages?.[0] ?? pages).slice(0, 200))
}
