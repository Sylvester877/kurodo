import axios from 'axios'

const SITE = 'https://anidap.se'
const API = 'https://chad.anidap.se'

// Test Re:Zero S4 AniList ID... need to find it first.
// Let's test with a very popular anime - Demon Slayer S1 = 101922
const TEST_ID = 101922

async function test() {
  console.log('=== Testing AniList ID → slug ===')
  try {
    const url = `${SITE}/info/${TEST_ID}.data`
    const { data } = await axios.get(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        accept: 'application/json, */*',
        referer: `${SITE}/`,
        origin: SITE,
      },
      timeout: 10000,
    })
    console.log('info.data response type:', typeof data, Array.isArray(data) ? 'array' : 'not array')
    if (Array.isArray(data)) console.log('length:', data.length, 'first few:', data.slice(0, 20))
    else console.log('data:', JSON.stringify(data).slice(0, 500))
    
    // Find slug
    let slug = null
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length - 1; i++) {
        if (data[i] === 'id' && typeof data[i + 1] === 'string'
            && /^[a-z0-9][a-z0-9-]+-[a-z0-9]{4,6}$/i.test(data[i + 1])) {
          slug = data[i + 1]
          break
        }
      }
    }
    console.log('Found slug:', slug)
    if (!slug) return

    console.log('\n=== Testing episodes ===')
    const epUrl = `${API}/rest/api/episodes?id=${encodeURIComponent(slug)}`
    const { data: epData } = await axios.get(epUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        accept: 'application/json, */*',
        referer: `${SITE}/`,
        origin: SITE,
      },
      timeout: 10000,
    })
    console.log('Episodes response type:', typeof epData, Array.isArray(epData))
    if (Array.isArray(epData)) console.log('Episode count:', epData.length, 'first:', epData[0])
    else console.log('epData:', JSON.stringify(epData).slice(0, 500))

    console.log('\n=== Testing servers for ep 1 ===')
    const srvUrl = `${API}/rest/api/servers?id=${encodeURIComponent(slug)}&epNum=1`
    const { data: srvData } = await axios.get(srvUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        accept: 'application/json, */*',
        referer: `${SITE}/`,
        origin: SITE,
      },
      timeout: 10000,
    })
    console.log('Servers:', JSON.stringify(srvData, null, 2).slice(0, 800))

    // Pick first provider
    let providers = []
    for (const key of Object.keys(srvData || {})) {
      if (!key.endsWith('Providers')) continue
      const type = key.replace('Providers', '')
      const list = Array.isArray(srvData[key]) ? srvData[key] : []
      for (const p of list) {
        const id = typeof p === 'string' ? p : (p.id || p.name)
        if (id) providers.push({ name: id, type })
      }
    }
    console.log('Parsed providers:', providers.slice(0, 5))
    if (providers.length === 0) return

    console.log('\n=== Testing stream ===')
    const p = providers[0]
    const strUrl = `${API}/rest/api/sources?id=${encodeURIComponent(slug)}&epNum=1&type=${p.type}&providerId=${encodeURIComponent(p.name)}`
    const { data: strData } = await axios.get(strUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        accept: 'application/json, */*',
        referer: `${SITE}/watch?id=${encodeURIComponent(slug)}&ep=1&type=${p.type}&provider=${p.name}`,
        origin: SITE,
      },
      timeout: 12000,
    })
    console.log('Stream response:', JSON.stringify(strData, null, 2).slice(0, 1000))
  } catch (e) {
    console.error('ERROR:', e.code, e.message)
    if (e.response) {
      console.error('Status:', e.response.status)
      console.error('Data:', JSON.stringify(e.response.data).slice(0, 500))
    }
  }
}

test()
