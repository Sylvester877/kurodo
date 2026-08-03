import puppeteer from 'puppeteer';
import fs from 'fs';

const SCREENSHOT_DIR = 'C:/Users/sylvester/Downloads/kurodo/screenshots';

async function takeScreenshot(page, name) {
  const p = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  ✓ ${name} (${(fs.statSync(p).size / 1024).toFixed(0)}KB)`);
  return p;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox','--disable-gpu','--window-size=1920,1080']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Bypass setup wizard
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('kurodo-setup-done', '1');
  });

  // Collect console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 200));
  });

  // Collect failed network requests
  const failedUrls = [];
  page.on('response', resp => {
    if (resp.status() >= 400) {
      failedUrls.push(`${resp.status()} ${resp.url().slice(0, 120)}`);
    }
  });

  try {
    // ── 1. HOME PAGE ──
    console.log('\n=== 1. HOME PAGE ===');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 8000));
    await takeScreenshot(page, 'final-home');

    // Check for broken images
    const homeImgInfo = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const broken = imgs.filter(i => !i.complete || i.naturalWidth === 0);
      const total = imgs.length;
      const loaded = imgs.filter(i => i.complete && i.naturalWidth > 0).length;
      return { total, loaded, broken: broken.length };
    });
    console.log(`  Images: ${homeImgInfo.loaded}/${homeImgInfo.total} loaded, ${homeImgInfo.broken} broken`);

    // ── 2. SEARCH ──
    console.log('\n=== 2. SEARCH ===');
    await page.goto('http://localhost:5173/search?q=bleach', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 8000));

    const searchInfo = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="AnimeCard"], [class*="card"], [class*="StaggerCard"]');
      const titles = Array.from(document.querySelectorAll('h2, h3, [class*="title"]'))
        .slice(0, 5).map(e => e.textContent.trim()).filter(t => t.length > 2);
      const imgs = Array.from(document.querySelectorAll('img'));
      const loaded = imgs.filter(i => i.complete && i.naturalWidth > 0).length;
      return { cardCount: cards.length, titles: titles.slice(0, 3), imgLoaded: loaded, imgTotal: imgs.length };
    });
    console.log(`  Cards: ${searchInfo.cardCount} | Images: ${searchInfo.imgLoaded}/${searchInfo.imgTotal}`);
    console.log(`  Titles: ${searchInfo.titles.join(' | ')}`);
    await takeScreenshot(page, 'final-search-bleach');

    // ── 3. ANIME DETAILS ──
    console.log('\n=== 3. ANIME DETAILS (Bleach) ===');
    await page.goto('http://localhost:5173/anime/269', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 15000));

    const detailInfo = await page.evaluate(() => {
      const hero = document.querySelector('[class*="hero"], [class*="Hero"], [class*="banner"]');
      const epCards = document.querySelectorAll('[class*="episode"] img, [class*="Episode"] img');
      const epImgLoaded = Array.from(epCards).filter(i => i.complete && i.naturalWidth > 0).length;
      const allImgs = Array.from(document.querySelectorAll('img'));
      const loaded = allImgs.filter(i => i.complete && i.naturalWidth > 0).length;
      return {
        heroExists: !!hero,
        epCardImgs: epCards.length,
        epCardLoaded: epImgLoaded,
        allImgLoaded: loaded,
        allImgTotal: allImgs.length
      };
    });
    console.log(`  Hero: ${detailInfo.heroExists ? 'YES' : 'NO'} | Ep imgs: ${detailInfo.epCardLoaded}/${detailInfo.epCardImgs}`);
    console.log(`  All imgs: ${detailInfo.allImgLoaded}/${detailInfo.allImgTotal}`);

    // Scroll down to episode list
    await page.evaluate(() => window.scrollTo(0, 800));
    await new Promise(r => setTimeout(r, 2000));
    await takeScreenshot(page, 'final-details-bleach');

    // Scroll to episode list area
    await page.evaluate(() => {
      const epSection = document.querySelector('[class*="episode"], [class*="Episode"], [id*="episode"]');
      if (epSection) epSection.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    await new Promise(r => setTimeout(r, 2000));
    await takeScreenshot(page, 'final-episodes-bleach');

    // ── 4. WATCH PAGE ──
    console.log('\n=== 4. WATCH PAGE ===');
    await page.goto('http://localhost:5173/watch/269?ep=1', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 15000));
    await takeScreenshot(page, 'final-watch-bleach');

    // ── 5. SUMMARY ──
    console.log('\n=== AUDIT SUMMARY ===');
    console.log(`Console errors: ${errors.length}`);
    errors.slice(0, 10).forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    console.log(`Failed requests (4xx/5xx): ${failedUrls.length}`);
    const uniqueFails = [...new Set(failedUrls)].slice(0, 10);
    uniqueFails.forEach(f => console.log(`  ${f}`));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await browser.close();
    console.log('\nDone. Screenshots in', SCREENSHOT_DIR);
  }
}

main();
