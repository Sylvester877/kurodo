// Decode anidap's watch.data (turbo-stream format) and find stream fields
const H = {
  'Referer': 'https://anidap.lol/',
  'Origin': 'https://anidap.lol',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
}
const r = await fetch('https://anidap.lol/watch.data?id=171627&ep=1&type=sub&provider=kiwi', {
  headers: H,
  signal: AbortSignal.timeout(15000),
})
const body = await r.text()
console.log('status:', r.status, 'len:', body.length)

// turbo-stream encodes rows as [ \"_index\": value, ... ] flat arrays.
// Find the row containing source-ish keys and print nearby structure.
const rows = body.split(',\"')
console.log('rows:', rows.length)
const interesting = rows.filter((row) => /source|stream|url|file|playlist|hls|link|video/i.test(row)).slice(0, 20)
interesting.forEach((row, i) => console.log(`── row ${i}:`, row.slice(0, 160)))
