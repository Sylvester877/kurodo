// Publish the v0.3.41 draft release: un-draft + set name + notes from txt file.
// Token comes from git credential manager (never printed).
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const VERSION = '0.3.41'
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
console.log('token OK (len', token.length + ')')

const H = { Authorization: `Bearer ${token}`, 'User-Agent': 'kurodo-release-script', Accept: 'application/vnd.github+json' }

// 1. Find the draft release for v0.3.41
const listRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`, { headers: H })
if (!listRes.ok) { console.error('list failed:', listRes.status); process.exit(1) }
const rels = await listRes.json()
const draft = rels.find((r) => r.draft && r.tag_name === `v${VERSION}`)
if (!draft) { console.error('no draft for v' + VERSION); process.exit(1) }
console.log('draft id:', draft.id, '| assets:', (draft.assets || []).map((a) => a.name).join(', '))

// 2. Publish with notes
const body = fs.readFileSync(path.join(ROOT, 'scripts-perf', `release-notes-${VERSION}.txt`), 'utf8')

const patchRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${draft.id}`, {
  method: 'PATCH',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ draft: false, name: `Kurōdo v${VERSION}`, body }),
})
if (!patchRes.ok) {
  console.error('patch failed:', patchRes.status, (await patchRes.text()).slice(0, 300))
  process.exit(1)
}
const rel = await patchRes.json()
console.log('\n✅ PUBLISHED:', rel.html_url)
console.log('assets:', (rel.assets || []).map((a) => `${a.name} (${Math.round(a.size / 1024 / 1024)} MB)`).join(', '))
