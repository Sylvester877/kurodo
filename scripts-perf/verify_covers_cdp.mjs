// Raw-CDP manga cover diagnosis: read img.complete/naturalWidth state AND
// capture the page's own network failures for cover URLs.
import WebSocket from 'ws'
import fs from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json().catch(() => null)
console.log('CDP targets:', list ? list.length : 'none (devtools port closed — expected)')
process.exit(0)
