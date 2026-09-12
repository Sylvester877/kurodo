# PRIORITIES (live top-10) — refreshed 2026-09-11 post-A–Z pooling (98f557a)

Ranked by (canon weight × visible impact ÷ risk). Recon 30/30 green; parity ≥85% average.

1. [DONE] Ghost-numeral Trending rail (18 numerals verified live).
2. [DONE] Browse A–Z + genre now have Kitsu fallbacks (kitsu-feed.js, dual-outage verified).
3. [DONE] AnimeHoverCard cast strip (cachedCast mini-strip wired to cached characters query).
4. [DONE] Dead /music footer link → 404 (SEV-2) — rerouted to /seasonal (Footer.tsx 2026-09-11 a8448b4).
5. [DONE] Schedule Miruro microcopy — 'est.' per-episode tooltip added to countdown (Schedule.tsx 2026-09-11 d0807e2).
6. [DONE] Bug-hunt re-sweep: /img (kitsu + mangadex) prove 200, dead 404s → SVG placeholder, AniList 403 honest (2026-09-11).
7. [DONE] Browse perf bench — DCL <0.3s all pages; cold /img 0.74–3.6s → warm 0.01s (disk cache); cold thumbs/episodes one-time cost, cached instant. Logged in state.json fetchBench.
8. [DONE] CharactersRow a11y: scroller now keyboard-focusable (tabIndex=0, role=region, aria-label) + visible focus ring (CharactersRow.tsx 2026-09-11 2026b1b).
9. [DONE] .gauntlet/recon.mjs — sticky-header regex fixed (backdrop-blur), 30/30 green (2026-09-11 d0807e2).
10. [DONE] Fullscreen baked-bar zoom — VideoPlayer smart-aspect + crop-detect + cover-scale audited live; manual fill/cover overrides verified (VideoPlayer.tsx 2026-09-11 d0807e2).

— Also DONE (post-10/10 sweep) —
11. [DONE] Kitsu A–Z deep pagination — letterPool:<L> warm cache + 200-pool slicing fixes scroll past 24 (Browse A–Z page 2+ now real titles, has_next_page honest) — server/kitsu-feed.js 98f557a.

Dropped: fonts.googleapis.com duplicate <link> — FIXED (1a28f23).
Next tier TBD: rerun recon after 98f557a + open frame-vs-padding watch pass (baked-bar truth vs UI gap) on next play-test.
