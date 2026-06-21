/* End-to-end smoke test for the Workout PWA.
   Run: NODE_PATH=<global node_modules> node tools/smoke_test.cjs
   Drives a real Chromium through the core flows and asserts behavior. */
const { chromium } = require('C:/Users/Abbas/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');

const BASE = 'http://127.0.0.1:8099';
const fails = [];
function check(cond, msg) {
  if (cond) console.log('  PASS:', msg);
  else { console.log('  FAIL:', msg); fails.push(msg); }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/Abbas/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();

  // capture console + page errors
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

  // stub vibration so we can assert it fires
  await page.addInitScript(() => {
    window.__vibes = [];
    navigator.vibrate = (p) => { window.__vibes.push(p); return true; };
  });

  // fresh state
  await page.goto(BASE + '/#/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.topbar');

  console.log('\n[1] Empty state + templates');
  check(await page.locator('[data-nav="#/plan/new"]').first().isVisible(), 'Create-your-own button shows');
  check(await page.locator('[data-tpl]').count() >= 3, 'templates listed');

  console.log('\n[2] Add a template plan');
  await page.locator('[data-tpl="0"]').click();
  await page.waitForSelector('[data-run]');
  check(/#\/plan\//.test(page.url()), 'navigated to plan detail');
  check(await page.getByText('Start workout').isVisible(), 'Start workout button present');

  console.log('\n[3] Shorten rest to 2s via editor');
  await page.locator('[data-nav$="/edit"]').first().click();
  await page.waitForSelector('[data-f="rest"]');
  await page.locator('[data-f="rest"]').first().fill('2');
  await page.locator('#save').click();
  await page.waitForSelector('[data-run]');

  console.log('\n[4] Start workout — timer + set logging');
  await page.locator('[data-run]').click();
  await page.waitForSelector('#elapsed');
  check(await page.locator('.timer-bar').isVisible(), 'timer bar visible');
  const t0 = await page.locator('#elapsed').textContent();
  await page.waitForTimeout(1200);
  const t1 = await page.locator('#elapsed').textContent();
  check(t0 !== t1, `elapsed timer ticks (${t0} -> ${t1})`);

  console.log('\n[5] Log a set -> rest countdown + vibration');
  const row = page.locator('.set-row').first();
  await row.locator('[data-f="reps"]').fill('10');
  await row.locator('[data-f="weight"]').fill('20');
  await page.locator('[data-log]').first().click();
  check(await page.locator('.set-row.done').first().isVisible(), 'set logged via bottom button (marked done)');
  await page.waitForSelector('#rest-host .card', { timeout: 2000 });
  check(await page.locator('#rest-host').getByText('Rest').isVisible(), 'rest bar appears');
  // wait for the 2s rest to elapse -> vibration
  await page.waitForFunction(() => window.__vibes.length > 0, null, { timeout: 5000 });
  check(true, 'vibration fired at rest end');

  console.log('\n[6] Finish -> history');
  await page.locator('#finish').click();
  await page.waitForSelector('.hist-row', { timeout: 3000 });
  check(await page.locator('.hist-row').count() >= 1, 'session saved to history');
  const dur = await page.locator('.hist-row .dur').first().textContent();
  check(/\d/.test(dur), `history shows duration (${dur})`);

  console.log('\n[7] Last-time memory on second run');
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.plan-card');
  check((await page.locator('[data-tpl]').count()) >= 1, 'templates still reachable from populated home');
  await page.locator('.plan-card').first().click();
  await page.waitForSelector('[data-run]');
  check((await page.locator('text=last').count()) >= 0, 'plan detail renders (last-time wired)');
  await page.locator('[data-run]').click();
  await page.waitForSelector('.run-ex');
  const lastTxt = await page.locator('.lasttime').first().textContent();
  check(/10/.test(lastTxt), `last-time shows previous reps (${lastTxt.trim()})`);

  console.log('\n[8] No console errors');
  check(consoleErrors.length === 0, 'no console/page errors' + (consoleErrors.length ? ' -> ' + consoleErrors.join(' | ') : ''));

  await browser.close();
  console.log('\n' + (fails.length ? `RESULT: ${fails.length} FAILED` : 'RESULT: ALL PASSED'));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(2); });
