// Finish publishing v0.3.33: create tag + GitHub release, upload installer.
// Token comes from git credential manager via stdin — never printed.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OWNER = 'Sylvester877'
const REPO = 'kurodo'
const TAG = 'v0.3.33'
const VERSION = '0.3.33'

const token = execSync(
  'git credential fill',
  { input: `protocol=https\nhost=github.com\n`, encoding: 'utf8' },
)
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

// 2. Create the tag if missing (lightweight tag object via refs API)
let refRes = await gh(`/git/refs/tags/${TAG}`)
if (refRes.status === 404) {
  const create = await gh('/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/tags/${TAG}`, sha }),
  })
  if (!create.ok) {
    console.error('tag create failed:', create.status, await create.text())
    process.exit(1)
  }
  console.log('tag created:', TAG)
} else {
  console.log('tag already exists')
}

// 3. Create the release if missing
let relRes = await gh(`/releases/tags/${TAG}`)
if (relRes.status === 404) {
  const createRel = await gh('/releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: TAG,
      name: `Kurōdo ${VERSION}`,
      body: [
        `## What's new in ${VERSION}`,
        '',
        '### Search page redesign (anikage-style)',
        '- Compact top bar: search field + **Genres / Sort by / Year** dropdowns + clear-all button',
        '- Left filter rail with collapsible **Season / Format / Status / Min score** sections',
        '- Desktop results switched from list rows to a rich **poster grid**',
        '- New **Season** filter (Winter/Spring/Summer/Fall) wired end-to-end',
        '- Default sort is now **Popularity** so well-known titles lead',
        '',
        '### Fixes',
        '- Screenshots no longer blocked by the first-run wizard backdrop',
        '- Server pick sticks (no snap-back to default mid-episode)',
        '- No more play → refresh → "loading stream" loop during playback',
        '- Cold source fetches down to ~1.2–1.5s via the megavid fast path',
      ].join('\n'),
      draft: false,
      prerelease: false,
    }),
  })
  if (!createRel.ok) {
    console.error('release create failed:', createRel.status, await createRel.text())
    process.exit(1)
  }
  relRes = createRel
  console.log('release created')
} else {
  console.log('release already exists')
}
const release = await relRes.json()
console.log('release id:', release.id, '| upload_url present:', !!release.upload_url)

// 4. Upload assets (installer + blockmap), skipping ones already attached
const existing = new Set((release.assets || []).map((a) => a.name))
const assets = [
  ['Kurodo-Setup-0.3.33.exe', 'application/vnd.microsoft.portable-executable'],
  ['Kurodo-Setup-0.3.33.exe.blockmap', 'application/octet-stream'],
]
for (const [name, contentType] of assets) {
  if (existing.has(name)) { console.log('asset already uploaded:', name); continue }
  const fp = path.join(ROOT, 'release', name)
  if (!fs.existsSync(fp)) { console.error('MISSING FILE:', fp); process.exit(1) }
  const size = fs.statSync(fp).size
  console.log(`uploading ${name} (${(size / 1e6).toFixed(1)} MB)…`)
  const up = await fetch(`https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': contentType,
      'Content-Length': String(size),
    },
    body: fs.readFileSync(fp),
  })
  if (!up.ok) {
    console.error('upload failed:', up.status, (await up.text()).slice(0, 300))
    process.exit(1)
  }
  const j = await up.json()
  console.log('uploaded:', j.name, j.state, (j.size / 1e6).toFixed(1) + 'MB')
}

console.log('\nPUBLISHED: https://github.com/Sylvester877/kurodo/releases/tag/' + TAG)
