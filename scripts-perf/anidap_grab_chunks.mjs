// Download every JS asset referenced (directly or via modulepreload/import) by
// the anidap watch page, then grep for the consumer of `/api/anime/sources`
// and any decode logic around it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'scripts-perf', 'anidap_chunks')
fs.mkdirSync(OUT, { recursive: true })

const BASE = 'https://anidap.lol'
const seen = new Set()
const queue = ['/watch?id=5114&ep=1&type=sub', '/home']

const assetRe = /(?:src|href)=["'](\/assets\/[^"']+\.js)["']/g
const importRe = /from\s*["'](\.\/[^"']+\.js|\/assets\/[^"']+\.js)["']/g
const dynamicRe = /import\(["'](\/assets\/[^"']+\.js|\.[^"']+\.js)["']\)/g

async function grab(u) {
  const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', Accept: '*/*' } })
  if (!res.ok) throw new Error(`${res.status} ${u}`)
  return res.text()
}

while (queue.length) {
  const route = queue.shift()
  const url = route.startsWith('http') ? route : BASE + route
  if (seen.has(url)) continue
  seen.add(url)
  try {
    const text = await grab(url)
    const name = url.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '_')
    const dest = path.join(OUT, name)
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, text)
    const found = new Set()
    for (const re of [assetRe, importRe, dynamicRe]) {
      for (const m of text.matchAll(re)) {
        let a = m[1]
        if (a.startsWith('./')) a = '/assets/' + a.slice(2)
        found.add(a)
      }
    }
    for (const a of found) if (!seen.has(BASE + a)) queue.push(a)
    console.log(`got ${url} (${text.length}b) -> +${found.size} refs`)
  } catch (e) {
    console.log(`SKIP ${url}: ${e.message}`)
  }
}
console.log(`total fetched: ${seen.size}`)
