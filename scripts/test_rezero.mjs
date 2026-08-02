import axios from 'axios'
const SITE = 'https://anidap.se'
const API = 'https://chad.anidap.se'

// Re:Zero S4 — from screenshot. Let's try some common AniList IDs.
// Re:Zero S1 = 21355, S2 = 108632, S3 = 163134, S4 likely around 1800xx
// Let's search anilist quickly? No search API. Try known IDs.
const TEST_IDS = [21355, 108632, 163134, 180349, 185666, 187563]

async function test() {
  for (const id of TEST_IDS) {
    try {
      const url = `${SITE}/info/${id}.data`
      const { data } = await axios.get(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          accept: 'application/json, */*',
          referer: `${SITE}/`,
          origin: SITE,
        },
        timeout: 10000,
      })
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
      console.log(`ID ${id}: slug = ${slug}`)
      if (slug) {
        // try episodes
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
        console.log(`  Episodes: ${Array.isArray(epData) ? epData.length : 'N/A'}`)
        if (Array.isArray(epData) && epData.length > 0) {
          // try servers
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
          const providers = []
          for (const key of Object.keys(srvData || {})) {
            if (!key.endsWith('Providers')) continue
            const type = key.replace('Providers', '')
            const list = Array.isArray(srvData[key]) ? srvData[key] : []
            for (const p of list) {
              const pid = typeof p === 'string' ? p : (p.id || p.name)
              if (pid) providers.push({ name: pid, type })
            }
          }
          console.log(`  Providers for ep1: ${providers.length}`, providers.slice(0,3))
          if (providers.length > 0) {
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
            const sourceUrl = strData?.sources?.[0]?.url || strData?.sources?.[0]?.file
            console.log(`  Stream URL: ${sourceUrl ? 'YES' : 'NO'}`, sourceUrl?.slice(0,80))
          }
        }
      }
    } catch (e) {
      console.log(`ID ${id}: ERROR ${e.code} ${e.message}`)
      if (e.response) console.log(`  Status: ${e.response.status}`)
    }
  }
}

test()
