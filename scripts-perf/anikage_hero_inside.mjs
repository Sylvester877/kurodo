// Inspect the actual inner content of anikage's hero-shell (backdrop slideshow?).
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
await new Promise((r) => setTimeout(r, 9000))

const out = await p.evaluate(() => {
  const shell = document.querySelector('.hero-shell') || [...document.querySelectorAll('section')].find((s) => /hero/i.test((s.className + '')))
  if (!shell) return { found: false }
  const y = (el) => Math.round(el.getBoundingClientRect().y + window.scrollY)
  const summarize = (el, depth) => {
    if (!el || depth > 6) return ''
    const tag = el.tagName.toLowerCase()
    const cls = (el.className + '').toString().slice(0, 80)
    const r = el.getBoundingClientRect()
    let s = '  '.repeat(depth) + `<${tag}${cls ? ' .' + cls.split(' ').slice(0, 3).join(' .') : ''}>`
    if (r.width > 4 && r.height > 4) s += ` [${Math.round(r.width)}x${Math.round(r.height)}@y${Math.round(r.y + scrollY)}]`
    const txt = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).filter(Boolean).join(' ')
    if (txt) s += ' "' + txt.slice(0, 50) + '"'
    const img = el.tagName === 'IMG' ? (el.src + '').slice(0, 60) : null
    const vid = el.tagName === 'VIDEO' ? 'VIDEO' : null
    if (img) s += ' [IMG ' + img + ']'
    if (vid) s += ' [VIDEO]'
    if (el.children.length) s += ' {\n' + [...el.children].map((c) => summarize(c, depth + 1)).join('') + '  '.repeat(depth) + '}'
    s += '\n'
    return s
  }
  const info = {
    found: true,
    h: Math.round(shell.getBoundingClientRect().height),
    bgImage: getComputedStyle(shell).backgroundImage.slice(0, 100),
    tree: summarize(shell, 0).slice(0, 4200),
  }
  return info
})
if (!out.found) { console.log('no hero shell found'); process.exit(0) }
console.log('hero h=' + out.h)
console.log('hero bgImage:', out.bgImage)
console.log(out.tree)
await b.close()
