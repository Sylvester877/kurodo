import axios from 'axios'
import { PROVIDERS } from './server/providers/router.js'

// Mock process.env for providers that might need it

async function testProvider(p, anilistId, episode) {
  console.log(`\n--- Testing Provider: ${p.name.toUpperCase()} ---`)
  try {
    // 1. Get Info
    console.log(`[1/3] Resolving info for AniList ${anilistId}...`)
    const info = await p.getInfoByAniListId(anilistId)
    if (!info || !info.slug) {
      console.log(`❌ Failed to resolve slug.`)
      return { ok: false, stage: 'info' }
    }
    console.log(`✅ Resolved slug: ${info.slug}`)

    // 2. Get Providers
    console.log(`[2/3] Fetching servers for episode ${episode}...`)
    const servers = await p.getProviders(info.slug, episode, anilistId)
    if (!servers || servers.length === 0) {
      console.log(`❌ No servers found.`)
      return { ok: false, stage: 'servers' }
    }
    console.log(`✅ Found ${servers.length} servers: ${servers.map(s => s.name).join(', ')}`)

    // 3. Get Stream for first server
    const s = servers[0]
    console.log(`[3/3] Fetching stream for ${s.name} (${s.type})...`)
    const stream = await p.getStream(info.slug, episode, s.name, s.type, anilistId)
    if (!stream || !stream.url) {
      console.log(`❌ Failed to get stream URL.`)
      return { ok: false, stage: 'stream' }
    }
    console.log(`✅ Got stream: ${stream.url.slice(0, 80)}...`)
    
    // 4. Test URL reachability (simple HEAD request)
    try {
        const resp = await axios.head(stream.url, { 
            headers: stream.headers || {},
            timeout: 5000 
        })
        console.log(`✅ URL reachable (Status: ${resp.status})`)
    } catch (e) {
        console.log(`⚠️ HEAD request failed (might be normal for some CDNs): ${e.message}`)
    }

    return { ok: true }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`)
    return { ok: false, stage: 'error', error: e.message }
  }
}

async function runAllTests() {
  const anilistId = 20 // Naruto
  const episode = 1
  
  const results = {}
  for (const p of PROVIDERS) {
    results[p.name] = await testProvider(p, anilistId, episode)
  }

  console.log('\n\n=== FINAL TEST SUMMARY ===')
  console.table(Object.keys(results).map(name => ({
    Provider: name,
    Status: results[name].ok ? '✅ WORKING' : '❌ BROKEN',
    Stage: results[name].stage || '-'
  })))
}

runAllTests().catch(console.error)
