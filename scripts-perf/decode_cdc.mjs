import fs from 'node:fs'
const s = fs.readFileSync(process.argv[2], 'utf8').trim()
const b64 = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
const buf = Buffer.from(b64, 'base64')
console.log('decoded bytes:', buf.length)
console.log('hex head:', buf.toString('hex').slice(0, 60))
// Look for url-ish or json-ish patterns
const latin = buf.toString('latin1')
console.log('has m3u8:', latin.includes('m3u8'))
console.log('has ==json==:', /[{}]/.test(latin))
console.log('printable head:', [...buf.slice(0, 80)].map((b) => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join(''))
