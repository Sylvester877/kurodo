// Publish the v0.3.40 draft release: un-draft + set name + release-notes body.
// Token comes from git credential manager (never printed).
import { execSync } from 'node:child_process'

const VERSION = '0.3.40'
const OWNER = 'Sylvester877'
const REPO = 'kurodo'

const token = (() => {
  for (let i = 1; i <= 3; i++) {
    try {
      const out = execSync('git credential fill', {
        input: `protocol=https\nhost=github.com\n`,
        encoding: 'utf8',
        timeout: 30_000,
      })
      const t = out.split('\n').find((l) => l.startsWith('password='))?.slice(9)
      if (!t) throw new Error('NO_TOKEN')
      console.log(`token OK (len ${t.length})`)
      return t
    } catch (e) {
      console.log(`attempt ${i} failed: ${e.message?.slice(0, 80)}`)
      if (i === 3) throw e
    }
  }
})()

const H = { Authorization: `Bearer ${token}`, 'User-Agent': 'kurodo-release-script', Accept: 'application/vnd.github+json' }

// 1. Find the draft release for v0.3.40
const listRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=20`, { headers: H })
if (!listRes.ok) { console.error('list failed:', listRes.status); process.exit(1) }
const rels = await listRes.json()
const draft = rels.find((r) => r.draft && r.tag_name === `v${VERSION}`)
if (!draft) { console.error('no draft for v' + VERSION); process.exit(1) }
console.log('draft id:', draft.id, 'assets:', (draft.assets || []).map((a) => a.name).join(', '))

// 2. Publish with notes
const body = `# Kurōdo v${VERSION}

## Official title logos everywhere
- **TVDB clearlogos** now resolve for the hero, details page, and watch page via the new \`/api/tvdb-art\` pipeline (AniList/MAL → TVDB mapping, 24h memory + 30d disk cache, served through the 1-year-immutable \`/img\` proxy).
- New **AnimeLogo** component: instant text wordmark underlay, transparent logo pops in over it (spring, blur-to-sharp), fixed boxes = zero layout shift, silent 10-min retry when art appears later.
- Wired into **Home hero**, **Anime details**, and the **Watch title bar** — one shared persisted cache chain across all three.

## Fullscreen right-edge gap — fixed for real
- Root cause 1: the Electron window never actually went OS-fullscreen; it now does (and restores perfectly).
- Root cause 2: the app's themed scrollbar + reserved gutter stayed painted above the fullscreen element — an 8px (10 physical px) reddish-brown strip on the right. The root scrollbar is now suppressed while any fullscreen is active.
- Player internals rebuilt for fullscreen: no more double-zoom (oversize% + scale + offsets), crop-zoom only for genuinely symmetric baked bars, webkit fullscreen events handled, rapid F toggling self-heals.

## New "Original" video fit
- Fourth fit mode alongside Contain / Cover / Fill: plays the stream at its **native pixel size** (1:1), never upscales, no auto-crop — selectable in the player gear menu and Settings.

## Motion + speed (reference-site parity pass)
- Hero crossfade tightened to 8s with an animated progress dot, "Featured this week" eyebrow, staggered meta pills, Ken Burns backdrop, magnetic CTAs.
- Hover card (qtip) reacts 2x faster (180ms in / 80ms out, stiffer springs) and prefetches details on hover.
- New motion-token stylesheet — spring/out-expo/hover easings, transform+opacity only, fully disabled under reduced-motion / reduce-quality.
- \`/img\` responses are now \`max-age=31536000, immutable\`; catalog/art queries keep longer stale windows; trending + schedule prefetched at idle boot.
- Health endpoint now reports \`tmdbOk\` / \`tvdbOk\` / \`wsrvOk\` gates (visible in Settings → Diagnostics).

## Install
Download \`Kurodo-Setup-${VERSION}.exe\` and run it. Existing installs auto-update.

**Full changelog:** https://github.com/${OWNER}/${REPO}/blob/main/CHANGELOG.md
`

const patchRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${draft.id}`, {
  method: 'PATCH',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    draft: false,
    name: `Kurōdo v${VERSION}`,
    body,
  }),
})
if (!patchRes.ok) {
  console.error('patch failed:', patchRes.status, (await patchRes.text()).slice(0, 300))
  process.exit(1)
}
const rel = await patchRes.json()
console.log('\n✅ PUBLISHED:', rel.html_url)
console.log('assets:', (rel.assets || []).map((a) => `${a.name} (${Math.round(a.size / 1024 / 1024)} MB)`).join(', '))
