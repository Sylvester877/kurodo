// Read AniList auth-related localStorage from the live Electron window.
// Prints client IDs in full, secrets as LENGTH ONLY (never the value).
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

const probe = await page.evaluate(() => {
  const get = (k) => localStorage.getItem(k)
  const authRaw = get('kurodo-anilist-auth')
  let auth = null
  try { auth = authRaw ? JSON.parse(authRaw) : null } catch {}
  return {
    lsClientId: get('kurodo-anilist-client-id'),
    lsSecretLen: (get('kurodo-anilist-client-secret') || '').length || null,
    hasAuth: !!authRaw,
    authTokenLen: auth?.token ? String(auth.token).length : null,
    authExpiresIn: auth?.expiresIn ?? null,
    origin: window.location.origin,
  }
})
console.log(JSON.stringify(probe, null, 2))

// Also compare against the env client id baked into the bundle.
const html = await page.evaluate(async () => {
  const envId = import.meta?.env?.VITE_ANILIST_CLIENT_ID
  return envId ?? null
}).catch(() => null)
console.log('renderer import.meta.env.VITE_ANILIST_CLIENT_ID:', html ?? 'n/a (not readable outside module)')

process.exit(0)
