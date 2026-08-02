import http from 'http'

const ALL_DUB_SERVERS = [
  'yuki', 'nuri', 'kami', 'koto', 'neko',
  'miku', 'vee', 'uwu', 'beep'
]

const slug = 'naruto-shippuuden'
const ep = 1
const anilistId = 1735
const SERVER = 'localhost:5173'

function testProvider(name) {
  return new Promise((resolve) => {
    const start = Date.now()
    const path = `/api/anidap/sources/${slug}/${ep}/anidap-${name}/dub?anilistId=${anilistId}`
    let data = ''
    const req = http.get(
      { hostname: 'localhost', port: 5173, path, timeout: 70000 },
      (res) => {
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          const elapsed = Date.now() - start
          try {
            const json = JSON.parse(data)
            const source =
              json?.url ||
              json?.raw ||
              json?.sources?.[0]?.url ||
              json?.tracks?.[0]?.file
            if (source) {
              resolve({ name, status: 'OK', timeMs: elapsed, url: String(source).slice(0, 140) })
            } else {
              resolve({ name, status: 'NO_STREAM', timeMs: elapsed, response: JSON.stringify(json).slice(0, 200) })
            }
          } catch (e) {
            resolve({ name, status: 'PARSE_ERROR', timeMs: elapsed, response: data.slice(0, 200) })
          }
        })
      }
    )
    req.on('error', (err) => resolve({ name, status: 'ERROR', timeMs: Date.now() - start, response: err.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ name, status: 'TIMEOUT', timeMs: Date.now() - start })
    })
  })
}

console.log(`Testing DUB servers for ${slug} ep${ep} (anilistId ${anilistId})...\n`)
const results = []
for (const name of ALL_DUB_SERVERS) {
  const r = await testProvider(name)
  results.push(r)
  console.log(JSON.stringify(r))
}

console.log('\n--- SUMMARY ---')
const ok = results.filter((r) => r.status === 'OK')
const failed = results.filter((r) => r.status !== 'OK')
console.log(`Working: ${ok.length}/${ALL_DUB_SERVERS.length}`)
ok.forEach((r) => console.log(`  ✓ ${r.name.padEnd(5)} (${r.timeMs.toString().padStart(5)}ms) -> ${r.url}`))
failed.forEach((r) => console.log(`  ✗ ${r.name.padEnd(5)} -> ${r.status}${r.response ? ` | ${r.response.slice(0, 100)}` : ''}`))
