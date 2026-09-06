// Dump the structural markup of anikage's top (hero) region and the
// Featured Anime / Editor's Pick section so Kurodo can mirror it.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 1100 })
await p.goto('https://anikage.cc/', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 7000))

const out = await p.evaluate(() => {
  const strip = (el, depth) => {
    if (!el || depth > 3) return ''
    const r = el.getBoundingClientRect()
    const tag = el.tagName.toLowerCase()
    const cls = (el.className + '').toString().slice(0, 90)
    let s = '  '.repeat(depth) + `<${tag}${cls ? ' class="' + cls + '"' : ''}>`
    // include text leaves
    const directText = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).filter(Boolean).join(' ')
    if (directText) s += ' "' + directText.slice(0, 60) + '"'
    // images / videos matter
    const img = el.querySelector(':scope > img, :scope > video, :scope > picture')
    if (img && img.src) s += ` [img ${(img.src + '').slice(0, 70)}]`
    s += '\n'
    for (const c of el.children) {
      if (c.children.length === 0) {
        const t = c.textContent.trim().replace(/\s+/g, ' ').slice(0, 70)
        if (t) s += '  '.repeat(depth + 1) + `<${c.tagName.toLowerCase()}${c.className ? ' class="' + (c.className + '').toString().slice(0, 60) + '"' : ''}> "${t}"\n`
      } else {
        s += strip(c, depth + 1)
      }
    }
    return s
  }

  const y = (el) => Math.round(el.getBoundingClientRect().y + window.scrollY)

  // Find hero: topmost full-width container after nav, > 60vh tall
  const all = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 1200 && r.height > 500 && r.y + window.scrollY < 50 && r.top >= -50
  }).sort((a, b2) => b2.getBoundingClientRect().height - a.getBoundingClientRect().height)[0]

  // Featured header row (contains Editor's Pick chip)
  const pick = [...document.querySelectorAll('span')].find((el) => /editor'?s pick/i.test(el.textContent) && el.offsetParent)
  let featuredSection = null
  if (pick) {
    // climb to the section wrapper containing header + content
    let node = pick
    for (let i = 0; i < 6 && node; i++) {
      node = node.parentElement
      if (node && node.querySelectorAll('img').length >= 1 && node.getBoundingClientRect().height > 200) { featuredSection = node; break }
    }
  }
  return {
    heroY: all ? y(all) : null,
    heroH: all ? Math.round(all.getBoundingClientRect().height) : null,
    heroTop: all ? strip(all, 0).slice(0, 2600) : 'none',
    featuredY: featuredSection ? y(featuredSection) : null,
    featuredMarkup: featuredSection ? strip(featuredSection, 0).slice(0, 3000) : 'none',
  }
})
console.log('=== HERO region === y=' + out.heroY + ' h=' + out.heroH)
console.log(out.heroTop)
console.log('=== FEATURED/EDITOR region === y=' + out.featuredY)
console.log(out.featuredMarkup)
await b.close()
