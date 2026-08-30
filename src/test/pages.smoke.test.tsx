/**
 * Page smoke tests.
 *
 * Each page component is rendered inside MemoryRouter + QueryClientProvider
 * (see `renderWithProviders`). The goal: assert every page can mount
 * without throwing, so a bad import or undefined-access bug fails the
 * suite instead of producing a white screen in production.
 *
 * Pages that take a route param (AnimeDetails, Watch, etc.) are mounted
 * with a plausible param value and rely on the API mocks in `mocks.ts`
 * to short-circuit the network calls.
 */
import { describe, it, afterEach, vi, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders } from './render'

import './mocks'

beforeEach(() => {
  // jsdom doesn't implement IntersectionObserver — shim it so components
  // that observe scroll visibility (rails, ScrollReveal) can mount.
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

describe('Page smoke', () => {
  it('Home mounts', async () => {
    const { default: Home } = await import('../pages/Home')
    renderWithProviders(<Home />, {
      routerProps: { initialEntries: ['/'] },
      withToaster: true,
    })
    // Home is the heaviest page in the suite (Hero with YouTube iframes,
    // parallax backdrops, featured slider, multiple feed rails). Under CI
    // load it can take ~6s to mount, so the default 5s timeout is too
    // tight — give it room without masking real failures.
  }, 20000)

  it('Browse mounts', async () => {
    const { default: Browse } = await import('../pages/Browse')
    renderWithProviders(<Browse />, {
      routerProps: { initialEntries: ['/browse'] },
      withToaster: true,
    })
  })

  it('Search mounts', async () => {
    const { default: Search } = await import('../pages/Search')
    renderWithProviders(<Search />, {
      routerProps: { initialEntries: ['/search'] },
      withToaster: true,
    })
  })

  it('Schedule mounts', async () => {
    const { default: Schedule } = await import('../pages/Schedule')
    renderWithProviders(<Schedule />, {
      routerProps: { initialEntries: ['/schedule'] },
      withToaster: true,
    })
  })

  it('Seasonal mounts', async () => {
    const { default: Seasonal } = await import('../pages/Seasonal')
    renderWithProviders(<Seasonal />, {
      routerProps: { initialEntries: ['/seasonal'] },
      withToaster: true,
    })
  })

  it('WatchList mounts', async () => {
    const { default: WatchList } = await import('../pages/WatchList')
    renderWithProviders(<WatchList />, {
      routerProps: { initialEntries: ['/watchlist'] },
      withToaster: true,
    })
  })

  it('Activity mounts', async () => {
    const { default: Activity } = await import('../pages/Activity')
    renderWithProviders(<Activity />, {
      routerProps: { initialEntries: ['/activity'] },
      withToaster: true,
    })
  })

  it('Profile mounts', async () => {
    const { default: Profile } = await import('../pages/Profile')
    renderWithProviders(<Profile />, {
      routerProps: { initialEntries: ['/profile'] },
      withToaster: true,
    })
  })

  it('Settings mounts', async () => {
    const { default: Settings } = await import('../pages/Settings')
    renderWithProviders(<Settings />, {
      routerProps: { initialEntries: ['/settings'] },
      withToaster: true,
    })
  })

  it('Quotes mounts', async () => {
    const { default: Quotes } = await import('../pages/Quotes')
    renderWithProviders(<Quotes />, {
      routerProps: { initialEntries: ['/quotes'] },
      withToaster: true,
    })
  })

  it('Health mounts', async () => {
    const { default: Health } = await import('../pages/Health')
    renderWithProviders(<Health />, {
      routerProps: { initialEntries: ['/health'] },
    })
  })

  it('NotFound mounts', async () => {
    const { default: NotFound } = await import('../pages/NotFound')
    renderWithProviders(<NotFound />, {
      routerProps: { initialEntries: ['/this-route-does-not-exist'] },
    })
  })

  it('AuthCallback mounts', async () => {
    const { default: AuthCallback } = await import('../pages/AuthCallback')
    renderWithProviders(<AuthCallback />, {
      routerProps: { initialEntries: ['/auth/callback?code=test'] },
      withToaster: true,
    })
  })

  it('AuthDebug mounts', async () => {
    const { default: AuthDebug } = await import('../pages/AuthDebug')
    renderWithProviders(<AuthDebug />, {
      routerProps: { initialEntries: ['/auth/debug'] },
    })
  })

  it('ScraperDebug mounts', async () => {
    const { default: ScraperDebug } = await import('../pages/ScraperDebug')
    renderWithProviders(<ScraperDebug />, {
      routerProps: { initialEntries: ['/scraper/debug'] },
    })
  })

  it('AnimeDetails mounts with route param', async () => {
    const { default: AnimeDetails } = await import('../pages/AnimeDetails')
    renderWithProviders(<AnimeDetails />, {
      routerProps: { initialEntries: ['/anime/1'] },
      withToaster: true,
    })
  })

  it('Watch mounts with route param', async () => {
    const { default: Watch } = await import('../pages/Watch')
    renderWithProviders(<Watch />, {
      routerProps: { initialEntries: ['/watch/1/1'] },
      withToaster: true,
    })
  })
})
