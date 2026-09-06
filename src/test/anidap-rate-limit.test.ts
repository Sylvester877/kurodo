// B0-1 regression tests: the chad site-wide 429 backoff clamp + export fix.
//
// The crash: server/anidap.js declared `function markChad429` WITHOUT export,
// so dynamic importers in server/lib/cf-harvester/electron.js (lines ~394,
// ~505, ~557) destructured `undefined` and threw "markChad429 is not a
// function" on every chad 429 path — killing the fallback chain mid-flight.
//
// Clamp contract (per runbook B0-1):
//   • bogus 22h retry_after  → capped at 3 min (CHAD_429_MAX_TTL)
//   • sub-15s retry_after    → floored at 15 s
//   • a NEW smaller window never shrinks an active larger one
//     (fresh window wins via Math.max)
//   • chadRetryAfterMs parses retry_after SECONDS (body drains ~1/sec)

import { describe, it, expect, vi } from 'vitest'
// vitest alias-free direct server import (same pattern as filler-lib.test.ts)
import {
  markChad429,
  chadRetryAfterMs,
} from '../../server/anidap.js'

// Each test needs a CLEAN module state: the backoff window is module-global,
// so consecutive tests would otherwise observe the previous test's window.
// vi.resetModules + a fresh dynamic import gives us isolation cheaply.
async function freshAnidap() {
  vi.resetModules()
  return await import('../../server/anidap.js')
}

describe('markChad429 export + clamp (B0-1)', () => {
  it('exports markChad429 as a function (the crash)', () => {
    expect(typeof markChad429).toBe('function')
  })

  it('caps a bogus 22h retry_after at 3 minutes', async () => {
    const m = await freshAnidap()
    m.markChad429(22 * 60 * 60 * 1000) // 22h in ms
    const remaining = m.getChad429Remaining()
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThanOrEqual(180) // ≤ 3 min
    expect(m.isChad429Blocked()).toBe(true)
  })

  it('floors a sub-15s retry_after at 15 seconds', async () => {
    const m = await freshAnidap()
    m.markChad429(5000) // 5s in ms
    const remaining = m.getChad429Remaining()
    expect(remaining).toBeGreaterThanOrEqual(15)
    expect(remaining).toBeLessThanOrEqual(15) // exactly 15 after floor + rounding
  })

  it('never shrinks an active window with a smaller one', async () => {
    const m = await freshAnidap()
    m.markChad429(180_000) // full 3-min window
    const before = m.getChad429Remaining()
    m.markChad429(15_000) // tiny window arrives mid-window
    expect(m.getChad429Remaining()).toBeGreaterThanOrEqual(before - 1)
  })

  it('parses retry_after seconds from a chad 429 body', async () => {
    const body = JSON.stringify({ retry_after: 30 })
    expect(chadRetryAfterMs(body)).toBe(30_000)
  })
})
