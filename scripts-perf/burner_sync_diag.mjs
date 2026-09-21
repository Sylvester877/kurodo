// Diagnose why the e2e sync didn't reach AniList:
//   • incognito setting (pauses progress by design)
//   • autoplayNext / autonext settings
//   • sync-confirm dialog currently open?
//   • current URL + video state
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

const state = await page.evaluate(() => {
  const out = { url: location.href }
  // Settings store — find the zustand persist key.
  for (const k of Object.keys(localStorage)) {
    if (/kurodo.*setting/i.test(k)) {
      try {
        const j = JSON.parse(localStorage.getItem(k))
        const s = j?.state ?? j
        out.settingsKey = k
        out.incognito = s.incognito ?? s.incognitoMode ?? null
        out.autoSyncAniList = s.autoSyncAniList ?? null
        out.autoplayNext = s.autoplayNext ?? s.autoPlayNext ?? null
        out.subDubFilter = s.subDubFilter ?? null
      } catch { /* skip */ }
    }
  }
  // Sync dialog open?
  out.syncDialogOpen = !!document.querySelector('[role="dialog"]') &&
    [...document.querySelectorAll('[role="dialog"]')].some((d) => /sync|anilist|confirm/i.test(d.textContent || ''))
  // Any visible toast?
  out.lastToast = [...document.querySelectorAll('[data-sonner-toast], .toast')].map((t) => t.textContent?.trim()).slice(-3)
  // Video state.
  const v = document.querySelector('video')
  out.video = v ? { ct: Math.round(v.currentTime || 0), dur: Math.round(v.duration || 0), paused: v.paused, ended: v.ended, rate: v.playbackRate } : null
  return out
})
console.log(JSON.stringify(state, null, 2))
browser.disconnect()
