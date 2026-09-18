// Quick visual check: serve after screenshot vs ref side-by-side in one page
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

// Copy needed files into dist for serving
for (const f of ['onisaga-home-2026-09-12-22_52_07.png', 'onisaga-home-after-above.png', 'onisaga-home-after-full.png', 'local-home-before-onisaga-above.png']) {
  try { fs.copyFileSync(path.join(OUT, f), path.join(ROOT, 'dist', f)) } catch {}
}

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0a0a;color:#fff;font:12px system-ui;padding:12px}
  .row{display:flex;gap:12px;align-items:flex-start}
  .col{flex:1;min-width:0}
  img{width:100%;height:auto;display:block;border:1px solid #222;border-radius:10px}
  h2{margin:12px 0 6px;font-size:13px;color:#999;text-transform:uppercase;letter-spacing:0.08em}
  #log{white-space:pre-wrap;font:11px ui-monospace;background:#111;padding:10px;border-radius:8px;margin-top:12px}
</style>
<h2>Left: Onisaga ref (1920×4921 full) — Right: Kurodo after (Onisaga-inspired)</h2>
<div class="row">
  <div class="col"><img id="ref" src="/onisaga-home-2026-09-12-22_52_07.png"></div>
  <div class="col"><img id="after" src="/onisaga-home-after-full.png"></div>
</div>
<h2>Above-fold comparison</h2>
<div class="row">
  <div class="col"><img src="/local-home-before-onisaga-above.png"><div style="text-align:center;color:#666;margin-top:4px">Before (82vh hero, #080808)</div></div>
  <div class="col"><img id="afterAbove" src="/onisaga-home-after-above.png"><div style="text-align:center;color:#666;margin-top:4px">After (46vh ~414px, #262626 flat)</div></div>
</div>
<pre id="log">waiting…</pre>
<script>
  async function sample(imgId){
    const img=document.getElementById(imgId)
    await new Promise(r=> img.complete ? r() : (img.onload=r, img.onerror=()=>r()))
    const w=img.naturalWidth, h=img.naturalHeight
    const c=document.createElement('canvas'); c.width=w; c.height=h
    const ctx=c.getContext('2d')
    try{ ctx.drawImage(img,0,0) }catch(e){ return {w,h,err:String(e)} }
    function avgRect(x,y,rw,rh,step=8){
      let r=0,g=0,b=0,n=0
      for(let yy=y; yy<y+rh; yy+=step) for(let xx=x; xx<x+rw; xx+=step){ try{ const d=ctx.getImageData(xx,yy,1,1).data; r+=d[0]; g+=d[1]; b+=d[2]; n++ }catch{} }
      if(!n) return 'n=0'; return 'rgb('+Math.round(r/n)+','+Math.round(g/n)+','+Math.round(b/n)+')'
    }
    return { w,h, heroCenter: avgRect(w*0.35, Math.floor(h*0.12), w*0.3, Math.floor(h*0.14)), pageBg: avgRect(w*0.5, Math.floor(h*0.55), 20, 20) }
  }
  ;(async()=>{
    try{
      const r=await sample('ref')
      const a=await sample('after')
      const aa=await sample('afterAbove')
      document.getElementById('log').textContent =
        'REF ONISAGA '+JSON.stringify(r,null,2)+'\\nAFTER FULL '+JSON.stringify(a,null,2)+'\\nAFTER ABOVE '+JSON.stringify(aa,null,2)
      window.__done=true
    }catch(e){ document.getElementById('log').textContent='ERR '+e.stack; window.__done=true }
  })()
<\/script>
`
fs.writeFileSync(path.join(ROOT, 'dist', '__onisaga_compare.html'), html)

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
await p.goto('http://127.0.0.1:5173/__onisaga_compare.html', { waitUntil: 'domcontentloaded', timeout: 30_000 })
await p.waitForFunction('window.__done===true', { timeout: 15_000 }).catch(()=>{})
await new Promise(r=> setTimeout(r, 800))
await p.screenshot({ path: path.join(OUT, 'onisaga-compare.png'), fullPage: true })
console.log('saved onisaga-compare.png')
const log = await p.evaluate(() => document.getElementById('log')?.textContent || '')
console.log(log)
await b.close()
console.log('Done')
