// Verify the megavid HLS manifest + segments are fetchable with plain headers.
import axios from 'axios'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const manifest = 'https://cp.megavid.buzz/hls/275ea11f-2b23-479b-a75f-976cf3e47bd3/playlist.m3u8'

for (const [label, headers] of [
  ['no-referer', { 'User-Agent': UA }],
  ['megavid-ref', { 'User-Agent': UA, Referer: 'https://megavid.buzz/' }],
]) {
  try {
    const res = await axios.get(manifest, { timeout: 15000, headers, validateStatus: () => true })
    const txt = typeof res.data === 'string' ? res.data : ''
    const lines = txt.split('\n').filter(Boolean)
    console.log(`${label}: ${res.status} ct=${(res.headers['content-type'] || '').split(';')[0]}`)
    console.log(`   first lines: ${lines.slice(0, 3).join(' | ').slice(0, 220)}`)
    // find a variant/segment URL and probe it
    const seg = lines.find((l) => l && !l.startsWith('#'))
    if (seg && res.status === 200) {
      const segUrl = seg.startsWith('http') ? seg : new URL(seg, manifest).href
      const segRes = await axios.get(segUrl, { timeout: 15000, headers, responseType: 'arraybuffer', validateStatus: () => true })
      const isM3u8 = String(Buffer.from(segRes.data || '').toString('utf8', 0, 7)).includes('EXTM3U')
      console.log(`   child ${isM3u8 ? 'manifest' : 'segment'}: ${segRes.status} len=${(segRes.data || '').length}`)
    }
    console.log('')
  } catch (e) {
    console.log(`${label}: ERR ${e.message}\n`)
  }
}
