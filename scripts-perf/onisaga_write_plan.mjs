// Write a concise plan file after inspecting the reference
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const plan = `# Onisaga Home — rebuild plan (measured from onisaga-home-2026-09-12-22_52_07.png 1920×4921)

## Reference DNA (from sampled metrics)
- Page bg: #262626-ish (38,38,38) — your current Home before is #080808, way darker. Onisaga is a warm charcoal, not OLED black.
- Header: ~60px, light grey (#3e3e3e at 63,63,63) — your navbar is translucent black pill. Onisaga header is a solid light strip that separates from the dark page. It carries nav links + search.
- Hero: ~420-450px tall (y80 → y520), full-bleed banner with left-side text overlay (bright yellows at left, banner art center). Your hero is 82vh cinematic with strong vignette — Onisaga hero is shorter, banner-first, with tighter text. After hero there is a thin dark separator before rails begin (~y520-560 uniform 23-25 luma).
- Rails: card rows on the same #262626 bg (no card-to-card bg shift). Your app interleaves grain/parallax and white/[0.02] rail bgs — Onisaga is flat, dense. Rail headers sit at y~540+ with left accent + "View all" on right (your SectionHeader already matches this shape — good).
- Cards: in rail scan at y=700, gaps clearly visible — Onisaga poster gap ~12-16px (dark gutter). Your AnimeCard gap is gap-x-3 (12px) — already close. Posters are rounded ~12px. Accent pill (warm 143,75,53 delta 90 at y1050) shows orange/red tag — similar to your HOT pill.
- Overall feel: dense, flat, warm-charcoal, light header floating over dark rails, compact hero — not the taller cinematic hero you have.

## What to build
1) Home page background → #262626 flat (override page bg locally, keep app dark elsewhere).
2) Hero height clamp: 82vh → ~46vh / clamp 380-520px for Onisaga proportion; soften vignette so banner reads lighter.
3) Header: keep your existing translucent pill (it's better UX), but tighten Home's top padding so hero sits directly under it like Onisaga.
4) Rail density: keep current rails, just tighten mx-3/4 → mx-4 and gap-y-5 to compress slightly like Onisaga's tighter rows.
5) FeaturedPicks card: shorten height clamp 210-264 → 200-240 to match the compact hero below it.
6) Ensure SubDubToggle + GenreTiles sit in the same charcoal zone with no light gaps.

## Files to touch
- src/pages/Home.tsx (page bg wrapper, hero clamp override slot, density tweaks)
- src/components/Hero.tsx (height + vignette softening, Onisaga-height variant when on Home)
- src/index.css or theme tokens if needed for the #262626 override (keep scoped to Home)

## Non-goals
- Do not restyle the global header to solid light grey (hurts the rest of the app) — just align Home spacing.
- Do not change card component internals (AnimeCard is already close).
`
fs.writeFileSync(path.join(ROOT, 'screenshots', 'onisaga-home-plan.md'), plan)
console.log('wrote screenshots/onisaga-home-plan.md')
