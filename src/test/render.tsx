import { ReactElement, ReactNode } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { MemoryRouter, MemoryRouterProps } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Toaster from '../components/Toaster'

/**
 * Build a fresh QueryClient per test so we never share cache state.
 * `retry: false` makes failing fetches fail fast (we don't want to wait
 * 30s for an axios timeout inside a smoke test).
 */
export function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial entries / path for the MemoryRouter. Defaults to `/`. */
  routerProps?: MemoryRouterProps
  queryClient?: QueryClient
  /** Mount Toaster so components that call `toast.*` don't crash. */
  withToaster?: boolean
}

/**
 * Wraps a node in MemoryRouter + QueryClientProvider so pages and
 * router-dependent components can mount in jsdom without a real
 * history stack. Toaster is off by default — enable per-test.
 */
export function renderWithProviders(
  ui: ReactElement,
  { routerProps, queryClient, withToaster = false, ...rest }: RenderWithProvidersOptions = {},
) {
  const client = queryClient ?? makeTestQueryClient()
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter {...routerProps}>{children}</MemoryRouter>
        {withToaster && <Toaster />}
      </QueryClientProvider>
    )
  }
  return render(ui, { wrapper: Wrapper, ...rest })
}
