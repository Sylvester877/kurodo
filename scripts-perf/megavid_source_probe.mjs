// megavid source API: GET /mal/<id>/<ep>/<type>/source -> { sourceUrl, ... }
import axios from 'axios'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function getSource(label, url) {
  try {
    const res = await axios.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': UA, Referer: 'https://megavid.buzz/', Accept: 'application/json' },
      validateStatus: () => true,
    })
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    console.log(`${label}: ${res.status} ct=${(res.headers['content-type'] || '').split(';')[0]}`)
    console.log(`   ${body.slice(0, 500)}`)
    return res.status === 200 ? res.data : null
  } catch (e) {
    console.log(`${label}: ERR ${e.message}`)
    return null
  }
}

// FMAB ep1 sub + dub, and Liar Game as control
const fmabSub = await getSource('FMAB  /mal/5114/1/sub/source ', 'https://megavid.buzz/mal/5114/1/sub/source')
await getSource('FMAB  /mal/5114/1/dub/source ', 'https://megavid.buzz/mal/5114/1/dub/source')
await getSource('LiarG /mal/62331/1/sub/source', 'https://megavid.buzz/mal/62331/1/sub/source')

// If we got a sourceUrl, verify it's a real stream
if (fmabSub?.sourceUrl) {
  const u = fmabSub.sourceUrl
  console.log(`\nverifying stream: ${u.slice(0, 120)}`)
  try {
    const head = await axios.get(u, {
      timeout: 20000,
      headers: { 'User-Agent': UA, Referer: 'https://megavid.buzz/', Range: 'bytes=0-2047' },
      responseType: 'arraybuffer',
      validateStatus: () => true,
    })
    const ct = head.headers['content-type'] || ''
    console.log(`   -> ${head.status} ct=${ct} len=${(head.data || '').length}`)
    const txt = Buffer.from(head.data || '').toString('utf8', 0, 200)
    if (/EXTM3U/.test(txt)) console.log('   *** HLS MANIFEST CONFIRMED ***')
    if (/ftyp/.test(txt)) console.log('   *** MP4 CONFIRMED ***')
  } catch (e) {
    console.log(`   verify ERR: ${e.message}`)
  }
}
