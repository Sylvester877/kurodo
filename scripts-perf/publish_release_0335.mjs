// Finish publishing v0.3.35: create the GitHub release (tag already pushed)
// and upload the installer + blockmap assets.
// Token comes from git credential manager — never printed.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OWNER = 'Sylvester877'
const REPO = 'kurodo'
const TAG = 'v0.3.35'
const VERSION = '0.3.35'

const token = execSync('git credential fill', {
  input: 'protocol=https\nhost=github.com\n',
  cwd: ROOT,
})
  .toString()
  .split('\n')
  .find((l) => l.startsWith('password='))
  ?.slice(9)
if (!token) { console.error('no token'); process.exit(1) }

const H = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'kurodo-release',
  Accept: 'application/vnd.github+json',
}

// 1. Create the release (idempotent-ish: if it exists, reuse it)
const body = `## Kurōdo v${VERSION}

### Watch & sync
- Episodes auto-mark watched in-app AND on AniList when finished (even watched while signed out — queued and flushed on sign-in)
- Video now fills 1920-wide screens — no more dead black bars beside the player
- Auto-post activity feature fully removed: nothing you watch is ever shared to your AniList feed

### Adult-content filter
- Searching "hentai" (or any typo of it) no longer surfaces adult titles — filtered at every layer: AniList (\`isAdult: false\`), Jikan (always SFW + server-side genre strip), MangaDex (no erotica/pornographic), Atsu (title-level guard)
- Mainstream ecchi comedies with "hentai" in the title still show correctly

### Fixes
- Manga Browse grid: covers no longer show "?" placeholders (canonical MangaDex cover URLs + proxy fallback chain)
- Blank window after app update: SPA shell is never cached now, and the web-PWA service worker is blocked in the desktop app
- Thumbnails: failed or hung CDN images self-heal through the server image proxy instead of staying grey
- Playblack loop: switching episodes no longer restarts playback ("Loading stream" every few seconds)
- Search page redesigned: filter rail, genres/sort/year dropdowns, poster grid
- Aniclover-style cursor-following hover cards
- Episodes auto-mark complete near the end (no more manual marking)
- Smooth scrolling (Lenis tuning, no more blur-raster jank)

**Install:** download \`Kurodo-Setup-${VERSION}.exe\` below and run it.
`

let releaseId
{
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: TAG,
      target_commitish: 'main',
      name: `Kurōdo v${VERSION}`,
      body,
      draft: false,
      prerelease: false,
    }),
  })
  const j = await r.json()
  if (j.id) {
    releaseId = j.id
    console.log('release created:', j.html_url)
  } else if (j.errors?.[0]?.code === 'already_exists' || /already_exists/.test(JSON.stringify(j))) {
    const existing = await (await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, { headers: H })).json()
    releaseId = existing.id
    // Update notes
    await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}`, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    console.log('release already exists, reused:', existing.html_url)
  } else {
    console.error('create failed:', JSON.stringify(j).slice(0, 300))
    process.exit(1)
  }
}

// 2. Upload assets (uploads.github.com host)
const assets = [
  path.join(ROOT, 'release', `Kurodo-Setup-${VERSION}.exe`),
  path.join(ROOT, 'release', `Kurodo-Setup-${VERSION}.exe.blockmap`),
  path.join(ROOT, 'release', 'latest.yml'),
]
for (const file of assets) {
  if (!fs.existsSync(file)) { console.log('skip (missing):', path.basename(file)); continue }
  const name = path.basename(file)
  // Check if asset already exists → delete then re-upload
  const rel = await (await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?per_page=100`, { headers: H })).json()
  const dup = (rel || []).find((a) => a.name === name)
  if (dup) {
    await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${dup.id}`, { method: 'DELETE', headers: H })
    console.log('deleted existing asset:', name)
  }
  const size = fs.statSync(file).size
  console.log(`uploading ${name} (${(size / 1024 / 1024).toFixed(1)}MB)…`)
  const up = await fetch(`https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      ...H,
      'Content-Type': name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
      'Content-Length': size,
    },
    body: fs.createReadStream(file),
    duplex: 'half',
  })
  if (up.ok) console.log('  uploaded ✓')
  else console.error('  upload failed:', up.status, (await up.text()).slice(0, 200))
}

// 3. Verify
const final = await (await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, { headers: H })).json()
console.log('\nFINAL:', final.name, '|', final.html_url)
for (const a of final.assets || []) console.log('  asset:', a.name, (a.size / 1024 / 1024).toFixed(1) + 'MB')
