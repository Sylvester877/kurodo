// AniList OAuth — supports BOTH flows so the user can pick the path of
// least friction:
//
//   • IMPLICIT (default, no setup): create a PUBLIC client on AniList
//     (no Client Secret shown), paste the Client ID into the in-app
//     setup screen — done. Token comes back in the URL fragment, no
//     server round-trip. Zero .env editing.
//
//   • AUTH-CODE (advanced): for users who already created a CONFIDENTIAL
//     client (Client ID + Secret). Requires ANILIST_CLIENT_SECRET in
//     .env.local + a backend exchange. We auto-detect this case at
//     callback time by checking for ?code= vs #access_token=.
//
// The Client ID can come from THREE places, in priority order:
//   1. localStorage (kurodo-anilist-client-id) — set from the in-app
//      setup screen. Highest priority because users can swap clients
//      without restarting dev.
//   2. VITE_ANILIST_CLIENT_ID env var — for power users / production.
//   3. None — sign-in button shows the setup screen.
//
// Token lives 1 year. Stored in localStorage (no refresh token kept).

import axios from 'axios'
import { getBackendOrigin } from '../lib/utils'
import { anilistRequest } from './anilistClient'

const STORAGE_KEY = 'kurodo-anilist-auth'
const CLIENT_ID_KEY = 'kurodo-anilist-client-id'
const CLIENT_SECRET_KEY = 'kurodo-anilist-client-secret'

const ENV_CLIENT_ID = import.meta.env.VITE_ANILIST_CLIENT_ID as string | undefined
const ENV_CLIENT_SECRET = import.meta.env.VITE_ANILIST_CLIENT_SECRET as string | undefined

/** Read the current Client ID, preferring user-pasted localStorage value. */
export function getClientId(): string | undefined {
  try {
    const fromLs = localStorage.getItem(CLIENT_ID_KEY)
    if (fromLs && /^\d+$/.test(fromLs)) return fromLs
  } catch { /* SSR safety */ }
  return ENV_CLIENT_ID
}

/** Persist a Client ID to localStorage AND to disk (Electron). */
export function setClientId(id: string | null): void {
  try {
    if (id == null || !id.trim()) localStorage.removeItem(CLIENT_ID_KEY)
    else localStorage.setItem(CLIENT_ID_KEY, id.trim())
  } catch { /* ignore quota */ }
  // Also save to disk via Electron IPC so it survives reinstalls
  saveCredsToDisk()
}

/** Read the stored Client Secret (localStorage or env var). */
export function getClientSecret(): string | undefined {
  try {
    const fromLs = localStorage.getItem(CLIENT_SECRET_KEY)
    if (fromLs) return fromLs
  } catch {}
  return ENV_CLIENT_SECRET
}

/** Persist a Client Secret to localStorage AND to disk (Electron). */
export function setClientSecret(secret: string | null): void {
  try {
    if (!secret) localStorage.removeItem(CLIENT_SECRET_KEY)
    else localStorage.setItem(CLIENT_SECRET_KEY, secret.trim())
  } catch {}
  // Also save to disk via Electron IPC so it survives reinstalls
  saveCredsToDisk()
}

/** Helper: write current Client ID + Secret to the Electron disk file. */
function saveCredsToDisk() {
  const api = (window as any).electronAPI
  if (api?.setAnilistCredentials) {
    api.setAnilistCredentials(getClientId() || '', getClientSecret() || '')
  }
}

/** On app start, try to restore credentials from the Electron disk file
 *  into localStorage. The disk file survives reinstalls, unlike localStorage
 *  which lives inside Chromium's data dir.
 *  Uses raw localStorage.setItem to avoid triggering saveCredsToDisk()
 *  (which would immediately write back the same data to disk). */
export function restoreCredsFromDisk() {
  const api = (window as any).electronAPI
  if (!api?.getAnilistCredentials) return
  try {
    const creds = api.getAnilistCredentials()
    if (creds?.clientId && /^\d+$/.test(creds.clientId) && !getClientId()) {
      try { localStorage.setItem(CLIENT_ID_KEY, creds.clientId) } catch {}
      console.log('[anilist-auth] Restored Client ID from disk')
    }
    if (creds?.clientSecret && !getClientSecret()) {
      try { localStorage.setItem(CLIENT_SECRET_KEY, creds.clientSecret) } catch {}
      console.log('[anilist-auth] Restored Client Secret from disk')
    }
  } catch { /* IPC not available (browser mode) */ }
}

/** True when a Client Secret is available (any source). */
export function hasClientSecret(): boolean {
  return !!getClientSecret()
}

/** Back-compat: legacy callers import CLIENT_ID as a constant. We export
 *  a getter wrapped in a thin compatibility shim. Re-evaluated at module
 *  load time — call getClientId() if you need fresh values. */
export const CLIENT_ID: string | undefined =
  (typeof window !== 'undefined' ? (() => {
    try {
      const fromLs = localStorage.getItem(CLIENT_ID_KEY)
      if (fromLs && /^\d+$/.test(fromLs)) return fromLs
    } catch { /* ignore */ }
    return ENV_CLIENT_ID
  })() : ENV_CLIENT_ID)

export interface AniListAuth {
  token: string
  expiresAt: number
  user: {
    id: number
    name: string
    avatar: string | null
    /** AniList profile banner (1920×400) — used as hero backdrop on /profile. */
    bannerImage: string | null
    /** User bio/about (may contain markdown/HTML). */
    about: string | null
    /** Profile accent color (hex, e.g. "#aabbcc"). */
    profileColor: string | null
    /** Total anime completed. */
    animeCount: number
    /** Total episodes watched. */
    episodesWatched: number
    /** Total watch time in minutes. */
    minutesWatched: number
    /** Follower count. */
    followers: number
    /** Following count. */
    following: number
  }
}

// ─────────────────────────────────────────────────────────────────
// Token persistence
// ─────────────────────────────────────────────────────────────────
export function loadAuth(): AniListAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const a = JSON.parse(raw) as AniListAuth
    if (a.expiresAt < Date.now()) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return a
  } catch {
    return null
  }
}

export function saveAuth(a: AniListAuth) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(a))
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY)
}

// ─────────────────────────────────────────────────────────────────
// OAuth helpers
// ─────────────────────────────────────────────────────────────────
/**
 * Build the AniList authorize URL.
 *
 * Defaults to the IMPLICIT flow (`response_type=token`) — the easy path,
 * no server-side exchange needed. Token comes back in the URL fragment.
 *
 * Pass `{flow: 'code'}` to use the auth-code grant (only works when the
 * backend has ANILIST_CLIENT_SECRET configured).
 */
export function getLoginUrl(opts: { flow?: 'token' | 'code' | 'auto'; state?: string } = {}): string | null {
  const id = getClientId()
  if (!id) return null
  const flow = opts.flow ?? 'auto'
  let effectiveFlow: 'token' | 'code' = 'token'

  if (flow === 'auto') {
    // Pick the flow that matches the client TYPE:
    //   • Secret present  → CONFIDENTIAL client → authorization-code flow
    //     (response_type=code). AniList REJECTS implicit for confidential
    //     clients with "unsupported_grant_type", so we must use code here.
    //   • No secret       → PUBLIC client → implicit flow (response_type=token),
    //     the zero-backend path.
    effectiveFlow = hasClientSecret() ? 'code' : 'token'
  } else {
    effectiveFlow = flow
  }

  const redirect = `${window.location.origin}/auth/callback`
  let url =
    `https://anilist.co/api/v2/oauth/authorize` +
    `?client_id=${encodeURIComponent(id)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_type=${effectiveFlow}`
  // Include state for cross-browser token relay (external browser → Electron)
  if (opts.state) url += `&state=${encodeURIComponent(opts.state)}`
  return url
}

/** Build the redirect URI string that has to EXACTLY match what's
 *  registered in your AniList client settings — used both when sending
 *  the user to /authorize and when redeeming the code at /oauth/token. */
export function getRedirectUri(): string {
  return `${window.location.origin}/auth/callback`
}

/**
 * Parse the authorization code AniList puts in `?code=` after redirect.
 * We also handle `?error=` so the callback page can show a useful message.
 */
export function parseCodeFromQuery(): { code: string } | { error: string } | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error_description') || params.get('error')
  if (error) return { error }
  if (!code) return null
  return { code }
}

/**
 * Parse the access token AniList puts in the URL fragment after redirect.
 * PRIMARY path (implicit flow). Returns null when the user went through
 * the auth-code flow instead (then use parseCodeFromQuery).
 */
export function parseTokenFromHash(): { token: string; expiresIn: number } | { error: string } | null {
  if (typeof window === 'undefined' || !window.location.hash) return null
  const params = new URLSearchParams(window.location.hash.slice(1))
  const token = params.get('access_token')
  const error = params.get('error_description') || params.get('error')
  if (error) return { error }
  if (!token) return null
  const expiresIn = Number(params.get('expires_in')) || 31_536_000
  return { token, expiresIn }
}

/**
 * Custom error so AuthCallback can render the structured debug payload
 * (what redirect_uri we sent, what AniList replied) — much more useful
 * than just "Request failed with status code 500".
 */
export class AniListExchangeError extends Error {
  upstream?: number
  debug?: unknown
  constructor(msg: string, upstream?: number, debug?: unknown) {
    super(msg)
    this.upstream = upstream
    this.debug = debug
  }
}

/**
 * Exchange the authorization code for an access token via the backend.
 * The backend talks to AniList's /oauth/token with the client_secret —
 * we never expose the secret to the browser.
 */
export async function exchangeCodeForToken(
  code: string,
): Promise<{ token: string; expiresIn: number }> {
  // 1. Try backend first (most secure — secret never leaves the server)
  try {
    const { data, status } = await axios.post(
      `${getBackendOrigin()}/api/anilist/exchange`,
      { code, redirectUri: getRedirectUri() },
      { validateStatus: () => true, timeout: 5000 },
    )
    if (data?.ok) {
      return { token: data.data.accessToken, expiresIn: data.data.expiresIn }
    }
    // If backend returned a structured error, surface it — don't fall back
    if (data && !data.ok) {
      throw new AniListExchangeError(
        data?.error || `Token exchange failed (HTTP ${status})`,
        data?.upstream ?? status,
        data?.debug,
      )
    }
  } catch (e) {
    // Only fall back on network/timeout errors, not backend-level errors
    if (e instanceof AniListExchangeError) throw e
    if (axios.isAxiosError(e) && e.response) throw e
    // Fall through to frontend fallback
  }

  // 2. Frontend fallback: call AniList directly with the stored secret
  const secret = getClientSecret()
  if (!secret) {
    throw new Error(
      'The backend is not running and no Client Secret is stored locally. ' +
      'Either start the backend or add your Client Secret in the sign-in setup.'
    )
  }

  const { data: anilistData, status: anilistStatus } = await axios.post(
    'https://anilist.co/api/v2/oauth/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: String(getClientId()),
      client_secret: secret,
      redirect_uri: getRedirectUri(),
      code,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      timeout: 10_000,
      validateStatus: () => true,
    },
  )

  if (anilistStatus >= 400 || !anilistData?.access_token) {
    throw new AniListExchangeError(
      anilistData?.hint || anilistData?.error_description || anilistData?.error || `AniList returned ${anilistStatus}`,
      anilistStatus,
      { anilist_response: anilistData },
    )
  }

  return { token: anilistData.access_token, expiresIn: Number(anilistData.expires_in) || 31_536_000 }
}

// ─────────────────────────────────────────────────────────────────
// Authenticated GraphQL
// ─────────────────────────────────────────────────────────────────
async function authQuery<T>(token: string, gql: string, variables: Record<string, unknown> = {}): Promise<T> {
  // Goes through the shared resilient client so authenticated reads AND
  // mutations (saveListEntry/postTextActivity) survive AniList's 429s
  // during a binge instead of silently dropping the update.
  return anilistRequest<T>(gql, variables, { token })
}

// ─────────────────────────────────────────────────────────────────
// User & lists
// ─────────────────────────────────────────────────────────────────
export async function fetchCurrentUser(token: string): Promise<AniListAuth['user']> {
  // Two-step fetch:
  //   1. Viewer (basic profile + statistics) — User type no longer exposes
  //      followers/following *connections* (they were deprecated; only the
  //      isFollower/isFollowing booleans remain on User).
  //   2. Page.followers / Page.following — the supported way to enumerate
  //      a user's network. AniList explicitly disables pageInfo.total for
  //      these heavy queries, so we cap at perPage=50 and use the array
  //      length. Anything >50 we display as "50+" on the Profile UI.
  //   The follower query is best-effort: if it 429s or otherwise fails,
  //   fall back to 0 so auth still completes.
  const data = await authQuery<{
    Viewer: {
      id: number
      name: string
      avatar: { medium: string | null; large: string | null } | null
      bannerImage: string | null
      about: string | null
      options: { profileColor: string | null } | null
      statistics: {
        anime: {
          count: number
          episodesWatched: number
          minutesWatched: number
        }
      } | null
    }
  }>(token, `query {
    Viewer {
      id name
      avatar { medium large }
      bannerImage
      about (asHtml: false)
      options { profileColor }
      statistics {
        anime { count episodesWatched minutesWatched }
      }
    }
  }`)
  const v = data.Viewer

  const network = await authQuery<{
    Followers: { followers: { id: number }[] } | null
    Following: { following: { id: number }[] } | null
  }>(
    token,
    // NOTE: perPage lives on the inner followers()/following() calls, NOT
    // on the outer Page — the outer Page params only affect sibling
    // queries that don't specify their own pagination. Page.followers has
    // its own (page, perPage) args (default 25); we want 50 so a user
    // sitting right at the achievement threshold (~50) shows their real
    // count instead of an imprecise "50+". The returned array length
    // is the displayed count.
    `query ($id: Int) {
      Followers: Page {
        followers(userId: $id, page: 1, perPage: 50) { id }
      }
      Following: Page {
        following(userId: $id, page: 1, perPage: 50) { id }
      }
    }`,
    { id: v.id },
  ).catch(() => null)

  return {
    id: v.id,
    name: v.name,
    avatar: (v.avatar?.large || v.avatar?.medium) ?? null,
    bannerImage: v.bannerImage ?? null,
    about: v.about ?? null,
    profileColor: v.options?.profileColor ?? null,
    animeCount: v.statistics?.anime?.count ?? 0,
    episodesWatched: v.statistics?.anime?.episodesWatched ?? 0,
    minutesWatched: v.statistics?.anime?.minutesWatched ?? 0,
    followers: network?.Followers?.followers?.length ?? 0,
    following: network?.Following?.following?.length ?? 0,
  }
}

export type ListStatus =
  | 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'DROPPED' | 'PAUSED' | 'REPEATING'

export interface AniListEntry {
  id: number
  status: ListStatus
  progress: number
  score: number
  mediaId: number
  media: {
    id: number
    idMal: number | null
    title: { romaji: string; english: string | null; native: string | null }
    coverImage: { large: string | null; color: string | null }
    episodes: number | null
    averageScore: number | null
    format: string | null
  }
}

/** Fetch all anime list entries (paginated, default page 1). */
export async function fetchUserList(
  token: string,
  userId: number,
  status?: ListStatus,
): Promise<AniListEntry[]> {
  // Only declare $status in the GraphQL query AND include it in variables
  // when explicitly provided. Sending `null` to AniList causes it to
  // filter by null-status, which returns zero results. Omitting the
  // variable declaration entirely avoids this — AniList then defaults
  // to "no filter" and returns all statuses.
  const hasStatus = status != null
  const variables: Record<string, unknown> = { userId }
  if (hasStatus) variables.status = status

  const gql = hasStatus
    ? `
    query ($userId: Int, $status: MediaListStatus) {
      MediaListCollection(userId: $userId, type: ANIME, status: $status) {
        lists {
          entries {
            id status progress score mediaId
            media {
              id idMal
              title { romaji english native }
              coverImage { large color }
              episodes averageScore format
            }
          }
        }
      }
    }`
    : `
    query ($userId: Int) {
      MediaListCollection(userId: $userId, type: ANIME) {
        lists {
          entries {
            id status progress score mediaId
            media {
              id idMal
              title { romaji english native }
              coverImage { large color }
              episodes averageScore format
            }
          }
        }
      }
    }`

  const data = await authQuery<{
    MediaListCollection: {
      lists: { entries: AniListEntry[] }[]
    }
  }>(token, gql, variables)
  return data.MediaListCollection?.lists?.flatMap((l) => l.entries) ?? []
}

/** Add/update an entry. Returns the AniList entry id. */
export async function saveListEntry(
  token: string,
  args: {
    mediaId: number
    status?: ListStatus
    progress?: number
    score?: number
  },
): Promise<number> {
  const data = await authQuery<{ SaveMediaListEntry: { id: number } }>(
    token,
    `mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $score: Float) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, score: $score) {
        id status progress
      }
    }`,
    args,
  )
  return data.SaveMediaListEntry.id
}

export async function deleteListEntry(token: string, id: number): Promise<boolean> {
  const data = await authQuery<{ DeleteMediaListEntry: { deleted: boolean } }>(
    token,
    `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`,
    { id },
  )
  return data.DeleteMediaListEntry.deleted
}

/**
 * Post a text status to the user's AniList activity feed.
 * We use this for batched episode progress messages like
 * "📺 Watched episodes 2–8 of Hunter × Hunter (2011) on Kurōdo"
 */
export async function postTextActivity(token: string, text: string): Promise<number> {
  const data = await authQuery<{ SaveTextActivity: { id: number } }>(
    token,
    `mutation ($text: String) {
      SaveTextActivity(text: $text) { id }
    }`,
    { text },
  )
  return data.SaveTextActivity.id
}

// ─────────────────────────────────────────────────────────────────
// Relations (sequel / prequel / side-story / etc.) — public query
// ─────────────────────────────────────────────────────────────────
export type RelationType =
  | 'SEQUEL' | 'PREQUEL' | 'PARENT' | 'SIDE_STORY' | 'ALTERNATIVE'
  | 'SPIN_OFF' | 'CHARACTER' | 'OTHER' | 'SUMMARY' | 'CONTAINS'
  | 'ADAPTATION' | 'SOURCE'

export interface RelationEdge {
  relationType: RelationType
  node: {
    id: number
    idMal: number | null
    type: 'ANIME' | 'MANGA'
    format: string | null
    title: { romaji: string; english: string | null; native: string | null }
    coverImage: { large: string | null; color: string | null }
    episodes: number | null
    status: string | null
    seasonYear: number | null
    averageScore: number | null
  }
}

/** Fetch relations for an anime by AniList ID. */
export async function fetchRelations(anilistId: number): Promise<RelationEdge[]> {
  // No auth needed for relations — but still routes through the resilient
  // client so it backs off on 429 like every other AniList call.
  const data = await anilistRequest<{
    Media: { relations: { edges: RelationEdge[] } | null } | null
  }>(
    `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        relations {
          edges {
            relationType
            node {
              id idMal type format
              title { romaji english native }
              coverImage { large color }
              episodes status seasonYear averageScore
            }
          }
        }
      }
    }`,
    { id: anilistId },
  )
  const edges: RelationEdge[] = data.Media?.relations?.edges ?? []
  // Filter to anime only (drops manga/novel adaptations)
  return edges.filter((e) => e.node.type === 'ANIME')
}


// ─────────────────────────────────────────────────────────────────
// Activity feed read + delete (for /activity dashboard)
// ─────────────────────────────────────────────────────────────────

export interface MyTextActivity {
  id: number
  text: string
  createdAt: number       // unix seconds
  likeCount: number
  replyCount: number
  siteUrl: string | null
  isLiked: boolean
}

/**
 * Fetch the signed-in user's recent text activities (the ones our app
 * posts via `SaveTextActivity`). AniList paginates 25 per page.
 */
export async function fetchMyActivity(
  token: string, userId: number, page = 1, perPage = 25,
): Promise<{ items: MyTextActivity[]; hasNextPage: boolean }> {
  const data = await authQuery<{
    Page: {
      pageInfo: { hasNextPage: boolean }
      activities: Array<{
        id: number
        text: string
        createdAt: number
        likeCount: number
        replyCount: number
        siteUrl: string | null
        isLiked: boolean
      } | null>
    }
  }>(token, `
    query ($userId: Int, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        activities(
          userId: $userId
          type: TEXT
          sort: ID_DESC
        ) {
          ... on TextActivity {
            id text createdAt likeCount replyCount siteUrl isLiked
          }
        }
      }
    }
  `, { userId, page, perPage })
  // The activities union can include nulls when an entry isn't a
  // TextActivity at the gql layer; filter those out for safety.
  const items = (data.Page.activities ?? [])
    .filter((a): a is NonNullable<typeof a> => !!a && typeof a.text === 'string')
    .map((a) => ({
      id: a.id,
      text: a.text,
      createdAt: a.createdAt,
      likeCount: a.likeCount,
      replyCount: a.replyCount,
      siteUrl: a.siteUrl,
      isLiked: !!a.isLiked,
    }))
  return { items, hasNextPage: data.Page.pageInfo.hasNextPage }
}

/** Delete one of the signed-in user's activity entries. */
export async function deleteActivityById(token: string, id: number): Promise<boolean> {
  const data = await authQuery<{ DeleteActivity: { deleted: boolean } | null }>(
    token,
    `mutation ($id: Int) { DeleteActivity(id: $id) { deleted } }`,
    { id },
  )
  return !!data.DeleteActivity?.deleted
}
