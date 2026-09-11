# PRIORITIES (live top-10) — refreshed 2026-09-11

Ranked by (canon weight × visible impact ÷ risk). Recon shows ~90% parity —
remaining work is gap-filling, not reskinning.

1. [DONE] Ghost-numeral Trending rail (18 numerals verified live).
2. [DONE] Browse A–Z + genre now have Kitsu fallbacks (kitsu-feed.js, dual-outage verified).
3. [DONE] AnimeHoverCard cast strip (cachedCast mini-strip wired to cached characters query).
4. [DONE] Dead /music footer link → 404 (SEV-2) — rerouted to /seasonal (Footer.tsx 2026-09-11).
5. [PARITY] Schedule: today is auto-highlighted + countdown strip exists;
   consider Miruro-style per-episode "estimated release" microcopy.
6. [BUG-HUNT] Re-run scripts-perf/error_sweep2.mjs now that image layer
   proxies everything (may surface new 4xx/5xx shapes worth handling).
7. [PERF] Verify cold Browse first-paint with disk-cached covers (needs Jikan healthy to measure).
8. [a11y] Audit focus rings on the new CharactersRow scroll region.
9. [MAINT] .gauntlet/recon.mjs kept as the reusable feature-matrix audit.
10. [WATCH] Fullscreen baked-bar zoom (194ec09) — confirm on a real letterboxed movie once user play-tests.

Dropped: fonts.googleapis.com duplicate <link> item — verified FIXED (1a28f23); no longer actionable.
