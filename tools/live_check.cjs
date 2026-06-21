/* Verify the DEPLOYED site (not localhost): boots under the /workout-app/
   subpath, manifest + service worker register, and a core flow works. */
const { chromium } = require('C:/Users/Abbas/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const EXE = 'C:/Users/Abbas/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const BASE = process.argv[2] || 'https://bboyabbas.github.io/workout-app/';
const fails = [];
const check = (c, m) => { console.log((c ? '  PASS: ' : '  FAIL: ') + m); if (!c) fails.push(m); };

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await (await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  })).newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.topbar', { timeout: 10000 });
  check(true, 'app shell booted under subpath');

  // manifest fetches + parses
  const man = await page.evaluate(async () => {
    const l = document.querySelector('link[rel=manifest]');
    const r = await fetch(l.href); return { ok: r.ok, json: await r.json() };
  });
  check(man.ok && man.json.name === 'Workout', 'manifest loads + parses');

  // service worker registers
  const sw = await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => true).catch(() => false));
  check(sw, 'service worker registered (offline-ready)');

  // core flow
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForSelector('[data-tpl="0"]');
  await page.locator('[data-tpl="0"]').click();
  await page.waitForSelector('[data-run]');
  await page.locator('[data-run]').click();
  await page.waitForSelector('.set-row');
  const row = page.locator('.set-row').first();
  await row.locator('[data-f="reps"]').fill('10');
  await row.locator('[data-f="weight"]').fill('30');
  await row.locator('.set-check').click();
  check(await page.locator('#rest-host .card').isVisible(), 'rest timer starts on set logged');
  await page.locator('#finish').click();
  await page.waitForSelector('.hist-row', { timeout: 4000 });
  check((await page.locator('.hist-row').count()) >= 1, 'workout saved to history');

  check(errs.length === 0, 'no console errors' + (errs.length ? ' -> ' + errs.join(' | ') : ''));
  await browser.close();
  console.log('\n' + (fails.length ? `RESULT: ${fails.length} FAILED` : 'RESULT: ALL PASSED'));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(2); });
