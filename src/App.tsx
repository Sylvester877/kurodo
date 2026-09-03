import { Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { lazyWithRetry } from './lib/lazyWithRetry'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { useSettings } from './store/useSettings'

const Home = lazyWithRetry(() => import('./pages/Home'))
const Browse = lazyWithRetry(() => import('./pages/Browse'))
const Watch = lazyWithRetry(() => import('./pages/Watch'))
const AnimeDetails = lazyWithRetry(() => import('./pages/AnimeDetails'))
const Search = lazyWithRetry(() => import('./pages/Search'))
const WatchList = lazyWithRetry(() => import('./pages/WatchList'))
const Schedule = lazyWithRetry(() => import('./pages/Schedule'))
const AuthCallback = lazyWithRetry(() => import('./pages/AuthCallback'))
const Admin = lazyWithRetry(() => import('./pages/Admin'))
const Profile = lazyWithRetry(() => import('./pages/Profile'))
const Settings = lazyWithRetry(() => import('./pages/Settings'))
const Activity = lazyWithRetry(() => import('./pages/Activity'))
const Seasonal = lazyWithRetry(() => import('./pages/Seasonal'))
const MangaBrowse = lazyWithRetry(() => import('./pages/MangaBrowse'))
const MangaDetails = lazyWithRetry(() => import('./pages/MangaDetails'))
const MangaReader = lazyWithRetry(() => import('./pages/MangaReader'))
const MangaList = lazyWithRetry(() => import('./pages/MangaList'))
const Login = lazyWithRetry(() => import('./pages/Login'))
const Health = lazyWithRetry(() => import('./pages/Health'))
const NotFound = lazyWithRetry(() => import('./pages/NotFound'))

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background via-card/30 to-background">
      <div className="flex flex-col items-center gap-5">
        {/* Animated logo mark rings */}
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-[ping_1.5s_ease-out_infinite]" />
          <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-[ping_1.5s_ease-out_0.5s_infinite]" />
          <div className="absolute inset-2 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
            <div className="h-5 w-5 rounded-sm bg-primary/60 animate-pulse" />
          </div>
        </div>
        <span className="text-sm text-muted-foreground animate-pulse">Loading...</span>
      </div>
    </div>
  )
}

function Page({ children, scope }: { children: React.ReactNode; scope: string }) {
  return (
    <ErrorBoundary scope={scope}>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

/** Auto-detect slow connections / datasaver and enable reduceQuality.
 *  Runs once on first mount. Uses the Network Information API where available. */
function ConnectionDetector() {
  const reduceQuality = useSettings((s) => s.reduceQuality)
  const setReduceQuality = useSettings((s) => s.set)

  useEffect(() => {
    // Only auto-detect once — never override a user's manual choice.
    if (reduceQuality) return

    const nav = navigator as any
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection
    if (!conn) return

    // effectiveType: 'slow-2g' | '2g' | '3g' | '4g'
    // saveData: user has datasaver mode on (mobile browsers)
    const slow = conn.saveData || conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g' || conn.effectiveType === '3g'
    if (slow) {
      setReduceQuality('reduceQuality', true)
      console.log('[App] Auto-enabled performance mode — detected slow connection:', conn.effectiveType, 'saveData:', conn.saveData)
    }
  }, [reduceQuality, setReduceQuality])

  return null
}

export default function App() {
  return (
    <ErrorBoundary scope="app">
        <BrowserRouter>
          <ConnectionDetector />
          <Routes>
          {/* Standalone full-screen gate — rendered OUTSIDE the app chrome. */}
          <Route path="login" element={<Page scope="login"><Login /></Page>} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Page scope="home"><Home /></Page>} />
            <Route path="browse" element={<Page scope="browse"><Browse /></Page>} />
            <Route path="catalog" element={<Page scope="browse"><Browse /></Page>} />
            <Route path="manga" element={<Page scope="manga"><MangaBrowse /></Page>} />
            <Route path="manga/:id" element={<Page scope="manga"><MangaDetails /></Page>} />
            <Route path="manga/read/:chapterId" element={<Page scope="manga"><MangaReader /></Page>} />
            <Route path="manga-list" element={<Page scope="mangalist"><MangaList /></Page>} />
            <Route path="anime/:id" element={<Page scope="animedetails"><AnimeDetails /></Page>} />
            <Route path="watch/:id" element={<Page scope="watch"><Watch /></Page>} />
            <Route path="search" element={<Page scope="search"><Search /></Page>} />
            <Route path="watchlist" element={<Page scope="watchlist"><WatchList /></Page>} />
            <Route path="schedule" element={<Page scope="schedule"><Schedule /></Page>} />
            <Route path="seasonal" element={<Page scope="seasonal"><Seasonal /></Page>} />
            <Route path="profile" element={<Page scope="profile"><Profile /></Page>} />
            <Route path="settings" element={<Page scope="settings"><Settings /></Page>} />
            <Route path="activity" element={<Page scope="activity"><Activity /></Page>} />
            <Route path="auth/callback" element={<Page scope="authcallback"><AuthCallback /></Page>} />
            <Route path="admin" element={<Page scope="admin"><Admin /></Page>} />
            <Route path="health" element={<Page scope="health"><Health /></Page>} />
            <Route path="*" element={<Page scope="notfound"><NotFound /></Page>} />
          </Route>
          </Routes>
        </BrowserRouter>
    </ErrorBoundary>
  )
}