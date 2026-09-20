// Unit tests for the server ORDERING rules (src/lib/providers.ts).
//
// Why this file exists (Sep 2026, "success 100%, fail 0%" work):
//   The default server pick and the auto-failover chain both read
//   `sortProviders`, so its order IS the user-felt success rate — the first
//   chip tried decides whether the episode plays. Two things had to be true
//   and were both broken:
//
//     1. Provider priority must rank MEASURED CAPABILITY, not picture
//        quality. `mimi` was ranked 2 while scoring **8%** on dub, and
//        `loli` — 92% on dub, the best server measured — had no entry at
//        all, so it fell to the unknown default (8) and was tried LAST.
//     2. The order must be STABLE across sessions (Sep 2026): per-fetch
//        health probes used to be sort key 0 and reshuffled the picker on
//        every app restart. The visible order is now: persistent user
//        memory (played-here-first servers) → measured capability →
//        deterministic tie-breakers. Health only steers the invisible
//        auto-pick's alive-pool.
//
// The failover bench (scripts-perf/failover_bench.mjs, 100 titles) confirmed
// the effect: of the titles that played, 100% were served by chain position
// #1, i.e. the default pick hit a working server every time.

import { describe, it, expect, beforeEach } from 'vitest'
import { PROVIDER_META, getProviderMeta, sortProviders } from '../lib/providers'
import { rememberServerGood, rememberServerBad, clearServerMemory } from '../lib/serverMemory'

beforeEach(() => { clearServerMemory() })

const names = (list: { name: string }[]) => list.map((p) => p.name)

describe('provider priority = measured capability', () => {
  it('ranks the measured winners first', () => {
    // Per-chip scores from dub_bench (100 titles) / servers_bench (20 obscure):
    //   dub/sub: loli 92/80 · yuki 70/29 · neko 68/35 · sora 58/21
    expect(PROVIDER_META.loli.priority).toBeLessThan(PROVIDER_META.yuki.priority)
    expect(PROVIDER_META.yuki.priority).toBeLessThan(PROVIDER_META.neko.priority)
    expect(PROVIDER_META.neko.priority).toBeLessThan(PROVIDER_META.sora.priority)
  })

  it('demotes the 8%-success servers behind the workhorses', () => {
    // mimi/kiwi/beep measured 8% — they must never win the default pick over
    // loli/yuki/neko/sora while the roster is unverified.
    for (const weak of ['mimi', 'kiwi', 'beep']) {
      expect(PROVIDER_META[weak].priority).toBeGreaterThan(PROVIDER_META.sora.priority)
    }
  })

  it('has an explicit entry for loli (it used to fall through to unknown)', () => {
    // A missing entry means priority 8, which sorted the BEST server last.
    expect(PROVIDER_META.loli).toBeDefined()
    expect(getProviderMeta('anidap-loli').priority).toBe(PROVIDER_META.loli.priority)
    expect(getProviderMeta('anidap-Loli').priority).toBe(PROVIDER_META.loli.priority)
  })
})

describe('sortProviders ordering', () => {
  it('orders by capability, not by "High quality" tip', () => {
    // sora advertises the better tip but loli has the better hit rate, so
    // capability wins — a 720p stream that plays beats a 1080p chip that 404s.
    const input = [
      { name: 'anidap-sora', tip: 'Soft sub, Fast, High quality' },
      { name: 'anidap-loli', tip: null },
      { name: 'anidap-yuki', tip: 'Soft sub, Good, Multi quality' },
    ]
    expect(names(sortProviders(input))).toEqual(['anidap-loli', 'anidap-yuki', 'anidap-sora'])
  })

  it('NO LONGER lets a live verdict reorder the list (stable order across sessions)', () => {
    // fixes: "every time I close the app and open it again different servers
    // appear" — the per-fetch probe verdicts (`_healthy`) used to be sort key
    // 0, reshuffling the picker between sessions. Health is now invisible:
    // it only feeds pickPreferredProvider's alive-pool, never the order.
    const input = [
      { name: 'anidap-loli', tip: null, _healthy: false },
      { name: 'anidap-sora', tip: 'Soft sub, Fast, High quality', _healthy: true },
      { name: 'anidap-yuki', tip: 'Soft sub, Good, Multi quality' },
    ]
    // Pure capability order, identical whether or not the probe ran.
    expect(names(sortProviders(input))).toEqual(['anidap-loli', 'anidap-yuki', 'anidap-sora'])
  })

  it('ranks the user\'s REMEMBERED fast servers first, persistently', () => {
    // The heart of "keep the same servers every session": a server that
    // actually played for the user stays pinned at the top across app
    // restarts (localStorage-backed serverMemory), even one with a weaker
    // static priority.
    rememberServerGood('anidap-beep') // priority 7 — would sort last
    const input = [
      { name: 'anidap-loli', tip: null },
      { name: 'anidap-beep', tip: 'Soft sub, Fast' },
      { name: 'anidap-yuki', tip: 'Soft sub, Good, Multi quality' },
    ]
    expect(names(sortProviders(input))).toEqual(['anidap-beep', 'anidap-loli', 'anidap-yuki'])
  })

  it('demotes a remembered server whose failures catch up with it', () => {
    // Good-but-now-broken: bad ≥ good drops it out of the pinned tier.
    rememberServerGood('anidap-beep')
    rememberServerBad('anidap-beep')
    rememberServerBad('anidap-beep')
    const input = [
      { name: 'anidap-beep', tip: 'Soft sub, Fast' },
      { name: 'anidap-loli', tip: null },
    ]
    expect(names(sortProviders(input))).toEqual(['anidap-loli', 'anidap-beep'])
  })

  it('treats unverified as neutral, never as dead', () => {
    const input = [
      { name: 'anidap-mimi', tip: 'Soft sub, Fastest', _healthy: null },
      { name: 'anidap-neko', tip: 'Hard sub, Fast, High quality', _healthy: false },
    ]
    expect(names(sortProviders(input))).toEqual(['anidap-neko', 'anidap-mimi'])
  })

  it('uses tip quality as the tie-breaker for UNKNOWN servers only', () => {
    // Both unknown → both priority 8 → the better-labeled one goes first.
    const input = [
      { name: 'anidap-zzz', tip: 'Soft sub, Fast' },
      { name: 'anidap-aaa', tip: 'Hard sub, Fast, High quality' },
    ]
    expect(names(sortProviders(input))).toEqual(['anidap-aaa', 'anidap-zzz'])
  })

  it('is deterministic for fully-tied servers', () => {
    const input = [
      { name: 'anidap-wave', tip: 'Legacy' },
      { name: 'anidap-shiro', tip: 'Legacy' },
      { name: 'anidap-mochi', tip: 'Legacy' },
    ]
    expect(names(sortProviders(input))).toEqual(['anidap-mochi', 'anidap-shiro', 'anidap-wave'])
  })

  it('does not mutate the caller’s array', () => {
    const input = [{ name: 'anidap-sora' }, { name: 'anidap-loli' }]
    const before = names(input)
    sortProviders(input)
    expect(names(input)).toEqual(before)
  })
})
