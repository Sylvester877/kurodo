// Run anidap's OWN client module in a Node VM to decrypt /api/anime/sources.
// The site's api chunk exports getEpisodeSources which fetches + decrypts.
// We stub browser APIs (fetch, btoa, TextEncoder, window, URL) and call the
// exported function, feeding the working /api/anime/sources response.
import fs from 'node:fs'
import vm from 'node:vm'
import axios from 'axios'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const hdrs = { Referer: 'https://anidap.lol/watch?id=5114', Origin: 'https://anidap.lol', 'User-Agent': UA, Accept: 'application/json' }

// Real payload from the working endpoint
const SLUG = process.argv[2] || 'fullmetal-alchemist-brotherhood-v3mzo'
const EP = Number(process.argv[3] || 1)
const HOST = process.argv[4] || 'yuki'
const TYPE = process.argv[5] || 'sub'

const src = await axios.get('https://anidap.lol/api/anime/sources', {
  params: { id: SLUG, ep: EP, host: HOST, type: TYPE }, headers: hdrs, timeout: 15000,
})
const payload = src.data
console.log('payload keys:', Object.keys(payload), 'dataLen:', payload.data?.length)

// Load the module source
let code = fs.readFileSync('./scripts-perf/anidap_api_chunk.js', 'utf8')
// Remove the ESM import (we inject `u` config)
code = code.replace(/import\{A as u\}from"\.\/config-[A-Za-z0-9]+\.js"/, '')
// Replace ESM export with a global capture
code = code.replace(/export\{([^}]*)\}/, (_, names) => {
  const entries = names.split(',').map((n) => n.trim().split(' as ')).map(([local, exp]) => [exp || local, local])
  return entries.map(([exp, local]) => `globalThis.__mod[${JSON.stringify(exp)}]=${local};`).join('')
})

const sandbox = {
  globalThis: {},
  __mod: {},
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  TextEncoder,
  TextDecoder,
  URL,
  setTimeout,
  clearTimeout,
  console,
  window: {},
  document: {},
  fetch: async (u, opts) => {
    const url = typeof u === 'string' ? u : u.url
    const res = { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) }
    return res
  },
  FormData,
  Blob: class {},
  URLSearchParams,
  AbortController,
  performance,
}
sandbox.globalThis = sandbox
sandbox.window = sandbox
vm.createContext(sandbox)
try {
  vm.runInContext(code, sandbox, { timeout: 5000 })
  console.log('exported fns:', Object.keys(sandbox.__mod).join(', '))
  const gs = sandbox.__mod.getEpisodeSources
  if (typeof gs === 'function') {
    const out = await gs(SLUG, EP, HOST, TYPE)
    console.log('=== getEpisodeSources result ===')
    console.log(JSON.stringify(out).slice(0, 1200))
  } else {
    // try resolvePlayerSource / transformSourceUrl directly
    console.log('no getEpisodeSources; exports:', Object.keys(sandbox.__mod))
  }
} catch (e) {
  console.log('VM ERR:', e.message)
  console.log(e.stack?.split('\n').slice(0, 4).join('\n'))
}
