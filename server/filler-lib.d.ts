// Type shim for server/filler-lib.js — lets the vitest suite (TypeScript)
// import the pure filler logic with full type safety.

export interface FillerData {
  total_episodes: number
  filler_episodes: number[]
  canon_episodes: number[]
  anime_canon_episodes: number[]
  mixed_episodes: number[]
  recap_episodes?: number[]
  source?: 'afl' | 'jikan' | string
}

export interface ResolveFillerOptions {
  malId: number
  title: string
  cache: Map<string, { at: number; data: FillerData }>
  failCache: Map<string, { at: number; slug: string }>
  fetchAFL?: (title: string) => Promise<FillerData | null>
  fetchJikan?: (malId: number) => Promise<FillerData | null>
  fetchLegacy?: (title: string, malId: number) => Promise<FillerData | null> | null
}

export type ResolveFillerResult =
  | { status: 200; data: FillerData; source?: string; hit?: boolean }
  | { status: 404; error: string; negativeHit?: boolean }

export declare const FILLER_CACHE_TTL: number
export declare const FILLER_FAIL_TTL: number
export declare function aflSlugify(title: string): string
export declare function parseAFLPage(html: string): FillerData | null
export declare function buildJikanFiller(
  flags: Map<number, { filler: boolean; recap: boolean }>,
  total: number,
): FillerData | null
export declare function resolveFiller(opts: ResolveFillerOptions): Promise<ResolveFillerResult>
