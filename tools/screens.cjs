const { chromium } = require('C:/Users/Abbas/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const BASE = 'http://127.0.0.1:8099';
const EXE = 'C:/Users/Abbas/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const fs = require('fs');

(async () => {
  fs.mkdirSync(__dirname + '/shots', { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await (await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    deviceScaleFactor: 2,
  })).newPage();

  await page.goto(BASE + '/#/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-tpl="0"]');
  await page.locator('[data-tpl="0"]').click();           // Full Body (preview)
  await page.waitForSelector('#tpl-add'); await page.locator('#tpl-add').click();
  await page.waitForSelector('[data-run]');
  await page.screenshot({ path: __dirname + '/shots/2-plan.png' });

  await page.locator('[data-run]').click();
  await page.waitForSelector('.set-row');
  // SESSION 1 — log first set of three exercises (Legs / Chest / Back).
  // Squat & Bench hit the top of their range (-> "add weight" next time),
  // the Row falls short (-> "beat the reps" next time), so session 2's run
  // screen shows both recommendation states.
  const fillLog = async (exIndex, reps, wt) => {
    const r = page.locator('.run-ex').nth(exIndex).locator('.set-row').first();
    await r.locator('[data-f="reps"]').fill(String(reps));
    await r.locator('[data-f="weight"]').fill(String(wt));
    await r.locator('[data-f="reps"]').click(); // focus -> selects this set
    await page.locator('#logbtn').click();
    await page.waitForTimeout(150);
  };
  await fillLog(0, 12, 40); // Squat -> Legs   (12 >= top 8  -> graduate weight)
  await fillLog(1, 10, 50); // Bench Press     (10 >= top 8  -> graduate weight)
  await fillLog(2, 10, 60); // Bent-Over Row   (10 <  top 12 -> hold, beat reps)

  await page.locator('#finish').click();
  await page.waitForSelector('.hist-row');
  await page.screenshot({ path: __dirname + '/shots/4-history.png' });

  // SESSION 2 — start the same plan again; each card now shows a recommendation
  // prefilled from session 1's performance.
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.plan-card');
  await page.locator('.plan-card').first().click();
  await page.waitForSelector('[data-run]');
  await page.locator('[data-run]').click();
  await page.waitForSelector('.run-ex .rec');
  await page.waitForTimeout(200);
  await page.screenshot({ path: __dirname + '/shots/3-run.png' });

  await page.goto(BASE + '/#/insights');
  await page.waitForSelector('.stat-grid');
  await page.screenshot({ path: __dirname + '/shots/6-insights.png', fullPage: true });

  await page.goto(BASE + '/#/');
  await page.waitForSelector('.plan-card');
  await page.screenshot({ path: __dirname + '/shots/1-home.png' });

  // editor view
  await page.goto(BASE + '/#/plan/new');
  await page.waitForSelector('#plan-name');
  await page.screenshot({ path: __dirname + '/shots/5-editor.png' });

  await browser.close();
  console.log('shots saved');
})();
