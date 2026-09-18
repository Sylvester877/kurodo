// Shared outbound budget for EVERY call to graphql.anilist.co.
//
// Why this is a module and not a counter inside each caller: the GraphQL relay
// (server/index.js) and the Jikan fallback (server/jikan-fallback.js) both hit
// AniList from the same IP, so they must share ONE budget. They used to keep
// separate accounting — each thought it had headroom while the combined stream
// tripped AniList's limiter. Observed effect: a single schedule week (6 pages
// fired together) came back 429 for 5 of 6 pages, each after a 4s wait, so the
// Schedule page sat on "Fetching" for 10-23s.
//
// AniList's limit is a per-minute BUDGET rather than a minimum gap between
// calls, so this is a rolling window plus a small concurrency cap rather than a
// serial queue. Rate-limit data observed live: bursts of 4-6 parallel queries
// are fine; sustained >90 requests/min is not.
//
// fixes: schedule/browse requests taking 10-23s behind 429 waits
// (cause: two uncoordinated limiters + a 4s retry-after sleep in the relay).
const WINDOW_MS = 60_000
// 50/min rather than AniList's documented ~90: the documented figure counts
// simple queries, while this app's are heavy Page/media reads with nested
// fields (schedule, seasonal, per-letter pools) — those trip the limiter well
// before 90. Observed live: a browse+letter+schedule sweep at 75/min still got
// 429s; 50 keeps a full cold navigation inside the limit.
const BUDGET = 50
const MAX_CONCURRENT = 4
const BREAKER_MS = 12_000  // pause after a real 429
const POLL_MS = 50

const callTimes = []
let running = 0
let breakerUntil = 0

export function aniListBreakerActive() {
  return Date.now() < breakerUntil
}

export function openAniListBreaker() {
  breakerUntil = Date.now() + BREAKER_MS
}

export function aniListBudgetSnapshot() {
  const now = Date.now()
  while (callTimes.length && now - callTimes[0] > WINDOW_MS) callTimes.shift()
  return { used: callTimes.length, budget: BUDGET, windowMs: WINDOW_MS, inFlight: running, breakerMsLeft: Math.max(0, breakerUntil - now) }
}

/**
 * Wait for a slot in the shared budget.
 * Resolves with a release function — always call it (finally).
 * Throws a 429-tagged error while the breaker is open so callers fail fast
 * instead of queueing behind an upstream that is refusing us.
 */
export async function acquireAniListSlot() {
  for (;;) {
    if (Date.now() < breakerUntil) {
      const err = new Error('AniList rate-limited (breaker active)')
      err.status = 429
      throw err
    }
    const now = Date.now()
    while (callTimes.length && now - callTimes[0] > WINDOW_MS) callTimes.shift()
    if (running < MAX_CONCURRENT && callTimes.length < BUDGET) {
      running++
      callTimes.push(now)
      let released = false
      return () => {
        if (released) return
        released = true
        running--
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}
