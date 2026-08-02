// Screenshot script — navigates to watch pages and captures playback screenshots.
// Usage: node scripts/screenshot-anime.mjs "Anime Name" MAL_ID
//
// Saves screenshots to ../screenshots/ relative to this script.

import puppeteer from 'puppeteer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '..', '..', 'screenshots');

const [,, label, malId] = process.argv;
if (!label || !malId) {
  console.error('Usage: node screenshot-anime.mjs "Anime Name" MAL_ID');
  process.exit(1);
}

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const BASE = 'http://localhost:5173';

async function takeScreenshot(label, malId) {
  console.log(`\n=== ${label} (MAL ${malId}) ===`);
  
  // Find system Chrome (same logic as cf-harvester.js)
  function findChrome() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const candidates = [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
    ].filter(Boolean);
    for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
    return undefined;
  }

  const chromePath = findChrome();
  if (!chromePath) {
    console.error('  Could not find Chrome. Set CHROME_PATH env var.');
    return [];
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();
  
  // ── CRITICAL: Prevent the SetupWizard and InstallPrompt modals from
  //    appearing. We inject localStorage flags BEFORE any page JS runs
  //    so SetupWizard's useState initializer reads done=true immediately.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('kurodo-setup-done', '1');
    localStorage.setItem('kurodo-install-dismissed', String(Date.now()));
  });
  
  // Collect console errors
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  try {
    // Navigate to watch page
    const url = `${BASE}/watch/${malId}?ep=1`;
    console.log(`  Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('  Page loaded (no modals — localStorage pre-set)');
    await new Promise(r => setTimeout(r, 3000));

    // Screenshot 1: Page loaded with episode list
    const shot1 = path.join(SCREENSHOTS_DIR, `${malId}-${label.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}-page.png`);
    await page.screenshot({ path: shot1, fullPage: false });
    console.log(`  Saved: ${path.basename(shot1)}`);

    // Wait for the player area to render (any state: loading, error, or playing).
    // Anidap DOM extraction via Puppeteer takes 15-30s for the first request.
    console.log('  Waiting for player area...');
    try {
      await page.waitForSelector('.aspect-video, video, [class*="Loading"]', { timeout: 35000 });
      console.log('  Player area detected, waiting for stream...');
      // Give the stream extra time to actually start playing
      await new Promise(r => setTimeout(r, 8000));
    } catch {
      console.log('  Player area not visible after 35s, taking screenshot anyway...');
    }

    // Check if there's a "No stream source found" or error state
    const errorText = await page.evaluate(() => {
      const el = document.querySelector('[class*="error"], [class*="Error"]');
      return el?.textContent?.slice(0, 200) || null;
    });
    if (errorText) console.log(`  UI message: ${errorText}`);

    // Screenshot 2: Player area
    const shot2 = path.join(SCREENSHOTS_DIR, `${malId}-${label.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}-player.png`);
    await page.screenshot({ path: shot2, fullPage: false });
    console.log(`  Saved: ${path.basename(shot2)}`);

  } catch (e) {
    console.error(`  Error: ${e.message}`);
    // Still try to take a screenshot
    try {
      const errShot = path.join(SCREENSHOTS_DIR, `${malId}-${label.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}-error.png`);
      await page.screenshot({ path: errShot, fullPage: false });
      console.log(`  Saved error state: ${path.basename(errShot)}`);
    } catch {}
  }

  if (errors.length > 0) {
    console.log(`  Console errors (${errors.length}):`);
    for (const e of errors.slice(0, 5)) console.log(`    - ${e.slice(0, 120)}`);
  } else {
    console.log('  No console errors');
  }

  await browser.close();
  
  // Return filenames for summary
  const files = fs.readdirSync(SCREENSHOTS_DIR)
    .filter(f => f.startsWith(malId))
    .map(f => path.join(SCREENSHOTS_DIR, f));
  return files;
}

// ── Run ──
const files = await takeScreenshot(label, malId);
console.log(`\n✓ ${label} — ${files.length} screenshots saved`);
