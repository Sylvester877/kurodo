# Kurodo load-time baseline (Sept 2026)

Measured live on the packaged Electron window (1920×1200 @125% → 763 CSS px viewport,
repo Express server serving the production `dist/` build, CDP on :9222).

## Home page (fresh navigation)

| Metric          | Before (old packaged build) | After (Phase-1 build) |
|-----------------|-----------------------------|------------------------|
| FCP             | ~595 ms                     | **117 ms**             |
| LCP             | n/a (CSS bg-image never counts) | **444 ms** (hero TMDB logo IMG) |
| DCL             | ~604 ms                     | **108 ms**             |
| Hero height     | 763 px = **100 % of viewport** | **600 px (68vh, clamped 600–720)** |
| "Continue Watching" header | below the fold (never visible on load) | top 681 px → **above the fold** |
| DOM nodes       | 1042                        | 1230 (full page populated) |

## Navigation / content paths

| Flow                          | Time-to-content |
|-------------------------------|-----------------|
| Home → click Trending card → details title | **247 ms** (nav-state `initialData` + persisted cache) |
| Cold direct URL `/anime/:id` (no nav state) | 2.8–8.2 s — upstream Jikan/AniList first fetch; server `/api/jikan` memory cache makes every repeat instant |
| `/watch/:id?ep=1` UI shell (ep list, player) | **340 ms** |
| → video actually playing (first cold stream) | ~12 s (stream CDN fetch + first segments; CDNs were rate-limited during the heavy test session) |

## Changes that produced these numbers (Phase 1)

1. **Fonts** (`index.html`) — Google Fonts stylesheet now loads asynchronously
   (preload → `rel=stylesheet` swap) so it never blocks first paint; removed
   Instrument Sans + Bricolage Grotesque from the request (dead fallbacks —
   Poppins is first in both `--font-sans` and `--font-display` stacks, so they
   never rendered a glyph). Kept Poppins (UI) + Noto Serif JP (rare `.font-jp`).
2. **Hero** (`src/components/Hero.tsx`) — `h-screen` → `h-[68vh] min-h-[600px] max-h-[720px]`
   with slightly tighter bottom padding. Verified no content clip (Watch Now
   button bottom 488 px clears the 544 px schedule ribbon).

## Re-measure after any further load changes
`node scripts-perf/fcplcp.mjs` (FCP/LCP/DCL via pre-nav observer) + `node scripts-perf/measure_home.mjs`

---

# Fetch-time pass (browse · schedule · catalog rails)

Root cause of the reported 10–23s waits was **not** the upstream APIs' raw
speed — measured here against a live server (Jikan/MAL was fully down, `504`
on every endpoint):

1. **Seasonal browse had no AniList fallback.** `tryAniListFallback` returned
   `null` for every `/seasons/*` path, so a MAL outage pushed "This Season"
   past the route's 6s race cap before the Kitsu stage answered. Cold
   `GET /api/jikan/seasons/2026/summer` = **6.96s**.
2. **A Jikan 504 paid a 1s backoff + a second 1.8s round trip** on every
   request even though a 504 means "MAL is unreachable" for *all* endpoints.
3. **The Kitsu stage only ran after the race settled**, so it could never win
   an outage — it was a backstop, not a racer.
4. **Client-side Jikan calls went through a single serial promise chain**
   (`src/api/anime.ts`) that included each request's retry loop (8s timeout ×
   3 attempts). On `/browse` the list request only *started* at +2.9s because
   the genres request held the chain.
5. **Two AniList rate limiters** (relay + Jikan fallback) counted separately
   against one IP, and a real 429 cost a **4s** retry sleep per attempt. A
   schedule week (6 pages fired together) 429'd on 5 of 6 pages.
6. **The packaged app never used the relay at all.** `anilistClient.ts` and
   `getBackendOrigin()` only matched the literal hostname `localhost`, but
   Electron loads `http://127.0.0.1:5173` — so every rail and schedule page
   called `graphql.anilist.co` directly, skipping the relay's 5-minute cache.

## Measured (server responses, cold process / cold cache)

| Endpoint | Before | After |
|---|---|---|
| `/api/jikan/seasons/2026/summer` | **6.96s** | **0.56s** |
| `/api/jikan/top/anime?filter=bypopularity` | 0.82s | 0.66s |
| `/api/jikan/anime?letter=B` | 1.52s | 0.71s |
| `/api/jikan/seasons/now` | 6.12s | 0.72s |
| `/api/jikan/seasons/upcoming` | 0.72s | 0.71s |
| `/api/jikan/schedules` (unsupported path) | ~7s (waited for race cap) | 1.40s → honest 502 |
| warm repeats (all of the above) | 0.00–0.03s | 0.00–0.01s |

## Measured (user-felt, live browser at 127.0.0.1, cold cache)

| Surface | Before | After |
|---|---|---|
| `/browse?filter=top-rated` | 3.69s | **1.21s** |
| `/browse?filter=popular` | 1.42s | **1.11s** |
| `/browse?filter=seasonal` | **7.95s** | **1.60s** |
| `/browse?filter=upcoming` | 3.67s | **1.67s** |
| `/browse?filter=az&letter=B` | 2.28s | **1.19s** |
| `/schedule` | 2.02s (up to 45s when throttled) | **2.37s**, zero 429s |
| warm repeat of every surface | 0.50–2.18s | **0.55–0.68s** |

## Changes

- `server/jikan-fallback.js` — new `getSeasonalFromAniList()` (`/seasons/now`,
  `/seasons/upcoming`, `/seasons/:y/:season`), dispatched from
  `tryAniListFallback`; A–Z AniList pool 4 → 3 pages; shares one rate budget.
- `server/index.js` — Jikan `504` fails fast (and sets a 45s MAL-outage flag so
  later requests skip the doomed Jikan call); Kitsu is now a third racer (armed
  at +1800ms and only for paths Kitsu implements); one funnel
  (`aniListUpstreamPost`) for all outbound AniList calls; 429 fails fast
  instead of sleeping 4s; `/api/health` gained an additive `anilistBudget`.
- `server/lib/anilist-budget.js` (new) — shared rolling-window limiter (50/min,
  4 concurrent, 12s breaker) for the relay **and** the Jikan fallback.
- `src/api/anime.ts` — serial queue → 4-slot pool with a 40ms start gap; 6s
  timeout; 2 attempts.
- `src/api/anilistClient.ts` — 400ms → 120ms start spacing; loopback hosts
  (incl. `127.0.0.1`) now use the `/api/anilist-gql` relay.
- `src/lib/utils.ts` — `getBackendOrigin()` recognises `127.0.0.1:5173`.

## Re-measure
```
node scripts-perf/browse_bench.mjs http://localhost:5173      # server-side, cold + warm
node scripts-perf/browse_timing_probe.mjs http://127.0.0.1:5173 label   # user-felt + shots
node scripts-perf/schedule_probe.mjs http://127.0.0.1:5173 label        # schedule network trace
node scripts-perf/fetch_smoke.mjs http://127.0.0.1:5173 label           # every surface renders
```

---

# Episode-fetch pass (details / watch episode lists)

Measured with `node scripts-perf/episode_bench.mjs`,
`node scripts-perf/episode_ui_probe.mjs` (user-felt + payload) and
`node scripts-perf/anizip_decoded_probe.mjs` (decoded bytes).

## Payload — what the renderer actually parses (One Piece, mal 21)

| response | before | after |
|---|---|---|
| `/api/anizip/mapping?mal_id=21` | **1076KB** | **305KB** (−72%) |
| `/api/anikage-episodes/21` | 770KB | 725KB |
| episode chain total | ~1.85MB | **~1.03MB** (−44%) |

AniZip ships every episode's title in ~35 languages plus a second long
synopsis (`summary`) duplicating `overview`: title 517KB + summary 256KB =
**94% of the mapping**. The app only reads `title.en` / `title['x-jat']` /
`title.ja`, `overview` and the numeric fields, so `slimMapping()` strips the
rest once on the way into the mem + disk cache.

## `/api/anikage-episodes/:malId` cold (fresh process, caches wiped)

| show | before | after |
|---|---|---|
| One Piece (1184 eps) | 3.36s | **2.01s** |
| Bleach (366 eps) | 1.38s | **1.17s** |
| Frieren (28 eps) | 1.19s | 1.25s |
| Chainsaw Man Reze | 1.62s | **0.91s** |

## `/api/anikage-episodes/:malId` after a server restart (disk caches warm)

This is the common case for a desktop app — the previous numbers were paid
again on every launch.

| show | before | after |
|---|---|---|
| One Piece | 2.9–3.4s | **1.19s** (now Jikan-bound; TVDB/AniZip 29ms) |
| Bleach | 1.4s | **0.40s** |
| Frieren | 0.4–0.7s | **0.008s** |
| Reze movie | 0.65s | 0.91s |

Stage breakdown before → after (One Piece): TVDB **2441ms → 29ms**, AniZip
1395ms → 29ms, TMDB phase 2 704ms → **skipped**.

## Changes

- `server/anizip-cache.js` — `slimMapping()`: drop the unused multi-language
  titles + duplicated `summary` on the way into the mem/disk cache (applied on
  disk reads too, so pre-existing entries shrink on next write).
- `server/tvdb-episodes.js` — `short=true` on the extended request
  (series 81797: 1363ms/1143KB → **589ms/908KB**; same fields we read);
  single-flight login; `warmTvdbToken()` called ~2.5s after boot so the ~1.0s
  TVDB login is never on the first episode request's critical path; **disk
  tier** (14d, 120MB cap) mirroring `anizip-cache.js`.
- `server/anikage-episodes.js` — TMDB phase 2 skipped when TVDB covers ≥90% of
  AniZip episodes (was all-or-nothing, so 1178/1184 made One Piece pay 700ms
  for a handful of gaps); null/empty fields dropped per episode; Jikan
  filler/recap stage hard-bounded at 1.2s (it measured 2209ms against an
  1800ms budget because a request could start at the deadline), skipped
  entirely while `isMalDown()`, and disk-cached for 30 days when it completes;
  per-stage timing line in the log.
- `server/lib/mal-outage.js` (new) — the "MAL unreachable" flag, now shared by
  the Jikan proxy and the filler-flag loop so neither re-discovers an outage.
- `src/lib/queryClient.ts` — the persisted snapshot used to be written only if
  the WHOLE thing fit under 1.5MB, so one long anime's episode list (~0.8MB)
  silently disabled persistence for every other query (feeds, schedule,
  watchlist) — the app appeared to "forget" data after browsing a long show.
  Now: 300KB per-entry cap + a budget that keeps as many (small) entries as
  fit, dropping the largest first.
- `src/hooks/useDominantColor.ts` — sample through the same-origin `/img`
  proxy. Raw CDN URLs + `crossOrigin='anonymous'` are refused, which logged a
  CORS error per anime and meant the ambient glow silently never appeared.

## Re-measure
```
node scripts-perf/episode_bench.mjs http://localhost:5173 2
node scripts-perf/episode_ui_probe.mjs http://127.0.0.1:5173 label
node scripts-perf/anizip_decoded_probe.mjs http://localhost:5173
node scripts-perf/tvdb_probe.mjs        # TVDB login + short=true vs false
```

---

## Server-stream pass — 20 obscure (non-cached) titles (Sep 2026)

Goal: the long tail. Popular shows were already warm; the report was that
unknown/old titles show a full picker and then hang or 404 on every chip.

Runner: `node scripts-perf/servers_bench.mjs http://127.0.0.1:5173 20`
Picks 20 titles from AniList `POPULARITY` (ascending) with a score/episode
floor, then walks the exact Watch path per title: `info` → `servers` →
`sources` for each of the first 6 usable servers. The pick query goes through
the app's own `/api/anilist-gql` relay so the bench shares the server's
rate-limit budget instead of burning IP quota next to it.

### Baseline (before)

    anidap-loli     60%  ok 3 / fail  2  avg  1.56s
    anidap-neko     31%  ok 5 / fail 11  avg  5.35s
    anidap-yuki     31%  ok 5 / fail 11  avg  5.80s
    anidap-sora     21%  ok 3 / fail 11  avg 12.02s
    anidap-kiwi      8%  ok 1 / fail 11  avg  7.77s
    anidap-beep      8%  ok 1 / fail 11  avg  9.98s
    anidap-mimi      8%  ok 1 / fail 11  avg  7.39s

    SUMMARY: 5/20 titles got a working stream · 15 had a server list but no
    working stream · 0 never resolved a slug

Two findings:

1. **Upstream truth:** 15/20 of these obscure titles have no stream at all on
   the anidap fleet. That part cannot be "fixed" by the client — what CAN be
   fixed is how fast and how honestly we say so.
2. **A 20s tax on every cold call.** `routedGetStream` gave the megavid
   fast path a 20s budget on the critical path, *serially*, before the
   provider the user asked for was even attempted. Server log for Donkikko:
   `[megavid] fetchSource 19901 ep1 dub -> miss in 11109ms` … `sub -> miss in
   8874ms`. So a chip click cost up to 20s of megavid wait + 4-13s of anidap.

### Fixes

- `server/providers/router.js` — megavid fast-path budget **20s → 5s** plus a
  90s hang breaker; while the breaker is open megavid is still called but with
  a 1.5s budget, so in-memory cache hits (and the titles megavid really has)
  stay instant.
- `server/providers/router.js` — `pick=1` (sent only when the user clicks a
  server chip) now **skips megavid entirely**. megavid serves one stream per
  episode and its router cache is keyed by (malId, ep, type), so whenever
  megavid had the title every single chip returned the identical stream —
  "switch server" was a no-op. `src/api/anidap.ts` + `src/pages/Watch.tsx`
  send the flag from the picker's `userPickedRef`.
- `server/anidap.js` — slug invalidation throttled to once per 5 min per
  title. A single provider's chad 404 wiped the 12h slug cache, so a title
  with no streams re-resolved the slug via AniList for every provider
  (`Resolved slug (graphql): #19901 -> donkikko-krddi` repeated per chip).
- `server/server-verify.js` — servers that could not be probed are reported
  `_healthy: null` (**unverified**) instead of `true`. Previously an unprobed
  chip was advertised as working, which is why the picker showed 25/25 green
  on titles where nothing worked. Nothing is hidden or disabled: `null` stays
  clickable and stays in the router's race pool, it just sorts below verified
  servers and renders amber in the picker.
- `src/components/ServerPicker.tsx` — three honest dot states: verified
  (emerald) / unverified (amber + `UNVERIFIED` pill) / verified dead for this
  title (red, disabled).
- `server/server-verify.js` — probe batch widened from 3/tick serial to
  **6/tick, 2-wide**. With cap 3 + a serial queue only ~1 probe landed inside
  the route's wait window, so a freshly-opened title painted 1 verified chip
  and 5 amber ones. Response latency is unchanged (the route still returns
  after `FAST_WAIT_MS`); the background batch just converges faster.
- `src/pages/MangaReader.tsx`, `src/components/manga/RightToolStack.tsx` —
  dropped 9 unused `lucide-react` imports so `tsc --noEmit` is fully clean.

### After (same runner, same 20 titles, fresh server process)

| server | before | after |
|---|---|---|
| anidap-loli | 60% · avg 1.56s | **80%** · avg 1.52s |
| anidap-neko | 31% · avg 5.35s | **35%** · avg **4.13s** |
| anidap-yuki | 31% · avg 5.80s | 29% · avg 5.40s |
| anidap-sora | 21% · avg 12.02s | 21% · avg **10.69s** |
| anidap-kiwi | 8% · avg 7.77s | 8% · avg **6.40s** |
| anidap-beep | 8% · avg 9.98s | 8% · avg **6.53s** |
| anidap-mimi | 8% · avg 7.39s | 8% · avg **4.84s** |

    before:  5/20 titles got a working stream · 15 listed-but-no-stream
    after:   7/20 titles got a working stream · 12 listed-but-no-stream
    mean failure latency: 7.12s → 5.64s (−21%)

Per-title totals, same 6 servers: Donkikko 62.05s → **48.19s**,
Fujiko F. Fujio … Tanpen Theater 68.05s → **39.18s**.

Counter activity in the same server run: `megavid hang breaker` tripped 4×,
and slug invalidation logged **4** real invalidations against **140**
throttled (i.e. 140 AniList slug lookups that used to be re-paid).

The one `NO SLUG` title (`Serendipity the Pink Dragon`, `info 500` in 10.01s)
is an upstream info-route 500, not a regression — it resolved in the before run.

### Explicit pick now means something (live proof, Bleach ep1 / MAL 269)

    AUTO anidap-yuki  → 200  540ms  source megavid   cp.megavid.buzz/hls/fad443c0-.../playlist.m3u8   3 subs
    PICK anidap-kiwi  → 200 3957ms  source anidap    playeng.animeapps.top/r2/cachehd/720p.../index.m3u8   0 subs
    PICK anidap-neko  → 200 8713ms  source anidap    morning-credit-3bcc.vibevibe.workers.dev/.../mast   0 subs

Before this pass all three returned the identical megavid URL.
Note the picked anidap CDNs ship no caption tracks (megavid does) — the Watch
page's Wyzie subtitle search is the path for those.

### Picker health, live (screenshots in `repo/screenshots/`)

`node scripts-perf/picker_health_proof.mjs http://127.0.0.1:5173` reads the
per-chip dot class off the rendered picker.

    obscure (Donkikko, mal 19901)   verified 0 · unverified 12 · dead 0
    popular (One Piece, mal 21)     verified 1 · unverified  4 · dead 1
      Beep=verified  Neko/Sora/Zuna/Loli=unverified  Yuki=dead

That is the honest picture the picker could not previously show: the obscure
title advertises **zero** servers as working (it used to show 25/25 healthy),
and on the popular title a server the router verified dead for this episode is
marked dead instead of clickable-and-green.

Files: `picker-health-obscure-{page,full}.png`,
`picker-health-popular-{page,full}.png`.

### Re-measure

    node scripts-perf/servers_bench.mjs http://127.0.0.1:5173 20
    node scripts-perf/picker_health_proof.mjs http://127.0.0.1:5173

---

## Every server is always shown and always clickable (Sep 2026)

Rule: the picker renders every server the backend returns, and every tile
accepts a click. Health is information, not a gate.

What used to hide servers:

- `src/components/ServerPicker.tsx` — a `_healthy === false` tile was
  `disabled` with `opacity-20 cursor-not-allowed` and its `onClick` was
  guarded, so verified-dead servers were unclickable. Now every tile is
  enabled and clickable, and the state renders as a badge instead:
  emerald dot = verified, amber = `UNVERIFIED`, red = `NO STREAM`.
- `src/pages/Watch.tsx` — `providersByType` did `continue` on
  `_healthy === false`, so a dead verdict **deleted the server from the whole
  page**: the per-type counts, `hasDubAvailable`/`hasSubAvailable`/
  `hasHsubAvailable` (which hide the audio toggle) and every fallback chain.
  The picker still showed the tile, but nothing else could reach it. The map
  now keeps every provider, and a separate `aliveByType` powers the
  auto-failover chain so auto-advance still can't burn 30s cycling into a
  server the backend just verified has nothing (`aliveByType` falls back to
  the full list when everything is dead, so the chain is never empty).
- `ServerPicker` type tabs (Sub / Dub / H-Subs) were `disabled` when a type
  had no servers — now always selectable, with a friendly per-type panel
  ("nothing is hidden, there is simply nothing here yet").

Verification — `node scripts-perf/picker_health_proof.mjs http://127.0.0.1:5173`:

    obscure (Donkikko, mal 19901)   verified 0 · unverified 7 · dead 5
      hidden/blocked: disabled 0 · not-clickable 0 · disabled type tabs 0
      click test (unverified chip): PASS — Yuki active false → true

    popular (One Piece, mal 21)     verified 6 · unverified 0 · dead 0
      hidden/blocked: disabled 0 · not-clickable 0 · disabled type tabs 0

All 12 servers on a title where 5 are verified dead are still rendered and
still clickable. Screenshots: `picker-health-{obscure,popular}-{page,full}.png`.

### An explicit pick also STICKS (no silent bounce)

Clicking a server whose stream fails instantly used to auto-switch away in the
same tick (the failure is negatively cached, so it returns in ~50ms) — the tile
lit up for a few milliseconds and the selection was already somewhere else.
That is the reported "I pick a different server and it snaps back to yuki" bug,
and it also made clicking a red tile look like it did nothing at all.

`src/pages/Watch.tsx` now detects an explicit pick (`userPickedRef` matches the
current episode + provider) and, on failure, **keeps the selection** and reports
it (`"Kiwi has no stream for this episode — pick another server."`) instead of
advancing. The auto-failover chain still runs for AUTOMATIC selection (first
load, playback-error recovery), so nothing regressed for the default path.

Click test now measures stickiness at 150ms **and** 2.5s:

    obscure — click test: PASS — Kiwi active false → @150ms true → @2.5s true
    popular — click test: PASS — Neko active false → @150ms true → @2.5s true

`src/test/serverPicker.behavior.test.tsx` gained a case asserting no tile is
ever disabled and that clicking a verified-dead tile selects it (82 tests).

---

## Pass 6 — "make success 100%, fail 0%" (failover + capability ordering)

**Request:** make every server succeed, then test 100 anime.
**Honest scope:** a server cannot be made to serve a stream it does not have.
What CAN reach 100% is *user-felt* success — "I pressed play, did the episode
play?" — so that is what was fixed and what was measured.

### Root causes found

1. **The default pick actively preferred the WORST servers.** `PROVIDER_META`
   ranked by *picture quality* (`mimi` priority 2, `yuki` 3) while `loli` —
   the best server measured (92% dub / 80% sub) — had **no entry at all**, so
   it took the unknown default (8) and was tried LAST. `sortProviders` also
   put tip quality ahead of priority, so a 1080p chip that 404s outranked a
   720p chip that plays. Priority now ranks measured capability and
   `sortProviders` puts capability above tip quality (verified health still
   outranks both).
2. **`ALL_DUB_SERVERS` led with `mimi` (8%)** and omitted `loli` entirely, so
   the long tail was handed 5-6 chips that could never work. Rosters
   re-ordered by measured capability; `loli` added. Nothing removed.
3. **A failed pick was a dead END.** `Watch.tsx` kept an explicit pick and
   stopped on an error card waiting for another manual click — correct for the
   "it snaps back to yuki" complaint, wrong for success: a title with one
   working server in a 13-server roster never played unless found by hand.
   Now the pick is honoured FIRST, then the chain fails forward, announced
   ("Kiwi has no stream for this episode — trying Neko…").
4. **The chain only ever tried ONE audio track.** 17 of 78 plays in the bench
   came from the new cross-track last resort (dub exhaustive → sub once).
5. **The attempt ceiling (10) was below the roster size (13)**, so a working
   server at position 11+ was unreachable automatically.
6. **A single pass was treated as the truth.** chad builds the per-episode
   list on the fly and its answers are not repeatable — a transient hiccup is
   indistinguishable from a dead server inside one pass. The exhausted chain
   now refreshes the server list and re-walks ONCE (capped per episode).

### Failover bench — 100 titles, 64.3 min (`scripts-perf/failover_bench.mjs`)

Pool interleaved mainstream / mid-tier / long tail · `pick=1` (the real chip
path) · stops at the FIRST working server, so latency is "time to first play".

    resolved a slug                       100/100
    EPISODE PLAYED                        78/100
      · served on the requested track     61
      · saved by the cross-track fallback 17
    time to first play                    mean 13.32s · p50 4.52s · p90 24.73s
    served by chain position              #1 74 · #1-3 77 · deeper 1
    never played                          22

**74 of 78 plays were served by chain position #1** — the ordering fix means
the first server tried is the one that works. (Mean latency is inflated by
chad 429 backoff inside the bench loop, not by server latency: plays that ran
between rate windows landed at 3.4-4.0s.)

### Uncapped re-probe — are the 22 failures fixable? (`scripts-perf/failover_redo.mjs`)

The chain cap (8/track) left chips 9-13 untried, so "never played" was
ambiguous. Re-probed with NO cap, every listed server on BOTH tracks:

    titles re-probed                      22
    REVIVED by a fresh lookup             2   (both at chain position 1)
    genuinely dead upstream (both tracks) 20
      · chad listed NOTHING (roster-only guess) 20
      · chad DID list servers, all dead          0

**Answer:** 0 of the 20 are a client bug. They are obscure titles where chad
returns no server list at all, so the app falls back to the guessed roster and
all 23 chips (10 dub + 13 sub) are dead upstream. `title success` is therefore
**80%** ceiling on this deliberately obscure pool, **~96%** on the mainstream
stratum (where chad does answer). The 2 revivals prove the mechanism behind the
new one-shot retry: a fresh `/servers` lookup returns a real list and the
capability-ordered chain hits a winner immediately.

### Files touched

- `server/anidap.js` — rosters re-ordered by measured capability, `loli` added;
  no invented tip for it (a fabricated quality claim is the same dishonesty as
  the old "25/25 healthy" read-out).
- `src/lib/providers.ts` — `PROVIDER_META` priorities = measured capability,
  `loli` entry, `sortProviders` key order (capability above tip quality).
- `src/pages/Watch.tsx` — pick honoured then fails forward; cross-track last
  resort (once/episode); chain ceiling covers the full list; one-shot
  list-refresh retry; `aliveByType` sorted verified-first.
- `src/test/providers.ordering.test.ts` — NEW, 9 cases locking the ordering.
- `scripts-perf/failover_bench.mjs`, `failover_redo.mjs` — NEW benches.

### Verified

`tsc --noEmit` clean · `vitest` **91/91** (9 new) · `vite build` 10.28s ·
live roster check `DUB: yuki > neko > loli > sora` (chad's order; the client
re-sorts capability-first) · `screenshots/failover-bench-results.json`,
`screenshots/failover-redo-results.json`.

---

## Pass 7 — Watch load time + fullscreen auto-next

**Request:** "fetching and loading takes around 20 seconds" + "add auto next and
play in the fullscreen version too".

### Measured first (scripts-perf/watch_load_probe.mjs)

The Watch page loads in a STRICT SEQUENCE, so the user's wait is the sum of the
stages. Cold, per stage:

    BEFORE  info (slug) 1.81s · servers 7.04s · first stream 14.56s  = 23.41s
            and only 2 of 4 titles reached playback

Stage 3 dominated and could FAIL after 31.7s. `pick=1` failures additionally ran
the serial gogoanime fallback behind the pool.

### Root causes fixed

1. **megavid blocked the real providers.** The fast path was `await`ed serially
   for up to 5s BEFORE the provider the user asked for was even tried, so every
   cold load paid a flat ~5s tax whenever megavid missed. It is now started
   concurrently and raced against the anidap pool — first genuine stream wins
   (same provider, same budget, same breaker).
2. **The servers route waited out chad's 12s timeout.** Now raced against a 4s
   deadline: if chad loses, the roster is served immediately and chad's real
   answer still fills the cache in the background. Measured 7.04s → 2.31s.
3. **Probe wait was 4s of pure added latency** on that same sequential path.
   Cut to 1.2s (the client no longer needs verdicts to pick well — it orders the
   chain by measured capability, so chain position #1 is already a winner).
4. **REGRESSION I INTRODUCED AND THEN FIXED:** returning from `/servers` without
   waiting left 6 background probes holding the cf-harvester browser mutex ahead
   of the user's own stream request — first-stream extraction went 14.6s → 28.7s.
   Probes are now 3-per-tick at concurrency 1, and a GUESSED roster (`_roster`)
   is not probed at all: probing a guess costs ~12s/server to learn that an
   obscure title has nothing, while the mutex is exactly what playback needs.
   That is what took extraction back to 11.6s AND 4/4 titles playing.

### Result

    stage probe (cold)   info 2.08s · servers 2.31s · first stream 11.63s = 16.02s
                         4 of 4 titles played (was 2 of 4)

    in-app time-to-play (the number the user feels)
      first run after a backend restart   11.22-13.34s, one 41.5s outlier
      second run (warmer)                 5.21-9.33s · mean 7.25s · 4/4 played

The 41.5s outlier did NOT reproduce (8.26s on the next run) and the server log
shows it was not server-side for that title (megavid answered in 408ms) — it was
the very first load after a restart, with slug + TVDB + episode list all cold.

**Still upstream-bound:** the remaining ~5-11s is browser extraction inside
cf-harvester (3-15s per candidate, serialised by its mutex). That is not
client-fixable; it is the cost of scraping a real source.

### Fullscreen auto-next

**Root cause:** `Watch.tsx` swapped the player out for a placeholder whenever
`stream` went null — and `stream` goes null on EVERY episode change. The
fullscreen element lives INSIDE `VideoPlayer`, so unmounting it made the browser
drop fullscreen: auto-next advanced the episode and threw the user out of
fullscreen. A second, related trap: the `autoPlay` attribute only applies when
`<video>` MOUNTS, so simply keeping the player mounted would have loaded the next
episode paused.

Fixes:
- `src/pages/Watch.tsx` — the last good stream is retained (`shownStream`), so
  the player stays mounted across an episode change; a loading overlay covers the
  frozen frame, and a failure is a bottom banner (not a full cover) so the picker
  stays usable. Fullscreen, audio track and controls all survive.
- `src/components/VideoPlayer.tsx` — explicit one-shot auto-play per NEW source
  (`autoPlayedSrcRef` guards it so a seek/quality switch can never override a
  deliberate pause).
- `src/store/useSettings.ts` — `autoplayNext` defaults ON again and the persist
  version is bumped 5 → 7 with a `version < 7` migration so existing installs
  get it too (it was made opt-in in v5; the countdown is visible and cancellable,
  so this is not the silent jumping that complaint was about).

**Verified in the LIVE Electron window** (`fullscreen_autonext_verify.mjs`):

    episode 1 playing (480p) → F → fullscreenElement: DIV
    press N (next episode) while in fullscreen
    source changed YES · playing YES (t=2.29s, 720p, err=null) · FULLSCREEN HELD YES
    → PASS

`screenshots/fs-autonext-1-before-next.png`, `fs-autonext-2-after-next.png`

### Verified green

`tsc --noEmit` clean · `vitest` **91/91** · `vite build` 16.01s · 4/4 titles
played in-app, twice.

### Note

The Electron window died mid-session with
`GPU state invalid after WaitForGetOffsetInRange` (the known GPU/renderer issue
on this machine) and the app is now running with `--disable-gpu`, which is the
same fallback `electron/main.js` uses after repeated renderer crashes.

---

## Pass 8 — found while running the app: settings never persisted

**How it surfaced:** checking the running Electron window after a reload,
`localStorage.getItem('kurodo-settings')` returned the literal string
**`"[object Object]"`**.

### Root cause

`debouncedStorage()` is a **string** storage (`getItem`/`setItem` move plain
strings) and it was passed straight to Zustand's `persist` as `storage:`. But
`persist` wants a `PersistStorage`, whose `setItem` receives the entire
`{ state, version }` OBJECT. localStorage then coerced that object to
`"[object Object]"`. On the next launch `getItem` returned that text,
`JSON.parse` threw, and the store fell back to `DEFAULTS`.

**Impact:** every setting — server preference, volume, theme, quality,
auto-next, caption style, and the 30-odd others — silently reset on **every
launch**. The `migrate()` branches could never run either, because nothing ever
parsed.

### Fix

`src/store/useSettings.ts` — wrap it: `createJSONStorage(() => debouncedStorage(localStorage, 300))`.

### Verified live (scripts-perf/settings_persist_verify.mjs)

    before  rawHead "[object Object]"  validJson false  keys 0
    after   rawHead '{"state":{"audio":"sub","server":"yuki",…  validJson true  version 7  keys 38

Then toggled `autoplayNext` in the real Settings UI and confirmed it round-trips:
`false → true`, persisted. It is now ON, which is the state the owner asked for.

---

## Pass 9 — the "recurring window death": forensics + crash-aware close

The app died repeatedly during this session. Evidence gathered:

- **No** Crashpad report, **no** Windows Application Error event.
- **No** `render-process-gone`, no GPU error, **no** `[memory]` diag line.
- **No** recovery diag line at all — which is the tell.

The main window's `close` handler treats **every** close as a user clicking X:
it sets `quitting = true` and calls `app.quit()`. When a teardown happens on its
own, `close` fires too — so the app quits and every recovery path (`closed`,
`destroyed`, `window-all-closed`) bails out on `quitting`. That is why the death
leaves no trace of any kind.

Also ruled out in the process:
- `window:close` IPC — `preload.cjs` exposes it, but **nothing in the renderer
  ever calls it** (only a type declaration exists).
- The backend dying — it stayed healthy (health 200) through the deaths.
- Memory pressure — the `[memory]` telemetry never fired.

### Change

`electron/main.js`:
- Fault signals are now recorded (`child-process-gone` for GPU/Utility/Network,
  `render-process-gone`, `unresponsive`, `did-fail-load`, renderer `destroyed`).
- The `close` handler consults them: a close within 20s of a fault is a
  **teardown, not a quit** — it `preventDefault()`s, reloads the window (or
  `destroy()`s it so `scheduleMainWindowRecovery` recreates it in-process) and
  keeps the app and its embedded backend alive.
- Faults are written to `startup.log`, so the next occurrence is diagnosable.

**Honest status:** this fixes the GPU-teardown class of death, but the deaths
observed here fired **no fault signal at all**, so this specific change would
not have stopped them — they remain unexplained and are consistent with the
process being terminated externally. The added logging is the point: the next
death will say why.

### Verified green

`tsc --noEmit` clean · `vitest` **91/91** · `vite build` 15.25s · app running on
the latest bundle · settings round-trip confirmed in the live window.

## Player settings menu — anikage parity + real controls (2026-09-16)

Reference: anikage.cc/anime/watch/ARPEGZW3fK?ep=1 gear menu
  root:  Playback speed `1x` ›   Audio boost `0%` ›   Caption styles `Default` ›
         ─────   More ›
  More:  Incognito · Autoplay video · Autonext episode · Skip intro/outro ·
         Skip fillers · Ambient mode

Built
  · PlayerControls: MenuNavRow (32px icon disc · label · value · chevron),
    SubViewHeader (back bar), MenuSwitchRow (role=switch + aria-checked)
  · Root page = exactly the 4 reference rows, then a rule, then Kurodo's own
    existing rows (Quality / Audio / Playback stats / Copy link) — nothing lost
  · Settings store v8: audioBoost, incognito, autoplayVideo moved in next to
    skipFiller (which was a `useState` in Watch.tsx with NO setter — the toggle
    was decorative). Migration carries the legacy `kurodo-skip-filler` flag.
  · VideoPlayer: real Audio boost via a Web Audio GainNode (0–200% → gain
    1.0–3.0). Graph is built lazily and REFUSES to reroute audio while the
    AudioContext is suspended, retiring on the next real gesture — otherwise a
    persisted boost on relaunch would silence playback.
  · Watch.tsx: incognito gates history (setLastWatched), progress
    (setEpisodeProgress/clearEpisodeProgress), watched-marks + AniList sync,
    with a toast announcing it; autoplayVideo gates the <video> autoplay.

Verified live (scripts-perf/player_menu_verify.mjs, Electron window over CDP)
  36/36 checks pass. Headline proofs:
    · gain is exactly 1.5 for a +50% boost  → web audio {ctxs:1, gains:[1.5]}
    · Skip fillers persisted false (was a dead useState) then restored
    · Autoplay video off → reload → {"src":true,"paused":true,"t":0}
    · Incognito on → persisted true, switch aria-checked=true, restored
  Screenshots: player-menu-root / -more / -more-incognito-on /
               -more-autoplay-off / -boost-50 / -captions (.png)

Tests: settings.store.test.ts (+7) — defaults, setters, real-JSON persistence
  (guards the "[object Object]" regression), version 8, v6 → v8 legacy flag
  carry-over, and that a v7 state is not re-migrated.
Green: tsc clean · vitest 98/98 · build 11.01s
