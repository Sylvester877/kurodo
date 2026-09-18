// megavid "Embed Only" gate: find the Referer/headers that unlock the embed page.
import axios from 'axios'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function probe(label, url, headers) {
  try {
    const res = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': UA, ...headers }, maxRedirects: 'follow', validateStatus: () => true })
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    const title = (body.match(/<title[^>]*>([^<]{0,90})/i)?.[1] || '').trim()
    console.log(`${label}: ${res.status} len=${body.length} title="${title}"`)
    if (res.status === 200) {
      const iframes = [...body.matchAll(/<iframe[^>]+src=["']([^"']+)/gi)].map((m) => m[1]).slice(0, 3)
      const m3u8 = body.match(/https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*/)?.[0]
      if (iframes.length) console.log(`   iframes: ${iframes.join(' | ').slice(0, 200)}`)
      if (m3u8) console.log(`   m3u8: ${m3u8.slice(0, 120)}`)
      return body
    }
  } catch (e) {
    console.log(`${label}: ERR ${e.message}`)
  }
  return null
}

const url = 'https://megavid.buzz/mal/5114/1/sub'
const refs = [
  ['no-ref', {}],
  ['ref-anidap', { Referer: 'https://anidap.lol/' }],
  ['ref-watch', { Referer: 'https://anidap.lol/watch?id=5114&ep=1&type=sub' }],
  ['ref-gogo', { Referer: 'https://gogoanime.by/' }],
  ['ref-self', { Referer: 'https://megavid.buzz/' }],
  ['iframe-fetchdest', { Referer: 'https://anidap.lol/', 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'cross-site' }],
]
for (const [label, h] of refs) await probe(label, url, h)
