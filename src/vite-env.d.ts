/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />

declare module '*.glsl?raw' {
  const content: string
  export default content
}
