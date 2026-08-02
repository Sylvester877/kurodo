// Verify the packaged app.asar contains the latest fixes.
// Usage: node scripts/verify-asar.mjs [path-to-app.asar]
import asar from '@electron/asar'
import path from 'node:path'

const asarPath = process.argv[2] || path.resolve('release/win-unpacked/resources/app.asar')

const files = asar.listPackage(asarPath)

// electron-builder's Windows asar stores entries like
// "\server\index.js" — a literal leading backslash. extractFile seems to
// want the path WITHOUT that leading separator. Try both forms.
const candidates = new Set()
for (const f of files) {
  candidates.add(f)                       // as listed
  candidates.add(f.replace(/^\\/, ''))    // without leading backslash
  candidates.add(f.replace(/^\\/, '').replace(/\\/g, '/')) // forward slashes
}

function get(rel) {
  const key = rel.replace(/\\/g, '/').replace(/^\//, '')
  // find a candidate that matches this normalized rel path
  for (const c of candidates) {
    if (c.replace(/\\/g, '/').replace(/^\//, '') === key) {
      try {
        return asar.extractFile(asarPath, c).toString()
      } catch {
        // try next form
      }
    }
  }
  return null
}

let ok = true

const checks = [
  ['puppeteer.js · proxy rotation', 'server/lib/cf-harvester/puppeteer.js', 'ensureBrowser(isGogo)'],
  ['server/index.js · dynamic version', 'server/index.js', 'APP_VERSION = pkg.version'],
  ['electron/main.js · subtitle return fix', 'electron/main.js', 'CRITICAL: return here'],
  ['electron/main.js · headersSent guard', 'electron/main.js', 'if (!res.headersSent) res.writeHead(500)'],
]

// The frontend source is compiled into dist/assets/*.js; identifiers get
// minified so string-grep won't find them. Instead, prove the packaged
// frontend is byte-identical to the freshly built local dist/ by hashing
// every dist asset from the asar against the on-disk dist directory.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
const distDir = path.resolve('dist')
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

let compared = 0
let mismatches = 0
let distHits = 0
let firstDist = ''
for (const f of files) {
  const normF = f.replace(/\\/g, '/').replace(/^\//, '')
  if (!normF.startsWith('dist/')) continue
  distHits++
  if (!firstDist) firstDist = normF
  const local = path.join(distDir, normF.slice('dist/'.length))
  // Use the same multi-form extraction as get(): find the archive key
  // variant that extractFile accepts.
  let inAsar = null
  for (const c of candidates) {
    if (c.replace(/\\/g, '/').replace(/^\//, '') !== normF) continue
    try {
      inAsar = asar.extractFile(asarPath, c)
      break
    } catch {
      // try next form
    }
  }
  try {
    const onDisk = readFileSync(local)
    if (inAsar === null) throw new Error('no extractable form')
    compared++
    if (sha256(onDisk) !== sha256(inAsar)) {
      mismatches++
      console.log(`  ⚠ hash mismatch: ${normF}`)
    }
  } catch {
    // local file missing or unextractable — skip
  }
}
const distOk = compared > 0 && mismatches === 0
if (!distOk) ok = false
console.log(`${distOk ? '✅' : '❌'} frontend dist matches local build (${compared} assets compared, ${mismatches} mismatches; distHits=${distHits}, first=${firstDist})`)

for (const [label, rel, needle] of checks) {
  const content = get(rel)
  const found = content !== null && content.includes(needle)
  if (!found) ok = false
  console.log(`${found ? '✅' : '❌'} ${label}`)
}

const pkgContent = get('package.json')
if (pkgContent) {
  const v = JSON.parse(pkgContent).version
  // Read the expected version from package.json so future releases don't
  // false-fail this check with a stale hardcoded number.
  let expectedVersion = 'unknown'
  try {
    expectedVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version
  } catch {}
  console.log(`${v === expectedVersion ? '✅' : '❌'} packaged version = ${v} (expect ${expectedVersion})`)
  if (v !== expectedVersion) ok = false
} else {
  console.log('❌ package.json not found in asar')
  ok = false
}

console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED')
process.exit(ok ? 0 : 1)
