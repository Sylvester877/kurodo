// Shared AniZip mapping cache regression tests (root fix for slow episode
// fetching).
//
// The bug: every episode surface (client list, anikage-episodes, TVDB
// series-id, episode-thumbs) fetched https://api.ani.zip/mappings with its
// own axios call + own in-memory cache, so a cold page paid 2-3 duplicate
// ~1-4s upstream round-trips and a restart threw every cache away.
//
// Contract under test:
//   • single-flight — N concurrent lookups for the same id share ONE
//     upstream request
//   • memory hit — a second call within the TTL never touches upstream
//   • disk reuse — after a module "restart" (fresh import, empty memory)
//     the mapping is served from disk with zero upstream calls
//   • failures are never persisted to disk

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolate each test from the previous one's module state (memory cache).
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kurodo-anizip-test-'))

// Mock axios BEFORE importing the module under test. axios.get resolves
// through the mock below; the module also reads KURODO_ANIZIP_CACHE_DIR at
// import time, so the env var is set before the dynamic import.
// vi.hoisted keeps the SAME mock instance visible to both the mock factory
// and the test body (with correct types) instead of re-importing axios.
const axiosMock = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('axios', () => ({ default: axiosMock }))

async function freshModule() {
  vi.resetModules()
  process.env.KURODO_ANIZIP_CACHE_DIR = TEST_DIR
  return await import('../../server/anizip-cache.js')
}

const SAMPLE = {
  tvdbShowId: 99999,
  mappings: { mal_id: 5114, anilist_id: 21, thetvdb_id: 99999, themoviedb_id: '123' },
  episodes: {
    '1': { episode: 1, title: { en: 'One' }, image: 'https://cdn.example/1.jpg' },
    '2': { episode: 2, title: { en: 'Two' }, image: 'https://cdn.example/2.jpg' },
  },
}

function upstreamResolves(data: unknown = SAMPLE) {
  axiosMock.get.mockResolvedValueOnce({ data })
}

function upstreamFails() {
  axiosMock.get.mockRejectedValueOnce(new Error('upstream down'))
}

beforeEach(() => {
  // resetAllMocks clears call history AND queued mockResolvedValueOnce/
  // RejectedValueOnce impls left unconsumed by a previous test (a leftover
  // resolved payload silently satisfied a later failure-expectation).
  vi.resetAllMocks()
  // Wipe the shared disk cache so tests never feed off each other's entries
  // (the single-flight test writes mal:5114; a later test must re-fetch it).
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true })
    fs.mkdirSync(TEST_DIR, { recursive: true })
  } catch { /* best effort */ }
})

afterAll(() => {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }) } catch { /* best effort */ }
})

describe('anizip-cache single-flight', () => {
  it('dedupes concurrent lookups of the same id into one upstream request', async () => {
    const mod = await freshModule()
    let resolveUpstream!: (v: unknown) => void
    axiosMock.get.mockImplementationOnce(
      () => new Promise((res) => { resolveUpstream = res })
    )

    const p1 = mod.getAnizipMapping({ malId: 5114 })
    const p2 = mod.getAnizipMapping({ malId: 5114 })
    const p3 = mod.getAnizipMapping({ malId: 5114 })

    // Give the three callers time to reach the single-flight gate.
    await new Promise((r) => setTimeout(r, 25))
    expect(axiosMock.get).toHaveBeenCalledTimes(1)

    resolveUpstream({ data: SAMPLE })
    const results = await Promise.all([p1, p2, p3])
    expect(results).toEqual([SAMPLE, SAMPLE, SAMPLE])
  })

  it('distinguishes concurrent lookups of different ids', async () => {
    const mod = await freshModule()
    upstreamResolves()
    upstreamResolves()
    const [a, b] = await Promise.all([
      mod.getAnizipMapping({ malId: 5114 }),
      mod.getAnizipMapping({ malId: 5115 }),
    ])
    expect(axiosMock.get).toHaveBeenCalledTimes(2)
    expect(a).toEqual(SAMPLE)
    expect(b).toEqual(SAMPLE)
  })
})

describe('anizip-cache memory tier', () => {
  it('serves repeat lookups from memory without hitting upstream', async () => {
    const mod = await freshModule()
    upstreamResolves()
    await mod.getAnizipMapping({ malId: 5114 })
    const again = await mod.getAnizipMapping({ malId: 5114 })
    expect(axiosMock.get).toHaveBeenCalledTimes(1)
    expect(again).toEqual(SAMPLE)
  })
})

describe('anizip-cache disk tier', () => {
  it('serves a lookup from disk after a module restart (no upstream call)', async () => {
    const mod1 = await freshModule()
    upstreamResolves()
    await mod1.getAnizipMapping({ malId: 5114 })

    // "Restart": fresh module state (empty memory), same cache dir on disk.
    vi.clearAllMocks()
    const mod2 = await freshModule()
    const again = await mod2.getAnizipMapping({ malId: 5114 })
    expect(again).toEqual(SAMPLE)
    expect(axiosMock.get).not.toHaveBeenCalled()
  })

  it('never persists a failed lookup — the next attempt retries upstream', async () => {
    // Distinct id: the other tests already wrote a GOOD disk entry for 5114;
    // this test needs a mapping that has never succeeded on disk.
    const mod1 = await freshModule()
    upstreamFails()
    await expect(mod1.getAnizipMapping({ malId: 9001 })).resolves.toBeNull()

    // Restart. A failed lookup must NOT have been written to disk, so the
    // fresh module still tries upstream (and succeeds this time).
    vi.clearAllMocks()
    const mod2 = await freshModule()
    upstreamResolves()
    const retry = await mod2.getAnizipMapping({ malId: 9001 })
    expect(retry).toEqual(SAMPLE)
    expect(axiosMock.get).toHaveBeenCalledTimes(1)
  })
})
