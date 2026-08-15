/* Screenshots of the session-detail screen: read-only view and edit mode.
   Run: python -m http.server 8099 --bind 127.0.0.1 &   then   node tools/session_edit_shot.cjs <outDir> */
const { chromium } = require('C:/Users/Abbas/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const BASE = 'http://127.0.0.1:8099';
const EXE = 'C:/Users/Abbas/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const OUT = process.argv[2] || '.';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.route('**/workout-sync.bboy-abbass.workers.dev/**',
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.addInitScript(() => { try { localStorage.setItem('wt_sync_id', 'shots'); } catch (_) {} });

  await page.goto(BASE + '/#/');
  // the just-installed service worker claims the page and self-reloads once,
  // which destroys the context mid-evaluate — retry until the wipe lands
  for (let i = 0; i < 6; i++) {
    try { await page.evaluate(() => localStorage.clear()); break; }
    catch (_) { await page.waitForTimeout(400); }
  }
  await page.reload().catch(() => {});
  await page.waitForSelector('.plan-card');
  await page.locator('.plan-card').filter({ hasText: 'Push' }).first().click();
  await page.waitForSelector('[data-run]');
  await page.locator('[data-run]').click();
  await page.waitForSelector('.set-row');

  // log a few sets so the screen has real content
  for (let i = 0; i < 3; i++) {
    const row = page.locator('.run-ex').nth(0).locator('.set-row').nth(i);
    await row.locator('[data-f="weight"]').fill(String(60 + i * 2.5));
    await row.locator('[data-f="reps"]').fill(String(8 - i));
    await row.locator('[data-f="reps"]').click();
    await page.locator('#logbtn').click();
    await page.waitForTimeout(150);
    const skip = page.locator('#rest-skip'); if (await skip.count()) await skip.click().catch(() => {});
  }
  await page.locator('#finish').click();
  await page.waitForSelector('.hist-row');

  // make it look auto-ended, exactly like the case this screen exists for
  await page.evaluate(() => {
    const ss = JSON.parse(localStorage.getItem('wt_sessions_v1'));
    ss[0].endReason = 'auto'; ss[0].durationSec = 415;
    localStorage.setItem('wt_sessions_v1', JSON.stringify(ss));
  });
  await page.reload();
  await page.waitForSelector('.hist-row');
  await page.locator('.hist-row').first().click();
  await page.waitForSelector('#edit-session');
  await page.screenshot({ path: OUT + '/1-session-view.png', fullPage: true });

  await page.locator('#edit-session').click();
  await page.waitForSelector('#add-ex');
  await page.locator('#add-ex').selectOption({ label: 'Treadmill (cardio)' });
  await page.locator('#add-ex-go').click();
  await page.waitForTimeout(200);
  {
    const row = page.locator('.run-ex').last().locator('.set-row').first();
    await row.locator('[data-f="minutes"]').fill('20');
    await row.locator('[data-f="incline"]').fill('12');
    await row.locator('[data-f="speed"]').fill('5');
  }
  await page.locator('#sess-dur').fill('30');
  await page.screenshot({ path: OUT + '/2-session-edit.png', fullPage: true });

  await page.locator('#save-edit').click();
  await page.waitForSelector('#edit-session');
  await page.screenshot({ path: OUT + '/3-session-saved.png', fullPage: true });

  await browser.close();
  console.log('shots written to', OUT);
})();
