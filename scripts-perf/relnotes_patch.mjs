// Update v0.3.39 release notes via the GitHub API — token stays in memory.
import { execSync } from 'node:child_process'

const token = execSync('git credential fill', {
  input: `protocol=https\nhost=github.com\n`,
  encoding: 'utf8',
}).split('\n').find((l) => l.startsWith('password='))?.slice(9)
if (!token) { console.error('NO_TOKEN'); process.exit(1) }

const HDR = { Authorization: `Bearer ${token}`, 'User-Agent': 'kurodo-release-script', Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }

const list = await (await fetch('https://api.github.com/repos/Sylvester877/kurodo/releases/tags/v0.3.39', { headers: HDR })).json()
if (!list.id) { console.error('release not found'); process.exit(1) }
console.log('release id:', list.id)

const body = `## Kurōdo v0.3.39

### Manga
- **Publisher-notice rescue** — licensed titles (My Dress-Up Darling, One Piece, Dandadan, JJK) no longer show the white "EXTERNAL CHAPTER" card. The reader silently pulls the same chapter from atsu.moe, with a subtle "reading via atsu.moe" badge.
- **Full chapter feeds** — chapter lists were silently capped at the first 96 chapters; they now paginate to the complete catalog (Dress-Up Darling showed 96/220).
- Publisher-split chapters (114.1 / 114.2) match atsu's combined numbering (114).
- Chapters with no readable alternative get a themed publisher-only panel with a real link out — never the raw notice PNG.

### Player
- **Anikage-style settings menu** — Playback speed / Audio boost / Caption styles / More, with a working More submenu: Incognito, Autoplay video, Autonext episode, Skip intro/outro, Skip fillers, Ambient mode.
- **Audio boost** via real Web Audio gain (up to +200%), gesture-gated so it can never mute playback.
- **Auto-next holds fullscreen** — episode changes no longer eject you out of fullscreen; the player stays mounted and explicitly resumes playback.
- Cinematic captions + ghost-chip control bar (Anikage parity).

### Servers & playback
- **Capability-first server ordering** — measured success rates now drive chip order (loli first for dub), not guesswork; nothing is hidden.
- **Fail-forward picking** — a failed server auto-tries the next, announces it, walks the whole roster, then the other audio track, then refreshes the server list once before giving up.
- Faster watch loads: megavid no longer serially blocks the real pool, the server list races a 4s deadline instead of waiting out upstream timeouts.

### Core
- **Settings actually persist** — fixed the \`"[object Object]"\` localStorage bug that reset every setting (volume, theme, auto-next, quality…) on every launch.
- **Crash-aware window close** — spontaneous window teardowns now recover instead of silently quitting; next death leaves a reason in startup.log.
- Adult-content filter on search/browse.

**Install:** download \`Kurodo-Setup-0.3.39.exe\` below. Existing installs update automatically.
**Known issues:** Jikan/AniList upstream outages can slow Browse/Schedule (fallbacks active); the 22 unplayable long-tail titles from the server audit have no upstream stream available.`

const upd = await fetch(`https://api.github.com/repos/Sylvester877/kurodo/releases/${list.id}`, {
  method: 'PATCH',
  headers: HDR,
  body: JSON.stringify({ body, name: 'Kurōdo v0.3.39 — manga rescue + player menu + server failover', draft: false }),
})
console.log('PATCH status:', upd.status)
const result = await upd.json()
if (!upd.ok) { console.error('PATCH body:', JSON.stringify(result).slice(0, 300)); process.exit(1) }
console.log('LIVE:', result.html_url)
console.log('name:', result.name)
console.log('body length:', (result.body || '').length)
console.log('assets:', result.assets.map(a => `${a.name} (${Math.round(a.size / 1024 / 1024)} MB)`).join(', '))
