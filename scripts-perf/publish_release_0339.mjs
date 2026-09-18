// Build + publish v0.3.39: bump version, electron-builder with GH_TOKEN from
// git credential manager (never printed), verify the release + installer land.
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const VERSION = '0.3.39'
const OWNER = 'Sylvester877'
const REPO = 'kurodo'

const step = (label, fn) => {
  console.log(`\n=== ${label} ===`)
  try { return fn() } catch (e) {
    console.error(`FAILED at ${label}:`, (e.stderr || e.stdout || e.message || '').toString().slice(-800))
    process.exit(1)
  }
}

// 1. Bump version
step('bump package.json', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  if (pkg.version === VERSION) { console.log('already', VERSION); return }
  pkg.version = VERSION
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
  console.log('version →', VERSION)
})

// 2. Commit the bump (allowed: release flow)
step('commit bump', () => {
  execSync('git add package.json', { stdio: 'inherit' })
  const dirty = execSync('git status --porcelain package.json', { encoding: 'utf8' }).trim()
  if (dirty) {
    execSync(`git commit -m "chore(release): v${VERSION}"`, { stdio: 'inherit' })
  } else {
    console.log('nothing to commit')
  }
})

// 3. Token from credential manager — never printed
const token = step('fetch token', () => {
  const out = execSync('git credential fill', {
    input: `protocol=https\nhost=github.com\n`,
    encoding: 'utf8',
  })
  const t = out.split('\n').find((l) => l.startsWith('password='))?.slice(9)
  if (!t) throw new Error('NO_TOKEN')
  console.log('token OK (len ' + t.length + ')')
  return t
})

// 4. Build installer + publish (electron-builder reads GH_TOKEN)
step('electron-builder publish', () => {
  execSync('npx electron-builder --win --publish always', {
    stdio: 'inherit',
    env: { ...process.env, GH_TOKEN: token },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  })
})

// 5. Verify release landed with assets
step('verify release', async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/v${VERSION}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'kurodo-release-script' },
    })
    if (res.ok) {
      const rel = await res.json()
      const names = (rel.assets || []).map((a) => `${a.name} (${Math.round(a.size / 1024 / 1024)} MB)`)
      console.log('release:', rel.html_url)
      console.log('assets:', names.length ? names.join(', ') : 'NONE YET')
      const exe = (rel.assets || []).find((a) => a.name === `Kurodo-Setup-${VERSION}.exe`)
      if (exe) { console.log('\n✅ RELEASE LIVE with installer'); return }
    } else {
      console.log(`attempt ${i + 1}: HTTP ${res.status}`)
    }
    await wait(6000)
  }
  throw new Error('release not found after 60s')
})
