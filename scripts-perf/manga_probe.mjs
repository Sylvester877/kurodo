import puppeteer from 'puppeteer';
import fs from 'node:fs';
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe';
const exe = fs.existsSync(CHROME) ? CHROME : undefined;
const browser = await puppeteer.launch({ headless: 'new', executablePath: exe, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] });
const page = await browser.newPage();
page.on('console', m => console.log('[console]', m.type(), m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message, (e.stack||'').slice(0,1800)));
await page.setViewport({width:1280,height:800});
const url = 'http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13';
console.log('goto', url);
try {
  await page.goto(url, {waitUntil:'domcontentloaded', timeout:20000});
  await new Promise(r=>setTimeout(r,8000));
  const html = await page.content();
  console.log('html len', html.length);
  const bodyText = await page.evaluate(()=>document.body.innerText.slice(0,2500));
  console.log('bodyText', bodyText.slice(0,2000));
  await page.screenshot({path:'screenshots/manga-crash-probe.png', fullPage:true});
  console.log('screenshot saved');
  const errs = await page.evaluate(()=> {
    // look for any error overlay
    const all = document.body.innerHTML.slice(0, 4000);
    return all.slice(0,2000);
  });
  console.log('html slice', errs.slice(0,2000));
} catch(e){ console.log('goto err', e.message, e.stack?.slice(0,1200)); }
await browser.close();
