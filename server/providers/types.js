// Unified scraper provider interface — only anidap remains as of Jun 2026.
// (miruro TLS revoked, consumet shut down, saturn HTML-only, animdl can't build on Python 3.14).
// The interface is preserved for when new providers are added in the future.

/**
 * @typedef {Object} InfoResult
 * @property {string|null} slug  Provider-internal id used by subsequent calls.
 * @property {string|null=} title Human-readable title (optional, for logs).
 */

/**
 * @typedef {Object} EpisodeStub
 * @property {number} number      Episode number.
 * @property {string=} title      Episode title if available.
 * @property {string=} img        Thumbnail URL.
 * @property {boolean=} hasDub
 * @property {boolean=} hasSub
 */

/**
 * @typedef {Object} ProviderEntry
 * @property {string} name        Raw provider id (e.g. "yuki", "hd-1").
 * @property {string} type        sub | dub | hsub
 */

/**
 * @typedef {Object} StreamResult
 * @property {string} url         Primary playable m3u8 (or .mp4 for direct progressive sources).
 * @property {string} raw         Same as url for sources without indirection.
 * @property {Array<{file:string, label?:string, kind?:string, default?:boolean}>} subtitles
 * @property {Record<string,string>=} headers  Optional Referer/UA the proxy must echo.
 */

/**
 * @typedef {Object} ScraperProvider
 * @property {string} name                   Unique provider id used in logs / URL ?source=.
 * @property {(anilistId: number) => Promise<InfoResult>}  getInfoByAniListId
 * @property {(slug: string) => Promise<EpisodeStub[]>}     getEpisodes
 * @property {(slug: string, ep: number) => Promise<ProviderEntry[]>} getProviders
 * @property {(slug: string, ep: number, providerName: string, type: string) => Promise<StreamResult|null>} getStream
 */

export const PROVIDER_NAMES = ['gogoanime', 'anidap']
