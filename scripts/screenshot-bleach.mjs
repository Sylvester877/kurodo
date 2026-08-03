import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(__dirname, '..', 'screenshots');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1920,1080'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0,200)); });

  console.log('Loading Bleach details...');
  await page.goto('http://localhost:5173/anime/269', { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('Clicking Play Now...');
  await page.waitForSelector('a[href*="watch"]', { timeout: 15000 });
  await page.click('a[href*="watch"]');

  console.log('Waiting 45s for full load + TMDB enrichment...');
  await new Promise(r => setTimeout(r, 45000));

  // Try scrolling deep
  await page.evaluate(() => {
    const scrollers = Array.from(document.querySelectorAll('*'))
      .filter(el => el.scrollHeight > el.clientHeight + 500 && el.scrollHeight > 3000);
    if (scrollers[0]) scrollers[0].scrollTop = scrollers[0].scrollHeight * 0.6;
    else {
      // Try clicking pagination if no scroller
      const btns = Array.from(document.querySelectorAll('button'));
      const rangeBtn = btns.find(b => (b.textContent||'').includes('100'));
      if (rangeBtn) rangeBtn.click();
    }
  });
  await new Promise(r => setTimeout(r, 8000));

  const info = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    const epImgs = imgs.filter(i => {
      const s = decodeURIComponent(i.src || '');
      return s.includes('/img?') || s.includes('image.tmdb.org');
    });
    const tmdb = epImgs.filter(i => (i.src||'').includes('image.tmdb.org'));
    return {
      epImgs: epImgs.length, tmdb: tmdb.length,
      samples: epImgs.slice(0,6).map(i => ({
        tmdb: (i.src||'').includes('image.tmdb.org'),
        ok: i.complete && i.naturalWidth > 0,
        w: i.naturalWidth,
        src: decodeURIComponent(i.src||'').slice(0,100)
      }))
    };
  });
  console.log(JSON.stringify(info, null, 1));
  console.log('Errors:', errors.length);
  errors.slice(0, 3).forEach(e => console.log(' -', e));

  const outPath = path.join(screenshotDir, 'bleach-episodes-80-130.png');
  await page.screenshot({ path: outPath, fullPage: false });
  console.log('SAVED:', outPath, fs.statSync(outPath).size, 'bytes');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
