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
