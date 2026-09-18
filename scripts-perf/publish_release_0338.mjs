// Publish v0.3.38: create tag + GitHub release + upload installer assets.
// Token comes from git credential manager via stdin — never printed.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OWNER = 'Sylvester877'
const REPO = 'kurodo'
const TAG = 'v0.3.38'
const VERSION = '0.3.38'

const token = execSync('git credential fill', { input: `protocol=https\nhost=github.com\n`, encoding: 'utf8' })
  .split('\n')
  .find((l) => l.startsWith('password='))
  ?.slice(9)
if (!token) { console.error('NO_TOKEN'); process.exit(1) }

const API = `https://api.github.com/repos/${OWNER}/${REPO}`
const auth = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'kurodo-release-script',
}

async function gh(pathname, opts = {}) {
  const r = await fetch(`${API}${pathname}`, { ...opts, headers: { ...auth, ...(opts.headers || {}) } })
  return r
}

// 1. Resolve the commit to tag (local main must equal origin/main)
const sha = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim()
console.log('tagging commit:', sha.slice(0, 10))

// 2. Create the tag if missing
let refRes = await gh(`/git/refs/tags/${TAG}`)
if (refRes.status === 404) {
  const create = await gh('/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/tags/${TAG}`, sha }),
  })
  if (!create.ok) { console.error('tag create failed:', create.status, await create.text()); process.exit(1) }
  console.log('tag created:', TAG)
} else {
  console.log('tag already exists')
}

// 3. Create the release if missing
let relRes = await gh(`/releases/tags/${TAG}`)
if (relRes.status === 404) {
  const NOTES = `### Outage-proof catalog — Kurodo no longer dies when the big APIs go down

AniList's API entered its documented site-wide outage state (403 on every query) with Jikan down at the same time. This build survives that exact condition — nothing lies with fake-empty rows anymore:

- **Home feed** (Trending / Popular This Season / Most Favorite / Coming Soon) falls back to a new **Kitsu relay** serving real MAL-id'd cards — verified end-to-end with zero error rows during the live outage.
- **Schedule** shows an honest outage state + Retry instead of fake "No episodes scheduled"; fresh air-times still render via the cache layer while the API is down.
- **Seasons page** serves real per-season cards from Kitsu (Frieren S2, etc.) with an honest outage card otherwise.
- **Browse** gains a Kitsu stage in the catalog chain — Top Rated / Popular / Upcoming / This Season paint during dual outages. Also fixes a latent bug where Kitsu's 20-item page cap 400'd 24–30 item requests.
- **Manga details** survive metadata outages — saved entries supply title/cover fallbacks so chapters still load; genuine failures show "Couldn't load this manga" + Retry instead of "No chapters found".

### Auto-next, surfaced
- Episode end now reliably advances when auto-next is on (even if a seek/jump skipped the 90% countdown).
- When off, an **"Up Next EP n" card** appears at episode end with one-click Play-next and an "Always auto-play next episode" enable.

### TMDB logo art fix
- Stale null logo/backdrop lookups are no longer pinned as fresh for 24h — hero + detail art re-resolve within 30–60 min, so brand-new shows (BLACK TORCH) get their real clear-logo the same day it appears on TMDB.

**Install:** download \\\`Kurodo-Setup-0.3.38.exe\\\` and run it. Existing installs auto-update.`
  const createRel = await gh('/releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: TAG,
      name: `Kurōdo 0.3.38 — Outage-proof catalog + surfaced auto-next`,
      body: NOTES,
      draft: false,
      prerelease: false,
    }),
  })
  if (!createRel.ok) { console.error('release create failed:', createRel.status, await createRel.text()); process.exit(1) }
  relRes = createRel
  console.log('release created')
} else {
  console.log('release already exists')
}
const release = await relRes.json()
console.log('release id:', release.id, '| upload_url present:', !!release.upload_url)

// 4. Upload assets (installer + blockmap + latest.yml), skipping ones already attached
const existing = new Set((release.assets || []).map((a) => a.name))
const assets = [
  ['Kurodo-Setup-0.3.38.exe', 'application/vnd.microsoft.portable-executable'],
  ['Kurodo-Setup-0.3.38.exe.blockmap', 'application/octet-stream'],
  ['latest.yml', 'application/octet-stream'],
]
for (const [name, contentType] of assets) {
  if (existing.has(name)) { console.log('asset already uploaded:', name); continue }
  const fp = path.join(ROOT, 'release', name)
  if (!fs.existsSync(fp)) { console.error('MISSING FILE:', fp); process.exit(1) }
  const size = fs.statSync(fp).size
  console.log(`uploading ${name} (${(size / 1e6).toFixed(1)} MB)…`)
  const up = await fetch(`https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': contentType, 'Content-Length': String(size) },
    body: fs.readFileSync(fp),
  })
  if (!up.ok) { console.error('upload failed:', up.status, (await up.text()).slice(0, 300)); process.exit(1) }
  const j = await up.json()
  console.log('uploaded:', j.name, j.state, (j.size / 1e6).toFixed(1) + 'MB')
}

console.log('\nPUBLISHED: https://github.com/Sylvester877/kurodo/releases/tag/' + TAG)
