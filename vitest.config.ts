/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'

// We deliberately DON'T extend vite.config.ts — pulling in the PWA plugin
// + manualChunks config adds noise to the test pipeline. Tailwind is the
// only plugin we need for the smoke suite: it's what processes index.css
// and would surface an orphaned-block / "Missing opening {" error.
export default defineConfig({
  // Match vite.config.ts: components that render the injected version
  // (Footer, Settings) need __APP_VERSION__ defined in tests too.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // CSS is imported as a side-effect of the setup file. The Tailwind
    // plugin still processes it at transform time, so any parse error in
    // index.css (the kind that broke Vite dev) fails the suite loudly.
    // We set css: false so jsdom doesn't try to parse Tailwind v4 syntax
    // (oklch, @layer properties, etc.) which it cannot handle.
    css: false,
    // Keep the smoke suite fast — no coverage instrumentation overhead.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
    },
  },
})
