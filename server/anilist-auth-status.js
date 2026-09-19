// AniList OAuth pair status for /api/health — additive diagnostics.
//
// Probes AniList's token endpoint with the server-side pair and a
// well-formed FAKE code. The reply distinguishes the two failure classes:
//   401 invalid_client                     → the pair itself is rejected
//   400 invalid_request "Cannot decrypt…"  → pair VALID (fails at the fake
//                                            code, which is expected —
//                                            client auth happened first)
// Result cached 10 minutes; never logs or returns the secret.
import axios from 'axios'

const TTL_MS = 10 * 60 * 1000
let cache = { at: 0, status: null }

export async function getAnilistAuthStatus() {
  const clientId = process.env.VITE_ANILIST_CLIENT_ID || process.env.ANILIST_CLIENT_ID
  const clientSecret = process.env.ANILIST_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return { configured: false, pairValid: null, reason: 'missing env: VITE_ANILIST_CLIENT_ID / ANILIST_CLIENT_SECRET' }
  }
  if (Date.now() - cache.at < TTL_MS && cache.status) return cache.status

  const probe = async () => {
    const { data, status } = await axios.post(
      'https://anilist.co/api/v2/oauth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: String(clientId),
        client_secret: String(clientSecret),
        redirect_uri: 'http://localhost:5173/auth/callback',
        code: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', // well-formed fake
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        timeout: 8000,
        validateStatus: () => true,
      },
    )
    const err = data?.error
    if (status === 401 && err === 'invalid_client') return { pairValid: false, reason: 'AniList rejected the ID+secret pair (invalid_client) — regenerate the secret at anilist.co/settings/developer' }
    if (status === 400 && /decrypt/i.test(data?.hint || '')) return { pairValid: true, reason: 'pair authenticates (probe failed at the fake code, as expected)' }
    if (status === 400 && err === 'unsupported_grant_type') return { pairValid: null, reason: 'AniList says unsupported_grant_type — probe shape changed?' }
    return { pairValid: null, reason: `unexpected probe reply HTTP ${status} ${err || ''}`.trim() }
  }

  try {
    const status = { configured: true, ...(await probe()), checkedAt: new Date().toISOString() }
    cache = { at: Date.now(), status }
    return status
  } catch (e) {
    return { configured: true, pairValid: null, reason: `probe network error: ${e.code || e.message}` }
  }
}
