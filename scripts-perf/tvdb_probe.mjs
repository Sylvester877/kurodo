// TVDB v4 timing/size probe: how much do we pay for `short=false`, and does
// the login dominate a cold episode fetch?
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')))
const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
const KEY = (/TVDB_API_KEY\s*=\s*(.+)/.exec(env)?.[1] || '').trim()
if (!KEY) { console.log('no TVDB_API_KEY'); process.exit(0) }

const S = Date.now()
const login = await fetch('https://api4.thetvdb.com/v4/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ apikey: KEY }),
})
const loginJson = await login.json()
const token = loginJson?.data?.token
console.log(`login ${login.status} ${Date.now() - S}ms`)

for (const [seriesId, name] of [[81797, 'One Piece'], [74796, 'Bleach TYBW'], [424536, 'Frieren']]) {
  for (const short of ['false', 'true']) {
    const t = Date.now()
    const r = await fetch(`https://api4.thetvdb.com/v4/series/${seriesId}/extended?meta=episodes&short=${short}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const buf = Buffer.from(await r.arrayBuffer())
    const j = JSON.parse(buf.toString('utf8'))
    const eps = j?.data?.episodes || []
    const bytes = buf.byteLength
    const withImg = eps.filter((e) => e.image).length
    console.log(`${name.padEnd(12)} short=${short.padEnd(5)} ${r.status} ${String(Date.now() - t).padStart(6)}ms ${String(Math.round(bytes / 1024)).padStart(6)}KB ${eps.length} eps (${withImg} with image)`)
  }
}
