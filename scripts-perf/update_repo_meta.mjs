// Update repo metadata: description, homepage, topics (searchability).
// Token from git credential manager — never printed.
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const OWNER = 'Sylvester877'
const REPO = 'kurodo'

const token = execSync('git credential fill', {
  input: `protocol=https\nhost=github.com\n`,
  encoding: 'utf8',
})
  .split('\n')
  .find((l) => l.startsWith('password='))
  ?.slice(9)
if (!token) { console.error('NO_TOKEN'); process.exit(1) }

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'kurodo-meta-script',
}

// 1. Description + homepage
const patch = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, {
  method: 'PATCH',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    description:
      '🎬 Cinematic anime & manga desktop app — Netflix-style UI, 15+ stream servers, real episode thumbnails, sub & dub, AniList sync. React + Electron.',
    homepage: 'https://github.com/Sylvester877/kurodo/releases/latest',
    has_discussions: true,
  }),
})
console.log('repo patch:', patch.status, patch.ok ? 'OK' : await patch.text())

// 2. Topics (max 20) — these drive GitHub topic-page discovery
const topics = [
  'anime', 'anime-streaming', 'anime-app', 'electron', 'react', 'typescript',
  'anilist', 'myanimelist', 'manga', 'manga-reader', 'hls', 'streaming',
  'windows', 'desktop-app', 'tailwindcss', 'jikan', 'anime-downloader',
  'netflix-clone', 'puppeteer', 'webtorrent',
]
const t = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/topics`, {
  method: 'PUT',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ names: topics }),
})
console.log('topics:', t.status, t.ok ? 'OK' : await t.text())

// 3. Confirm
const check = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, { headers })
const j = await check.json()
console.log('\ndescription:', j.description)
console.log('homepage:', j.homepage)
console.log('discussions:', j.has_discussions)
