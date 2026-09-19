import puppeteer from 'puppeteer'
import fs from 'node:fs'
const b64 = fs.readFileSync('screenshots/fs-os-native.png').toString('base64')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setContent(`<img id=i src="data:image/png;base64,${b64}">`)
await p.waitForSelector('#i')
const res = await p.evaluate(`(async () => {
  const img = document.getElementById('i')
  await img.decode()
  const W = img.naturalWidth, H = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, W, H).data
  const rowRuns = (y) => {
    const runs = []; let cur = null
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const isBlack = Math.max(d[i], d[i+1], d[i+2]) < 24
      if (!cur || cur.black !== isBlack) { if (cur) runs.push(cur); cur = { black: isBlack, from: x, to: x } } else cur.to = x
    }
    runs.push(cur)
    return runs.filter((r) => r.to - r.from > 4)
  }
  return { W, H, mid: rowRuns(Math.floor(H / 2)) }
})()`)
await b.close()
const fmt = (runs) => runs.map((r) => `${r.black ? 'BLACK' : 'PIC'} ${r.from}-${r.to} (${r.to - r.from + 1}px)`).join(' | ')
console.log('native OS shot:', res.W, 'x', res.H)
console.log('mid row:', fmt(res.mid))
const lastBlack = res.mid.filter(r => r.black).pop()
console.log(lastBlack && lastBlack.to >= res.W - 12 ? 'RIGHT EDGE: black to the edge = ' + (lastBlack.to - lastBlack.from + 1) + 'px physical right gap' : 'RIGHT EDGE: picture reaches panel edge — NO gap')
