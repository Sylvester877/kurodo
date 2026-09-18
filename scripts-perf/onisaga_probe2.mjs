// Serve both images from dist/ and sample their header/hero/card palettes
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

// Copy screenshots into dist so the backend serves them statically
for (const f of ['onisaga-home-2026-09-12-22_52_07.png', 'local-home-before-onisaga.png']) {
  fs.copyFileSync(path.join(ROOT, 'screenshots', f), path.join(ROOT, 'dist', f))
}

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  *{margin:0;padding:0}
  body{background:#0a0a0a;color:#fff;font:12px system-ui;padding:12px}
  img{display:block;border:1px solid #222;border-radius:12px;margin:8px 0;max-width:100%}
  #log{white-space:pre-wrap;font:11px ui-monospace;background:#111;padding:12px;border-radius:8px;margin-top:12px;max-width:900px}
</style>
<h2>Onisaga reference (pasted)</h2>
<img id="ref" src="/onisaga-home-2026-09-12-22_52_07.png" crossorigin="anonymous">
<h2>Local before (current Kurodo Home)</h2>
<img id="local" src="/local-home-before-onisaga.png" crossorigin="anonymous">
<pre id="log">waiting…</pre>
<script>
  async function analyze(imgId){
    const img=document.getElementById(imgId)
    await new Promise(r=> img.complete ? r() : (img.onload=r, img.onerror=()=>r()))
    const w=img.naturalWidth, h=img.naturalHeight
    const c=document.createElement('canvas')
    c.width=w; c.height=h
    const ctx=c.getContext('2d')
    try{ ctx.drawImage(img,0,0) }catch(e){ return {w,h,err:String(e)} }
    function sample(x,y){ try{ const d=ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data; return 'rgb('+d[0]+','+d[1]+','+d[2]+') a='+d[3] }catch{ return 'err'} }
    function avgRect(x,y,rw,rh,step=8){
      let r=0,g=0,b=0,n=0
      for(let yy=y; yy<y+rh; yy+=step) for(let xx=x; xx<x+rw; xx+=step){ try{ const d=ctx.getImageData(xx,yy,1,1).data; r+=d[0]; g+=d[1]; b+=d[2]; n++ }catch{} }
      if(!n) return 'n=0'; return 'rgb('+Math.round(r/n)+','+Math.round(g/n)+','+Math.round(b/n)+') n='+n
    }
    const headerBg = avgRect(w*0.2, 12, w*0.6, 44)
    const heroLeftDark = sample(w*0.10, h*0.14)
    const heroCenter = avgRect(w*0.30, h*0.14, w*0.40, h*0.16)
    const railHeader = avgRect(w*0.06, h*0.52, w*0.28, 28)
    const cardSample = avgRect(w*0.12, h*0.62, Math.min(180, w*0.12), Math.min(240, h*0.12))
    const bgBetween = avgRect(w*0.50, h*0.76, 20, 20)
    return { w, h, headerBg, heroLeftDark, heroCenter, railHeader, cardSample, bgBetween }
  }
  ;(async()=>{
    try{
      const r=await analyze('ref')
      const l=await analyze('local')
      document.getElementById('log').textContent =
        'REF ONISAGA '+JSON.stringify(r,null,2)+'\\n\\nLOCAL KURODO '+JSON.stringify(l,null,2)
      window.__done=true
    }catch(e){ document.getElementById('log').textContent='ERR '+e.stack; window.__done=true }
  })()
<\/script>
`
const probePath = path.join(ROOT, 'dist', '__onisaga_probe2.html')
fs.writeFileSync(probePath, html)

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
await p.goto('http://127.0.0.1:5173/__onisaga_probe2.html', { waitUntil: 'domcontentloaded', timeout: 30_000 })
await p.waitForFunction('window.__done===true', { timeout: 15_000 }).catch(()=>{})
await new Promise(r=> setTimeout(r, 800))
await p.screenshot({ path: path.join(OUT, 'onisaga-probe2.png'), fullPage: true })
console.log('saved onisaga-probe2.png')
const log = await p.evaluate(() => document.getElementById('log')?.textContent || '')
console.log(log)
await b.close()
console.log('Done')
