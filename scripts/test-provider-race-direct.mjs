import { routedGetStream } from '../server/providers/router.js'
import { markProviderRateLimited } from '../server/anidap.js'

const SLOW_MS = 35_000

async function timed(label, fn) {
  const start = Date.now()
  process.stdout.write(`\n[TEST] ${label} ... `)
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('LOCAL_TIMEOUT')), SLOW_MS),
      ),
    ])
    const elapsed = Date.now() - start
    console.log(`OK in ${elapsed}ms`)
    return { ok: true, elapsed, result }
  } catch (e) {
    const elapsed = Date.now() - start
    console.log(`FAILED in ${elapsed}ms: ${e.message || e}`)
    return { ok: false, elapsed, error: e.message || String(e) }
  }
}

async function run() {
  console.log('Real stream extraction test (direct router import)')
  console.log('Timeouts: per-test hard cap ' + SLOW_MS + 'ms')

  // 1. Fast known-good provider
  const t1 = await timed('One Piece ep1 yuki/sub (explicit fast path)', () =>
    routedGetStream(21, '21', 1, 'anidap-yuki', 'sub', {}),
  )
  if (t1.ok) {
    const url = t1.result?.url || t1.result?.raw || (t1.result?.sources?.[0]?.url)
    console.log('  stream url:', url ? url.slice(0, 80) + '...' : 'none')
  }

  // 2. Dead / unknown provider should race and either succeed quickly or fail fast
  const t2 = await timed('One Piece ep1 dead-test/sub (should race fallback providers)', () =>
    routedGetStream(21, '21', 1, 'anidap-dead-test', 'sub', {}),
  )
  if (t2.ok) {
    const url = t2.result?.url || t2.result?.raw || (t2.result?.sources?.[0]?.url)
    console.log('  fallback url:', url ? url.slice(0, 80) + '...' : 'none')
  }

  // 3. Force yuki to be rate-limited, then call it again — should skip immediately
  markProviderRateLimited('yuki', 60)
  const t3 = await timed('One Piece ep1 yuki/sub while rate-limited (should skip)', () =>
    routedGetStream(21, '21', 1, 'anidap-yuki', 'sub', {}),
  )

  // 4. Dub provider that may not exist — should fail fast
  const t4 = await timed('One Piece ep1 yuki/dub (likely no dub)', () =>
    routedGetStream(21, '21', 1, 'anidap-yuki', 'dub', {}),
  )

  console.log('\n--- SUMMARY ---')
  for (const [label, { ok, elapsed }] of Object.entries({
    'yuki/sub': t1,
    'dead-test/sub': t2,
    'yuki/sub rate-limited': t3,
    'yuki/dub': t4,
  })) {
    console.log(`${ok ? '✓' : '✗'} ${label}: ${elapsed}ms`)
  }

  process.exit(0)
}

run().catch((e) => {
  console.error('Test runner error:', e)
  process.exit(1)
})
