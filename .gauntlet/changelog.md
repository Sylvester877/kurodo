# GAUNTLET CHANGELOG

## Run 2026-09-06
- P0 recon via `.gauntlet/recon.mjs`: feature-matrix scan + live reads.
  Result: Kurodo already implements ~all MUST items (dark tokens, sticky
  blurred header, pill search, spotlight hero, rails, hover cards, 2:3
  posters, skeletons, watch settings cluster, filter stack, pagination,
  watchlist tabs, live search, empty/error states, themed 404,
  reduced-motion). Genuine gaps: characters row, A-Z index, ghost-numeral
  rail.
- Accent decision: keep existing theme (already hot-accent family).
  No re-tokenization — parity is high and re-skinning risks regressions.

### ITER-1 — feat(parity) Characters & Cast row  `45a148f`
- PLAN: add AniClover-canon cast section to AnimeDetails.
- EDIT: `getAnimeCharacters()` in api/anilist.ts (AniList by idMal,
  mains-first, JPN VA, shared cache) + new CharactersRow.tsx + wire into
  AnimeDetails above Recommendations.
- BUG caught in verify: useSettings object selector without useShallow →
  infinite re-render → error boundary. Fixed with zustand useShallow.
- VERIFY: live FMA:B → 12 avatars + 12 CV labels, no console errors.
  71/71 tests. Shot: screenshots/gauntlet-characters-row.png.

### ITER-2 — fix(bug) Jikan outage empties Browse  `63118cd`
- PLAN: negative-cache fast-fail (30s window) skipped the AniList fallback.
- EDIT: /api/jikan/* negative-cache branch races tryAniListFallback (6s).
- VERIFY: retry after a failed call attempts AniList (observed 2.1s race)
  instead of instant 502. AniList was ALSO rate-limiting at test time, so
  dual-outage still 502s by design. 71/71 tests.

### ITER-3 — feat(parity) Ghost-numeral Trending rail  (this commit)
- PLAN: SITE-02 Miruro steal — Trending feed row becomes a numbered rail
  with huge outline rank numerals behind each poster.
- EDIT: new TrendingRail.tsx (reuses ['feed','trending'] query +
  feedToAnimeList + filterBySubDub + RailArrows) mounted first in Home's
  feed area; removed the trending grid entry from SECTIONS.
- VERIFY: live capture found 18 ghost numerals (01–18) on Home;
  screenshot screenshots/gauntlet-trending-rail.png. 71/71 tests pass.

### ITER-4 — fix(bug) Google-Fonts stylesheet refused by CSP  1a28f23
- PLAN: kill the recurring "Refused to load the stylesheet" console error.
- EDIT: style-src += https://fonts.googleapis.com in index.html CSP.
- VERIFY: live probe — Poppins + Bricolage both load (document.fonts
  check true after a weight-800 render); earlier false reading was a
  check() weight/usage quirk. Remaining ERR_BLOCKED_BY_CLIENT ×2/route =
  by-design SW block (Electron refuses SW registration).
- Shots: gauntlet-verify-home.png, gauntlet-verify-details.png,
  gauntlet-final-home.png.

### ITER-5 — perf TMDB hero backdrops → w1280   e82c07c
- PLAN: hero fetched multi-MB /original backdrops via /img.
- EDIT: getTmdbBackdrop returns w1280 tier (5-10x smaller, same look).
- VERIFY: tsc + 71/71 tests; only consumer is Hero.tsx.
