import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1920,1080'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Capture ALL responses, including API
  const apiData = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] || '';
    // Capture API/JSON responses
    if (ct.includes('json') || url.includes('/api/') || url.includes('graphql') || url.includes('consumet') || url.includes('anilist')) {
      try {
        const text = await resp.text();
        apiData.push({ url: url.slice(0, 250), status: resp.status(), body: text.slice(0, 500) });
      } catch {}
    }
  });

  console.log('Loading anikage.cc Bleach page...');
  await page.goto('https://anikage.cc/anime/bleach', { waitUntil: 'networkidle2', timeout: 30000 });
  
  // Wait extra for dynamic content
  console.log('Waiting for dynamic content...');
  await new Promise(r => setTimeout(r, 15000));

  // Get all images again
  const imgs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map(i => ({
      src: i.src.slice(0, 300),
      w: i.naturalWidth, h: i.naturalHeight,
    }));
  });

  console.log('\n=== IMAGES AFTER WAIT ===');
  console.log('Count:', imgs.length);
  
  const episodeImgs = imgs.filter(i => i.w > 100 && i.h > 100);
  console.log('Episode-sized images:', episodeImgs.length);
  episodeImgs.forEach(i => console.log('  [' + i.w + 'x' + i.h + ']', i.src));

  console.log('\n=== API RESPONSES ===');
  console.log('Count:', apiData.length);
  apiData.forEach(r => {
    console.log('\n  URL:', r.url);
    console.log('  Status:', r.status, '| Body preview:', r.body.slice(0, 200));
  });

  await page.screenshot({ path: 'C:/Users/sylvester/Downloads/kurodo/screenshots/anikage-bleach.png' });

  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
