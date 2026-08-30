/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />

declare module '*.glsl?raw' {
  const content: string
  export default content
}

/** Injected at build time from package.json by vite.config.ts (define). */
declare const __APP_VERSION__: string
