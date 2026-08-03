// Scrape AniDB for real episode screenshot URLs
import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1920,1080'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Block unnecessary resources for speed
  await page.setRequestInterception(true);
  page.on('request', req => {
    const t = req.resourceType();
    if (t === 'image' || t === 'document' || t === 'xhr' || t === 'fetch') req.continue();
    else req.abort();
  });

  // Step 1: Go to Bleach anime page
  console.log('1. Loading Bleach page...');
  await page.goto('https://anidb.net/anime/2369', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });
  console.log('   URL:', page.url());
  console.log('   Title:', await page.title());

  // Step 2: Find and click the episodes tab/link
  console.log('\n2. Looking for episode list...');
  const epLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    return links
      .filter(a => (a.textContent || '').toLowerCase().includes('episode') || a.href.includes('episode'))
      .slice(0, 5)
      .map(a => ({ text: a.textContent?.trim()?.slice(0, 60), href: a.href.slice(0, 100) }));
  });
  console.log('   Episode links:', JSON.stringify(epLinks, null, 2));

  // Step 3: Try to go directly to episode 1 page
  console.log('\n3. Loading episode 1 page...');
  await page.goto('https://anidb.net/episode/14879', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });
  console.log('   URL:', page.url());
  console.log('   Title:', await page.title());

  // Step 4: Extract all CDN image URLs from the page
  const cdnImages = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs
      .filter(i => (i.src || '').includes('cdn.anidb.net'))
      .map(i => ({
        src: i.src,
        width: i.naturalWidth,
        height: i.naturalHeight,
        alt: (i.alt || '').slice(0, 50),
      }));
  });
  console.log('   CDN images:', cdnImages.length);
  cdnImages.forEach(i => console.log('     ', i.width + 'x' + i.height, '|', i.alt, '|', i.src.slice(0, 120)));

  // Step 5: Also check the page HTML for any data attributes with image IDs
  const dataImages = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    const matches = html.match(/cdn\.anidb\.net\/images\/[^"'\s<>]+/gi) || [];
    return [...new Set(matches)].slice(0, 10);
  });
  console.log('\n5. CDN URLs in HTML source:');
  dataImages.forEach(u => console.log('     ', u));

  // Step 6: Try screenshot/picture pages
  console.log('\n6. Loading pictures tab...');
  await page.goto('https://anidb.net/anime/2369/pics', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });
  const picImages = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs
      .filter(i => (i.src || '').includes('cdn.anidb.net'))
      .slice(0, 10)
      .map(i => ({ src: i.src.slice(0, 150), w: i.naturalWidth, h: i.naturalHeight }));
  });
  console.log('   Picture page images:', picImages.length);
  picImages.forEach(i => console.log('     ', i.w + 'x' + i.h, i.src));

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
