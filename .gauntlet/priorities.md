# PRIORITIES (live top-10) — refreshed 2026-09-11

Ranked by (canon weight × visible impact ÷ risk). Recon shows ~90% parity —
remaining work is gap-filling, not reskinning.

1. [DONE] Ghost-numeral Trending rail (18 numerals verified live).
2. [DONE] Browse A–Z + genre now have Kitsu fallbacks (kitsu-feed.js, dual-outage verified).
3. [DONE] AnimeHoverCard cast strip (cachedCast mini-strip wired to cached characters query).
4. [DONE] Dead /music footer link → 404 (SEV-2) — rerouted to /seasonal (Footer.tsx 2026-09-11).
5. [PARITY] Schedule: today is auto-highlighted + countdown strip exists;
   consider Miruro-style per-episode "estimated release" microcopy.
6. [DONE] Bug-hunt re-sweep: image-proxy paths (/img kitsu + mangadex) prove 200, dead 404s return SVG placeholder, AniList 403 still honest error (verified live 2026-09-11).
7. [PERF] Verify cold Browse first-paint with disk-cached covers (needs Jikan healthy to measure).
8. [DONE] CharactersRow a11y: scroller now keyboard-focusable (tabIndex=0, role=region, aria-label) + visible focus ring (CharactersRow.tsx 2026-09-11).
9. [MAINT] .gauntlet/recon.mjs kept as the reusable feature-matrix audit.
10. [WATCH] Fullscreen baked-bar zoom (194ec09) — confirm on a real letterboxed movie once user play-tests.

Dropped: fonts.googleapis.com duplicate <link> item — verified FIXED (1a28f23); no longer actionable.
