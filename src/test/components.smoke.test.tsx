/**
 * Component smoke tests.
 *
 * The bar here is intentionally low: "the component can be imported and
 * mounted without throwing". We don't assert on layout, copy, or
 * interactive behavior. The point is to catch the failure modes that
 * have actually bitten us:
 *
 *   - Top-level throws on render (undefined access, bad import, type
 *     assertion crash).
 *   - An orphaned CSS block in index.css (the one that produced the
 *     "Missing opening {" Vite error and broke the dev server).
 *   - A regressed export from a refactor (component still imports fine
 *     but the default export got renamed).
 *
 * If a component truly needs async data to mount, the API mocks in
 * `src/test/mocks.ts` return safe defaults so the first render doesn't
 * blow up.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, act } from '@testing-library/react'
import { renderWithProviders } from './render'
import { makeAnime } from './fixtures'

// Pull mocks in (auto-applies to every module mocked inside it).
import './mocks'

// ─── Simple / prop-less components ───────────────────────────────────────
import {
  Skeleton,
  SkeletonCard,
  SkeletonThumb,
  SkeletonRow,
  SkeletonScroller,
  SkeletonBanner,
  SkeletonLines,
} from '../components/Skeleton'
import Logo from '../components/Logo'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import SectionHeader from '../components/SectionHeader'
import StylizedFontEngine from '../components/StylizedFontEngine'
import Starfield from '../components/Starfield'
import MagneticButton from '../components/MagneticButton'
import Toaster from '../components/Toaster'
import ErrorBoundary from '../components/ErrorBoundary'
import TopLoadingBar from '../components/TopLoadingBar'
import OfflineBanner from '../components/OfflineBanner'
import UpdateNotification from '../components/UpdateNotification'
import SubDubToggle from '../components/SubDubToggle'
import EpisodeRangePicker from '../components/EpisodeRangePicker'
import StaggerCard from '../components/StaggerCard'
import PlayerLoadingStages from '../components/PlayerLoadingStages'
import TopSearchesBar from '../components/TopSearchesBar'

// ─── Prop-driven components (using a fixture Anime) ──────────────────────
import AnimeCard from '../components/AnimeCard'
import AnimeGrid from '../components/AnimeGrid'

beforeEach(() => {
  // Stub IntersectionObserver firing on mount so whileInView motion props
  // settle and the test doesn't have to await scroll events.
  if (!window.IntersectionObserver) {
    class IO {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    }
    ;(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO
  }
  const io = window.IntersectionObserver as unknown as {
    prototype: { observe: () => void }
  }
  vi.spyOn(io.prototype, 'observe').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Component smoke — simple', () => {
  it('Skeleton mounts', () => {
    renderWithProviders(<Skeleton className="w-32 h-4" />)
    expect(document.querySelector('[role="presentation"]')).toBeInTheDocument()
  })
  it('SkeletonCard mounts', () => {
    renderWithProviders(<SkeletonCard />)
  })
  it('SkeletonThumb mounts', () => {
    renderWithProviders(<SkeletonThumb />)
  })
  it('SkeletonRow mounts', () => {
    renderWithProviders(<SkeletonRow count={3} />)
  })
  it('SkeletonScroller mounts', () => {
    renderWithProviders(<SkeletonScroller count={3} />)
  })
  it('SkeletonBanner mounts', () => {
    renderWithProviders(<SkeletonBanner />)
  })
  it('SkeletonLines mounts', () => {
    renderWithProviders(<SkeletonLines count={3} />)
  })
  it('Logo mounts', () => {
    renderWithProviders(<Logo />)
  })
  it('Footer mounts', () => {
    renderWithProviders(<Footer />)
  })
  it('BackToTop mounts', () => {
    renderWithProviders(<BackToTop />)
  })
  it('SectionHeader mounts (title only)', () => {
    renderWithProviders(<SectionHeader title="Trending" />)
  })
  it('SectionHeader mounts (full)', () => {
    renderWithProviders(
      <SectionHeader
        kicker="Curated"
        title="Top 100"
        subtitle="All-time highest rated"
        pill="elite"
        pillTone="accent"
        to="/browse"
        linkLabel="See all"
      />,
    )
  })
  it('StylizedFontEngine mounts', () => {
    renderWithProviders(
      <StylizedFontEngine
        title="Cowboy Bebop"
        genres={['Action', 'Sci-Fi']}
        accentColor="#6366f1"
      />,
    )
  })
  it('Starfield mounts', () => {
    renderWithProviders(<Starfield />)
  })
  it('MagneticButton mounts', () => {
    renderWithProviders(<MagneticButton>Click</MagneticButton>)
  })
  it('Toaster mounts', () => {
    renderWithProviders(<Toaster />)
  })
  it('ErrorBoundary mounts', () => {
    renderWithProviders(<ErrorBoundary>{<div>child</div>}</ErrorBoundary>)
  })
  it('TopLoadingBar mounts', () => {
    renderWithProviders(<TopLoadingBar />)
  })
  it('OfflineBanner mounts', () => {
    renderWithProviders(<OfflineBanner />)
  })
  it('UpdateNotification mounts', () => {
    renderWithProviders(<UpdateNotification />)
  })
  it('SubDubToggle mounts', () => {
    renderWithProviders(<SubDubToggle />)
  })
  it('EpisodeRangePicker mounts with required props', () => {
    renderWithProviders(
      <EpisodeRangePicker
        totalEpisodes={50}
        currentEp={1}
        activeRangeStart={1}
        onSelectRange={() => {}}
      />,
    )
  })
  it('StaggerCard mounts with required index', () => {
    renderWithProviders(<StaggerCard index={0}>card</StaggerCard>)
  })
  it('PlayerLoadingStages mounts', () => {
    renderWithProviders(<PlayerLoadingStages stage="buffering" />)
  })
  it('TopSearchesBar mounts', () => {
    renderWithProviders(<TopSearchesBar />)
  })
})

describe('Component smoke — prop-driven (Anime fixture)', () => {
  const anime = makeAnime()

  it('AnimeCard mounts', () => {
    renderWithProviders(<AnimeCard anime={anime} />, { withToaster: true })
  })
  it('AnimeCard with badge mounts', () => {
    renderWithProviders(<AnimeCard anime={anime} badge="EP 7" />, { withToaster: true })
  })
  it('AnimeGrid mounts with empty list', () => {
    renderWithProviders(<AnimeGrid animes={[]} />)
  })
  it('AnimeGrid mounts with one anime', () => {
    renderWithProviders(<AnimeGrid animes={[anime]} />, { withToaster: true })
  })
})

describe('Component smoke — fetchers (no real network)', () => {
  it('Hero mounts with mocked AniList + TMDB', async () => {
    // Hero calls getTrending, fetchAnimeLogo, getEpisodeInfoFromMal, etc.
    // All mocked. Hero is also full-viewport so it tries to read
    // window.innerHeight — jsdom reports 768x600, that's fine.
    const { default: Hero } = await import('../components/Hero')
    await act(async () => {
      renderWithProviders(<Hero />, { withToaster: true })
    })
    // Don't assert on the logo/text — first-paint shows the skeleton.
    // The important thing is the render() didn't throw.
    expect(document.body).toBeTruthy()
  })
})
