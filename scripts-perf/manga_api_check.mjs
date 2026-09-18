const BASE = 'http://127.0.0.1:5173'
async function check(url) {
  const r = await fetch(url)
  const t = await r.text()
  console.log(url, '->', r.status, t.slice(0,1200).replace(/\s+/g,' ').slice(0,1000))
}
await check(`${BASE}/api/atsu/info/sVC2A`)
await check(`${BASE}/api/atsu/chapters/sVC2A`)
await check(`${BASE}/api/atsu/pages/sVC2A/yaCvs`)
