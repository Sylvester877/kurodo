// Run anidap's own getEpisodeSources but redirect its chad fetch to the
// WORKING /api/anime/sources endpoint, so the module's own decrypt logic
// runs against the real payload. We intercept the module's fetch.
import fs from 'node:fs'
import vm from 'node:vm'
import axios from 'axios'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const hdrs = { Referer: 'https://anidap.lol/watch?id=5114', Origin: 'https://anidap.lol', 'User-Agent': UA, Accept: 'application/json' }
const SLUG = process.argv[2] || 'fullmetal-alchemist-brotherhood-v3mzo'
const EP = Number(process.argv[3] || 1)
const HOST = process.argv[4] || 'yuki'
const TYPE = process.argv[5] || 'sub'

// Pre-fetch the working payload so we can feed it regardless of URL.
const real = await axios.get('https://anidap.lol/api/anime/sources', {
  params: { id: SLUG, ep: EP, host: HOST, type: TYPE }, headers: hdrs, timeout: 15000,
})
const payload = real.data
console.log('payload:', Object.keys(payload), 'dataLen:', payload.data?.length)

let code = fs.readFileSync('./scripts-perf/anidap_api_chunk.js', 'utf8')
code = code.replace(/import\{A as u\}from"\.\/config-[A-Za-z0-9]+\.js"/, '')
code = code.replace(/export\{([^}]*)\}/, (_, names) => {
  const entries = names.split(',').map((n) => n.trim().split(' as ')).map(([local, exp]) => [exp || local, local])
  return entries.map(([exp, local]) => `globalThis.__mod[${JSON.stringify(exp)}]=${local};`).join('')
})

const sandbox = {
  globalThis: {}, __mod: {},
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  TextEncoder, TextDecoder, URL, setTimeout, clearTimeout, console,
  window: {}, document: {},
  FormData, Blob: class {}, URLSearchParams, AbortController, performance,
  fetch: async (u, opts) => {
    const url = typeof u === 'string' ? u : u.url
    console.log('[module fetch]', url.slice(0, 100))
    // Return the working payload for any chad/sources call.
    if (/sources|rest\/api\/sources|anime\/sources/.test(url)) {
      return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) }
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }
  },
}
sandbox.globalThis = sandbox; sandbox.window = sandbox
vm.createContext(sandbox)
try {
  vm.runInContext(code, sandbox, { timeout: 5000 })
  const gs = sandbox.__mod.getEpisodeSources
  console.log('getEpisodeSources type:', typeof gs)
  const out = await gs(SLUG, EP, HOST, TYPE)
  console.log('=== DECRYPTED SOURCES ===')
  console.log(JSON.stringify(out, null, 0).slice(0, 2000))
} catch (e) {
  console.log('ERR:', e.message)
  console.log(e.stack?.split('\n').slice(0, 5).join('\n'))
}
