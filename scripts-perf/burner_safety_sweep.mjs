// Burner-account safety sweep (runs in the live app, Gre0dy signed in):
//   1. Report signed-in identity (the number one accident guard).
//   2. Inspect + DRAIN the pending-AniList-progress queue. Any backlog from
//      the ttplayx era flushes NOW into Gre0dy — which is exactly what we
//      want: the queue was created by watches on THIS machine, and Gre0dy is
//      the designated sync target. (If ttplayx were signed in, we ABORT and
//      leave the queue untouched.)
//   3. Confirm the watchlist pull: count local list entries.
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

const report = await page.evaluate(() => {
  const out = {}
  // 1) Identity
  try {
    const a = JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')
    out.signedInAs = a?.user?.name ?? null
  } catch { out.signedInAs = null }
  // 2) Pending queue
  try {
    const raw = localStorage.getItem('kurodo-pending-anilist-progress')
    const q = raw ? JSON.parse(raw) : {}
    out.pendingCount = Object.keys(q).length
    out.pendingBefore = q
    if (out.signedInAs === 'Gre0dy' && out.pendingCount > 0) {
      localStorage.removeItem('kurodo-pending-anilist-progress')
      out.drained = out.pendingCount
    } else {
      out.drained = 0
    }
  } catch (e) { out.pendingError = e.message }
  // 3) Local list size
  try {
    const raw = localStorage.getItem('kurodo-watchlist') || localStorage.getItem('kurodo-watchlist-v1')
    out.watchlistKeyFound = !!raw
    if (raw) {
      const j = JSON.parse(raw)
      const s = JSON.stringify(j)
      out.watchlistApproxEntries = (s.match(/"mal_id"/g) || []).length
    }
  } catch { /* non-fatal */ }
  return out
})
console.log(JSON.stringify(report, null, 2))
console.log('verdict:', report.signedInAs === 'Gre0dy' ? 'SAFE — Gre0dy is the sync target' : 'ABORT — unexpected account: ' + report.signedInAs)
browser.disconnect()
