// Minimal ambient declaration for the plain-JS server/anizip-cache.js module.
// Mirrors server/filler-lib.d.ts / server/anidap.d.ts so test files can
// import the module without TS7016. Only the surface used by tests is typed.

export interface AniZipMappingShared {
  episodes?: Record<string, unknown>
  mappings?: Record<string, unknown>
  tvdbShowId?: number
}

export function cacheKey(malId?: number | null, anilistId?: number | null): string
export function getAnizipMapping(opts?: { malId?: number; anilistId?: number }): Promise<AniZipMappingShared | null>
export function getAnizipCacheStatus(): { memEntries: number; inflight: number; diskDir: string }
export function register(app: unknown): void
