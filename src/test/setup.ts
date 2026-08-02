/**
 * Vitest setup — runs once before any test.
 *
 * Why the `import '../index.css'` matters: this file pulls the entire
 * design system stylesheet through the Vite/Tailwind transform pipeline.
 * If anyone introduces a malformed block (e.g. a properties-only orphan
 * left over from a partial str_replace), the @tailwindcss/vite plugin
 * throws "Missing opening {" at transform time, and the test suite
 * fails before the broken CSS ever reaches the dev server.
 *
 * It's a one-line guardrail that turned a 4-hour debugging session
 * into a 4-second CI failure.
 *
 * Why the vi.mock calls live HERE (not in a side-effect-imported
 * `mocks.ts`): Vitest's babel plugin only hoists `vi.mock` to the top
 * of TEST files. Mocks registered from a non-test file (even when
 * imported at the top of a test) run too late — the modules they mock
 * have already been loaded. setupFiles ARE transformed, so registering
 * mocks here applies them globally before any test file runs.
 */
import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import '../index.css'

// ── Polyfills for jsdom gaps ─────────────────────────────────────────────
// jsdom doesn't implement matchMedia, ResizeObserver, scrollIntoView.
// Each is used by some component under test; stub them out.
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  window.HTMLElement.prototype.scrollTo = function () {}
  if (!window.HTMLElement.prototype.scrollIntoView) {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    window.HTMLElement.prototype.scrollIntoView = function () {}
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
}

// ── Global API mocks ────────────────────────────────────────────────────
const noop = () => undefined
const noopAsync = async () => null

// anilist.ts
vi.mock('../api/anilist', () => ({
  default: vi.fn(noop),
  getAniListIdFromMal: vi.fn().mockResolvedValue(null),
  fetchMediaCounts: vi.fn().mockResolvedValue(null),
  getEpisodeInfoFromMal: vi.fn().mockResolvedValue({
    anilistId: null,
    totalEpisodes: 12,
    airedThrough: 12,
    nextAiring: null,
    accentColor: '#7c3aed',
    bannerImage: null,
    coverImageLarge: null,
  }),
  getAiringSchedule: vi.fn().mockResolvedValue({ items: [], hasNextPage: false }),
  getTrending: vi.fn().mockResolvedValue([]),
  getThisSeason: vi.fn().mockResolvedValue([]),
  getPopularAiring: vi.fn().mockResolvedValue([]),
  getUpcoming: vi.fn().mockResolvedValue([]),
  getAllTimeTop: vi.fn().mockResolvedValue([]),
  getRecentEpisodes: vi.fn().mockResolvedValue([]),
  getAniListMedia: vi.fn().mockResolvedValue(null),
  getSeasonal: vi.fn().mockResolvedValue([]),
}))

// anilistAuth.ts
vi.mock('../api/anilistAuth', () => ({
  default: vi.fn(noop),
  CLIENT_ID: undefined,
  getClientId: vi.fn().mockReturnValue(undefined),
  setClientId: vi.fn(noop),
  getClientSecret: vi.fn().mockReturnValue(undefined),
  setClientSecret: vi.fn(noop),
  hasClientSecret: vi.fn().mockReturnValue(false),
  getLoginUrl: vi.fn().mockReturnValue(null),
  getRedirectUri: vi.fn().mockReturnValue('http://localhost/auth/callback'),
  parseCodeFromQuery: vi.fn().mockReturnValue(null),
  parseTokenFromHash: vi.fn().mockReturnValue(null),
  exchangeCodeForToken: vi.fn(noopAsync),
  AniListExchangeError: class extends Error {},
  loadAuth: vi.fn().mockReturnValue(null),
  saveAuth: vi.fn(noop),
  clearAuth: vi.fn(noop),
  fetchCurrentUser: vi.fn().mockResolvedValue(null),
  fetchUserList: vi.fn().mockResolvedValue([]),
  saveListEntry: vi.fn().mockResolvedValue(0),
  deleteListEntry: vi.fn().mockResolvedValue(false),
  postTextActivity: vi.fn().mockResolvedValue(0),
  fetchRelations: vi.fn().mockResolvedValue([]),
  fetchMyActivity: vi.fn().mockResolvedValue({ items: [], hasNextPage: false }),
  deleteActivityById: vi.fn().mockResolvedValue(false),
}))

// anizip.ts
vi.mock('../api/anizip', () => ({
  default: vi.fn(noop),
  getAniZipMappings: vi.fn().mockResolvedValue({ episodes: {} }),
  getAniZipEpisode: vi.fn().mockResolvedValue(null),
}))


// aniskip.ts
vi.mock('../api/aniskip', () => ({
  default: vi.fn(noop),
  getSkipTimes: vi.fn().mockResolvedValue({ found: false, results: [] }),
}))

// anime.ts (Jikan)
vi.mock('../api/anime', () => ({
  default: vi.fn(noop),
  getTopAnime: vi.fn().mockResolvedValue({ data: [], pagination: { last_visible_page: 1, has_next_page: false, items: { count: 0, total: 0, per_page: 24 }, current_page: 1 } }),
  getSeasonalAnime: vi.fn().mockResolvedValue({ data: [], pagination: { last_visible_page: 1, has_next_page: false, items: { count: 0, total: 0, per_page: 24 }, current_page: 1 } }),
  getUpcomingAnime: vi.fn().mockResolvedValue({ data: [], pagination: { last_visible_page: 1, has_next_page: false, items: { count: 0, total: 0, per_page: 24 }, current_page: 1 } }),
  getAnimeById: vi.fn().mockResolvedValue({ data: null }),
  ANIME_LOAD_STUB_TITLE: 'Unable to load details',
  getAnimeEpisodes: vi.fn().mockResolvedValue({ data: [], pagination: { last_visible_page: 1, has_next_page: false } }),
  searchAnime: vi.fn().mockResolvedValue({ data: [], pagination: { last_visible_page: 1, has_next_page: false, items: { count: 0, total: 0, per_page: 24 }, current_page: 1 } }),
  getAnimeGenres: vi.fn().mockResolvedValue({ data: [] }),
  getAnimeByGenre: vi.fn().mockResolvedValue({ data: [], pagination: { last_visible_page: 1, has_next_page: false, items: { count: 0, total: 0, per_page: 24 }, current_page: 1 } }),
  getAnimeRecommendations: vi.fn().mockResolvedValue({ data: [] }),
  getPopularAnime: vi.fn().mockResolvedValue({ data: [], pagination: { last_visible_page: 1, has_next_page: false, items: { count: 0, total: 0, per_page: 24 }, current_page: 1 } }),
}))

// filler.ts
vi.mock('../api/filler', () => ({
  default: vi.fn(noop),
  getFillerEpisodes: vi.fn().mockResolvedValue({ isFiller: () => false, isMixed: () => false }),
}))

// tmdb.ts
vi.mock('../api/tmdb', () => ({
  default: vi.fn(noop),
  hasTmdbKey: vi.fn().mockReturnValue(false),
  getAnimeLogo: vi.fn().mockResolvedValue(null),
  fetchAnimeLogo: vi.fn().mockResolvedValue({ logo: null }),
  getTmdbLogoUrl: vi.fn((_logo: unknown, _size: string) => ''),
}))

// lib/prefetch.ts
vi.mock('../lib/prefetch', () => ({
  default: { prefetchRoute: vi.fn(), prefetchComponent: vi.fn(), cancelPrefetch: vi.fn() },
  prefetchRoute: vi.fn(),
  prefetchComponent: vi.fn(),
  cancelPrefetch: vi.fn(),
}))

// lib/sync.ts (AniList bidirectional sync)
vi.mock('../lib/sync', () => ({
  default: vi.fn(noop),
  initSyncBridge: vi.fn(noop),
  setSyncCallbacks: vi.fn(noop),
  syncAdd: vi.fn().mockResolvedValue(undefined),
  syncRemove: vi.fn().mockResolvedValue(undefined),
  syncProgress: vi.fn().mockResolvedValue(undefined),
  flushAllActivity: vi.fn(noop),
  pullFromAniList: vi.fn().mockResolvedValue(undefined),
  backfillEntryIds: vi.fn().mockResolvedValue(undefined),
  _buildActivityText: vi.fn((args: { title: string; eps: number[]; isLast: boolean }) =>
    `Watched ${args.eps.join(', ')} of ${args.title}${args.isLast ? ' 🎉' : ''}`),
  _resetSyncCache: vi.fn(noop),
  subscribePendingActivity: vi.fn().mockReturnValue(() => {}),
  getPendingActivity: vi.fn().mockReturnValue([]),
  isActivityOptedOut: vi.fn().mockReturnValue(false),
  getOptedOutMalIds: vi.fn().mockReturnValue([]),
  setActivityOptedOut: vi.fn(noop),
}))

// framer-motion: spread the real module so motion.div, AnimatePresence,
// useInView, etc. all keep working, but override useReducedMotion so
// animations don't pause in jsdom.
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return {
    ...actual,
    useReducedMotion: vi.fn().mockReturnValue(false),
  }
})
