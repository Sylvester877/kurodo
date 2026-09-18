// Probe the pasted Onisaga screenshot and the local before to extract layout deltas.
// Uses Puppeteer + canvas to sample colors, section structure, and hero metrics.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })

// Serve an HTML that loads both images via <img> so we can canvas-sample them
const html = `
<!doctype html>
<meta charset="utf-8">
<style>
  *{margin:0;padding:0}
  body{background:#0a0a0a;color:#fff;font:12px system-ui;padding:12px}
  img{max-width:100%;display:block;border:1px solid #222;border-radius:12px;margin:8px 0}
  #log{white-space:pre-wrap;font:11px ui-monospace;background:#111;padding:12px;border-radius:8px;margin-top:12px}
</style>
<h2>Onisaga reference (pasted)</h2>
<img id="ref" src="/screenshots/onisaga-home-2026-09-12-22_52_07.png">
<h2>Local before (current Kurodo Home)</h2>
<img id="local" src="/screenshots/local-home-before-onisaga.png">
<pre id="log">waiting…</pre>
<script>
  async function analyze(imgId){
    const img=document.getElementById(imgId)
    await new Promise(r=> img.complete ? r() : img.onload=r)
    const w=img.naturalWidth, h=img.naturalHeight
    const c=document.createElement('canvas')
    c.width=w; c.height=h
    const ctx=c.getContext('2d')
    ctx.drawImage(img,0,0)
    function sample(x,y){ const d=ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data; return 'rgb('+d[0]+','+d[1]+','+d[2]+') a='+d[3] }
    function avgRect(x,y,rw,rh,step=8){
      let r=0,g=0,b=0,n=0
      for(let yy=y; yy<y+rh; yy+=step) for(let xx=x; xx<x+rw; xx+=step){ const d=ctx.getImageData(xx,yy,1,1).data; r+=d[0]; g+=d[1]; b+=d[2]; n++ }
      return 'rgb('+Math.round(r/n)+','+Math.round(g/n)+','+Math.round(b/n)+') n='+n
    }
    // Heuristic regions (assuming full-page screenshot at viewport scale):
    // - Header: top 70px strip center
    // - Hero: ~10% down from top, center
    // - First rail header: ~40-55% down
    // - Cards: sample a tile area
    const headerBg = avgRect(w*0.2, 12, w*0.6, 44)
    const heroCenter = avgRect(w*0.35, h*0.12, w*0.3, h*0.18)
    const heroLeftDark = sample(w*0.12, h*0.14)
    const railHeader = avgRect(w*0.08, h*0.48, w*0.3, 28)
    const cardSample = avgRect(w*0.12, h*0.60, Math.min(180, w*0.12), Math.min(240, h*0.12))
    const bgBetweenRails = avgRect(w*0.5, h*0.72, 20, 20)
    return { w, h, headerBg, heroCenter, heroLeftDark, railHeader, cardSample, bgBetweenRails }
  }
  ;(async()=>{
    try{
      const r=await analyze('ref')
      const l=await analyze('local')
      document.getElementById('log').textContent =
        'REF ONISAGA '+JSON.stringify(r,null,2)+'\\n\\nLOCAL KURODO '+JSON.stringify(l,null,2)
    }catch(e){ document.getElementById('log').textContent='ERR '+e.stack }
  })()
</script>
`

// Serve via a tiny http server so /screenshots/* resolves (reuse backend on :5173 if alive, else inline data URL)
const res = await fetch('http://127.0.0.1:5173/api/health').then(r=>r.ok).catch(()=>false)
let url
if (res) {
  // write a temp html file under dist to serve
  const tmpHtml = path.join(ROOT, 'dist', '__onisaga_probe.html')
  fs.writeFileSync(tmpHtml, html)
  url = 'http://127.0.0.1:5173/__onisaga_probe.html'
} else {
  // fallback: data URL with base64 images inline (heavy but works)
  const refB64 = fs.readFileSync(path.join(ROOT, 'screenshots/onisaga-home-2026-09-12-22_52_07.png')).toString('base64')
  const localB64 = fs.readFileSync(path.join(ROOT, 'screenshots/local-home-before-onisaga.png')).toString('base64')
  const inlineHtml = html
    .replace('src="/screenshots/onisaga-home-2026-09-12-22_52_07.png"', `src="data:image/png;base64,${refB64}"`)
    .replace('src="/screenshots/local-home-before-onisaga.png"', `src="data:image/png;base64,${localB64}"`)
  url = 'data:text/html;base64,' + Buffer.from(inlineHtml).toString('base64')
}

await p.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 })
await new Promise(r=> setTimeout(r, 3000))
// screenshot the probe page itself (shows both images + sampled metrics)
await p.screenshot({ path: path.join(OUT, 'onisaga-probe-overlay.png'), fullPage: true })
console.log('saved onisaga-probe-overlay.png')
// extract the log text
const log = await p.evaluate(() => document.getElementById('log')?.textContent || '')
console.log(log)
await b.close()
console.log('Done')
