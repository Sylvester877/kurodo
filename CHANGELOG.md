# Changelog

All notable Kurōdo releases are tracked here.

## [0.3.40] - 2026-09-19

### Official title logos everywhere
- **TVDB clearlogos** now resolve for the hero, details page, and watch page via the new `/api/tvdb-art` pipeline (AniList/MAL → TVDB mapping, 24h memory + 30d disk cache, served through the 1-year-immutable `/img` proxy).
- New **AnimeLogo** component: instant text wordmark underlay, transparent logo pops in over it (spring, blur-to-sharp), fixed boxes = zero layout shift, silent 10-min retry when art appears later.
- Wired into **Home hero**, **Anime details**, and the **Watch title bar** — one shared persisted cache chain across all three.

### Fullscreen right-edge gap — fixed for real
- Root cause 1: the Electron window never actually went OS-fullscreen; it now does (and restores perfectly).
- Root cause 2: the app's themed scrollbar + reserved gutter stayed painted above the fullscreen element — an 8px (10 physical px) reddish-brown strip on the right. The root scrollbar is now suppressed while any fullscreen is active.
- Player internals rebuilt for fullscreen: no more double-zoom (oversize% + scale + offsets), crop-zoom only for genuinely symmetric baked bars, webkit fullscreen events handled, rapid F toggling self-heals.

### New "Original" video fit
- Fourth fit mode alongside Contain / Cover / Fill: plays the stream at its **native pixel size** (1:1), never upscales, no auto-crop — selectable in the player gear menu and Settings.

### Motion + speed (reference-site parity pass)
- Hero crossfade tightened to 8s with an animated progress dot, "Featured this week" eyebrow, staggered meta pills, Ken Burns backdrop, magnetic CTAs.
- Hover card (qtip) reacts 2x faster (180ms in / 80ms out, stiffer springs) and prefetches details on hover.
- New motion-token stylesheet (`styles/motion.css`) — spring/out-expo/hover easings, transform+opacity only, fully disabled under reduced-motion / reduce-quality.
- `/img` responses are now `max-age=31536000, immutable`; catalog/art queries keep longer stale windows; trending + schedule prefetched at idle boot.
- Health endpoint now reports `tmdbOk` / `tvdbOk` / `wsrvOk` gates (visible in Settings → Diagnostics).

**Install:** download `Kurodo-Setup-0.3.40.exe` and run it. Existing installs auto-update.

---

## [0.3.38] - 2026-09-07

### Outage-proof catalog — the app no longer dies when the big APIs do
AniList's API went into its documented site-wide outage state (403 on every query) and Jikan was down at the same time. Kurodo now survives that exact condition instead of showing empty/error rows:
- **Home feed** (Trending / Popular This Season / Most Favorite / Coming Soon) falls back to a new **Kitsu relay** (`/api/kitsu-feed`) that serves real MAL-id'd cards — verified end-to-end with zero error rows during the live outage.
- **Schedule** no longer lies with "No episodes scheduled" on fetch failure — honest outage state + Retry, and fresh air-times still render through the cache layer while the API is down.
- **Seasons page** falls back to Kitsu per-season data (real cards, e.g. Frieren S2 for Winter 2026) with an honest outage card otherwise.
- **Browse** gains a Kitsu stage in the `/api/jikan/*` proxy chain (Top Rated / Popular / Upcoming / This Season) + fixes a latent bug where Kitsu's 20-item page cap 400'd 24–30 item requests. A–Z / genre views show an honest "Couldn't load results" + Retry instead of "No anime found".
- **Manga details** survive metadata outages: saved manga-list entries supply title/cover fallbacks so chapters still load; genuine failures show "Couldn't load this manga" + Retry instead of "No chapters found".

### Auto-next, surfaced
- Episode end now reliably advances when auto-next is on (even if a seek/jump skipped the 90% countdown).
- When auto-next is off, an **"Up Next EP n" card** appears at the end with one-click Play-next and an "Always auto-play next episode" enable.

### TMDB logo art fix
- Stale null logo/backdrop lookups are no longer persisted as "fresh" for 24h — hero and detail art re-resolve in 30–60 min, so brand-new shows (e.g. BLACK TORCH) get their real clear-logo the same day it appears on TMDB.

**Install:** download `Kurodo-Setup-0.3.38.exe` and run it. Existing installs auto-update.

## [0.3.37] - 2026-09-05

### Player controls
- Added a 1.2-second cursor grace period around the video edge so controls do not flicker off when moving across the player gap.
- Controls remain visible while the cursor is over the control bar.
- Controls remain visible while paused or while playback menus are open.

### Watch layout
- Narrowed the watch sidebar on 16:10 laptop layouts to give more width back to the video player.

### Episode experience
- Redesigned episode rows with thumbnail-first layout, episode badges, synopsis, CC indicator, score, and air date.
- Added range selection and filtering to the episode list.
- Removed distracting episode-row hover zoom.

### Fullscreen and crop handling
- Fixed fullscreen video-fit behavior so automatic bar detection does not crop the picture incorrectly.
- Improved crop-boundary stability to reduce false detections during anime fades.

See the full release notes on the [v0.3.37 release](https://github.com/Sylvester877/kurodo/releases/tag/v0.3.37).

---

Older release history is available from [GitHub Releases](https://github.com/Sylvester877/kurodo/releases).
