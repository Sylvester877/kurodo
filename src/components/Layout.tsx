import { useEffect, useMemo, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import { ReactLenis } from 'lenis/react'
import Navbar from './Navbar'
import Footer from './Footer'
import Celebrations from './Celebrations'
import Toaster from './Toaster'
import TopLoadingBar from './TopLoadingBar'
import BackToTop from './BackToTop'
import ScrollProgress from './ScrollProgress'
import OfflineBanner from './OfflineBanner'
import KeyboardShortcuts from './KeyboardShortcuts'
import CommandPalette from './CommandPalette'
import UpdateNotification from './UpdateNotification'
import CompletionDialog from './CompletionDialog'
import SetupWizard from './SetupWizard'
import AuroraBackground from './AuroraBackground'
import { useAuthStore } from '../store/useAuthStore'
import { useSettings } from '../store/useSettings'
import { useReaderStore } from '../store/useReaderStore'
import { restoreCredsFromDisk } from '../api/anilistAuth'
import { backfillEntryIds, pullFromAniList } from '../lib/sync'
import { shouldReduceQuality, getIntegratedGpuDefaults } from '../utils/gpuDetection'
import { useScrollRestoration } from '../hooks/useScrollRestoration'
import {
  startNotificationScheduler, stopNotificationScheduler, getPermission,
} from '../lib/notifications'

export default function Layout() {
  const auth = useAuthStore((s) => s.auth)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const reduceQuality = useSettings((s) => s.reduceQuality)
  const notifyAiring = useSettings((s) => s.notifyAiring)
  const themeColor = useSettings((s) => s.themeColor)
  const lightMode = useSettings((s) => s.lightMode)
  const lastUserIdRef = useRef<number | null>(null)

  // On first mount, restore AniList credentials from the Electron disk file
  // into localStorage. The disk file survives reinstalls; localStorage is
  // tied to Chromium's data dir and gets wiped on Electron version bumps.
  useEffect(() => { restoreCredsFromDisk() }, [])

  // Save/restore scroll position per route.
  useScrollRestoration()

  // Mirror the reduce-motion setting onto <html> so the CSS rule in
  // index.css picks it up the same way `@media (prefers-reduced-motion)` does.
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion)
  }, [reduceMotion])

  // Apply theme colour class to <html>
  useEffect(() => {
    const html = document.documentElement
    html.classList.remove('theme-anikage', 'theme-violet', 'theme-anidap', 'theme-indigo', 'theme-crimson', 'theme-emerald', 'theme-amber')
    html.classList.add(`theme-${themeColor}`)
  }, [themeColor])

  // Sync light mode class to <html>
  useEffect(() => {
    document.documentElement.classList.toggle('light-mode', lightMode)
  }, [lightMode])

  // ── Auto-detect integrated GPU and apply reduced-quality settings on first load ──
  useEffect(() => {
    // One-shot guard: only auto-detect on the very first app boot.
    // After that, the user's manual toggle in Settings is respected.
    if (localStorage.getItem('kurodo-gpu-detected')) return
    localStorage.setItem('kurodo-gpu-detected', '1')

    if (shouldReduceQuality()) {
      // Apply main settings
      useSettings.getState().set('reduceQuality', true)
      // Apply reader store optimizations
      const defaults = getIntegratedGpuDefaults()
      useReaderStore.getState().setMany(defaults)
    }
  }, []) // Run once on mount

  // Start/stop the airing-notification scheduler when the setting flips.
  // The scheduler is a no-op until the user grants browser permission.
  useEffect(() => {
    if (notifyAiring && getPermission() === 'granted') {
      startNotificationScheduler()
      return () => stopNotificationScheduler()
    }
    stopNotificationScheduler()
  }, [notifyAiring])

  // On first sign-in (or user switch) — pull list down once.
  // On every subsequent app boot while still signed in — just backfill IDs
  // so the delete button works for items that were already in localStorage.
  // Defer AniList sync work to idle time — it shouldn't block first paint.
  useEffect(() => {
    if (!auth) {
      lastUserIdRef.current = null
      return
    }
    const syncWork = () => {
      if (lastUserIdRef.current !== auth.user.id) {
        lastUserIdRef.current = auth.user.id
        void pullFromAniList()
      } else {
        void backfillEntryIds()
      }
    }
    const handle = window.requestIdleCallback(syncWork, { timeout: 2000 })
    return () => window.cancelIdleCallback(handle)
  }, [auth])



  // Memoize lenis options so ReactLenis doesn't re-initialize on every render.
  // Tuned for buttery smoothness: duration+easing mode gives a deterministic
  // glide with a long ease-out tail after the last wheel event — the stop
  // feels "expensive" instead of abrupt. (lerp is the alternative mode; the
  // two are mutually exclusive, so we set duration+easing only.)
  // syncTouch gives mobile the same smoothness as desktop wheel scrolling.
  const lenisOptions = useMemo(() => ({
    duration: 1.15,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // easeOutExpo
    smoothWheel: !reduceMotion,
    syncTouch: !reduceMotion,
    touchMultiplier: 1.6,
    wheelMultiplier: 1.0,
  }), [reduceMotion])

  return (
    <ReactLenis
      root
      options={lenisOptions}
    >
    <div className="min-h-screen flex flex-col bg-background relative">
      {/* ── Aurora animated mesh gradient background ── */}
      {/* Disabled on integrated GPUs or reduced quality — avoids GPU memory pressure causing black screens */}
      {!reduceMotion && !reduceQuality && <AuroraBackground />}
      {/* Accessibility: skip-to-content link (visible on first Tab press) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-white focus:text-sm focus:font-bold focus:shadow-lg"
      >
        Skip to content
      </a>
      <TopLoadingBar />
      <Navbar />
      <main id="main-content" className="flex-1 relative z-[1]">
        {/* ═══ No route-level page transitions ═══
             Route-level keyed wrappers / AnimatePresence opacity fades were
             causing black screens during navigation: forcing a full remount
             resets local state and re-triggers Suspense fallbacks, while
             exit animations can leave a gap where neither page is visible.
             Pages mount instantly; individual pages can apply the local
             `.page-enter` class for their own entrance animation without
             risking the whole route. */}
        <Outlet />
      </main>
      <div className="relative z-[1]">
        <Footer />
      </div>
      {/* ── PWA/browser-only features — hidden in Electron (desktop app) ── */}
      {!window.electronAPI?.isElectron && <OfflineBanner />}
      <Celebrations />
      <Toaster />
      <UpdateNotification />
      <CompletionDialog />
      <SetupWizard />
      <ScrollProgress />
      <BackToTop />
      <KeyboardShortcuts />
      <CommandPalette />
    </div>
    </ReactLenis>
  )
}