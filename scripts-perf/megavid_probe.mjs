// Probe megavid.buzz MAL-keyed routes for old shows (FMAB = MAL 5114).
// If megavid serves ANY MAL id, we get a chad-independent, mirror-independent source.
import axios from 'axios'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const client = axios.create({ timeout: 15000, headers: { 'User-Agent': UA }, maxRedirects: 'follow', validateStatus: () => true })

async function probe(label, url) {
  try {
    const res = await client.get(url)
    const ct = res.headers['content-type'] || ''
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    const title = (body.match(/<title[^>]*>([^<]{0,90})/i)?.[1] || '').trim()
    const iframes = [...body.matchAll(/<iframe[^>]+src=["']([^"']+)/gi)].map((m) => m[1]).slice(0, 4)
    const hasHls = /\.m3u8/i.test(body)
    console.log(`${label}: ${res.status} ct=${ct.split(';')[0]} len=${body.length}`)
    if (title) console.log(`   title: ${title}`)
    if (iframes.length) console.log(`   iframes: ${iframes.join(' | ').slice(0, 220)}`)
    if (hasHls) console.log(`   contains .m3u8 !`)
    return { status: res.status, body }
  } catch (e) {
    console.log(`${label}: ERR ${e.message}`)
    return null
  }
}

// FMAB (old show) vs Liar Game (known-working reference)
await probe('megavid FMAB  /mal/5114/1/sub ', 'https://megavid.buzz/mal/5114/1/sub')
await probe('megavid LiarG /mal/62331/1/sub', 'https://megavid.buzz/mal/62331/1/sub')

// also the megaplay variant seen in CORS list
await probe('megaplay FMAB /mal/5114/1/sub ', 'https://megaplay.buzz/stream?mal=5114&ep=1&type=sub')
