# Kurōdo Improvement Plan

> A living document that tracks known pain points, planned fixes, and new
> features for the Kurōdo anime streaming Electron app.
>
> **How to use this file:** Update the `Status` column as work is completed.
> Open a new phase only when the previous high-priority items are stable.
>
> **Note:** This plan is for the **packaged Electron app** unless stated
> otherwise. Web-only fixes should be marked explicitly.

---

## Table of Contents

1. [Current Status](#current-status)
2. [Phase 1: Stability & Crash Fixes](#phase-1-stability--crash-fixes)
   - 1.1 [Eliminate black screens on navigation](#11-eliminate-black-screens-on-navigation)
   - 1.2 [Fix remaining MangaReader infinite loops](#12-fix-remaining-mangareader-infinite-loops)
   - 1.3 [Harden stream extraction reliability](#13-harden-stream-extraction-reliability)
   - 1.4 [Fix search and anime details failures](#14-fix-search-and-anime-details-failures)
   - 1.5 [Fix AniList sign-in/auth flow](#15-fix-anilist-sign-inauth-flow)
3. [Phase 2: Performance & UX](#phase-2-performance--ux)
   - 2.1 [Reduce stream extraction time](#21-reduce-stream-extraction-time)
   - 2.2 [Restore Lenis smooth scroll and add scroll-driven animations](#22-restore-lenis-smooth-scroll-and-add-scroll-driven-animations)
   - 2.3 [Improve Electron startup and packaging](#23-improve-electron-startup-and-packaging)
   - 2.4 [Show filler-episode badges](#24-show-filler-episode-badges)
4. [Phase 3: Features & Polish](#phase-3-features--polish)
   - 3.1 [AniList sync improvements](#31-anilist-sync-improvements)
   - 3.2 [Intro/outro skip](#32-introoutro-skip)
   - 3.3 [Theme and transitions](#33-theme-and-transitions)
5. [How to update this plan](#how-to-update-this-plan)

---

## Current Status

| Phase | Theme | Status |
|-------|-------|--------|
| Phase 1 | Stability & Crash Fixes | 🔄 In progress |
| Phase 2 | Performance & UX | ✅ Done |
| Phase 3 | Features & Polish | 🔄 In progress |

### Recently completed

- ✅ Strengthened global `ErrorBoundary` with broader stale-chunk detection,
  `app:clearCache` IPC bridge, and hard-reload fallback.
- ✅ Extracted `lazyWithRetry` to a shared module so the `VideoPlayer` chunk
  also recovers from stale chunks/hard reload.
- ✅ Deferred synchronous `hls.destroy()` in `VideoPlayer` to prevent the main
  thread from blocking during route transitions.
- ✅ Simplified the `Watch` page title/logo `AnimatePresence` swap to a plain
  conditional render, removing a possible exit-animation hang point.

---

## Phase 1: Stability & Crash Fixes

### 1.1 Eliminate black screens on navigation

**Problem:** The screen turns black when entering the Watch page, clicking
*Play Now*, or navigating away from Watch.

**Root causes addressed so far:**
- `VideoPlayer` was imported with a custom lazy retry that did not handle
  stale Vite chunks.
- `hls.destroy()` was called synchronously on the main thread, blocking the
  route transition.
- The TMDB logo/title swap used `AnimatePresence mode="wait"`, which could
  leave the route in an intermediate exit state.

**Files:**
- `src/lib/lazyWithRetry.ts`
- `src/App.tsx`
- `src/pages/Watch.tsx`
- `src/components/VideoPlayer.tsx`

**Status:** ✅ Done

**Validation:**
- [x] `npx tsc --noEmit` passes
- [ ] In the packaged Electron app, navigate Home → AnimeDetails → Watch → back 5 times with no black screen
- [ ] In the packaged Electron app, click Play Now and confirm the player loads without a black screen

---

### 1.2 Fix remaining MangaReader infinite loops

**Problem:** `MangaReader` can hit React error #185 (Maximum update depth
exceeded) when navigating to `/manga/read/:chapterId`.

**Approach:**
- Ensure all Zustand selectors use `useShallow` / atomic selectors.
- Bail out of `setChapterProgress` when nothing changed.
- Audit any other store subscriptions in `MangaReader.tsx` that could
  re-trigger a render loop.

**Files:**
- `src/pages/MangaReader.tsx`
- `src/store/useMangaListStore.ts`
- `src/components/SyncConfirmDialog.tsx`

**Status:** 🔄 In progress

*Note: core fixes are in place; needs verification in the packaged app.*

**Validation:**
- [ ] In the packaged Electron app, navigate to a manga reader page and confirm no crash
- [ ] Leave and re-enter the same manga reader page 3 times without React error #185

---

### 1.3 Harden stream extraction reliability

**Problem:** Anidap providers (yuki, gojo, etc.) sometimes return 404/429/timeouts;
one failing provider can take down the whole selection.

**Approach:**
- Add per-provider circuit breakers in `server/providers/router.js`.
- Cache successful stream sources server-side with TTL.
- Add proxy rotation for gogoanime to mitigate Cloudflare `ERR_ABORTED`.
- Add per-provider rate-limit backoff and key rotation for anidap.

**Files:**
- `server/providers/router.js`
- `server/providers/anidap.js`
- `server/cf-harvester.js`
- `server/providers/gogoanime.js`

**Status:** 🔄 In progress

*Note: proxy rotation and rate-limit backoff are partly in place; circuit
breakers and server-side stream caching are still pending.*

**Validation:**
- [ ] In the packaged Electron app, test all 12 servers (6 sub + 6 dub) for a known title
- [ ] Confirm a single 429 on one provider does not fail all other providers

---

### 1.4 Fix search and anime details failures

**Problem:** Search page goes blank; AnimeDetails can hang for minutes and show
"anime not found" when Jikan is slow/down.

**Approach:**
- Wrap Jikan and upstream API calls with fail-fast timeouts and fallbacks.
- Add a global React ErrorBoundary in `App.tsx`.
- Ensure `Search.tsx` handles empty/undefined result pages gracefully.

**Files:**
- `src/pages/Search.tsx`
- `src/pages/AnimeDetails.tsx`
- `src/api/anime.ts`
- `src/App.tsx`

**Status:** 🔄 In progress

*Note: the global ErrorBoundary and fail-fast timeouts are in place; Search
page hardening and Jikan fallback logic are still pending.*

**Validation:**
- [ ] Search for an anime while Jikan is throttled/simulated slow
- [ ] Click into AnimeDetails and confirm it loads within 10 s in the packaged Electron app

---

### 1.5 Fix AniList sign-in/auth flow

> **Scope note:** this item covers the *foundational* sign-in and token
> persistence. Once auth is reliable, progress sync is tracked in 3.1.

**Problem:** AniList sign-in is broken or unreliable; tokens are not persisted
securely, and the auth callback can fail.

**Approach:**
- Audit `anilistAuth.ts` for the exact failure mode (redirect, token exchange,
  refresh).
- Persist tokens in Electron's secure storage or localStorage with clear expiry
  handling.
- Handle the auth callback gracefully in both web and Electron contexts.

**Files:**
- `src/api/anilistAuth.ts`
- `src/pages/AuthCallback.tsx`
- `electron/main.js`
- `electron/preload.cjs`

**Status:** ⏳ Not started

**Validation:**
- [ ] Sign in with AniList in the packaged Electron app
- [ ] Restart the app and confirm the user is still authenticated
- [ ] Verify sync to AniList works after marking an episode watched

---

## Phase 2: Performance & UX

### 2.1 Reduce stream extraction time

**Problem:** Yuki/gojo providers can take 20–60 s to extract a stream.

**Approach:**
- Profile `server/lib/cf-harvester/*.js` and reduce direct-video timeout / iframe
  poll counts.
- Race multiple fast providers in parallel.
- Cache decrypted stream URLs server-side for the lifetime of the ephemeral
  anidap key.

**Files:**
- `server/lib/cf-harvester/puppeteer.js`
- `server/lib/cf-harvester/electron.js`
- `server/providers/router.js`

**Status:** ⏳ Not started

**Validation:**
- [ ] In the packaged Electron app, measure cold extraction time for yuki, gojo, koto, and uwu on the same episode
- [ ] Target <10 s worst case from clicking a server to the stream starting

---

### 2.2 Restore Lenis smooth scroll and add scroll-driven animations

**Problem:** Lenis smooth scrolling was removed during earlier black-screen
mitigation; the Home page feels flat.

**Approach:**
- Re-integrate Lenis in `src/components/Layout.tsx` with proper cleanup.
- Add parallax cards, fade-in on scroll, and subtle scale effects on the Home
  page using Lenis + Framer Motion.
- Gate heavy canvas/gradient effects behind `reduceQuality`.

**Files:**
- `src/components/Layout.tsx`
- `src/pages/Home.tsx`
- `src/components/AnimeCard.tsx`
- `src/components/FeaturedSlider.tsx`

**Status:** ⏳ Not started

**Validation:**
- [ ] In the packaged Electron app, scroll through the Home page and confirm it stays at 60 fps
- [ ] Enable `reduceQuality` and confirm no black screen or jank on low-end/iGPU devices

---

### 2.3 Improve Electron startup and packaging

**Problem:** Packaged app startup can be slow or fail silently; the splash
screen gives no progress feedback.

**Approach:**
- Reduce or make the `waitForServer` health-check timeout configurable.
- Add a startup log/retry window so users see progress.
- Ensure packaged app binds to the correct port (5173) and that health
  checks hit that port.

**Files:**
- `electron/main.js`
- `ecosystem.config.cjs`
- `package.json`

**Status:** ⏳ Not started

**Validation:**
- [ ] Build Windows installer from `npm run electron:build:win`
- [ ] Time from double-clicking the packaged .exe to the Home page rendering
- [ ] Verify port 5173 is used consistently in packaged build

---

### 2.4 Show filler-episode badges

**Problem:** Users cannot easily identify filler episodes in long-running
series (e.g. Naruto Shippuden).

**Approach:**
- Use the existing `getFillerInfo`/`isFiller` utilities to determine filler
  episodes.
- Display a "Filler" badge in the episode list and/or on the episode button.
- Optionally allow users to skip filler episodes automatically when
  autoplaying.

**Files:**
- `src/pages/Watch.tsx`
- `src/components/EpisodeRangePicker.tsx`
- `src/api/filler.ts`

**Status:** ⏳ Not started

**Validation:**
- [ ] In the packaged Electron app, open Naruto Shippuden and confirm filler episodes (e.g. ep 26–97) show a badge
- [ ] Confirm the badge does not appear on canon episodes

---

## Phase 3: Features & Polish

### 3.1 AniList sync improvements

> **Scope note:** this item builds on a working auth flow from 1.5. It covers
> progress sync, auto-sync toggles, and token refresh.

**Problem:** AniList progress sync is unreliable or does not happen after
 every episode.

**Approach:**
- Auto-sync progress after every episode ends (already wired via `markEpisodeWatched` → `syncProgress`).
- Add a settings toggle for auto-sync.
- Improve AniList auth flow to automatically grab client id/secret and
  persist tokens securely.

**Files:**
- `src/store/useWatchListStore.ts`
- `src/lib/sync.ts`
- `src/store/useSettings.ts`
- `src/pages/Settings.tsx`
- `src/api/anilistAuth.ts`
- `src/components/AccountMenu.tsx`

**Status:** 🔄 In progress

*Note: auto-sync toggle added. Auth auto-grab still pending.*

**Validation:**
- [ ] In the packaged Electron app, watch an episode to completion and confirm AniList updates within 10 s
- [ ] Disable the auto-sync toggle and confirm it is respected on the next episode

---

### 3.2 Intro/outro skip

**Problem:** Auto-next exists but does not skip intro/outro segments.

**Approach:**
- Integrate AniSkip data into `VideoPlayer.tsx` with Netflix-style skip
  buttons.
- Auto-skip when enabled, prompt when disabled.

**Files:**
- `src/components/VideoPlayer.tsx`
- `src/api/aniskip.ts`
- `src/store/useSettings.ts`

**Status:** ⏳ Not started

**Validation:**
- [ ] In the packaged Electron app, play an episode with known skip times (e.g. Naruto Shippuden ep 1)
- [ ] Confirm the intro skip button appears within 5 s and jumps past the intro

---

### 3.3 Theme and transitions

**Problem:** Theme switches can flash black; global transitions are missing.

**Approach:**
- Add a global CSS `background-color` transition on `body`.
- Add smooth page-level transitions without blocking navigation.
- Audit and remove any remaining full-screen black overlays.

**Files:**
- `src/index.css`
- `src/App.tsx`
- `src/components/Layout.tsx`
- `src/pages/Home.tsx`

**Status:** ✅ Done

*Note: body background transition already existed. Added safe `.page-enter`
entrance-only utility in `index.css` (respects `reduceMotion`/`prefers-reduced-motion`).
Applied it to `Home.tsx` for a subtle fade-in. Avoided a global keyed wrapper
in `Layout.tsx` because it forces full page remounts and can re-trigger
Suspense/black screens; individual pages can opt-in with `.page-enter`
without risk. Audit found no accidental full-screen black overlays beyond
the intentional Watch hero background and localized player loading/error states.*

**Validation:**
- [x] `npx tsc --noEmit` passes
- [ ] In the packaged Electron app, toggle theme and confirm no flash or black screen
- [ ] Navigate Home → AnimeDetails → Watch → Search → Home and confirm no black screen

---

## How to update this plan

1. When you start an item, change its status to **In progress**.
2. When an item is done, change its status to **Done** and add the PR or
   commit reference.
3. If an item is blocked, add a note under it explaining why.
4. New bugs/features should be added to the appropriate phase with status
   **Not started**.
