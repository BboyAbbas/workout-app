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
  await page.locator('[data-tpl="0"]').click();           // Full Body
  await page.waitForSelector('[data-run]');
  await page.screenshot({ path: __dirname + '/shots/2-plan.png' });

  await page.locator('[data-run]').click();
  await page.waitForSelector('.set-row');
  const row = page.locator('.set-row').first();
  await row.locator('[data-f="reps"]').fill('12');
  await row.locator('[data-f="weight"]').fill('40');
  await page.locator('[data-log]').first().click();
  await page.waitForSelector('#rest-host .card');
  await page.waitForTimeout(300);
  await page.screenshot({ path: __dirname + '/shots/3-run.png' });

  await page.locator('#finish').click();
  await page.waitForSelector('.hist-row');
  await page.screenshot({ path: __dirname + '/shots/4-history.png' });

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
