import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import pkg from './package.json'

export default defineConfig({
  // Single source of truth for the version: the web build (dist) and the
  // Electron installer both read package.json, so the version pill in the
  // footer / settings always matches the installer version. No more manual
  // BUMP-ME edits that drift out of sync.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192.svg', 'pwa-512.svg'],
      manifest: {
        name: 'Kurōdo · Discover & Stream Anime',
        short_name: 'Kurōdo',
        description: 'A sleek anime discovery & streaming companion — browse, search, and stream anime with HD quality.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        display_override: ['standalone', 'window-controls-overlay'],
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['entertainment', 'video'],
        lang: 'en',
        icons: [
          {
            src: '/pwa-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
          {
            src: '/pwa-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
        // Shortcuts for installed PWA (right-click / long-press the app icon)
        shortcuts: [
          {
            name: 'Browse Anime',
            short_name: 'Browse',
            description: 'Discover trending and popular anime',
            url: '/browse',
            icons: [{ src: '/pwa-192.svg', sizes: '192x192' }],
          },
          {
            name: 'Search',
            short_name: 'Search',
            description: 'Search for your favorite anime',
            url: '/search',
            icons: [{ src: '/pwa-192.svg', sizes: '192x192' }],
          },
          {
            name: 'Schedule',
            short_name: 'Schedule',
            description: 'See this season\'s airing schedule',
            url: '/schedule',
            icons: [{ src: '/pwa-192.svg', sizes: '192x192' }],
          },
        ],
      },
      workbox: {
        // Don't precache the giant Watch chunk (HLS.js); load it on demand.
        // Exclude index.html — when Vite rebuilds, chunk filenames change and
        // a cached index.html references stale chunks, causing lazyWithRetry
        // to trigger a hard page reload on every first navigation.
        globPatterns: ['**/*.{js,css,svg}'],
        globIgnores: ['**/index.html'],
        // Always serve fresh index.html for navigation requests so the app
        // never loads stale chunk references after a rebuild.
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//, /^\/proxy/],
        // Navigation preload — the SW intercepts the nav request AND
        // fires a network fetch in parallel for the main document. When
        // both the SW activation and the preload response are ready,
        // the browser picks the winner (usually the preload). Net result:
        // cached pages feel instant even on first SW activation.
        navigationPreload: true,
        runtimeCaching: [
          // Navigation: always fetch index.html from network so the app
          // never loads stale chunk references after a Vite rebuild.
          // Fall back to cache only when offline.
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 5, maxAgeSeconds: 60 },
            },
          },
          // Anime metadata — stale-while-revalidate so the browse pages
          // feel snappy on revisits while still updating in the background.
          {
            urlPattern: /^https:\/\/api\.jikan\.moe\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'jikan-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/graphql\.anilist\.co\/?.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'anilist-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 6 },
            },
          },
          {
            urlPattern: /^https:\/\/api\.ani\.zip\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'anizip-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          // Cover/thumbnail images — cache-first for ages
          {
            urlPattern: /^https:\/\/cdn\.myanimelist\.net\/.*\.(?:jpg|jpeg|png|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mal-images',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/artworks\.thetvdb\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tvdb-images',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Manga page images — CacheFirst for fast re-reads.
          // Mangadex chapter pages are immutable (content-addressed URLs),
          // so we can cache them aggressively. Also covers atsu.moe and
          // other manga proxy/CDN hosts used by the reader.
          {
            urlPattern: /^https:\/\/uploads\.mangadex\.org\/.*\.(?:jpg|jpeg|png|webp|avif)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'manga-pages',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/atsu\.moe\/.*\.(?:jpg|jpeg|png|webp|avif)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'manga-pages',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Google Fonts
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    target: 'es2020',
    // Bigger vendor chunks → fewer HTTP requests on first load.
    // Splits framer-motion, react-router, query, axios into their own chunks
    // so they cache long-term and don't bloat the main bundle.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-core': ['react', 'react-dom', 'react-router-dom'],
          'motion': ['framer-motion'],
          'query': ['@tanstack/react-query'],
          'state': ['zustand'],
          'net': ['axios'],
          'hls': ['hls.js'],
          'icons': ['lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
    // Terser options for production: drop console.logs, keep license comments
    // esbuild for JS, lightningcss for CSS — both are ~100x faster than Terser/PostCSS
    minify: 'esbuild',
    cssMinify: 'lightningcss',
    // Preload hint injection for critical chunks
    modulePreload: { polyfill: true },
  },
})
