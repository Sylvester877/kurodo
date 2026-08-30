// Build a robust thumbnail URL for an episode by routing through the local
// /img proxy with a chain of fallbacks. The first source that returns a real
// image wins; if all fail we get a styled SVG placeholder (never black).
//
// Why this exists:
//   - AniZip's v4 TVDB URLs (newer shows) return 403, leaving black boxes
//   - Browsers can't natively try N fallback URLs on a single <img>
//   - Server-side fallback is faster than chained client-side onError

import { getBackendOrigin } from './utils'
import type { AniZipEpisode } from '../api/anizip'

interface Options {
  /** Show banner URL — last-resort fallback so we always have *something*. */
  showCover?: string | null
  /** Episode number (used for the placeholder label). */
  label?: string | number | null
  /** Accent colour hex from AniList (e.g. "#1a2b3c") — used for the EP pill in card mode. */
  accent?: string | null
}

/**
 * Returns a relative URL that hits our /img proxy with the full fallback chain
 * baked in. Browser caches it once, server caches the resolved bytes for 24h.
 */
export function buildEpisodeImageUrl(
  ep: AniZipEpisode | null | undefined,
  opts: Options = {},
): string {
  // ── TMDB images + TVDB artworks (real episode screenshots from the
  // anikage.cc source): return directly — both CDNs have CORS * and load
  // instant in the browser. Bypassing the /img proxy avoids a server
  // round-trip + buffer pass-through (~300-800ms saved per thumbnail).
  if (ep?.image && (ep.image.includes('image.tmdb.org') || ep.image.includes('artworks.thetvdb.com'))) {
    return ep.image
  }

  // ── No real screenshot? Generate a numbered episode card. ──
  // /img?card=1 fetches the cover server-side, embeds it as a base64
  // data-URL in the SVG, and returns a fully self-contained numbered tile
  // (cover + "EP N" pill + accent colour). Self-contained data-URL SVGs
  // render reliably inside <img> — unlike external <image href> URLs which
  // browsers refuse, and unlike plain cover bytes which look like a generic
  // banner instead of an episode thumbnail.
  const origin = getBackendOrigin()
  if (!ep?.image && opts.showCover && opts.label != null) {
    const params = new URLSearchParams()
    params.append('card', '1')
    params.append('url', opts.showCover)
    params.append('ep', String(opts.label))
    if (opts.accent) params.append('accent', opts.accent)
    return `${origin}/img?${params.toString()}`
  }

  const params = new URLSearchParams()

  // Tier 1: AniZip/Jikan's real episode screenshot (may be a working
  // old-style or broken v4 URL)
  if (ep?.image) {
    params.append('url', ep.image)
    // Tier 2: if it's a v4 URL, also try the .jpg-suffixed variant
    if (/\/v4\/episode\/.+\/screencap\//.test(ep.image) && !/\.\w{3,4}$/.test(ep.image)) {
      params.append('url', ep.image + '.jpg')
    }
  }

  // Tier 3: show cover/banner as a final visual fallback
  if (opts.showCover) {
    params.append('url', opts.showCover)
    // Pass cover URL separately so the server can generate a card SVG
    // as the ultimate fallback when all image URLs return 403/404.
    params.append('coverUrl', opts.showCover)
  }

  // Always include the label for the placeholder / card fallback
  if (opts.label != null) {
    params.append('label', `EP ${opts.label}`)
  }

  // Pass accent colour for card SVG fallback pill styling
  if (opts.accent) {
    params.append('accent', opts.accent)
  }

  // If we have NO sources at all, hit /img anyway so we get the styled SVG
  return `${origin}/img?${params.toString()}`
}
