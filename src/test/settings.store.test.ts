/**
 * The player's gear menu (root rows + the "More" page) is only as real as the
 * settings behind it, so this locks the contract it depends on.
 *
 * Two bugs this file exists to prevent coming back:
 *   1. `skipFiller` used to be a `useState` in Watch.tsx with NO setter — the
 *      toggle rendered and did nothing. It now lives in the store, and the v8
 *      migration carries the old `kurodo-skip-filler` flag over.
 *   2. `debouncedStorage` was handed to `persist` as a STRING storage, so
 *      localStorage held the literal `"[object Object]"`, every load silently
 *      reset to defaults, and no migration ever ran. `createJSONStorage` fixes
 *      that; the round-trip test below fails loudly if it regresses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSettings } from '../store/useSettings'

const KEYS = {
  audioBoost: 50,
  incognito: true,
  autoplayVideo: false,
  skipFiller: false,
} as const

describe('player settings menu (gear → root / More)', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.getState().reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ships the reference defaults', () => {
    const s = useSettings.getState()
    expect(s.audioBoost).toBe(0) // off — no Web Audio graph until asked
    expect(s.incognito).toBe(false)
    expect(s.autoplayVideo).toBe(true)
    expect(s.skipFiller).toBe(true)
  })

  it('accepts every one of the new "More" toggles through set()', () => {
    const { set } = useSettings.getState()
    for (const [k, v] of Object.entries(KEYS)) set(k as keyof typeof KEYS, v)
    const s = useSettings.getState()
    for (const [k, v] of Object.entries(KEYS)) expect(s[k as keyof typeof KEYS]).toBe(v)
  })

  it('persists them as real JSON (not "[object Object]")', async () => {
    const { set } = useSettings.getState()
    for (const [k, v] of Object.entries(KEYS)) set(k as keyof typeof KEYS, v)

    // The store debounces writes by 300ms; wait for the flush.
    await new Promise((r) => setTimeout(r, 450))

    const raw = localStorage.getItem('kurodo-settings')
    expect(raw).not.toBe('[object Object]')
    const parsed = JSON.parse(raw as string)
    expect(parsed.version).toBe(8)
    expect(parsed.state.audioBoost).toBe(50)
    expect(parsed.state.incognito).toBe(true)
    expect(parsed.state.autoplayVideo).toBe(false)
    expect(parsed.state.skipFiller).toBe(false)
  })

  it('declares persist version 8', () => {
    const opts = useSettings.persist.getOptions()
    expect(opts.version).toBe(8)
  })

  it('an older install carries its legacy skip-filler flag forward', () => {
    const migrate = useSettings.persist.getOptions().migrate as (
      state: Record<string, unknown>,
      version: number,
    ) => Record<string, unknown>

    // `migrate(state, n)` means "this state was written by a build on version
    // n", so the `version < 7` / `version < 8` guards only fire for a state
    // persisted on v6 or older. 6 is the realistic upgrade path.
    localStorage.setItem('kurodo-skip-filler', '0')
    const optedOut = migrate({ skipFiller: true, autoplayNext: false }, 6)
    expect(optedOut.skipFiller).toBe(false)
    // v7's own migration must still fire in the same pass.
    expect(optedOut.autoplayNext).toBe(true)

    localStorage.setItem('kurodo-skip-filler', '1')
    const optedIn = migrate({ skipFiller: false, autoplayNext: false }, 6)
    expect(optedIn.skipFiller).toBe(true)
  })

  it('a state already on v7 is not re-migrated', () => {
    const migrate = useSettings.persist.getOptions().migrate as (
      state: Record<string, unknown>,
      version: number,
    ) => Record<string, unknown>
    localStorage.setItem('kurodo-skip-filler', '0')
    // v7 also predates skipFiller moving into the store, so the carry-over
    // still applies; but the v7 branch must NOT fire again and flip
    // auto-next back on for someone who deliberately turned it off.
    const s = migrate({ skipFiller: true, autoplayNext: false }, 7)
    expect(s.skipFiller).toBe(false)
    expect(s.autoplayNext).toBe(false)
  })

  it('a fresh install (no legacy key) keeps the default', () => {
    const migrate = useSettings.persist.getOptions().migrate as (
      state: Record<string, unknown>,
      version: number,
    ) => Record<string, unknown>
    localStorage.removeItem('kurodo-skip-filler')
    expect(migrate({ skipFiller: true }, 6).skipFiller).toBe(true)
  })
})
