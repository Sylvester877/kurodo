// AniSkip — community-maintained intro/outro/recap timestamps for anime episodes.
// Docs: https://api.aniskip.com/api-docs (v2)
//
// Routed through our backend (/api/aniskip/:malId/:ep) so the browser never
// sees a cross-origin 500 error when AniSkip's own API has issues.
// Server-side caching: 1h for hits, 5min for misses.

import axios from 'axios'
import { getBackendOrigin } from '../lib/utils'

const getBase = () => `${getBackendOrigin()}/api/aniskip`

const cache = new Map<string, { at: number; value: SkipTimes }>()
const TTL = 60 * 60 * 1000 // 1h — same as the backend's success cache

export type SkipType = 'op' | 'ed' | 'mixed-op' | 'mixed-ed' | 'recap'

export interface SkipInterval {
  startTime: number
  endTime: number
}

export interface SkipResult {
  interval: SkipInterval
  skipType: SkipType
  skipId: string
  episodeLength: number
}

export interface SkipTimes {
  op?: SkipResult
  ed?: SkipResult
  recap?: SkipResult
}

interface ApiResponse {
  found?: boolean
  results?: SkipResult[]
  statusCode?: number
  message?: string
}

/** Get all skip times for (malId, episode). Returns {} when nothing is known. */
export async function getSkipTimes(
  malId: number,
  episode: number,
  episodeLengthSec = 0,
): Promise<SkipTimes> {
  const key = `${malId}:${episode}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value

  try {
    const { data } = await axios.get<{ ok: boolean; data: ApiResponse | null }>(
      `${getBase()}/${malId}/${episode}?episodeLength=${episodeLengthSec || 0}`,
      { timeout: 8000 },
    )
    const out: SkipTimes = {}
    const apiData = data?.data
    if (apiData?.found && apiData?.results) {
      for (const r of apiData.results) {
        if (r.skipType === 'op' || r.skipType === 'mixed-op') out.op = r
        else if (r.skipType === 'ed' || r.skipType === 'mixed-ed') out.ed = r
        else if (r.skipType === 'recap') out.recap = r
      }
    }
    cache.set(key, { at: Date.now(), value: out })
    return out
  } catch {
    return {}
  }
}
