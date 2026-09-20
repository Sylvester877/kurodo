// Inspect the live sign-in decision state: what flow would getLoginUrl pick
// right now, and what's on disk (Electron IPC) vs localStorage.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(2500)

const probe = await page.evaluate(() => {
  const ls = (k) => localStorage.getItem(k)
  const api = window.electronAPI
  return {
    lsSecretPresent: ls('kurodo-anilist-client-secret') != null,
    lsSecretLen: (ls('kurodo-anilist-client-secret') || '').length || null,
    lsClientId: ls('kurodo-anilist-client-id'),
    pairRejectedFlag: ls('kurodo-anilist-pair-rejected') != null,
    retryFlagSession: sessionStorage.getItem('kurodo-anilist-implicit-retry') != null,
    hasDiskCredsApi: typeof api?.getAnilistCredentials === 'function',
  }
})
console.log('renderer state:', JSON.stringify(probe, null, 2))

// What do the DISK credentials hold? (they re-seed localStorage on boot)
if (probe.hasDiskCredsApi) {
  const disk = await page.evaluate(async () => {
    try {
      const c = await window.electronAPI.getAnilistCredentials()
      return { clientId: c?.clientId ?? null, secretLen: c?.clientSecret ? String(c.clientSecret).length : 0 }
    } catch (e) { return { error: String(e).slice(0, 80) } }
  })
  console.log('disk credentials:', JSON.stringify(disk))
}

process.exit(0)
