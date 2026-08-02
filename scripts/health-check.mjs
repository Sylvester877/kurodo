#!/usr/bin/env node
// scripts/health-check.mjs
//
// CLI probe runner — tests each streaming server against a specific
// anime + episode and prints a clean verdict to the terminal.
//
// Usage:
//   node scripts/health-check.mjs [--anime-id 21] [--ep 1] [--max 8]
//                                  [--probe-all] [--format json]
//
// Examples:
//   node scripts/health-check.mjs                         # probe a sample
//   node scripts/health-check.mjs --anime-id 113415 --ep 5
//   node scripts/health-check.mjs --probe-all             # probe 4 popular titles
//
// The script boots the SAME health-check module used at runtime, so
// terminal output matches what the production server would print.

import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Make sure .env is loaded BEFORE any provider modules import their
// own config (some providers read env at module load).
try {
  const dotenv = (await import('dotenv')).default
  dotenv.config({ path: '.env.local', override: false })
  dotenv.config()
} catch { /* dotenv optional */ }

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const healthCheckPath = path.resolve(__dirname, '..', 'server', 'health-check.js')

// Cross-platform loading: `await import(absPath)` works on POSIX paths
// but on Windows Node rejects raw backslash paths with ERR_UNSUPPORTED_ESM_URL_SCHEME.
// Convert via pathToFileURL so this works everywhere — no subscribers required.
const {
  runHealthCheck,
  logHealthCheck,
  clearHealthCache,
  getHealthStats,
} = await import(pathToFileURL(healthCheckPath).href)

// Tiny CLI flag parser (keeps zero deps)
function parseFlags(argv) {
  const out = { _: [] }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--probe-all') out.probeAll = true
    else if (a === '--format') out.format = argv[++i]
    else if (a === '--anime-id' || a === '--ep' || a === '--max') {
      out[a.replace('--', '').replace('-', '_')] = Number(argv[++i])
    } else if (a === '--help' || a === '-h') out.help = true
    else out._.push(a)
  }
  return out
}

function printHelp() {
  console.log(`Usage: node scripts/health-check.mjs [options]

Options:
  --anime-id <id>    Probe a specific AniList ID (default: 21 = One Piece)
  --ep <n>           Episode number to probe (default: 1)
  --max <n>          Maximum servers to probe (default: 8)
  --probe-all        Probe 4 popular titles and print a summary
  --format json      Output as JSON instead of pretty logs
  -h, --help         Show this help

Examples:
  node scripts/health-check.mjs
  node scripts/health-check.mjs --anime-id 113415 --ep 5
  node scripts/health-check.mjs --probe-all
`)
}

const flags = parseFlags(process.argv)

if (flags.help) {
  printHelp()
  process.exit(0)
}

// Use a stable default so the script works without flags.
const POPULAR = [
  { anilistId: 21, name: 'One Piece', ep: 1 },
  { anilistId: 113415, name: 'Jujutsu Kaisen', ep: 1 },
  { anilistId: 16498, name: 'Attack on Titan', ep: 1 },
]

const targets = flags.probeAll
  ? POPULAR
  : [{ anilistId: flags.anime_id ?? 21, name: `anilist ${flags.anime_id ?? 21}`, ep: flags.ep ?? 1 }]

clearHealthCache()
const startMs = Date.now()
const allResults = []
let exitCode = 0

for (const t of targets) {
  try {
    const { results } = await runHealthCheck({
      slug: String(t.anilistId), ep: t.ep, anilistId: t.anilistId, max: flags.max ?? 8,
    })
    if (flags.format === 'json') {
      allResults.push({
        title: t.name, anilistId: t.anilistId, ep: t.ep,
        okCount: results.filter((r) => r.ok).length,
        deadCount: results.filter((r) => !r.ok).length,
        results,
      })
    } else {
      logHealthCheck({ slug: t.name, ep: t.ep, results })
    }
    if (results.some((r) => !r.ok)) exitCode = 1
  } catch (e) {
    console.error(`[health-check] ${t.name} probe failed:`, e?.message || e)
    exitCode = 1
  }
}

if (flags.format === 'json') {
  console.log(JSON.stringify({ ok: exitCode === 0, durationMs: Date.now() - startMs, shows: allResults, stats: getHealthStats() }, null, 2))
}

console.log(`\n[x] health-check complete in ${Date.now() - startMs}ms · ${exitCode === 0 ? 'all green' : 'some servers down'}`)
process.exit(exitCode)
