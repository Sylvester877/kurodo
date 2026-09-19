// Byte-exact A/B: same well-formed fake code, same client_id, secret sent
// 3 ways — from .env.local bytes (CR-stripped), with trailing CR appended,
// and without any secret (public-client style). Decides the root cause.
import fs from 'node:fs'

const envText = fs.readFileSync('.env.local', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp('^' + k + '=(.*)$', 'm'))
  return m ? m[1].trim() : null
}
const clientId = get('VITE_ANILIST_CLIENT_ID')
const secret = get('ANILIST_CLIENT_SECRET')

async function probe(label, body) {
  const res = await fetch('https://anilist.co/api/v2/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  })
  const json = await res.json().catch(() => null)
  console.log(`[${label}] HTTP ${res.status}:`, JSON.stringify(json).slice(0, 160))
  return json
}

const redirectUri = 'http://localhost:5173/auth/callback'
// A well-formed-but-fake code: 32 hex chars (AniList codes are ~32-char tokens).
const fakeCode = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

console.log('client_id:', clientId, '| secret len:', secret.length)
const a = await probe('A clean secret + fake code', { grant_type: 'authorization_code', client_id: clientId, client_secret: secret, redirect_uri: redirectUri, code: fakeCode })
const b = await probe('B secret + CR + fake code', { grant_type: 'authorization_code', client_id: clientId, client_secret: secret + '\r', redirect_uri: redirectUri, code: fakeCode })
const c = await probe('C no secret (public style)', { grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code: fakeCode })

console.log('\nVERDICT:')
if (a.error === 'invalid_grant') console.log('→ CLEAN PAIR VALIDATES. Root cause = secret corruption/rotation at AniList side OR earlier probes were code-mangled.')
else if (a.error === 'invalid_client') console.log('→ CLEAN PAIR STILL REJECTED → secret is genuinely wrong/rotated. Regenerate at anilist.co/settings/developer.')
if (b.error === 'invalid_grant' && a.error === 'invalid_client') console.log('→ CR-POISONING CONFIRMED: secret with trailing CR authenticates!')
if (c.error === 'invalid_client') console.log('→ (no-secret variant also rejected — expected for confidential client)')
