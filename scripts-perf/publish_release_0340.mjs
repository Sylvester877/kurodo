// Build + publish v0.3.40: electron-builder with GH_TOKEN from git credential
// manager (never printed), verify the release + installer land.
// (Version bump already committed separately — this script only builds/publishes.)
import { execSync } from 'node:child_process'

const VERSION = '0.3.40'
const OWNER = 'Sylvester877'
const REPO = 'kurodo'

const step = (label, fn) => {
  console.log(`\n=== ${label} ===`)
  try { return fn() } catch (e) {
    console.error(`FAILED at ${label}:`, (e.stderr || e.stdout || e.message || '').toString().slice(-800))
    process.exit(1)
  }
}

// 1. Token from credential manager — never printed. GCM occasionally hangs;
//    bounded retries keep the script from blocking forever.
const token = step('fetch token', () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const out = execSync('git credential fill', {
        input: `protocol=https\nhost=github.com\n`,
        encoding: 'utf8',
        timeout: 30_000,
      })
      const t = out.split('\n').find((l) => l.startsWith('password='))?.slice(9)
      if (!t) throw new Error('NO_TOKEN')
      console.log(`token OK (len ${t.length}, attempt ${attempt})`)
      return t
    } catch (e) {
      console.log(`attempt ${attempt} failed: ${e.message?.slice(0, 80)}`)
      if (attempt === 3) throw e
    }
  }
})

// 2. Sanity: package.json is at the release version and tree is clean
step('precheck', () => {
  const pkg = JSON.parse(execSync('node -p "JSON.stringify(require(\'./package.json\').version)"', { encoding: 'utf8' }).trim())
  if (pkg !== VERSION) throw new Error(`package.json is ${pkg}, expected ${VERSION}`)
  const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
  if (dirty) throw new Error('working tree dirty:\n' + dirty.slice(0, 300))
  console.log('version + tree OK')
})

// 3. Build installer + publish (electron-builder reads GH_TOKEN)
step('electron-builder publish', () => {
  execSync('npx electron-builder --win --publish always', {
    stdio: 'inherit',
    env: { ...process.env, GH_TOKEN: token },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  })
})

// 4. Verify release landed with assets
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
