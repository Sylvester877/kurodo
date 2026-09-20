import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import 'lenis/dist/lenis.css'
import './index.css'
import { queryClient, loadPersistedCache, startPersistence, startBootPrefetch } from './lib/queryClient'
import { initSyncBridge } from './lib/sync'
import { initMangaSyncBridge } from './lib/mangaSync'
import { refreshBackendSecretFlag } from './api/anilistAuth'

// Re-hydrate any persisted query data BEFORE React mounts so the first paint
// can use it without flashing skeletons.
loadPersistedCache()
startPersistence()
// Fire-and-forget warm of Home's first queries (idle-time, after hydrate).
startBootPrefetch()
// Ask the backend (once, background) whether it holds an AniList client
// secret — getLoginUrl uses the answer to pick code vs implicit flow so
// confidential clients never get sent down the implicit path.
refreshBackendSecretFlag()

// Wire the watchlist store ↔ AniList sync bridge (avoids circular imports).
initSyncBridge()

// Wire the manga list store ↔ AniList sync bridge.
initMangaSyncBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
