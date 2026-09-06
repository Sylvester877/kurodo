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
