// Publish the v0.3.36 draft release with notes.
import { execSync } from 'node:child_process'

const token = execSync('git credential fill <<< $\'protocol=https\\nhost=github.com\' 2>/dev/null || printf ""', { shell: 'bash', encoding: 'utf8' })
const TOKEN = (token.match(/^password=(.+)$/m) || [])[1]
if (!TOKEN) { console.error('no token'); process.exit(1) }
const H = { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json' }

const NOTES = `### Player
- **Fullscreen fixed** — the auto bar-crop no longer fights the fullscreen box. No more chopped picture in fullscreen, in every video-fit mode (Contain / Cover / Fill).
- Bar-crop now only ever applies in Contain mode, and reshapes the box instead of zooming — **your picture is never cropped**, bars are removed by geometry.

### Episode list — full redesign
- New rows: thumbnail left with EP badge, title + synopsis, CC / ★ score / air-date meta row, watch-progress bar — like anikage.
- New header: range dropdown (1 - 25 / 26 - 50 / …), prev/next paging, round filter box, hide-watched eye toggle.
- **No more hover zoom** — rows stay put when you hover.

### Fixes
- Stale-shell blank screen after updates (server now serves index.html with no-cache).
- Episode list virtualizer keeps working on 100+ episode shows with the new row height.

**Install:** download \`Kurodo-Setup-0.3.36.exe\` below and run it. Existing installs auto-update.`

// Find the draft release for the tag.
const res = await fetch('https://api.github.com/repos/Sylvester877/kurodo/releases', { headers: H })
const rels = await res.json()
const draft = rels.find((r) => r.tag_name === 'v0.3.36' && r.draft)
if (!draft) { console.log('no draft found for v0.3.36 — may already be published'); process.exit(0) }

const upd = await fetch('https://api.github.com/repos/Sylvester877/kurodo/releases/' + draft.id, {
  method: 'PATCH',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ draft: false, name: 'Kurōdo 0.3.36 — Episode list redesign + fullscreen fix', body: NOTES }),
})
const j = await upd.json()
if (j.html_url) {
  console.log('PUBLISHED:', j.html_url)
  console.log('assets:', j.assets.map((a) => a.name + ' (' + Math.round(a.size / 1048576) + 'MB)').join(', '))
} else {
  console.log('patch failed:', JSON.stringify(j).slice(0, 300))
  process.exit(1)
}
