// wsrv.nl image-transform pipeline — otakutsu.cc's CDN strategy.
//
// wsrv.nl is a free, global (Cloudflare 300+ PoPs) libvips image proxy:
//   https://wsrv.nl/?url=<encoded origin>&w=780&fit=cover&output=webp&q=85&sharp=1
// Benefits over raw origin URLs:
//   • WebP re-encode (~30-50% smaller than the source JPEG/PNG)
//   • on-the-fly resize (hero backdrops ship at 780w, not 2-6MB originals)
//   • 1-year browser cache + 7-31d edge cache, 20M req/hour capacity
//   • `sharp=1` light sharpen keeps small text/logos crisp after resize
//
// Usage rules (per otakutsu): always encode the ORIGIN url, always
// `output=webp&q=85`, size per surface — hero `w=780`, cards `500/300`,
// qtip `300`. PNG transparency is preserved by wsrv, so clearlogos can go
// through it too when they need sizing (otherwise serve TVDB direct).

const WSRV = 'https://wsrv.nl/'

export interface WsrvOptions {
  /** Target width in px. Height follows aspect (or pair with h + fit). */
  w?: number
  /** Target height in px (with fit=cover for exact crops). */
  h?: number
  /** How to fit when both w+h given. Default 'cover' for backdrops. */
  fit?: 'cover' | 'contain' | 'fill' | 'inside'
  /** Output encoding. Default webp (smallest, universal in Electron/Chromium). */
  output?: 'webp' | 'jpg' | 'png'
  /** Quality 0-100. Default 85 — otakutsu's value, visually lossless-ish. */
  q?: number
  /** 1 = light libvips sharpen after resize (keeps logos crisp). */
  sharp?: boolean
  /** Fallback image URL wsrv substitutes if the origin 404s. */
  default?: string
  /** we serve `url` unchanged for local/relative addresses. */
}

/** True when the URL can legally be handed to wsrv (absolute http(s)). */
function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * Build a wsrv.nl transform URL. Returns the input unchanged when it is
 * not a remote http(s) URL (data:, blob:, localhost proxies like /img?...).
 */
export function wsrv(url: string, opts: WsrvOptions = {}): string {
  if (!url || !isRemote(url)) return url
  const params = new URLSearchParams()
  params.set('url', url)
  if (opts.w != null) params.set('w', String(Math.round(opts.w)))
  if (opts.h != null) params.set('h', String(Math.round(opts.h)))
  if (opts.w != null || opts.h != null) params.set('fit', opts.fit || 'cover')
  params.set('output', opts.output || 'webp')
  params.set('q', String(opts.q ?? 85))
  if (opts.sharp) params.set('sharp', '1')
  if (opts.default) params.set('default', opts.default)
  return `${WSRV}?${params.toString()}`
}

/** Canonical sizes used across the app (otakutsu parity). */
export const WSRC_SIZES = {
  /** Hero backdrop — big enough for 1080p, 4× smaller than the original. */
  hero: { w: 780 } as WsrvOptions,
  /** Rails / grid cards. */
  card: { w: 500 } as WsrvOptions,
  /** Hover qtip poster. */
  qtip: { w: 300 } as WsrvOptions,
} as const
