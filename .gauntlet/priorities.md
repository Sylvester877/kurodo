# PRIORITIES (live top-10)

Ranked by (canon weight × visible impact ÷ risk). Recon shows ~90% parity —
remaining work is gap-filling, not reskinning.

1. [HIGH] Ghost-numeral Trending rail on Home (SITE-02 steal; rank
   numerals behind offset cards in the Trending feed row).
2. [HIGH] Browse A–Z letter index mode — BACKLOGGED while Jikan is
   flaky (needs a full-title datasource); revisit when Jikan healthy.
3. [BONUS] Reuse cast data in AnimeHoverCard (tiny character strip).
4. [SEV-4→BUG] fonts.googleapis.com stylesheet refused
   (ERR_BLOCKED_BY_CLIENT) on some loads — confirm fonts still render
   via FontFace; if so, benign duplicate, remove the <link>.
5. [PARITY] Schedule: today is auto-highlighted + countdown strip exists;
   consider Miruro-style per-episode "estimated release" microcopy.
6. [BUG-HUNT] Re-run scripts-perf/error_sweep2.mjs now that image layer
   proxies everything (may surface new 4xx/5xx shapes worth handling).
7. [PERF] Verify cold Browse first-paint with disk-cached covers (Jikan
   needs to be up to measure end-to-end).
8. [a11y] Audit focus rings on the new CharactersRow scroll region.
9. [MAINT] .gauntlet/recon.mjs kept as the reusable feature-matrix audit.
10. [WATCH] Fullscreen baked-bar zoom (194ec09) — confirm on a real
    letterboxed movie once user play-tests.
