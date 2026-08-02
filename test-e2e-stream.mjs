// E2E test: full streaming pipeline for Demon Slayer (AniList #101922)
// Tests: slug resolution → servers → stream sources → proxy reachability
import axios from 'axios'

const BASE = 'http://localhost:5173'
const ANILIST_ID = 101922

async function test() {
  // Step 1: Health check
  try {
    const health = await axios.get(`${BASE}/api/health`, { timeout: 5000 })
    console.log('✓ Backend UP:', health.data?.uptime + 's uptime')
  } catch (e) {
    console.error('✗ Backend DOWN:', e.message)
    return
  }

  // Step 2: Resolve slug
  let slug
  try {
    const info = await axios.get(`${BASE}/api/anidap/info/${ANILIST_ID}`, { timeout: 15000 })
    slug = info.data?.data?.slug
    console.log('✓ Slug:', slug, '(source:', info.data?.data?.source + ')')
  } catch (e) {
    console.error('✗ Slug resolution failed:', e.response?.data?.error || e.message)
    return
  }

  // Step 3: Get servers
  try {
    const servers = await axios.get(`${BASE}/api/anidap/servers/${slug}/1?anilistId=${ANILIST_ID}`, { timeout: 15000 })
    const list = servers.data?.data?.providers || []
    console.log(`✓ Servers: ${list.length} total`)
    const sub = list.filter(s => s.type === 'sub')
    const dub = list.filter(s => s.type === 'dub')
    console.log(`  Sub: ${sub.length}, Dub: ${dub.length}`)
    if (sub.length > 0) console.log('  Sub servers:', sub.slice(0, 5).map(s => s.name).join(', '))
    if (dub.length > 0) console.log('  Dub servers:', dub.slice(0, 5).map(s => s.name).join(', '))
  } catch (e) {
    console.error('✗ Server fetch failed:', e.response?.data?.error || e.message)
  }

  // Step 4: Get stream from first sub server (yuki)
  try {
    const stream = await axios.get(
      `${BASE}/api/anidap/sources/${slug}/1/anidap-yuki/sub?anilistId=${ANILIST_ID}`,
      { timeout: 20000 }
    )
    const data = stream.data?.data
    if (data?.proxiedUrl) {
      console.log('✓ Stream URL obtained:', data.proxiedUrl.slice(0, 80))
      console.log('  Source:', data.source || 'unknown')
      console.log('  Raw:', (data.raw || '').slice(0, 80))
      
      // Step 5: Test proxy
      const proxyUrl = data.proxiedUrl.startsWith('http') ? data.proxiedUrl : `${BASE}${data.proxiedUrl}`
      try {
        const proxyResp = await axios.get(proxyUrl, { 
          timeout: 10000,
          validateStatus: () => true,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        })
        console.log(`✓ Proxy: ${proxyResp.status} (${proxyResp.headers['content-type'] || '?'})`)
      } catch (e) {
        console.error(`✗ Proxy failed: ${e.response?.status || e.message}`)
      }
    } else {
      console.log('✗ No stream URL in response:', JSON.stringify(data).slice(0, 200))
    }
  } catch (e) {
    console.error('✗ Stream fetch failed:', e.response?.data?.error || e.message)
  }
}

test().catch(e => console.error('FATAL:', e.message))
