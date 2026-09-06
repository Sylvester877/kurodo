// Where does anikage show "Editor's Pick"? Full heading inventory + any pick nodes.
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
await new Promise((r) => setTimeout(r, 6000))

const out = await p.evaluate(() => {
  const pickNodes = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    if (/editor'?s pick/i.test(n.textContent)) {
      const el = n.parentElement
      const r = el.getBoundingClientRect()
      pickNodes.push({ text: el.textContent.trim().slice(0, 90), y: Math.round(r.y + scrollY), tag: el.tagName, cls: (el.className + '').slice(0, 70) })
    }
  }
  const heads = [...document.querySelectorAll('h1,h2,h3')]
    .filter((el) => el.offsetParent)
    .map((el) => ({
      t: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 55),
      y: Math.round(el.getBoundingClientRect().y + scrollY),
      cls: (el.className + '').slice(0, 50),
    }))
  return { pickNodes, heads, bodyH: document.body.scrollHeight }
})
console.log('bodyH', out.bodyH)
console.log('EDITOR PICK nodes:', out.pickNodes.length)
out.pickNodes.forEach((x) => console.log('  y=' + x.y, x.tag, JSON.stringify(x.text), '|', x.cls))
console.log('HEADINGS:')
for (const h of out.heads) console.log('  y=' + String(h.y).padStart(5), JSON.stringify(h.t), '|', h.cls)
await b.close()
