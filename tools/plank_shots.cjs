/* Screenshots of every Plank Trainer state, at phone size, for a visual check.
   Run: node tools/plank_shots.cjs   (needs the dev server on :8099)
   Writes into tools/shots/ — that folder is git-ignored. */
const { chromium } = require('C:/Users/Abbas/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');

const BASE = 'http://127.0.0.1:8099';
const OUT = 'tools/shots';

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/Abbas/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.route('**/workout-sync.bboy-abbass.workers.dev/**',
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.addInitScript(() => {
    navigator.vibrate = () => true;
    try { localStorage.setItem('wt_sync_id', 'shots-only'); } catch (_) {}
  });

  const shot = async (name, full = false) => {
    await page.waitForTimeout(320);
    await page.screenshot({ path: `${OUT}/plank-${name}.png`, fullPage: full });
    console.log('  shot:', name);
  };

  await page.goto(BASE + '/#/');
  for (let i = 0; i < 6; i++) {
    try { await page.evaluate(() => localStorage.clear()); break; }
    catch (_) { await page.waitForTimeout(400); }
  }
  await page.reload().catch(() => {});
  await page.waitForSelector('.topbar');
  await page.waitForSelector('.plan-card');

  // realistic history: a cardio plan in the list + several past plank sessions
  await page.evaluate(() => {
    const plans = JSON.parse(localStorage.getItem('wt_plans_v1') || '[]');
    plans.push({ id: 'cardio1', name: 'Cardio', createdAt: Date.now(),
      exercises: [{ id: 'c1', name: 'Incline Walk', kind: 'treadmill', sets: 1, rest: 0 }] });
    localStorage.setItem('wt_plans_v1', JSON.stringify(plans));
    const day = 86400000, now = Date.now();
    const mk = (id, ago, secs) => ({ id, t: now - ago * day, endedAt: now - ago * day,
      sets: secs.map((s, i) => ({ sec: s, at: now - ago * day + i * 90000 })) });
    localStorage.setItem('wt_planks_v1', JSON.stringify({
      targetSets: 3, restSec: 60,
      sessions: [
        mk('p1', 24, [42, 38, 35]), mk('p2', 20, [50, 46, 41]), mk('p3', 16, [58, 52, 47]),
        mk('p4', 11, [66, 61, 55]), mk('p5', 7, [78, 70, 64]), mk('p6', 3, [92, 84, 75]),
      ],
    }));
  });
  await page.reload();
  await page.waitForSelector('#plank-card');
  await shot('0-home', true);

  await page.locator('#plank-card').click();
  await page.waitForSelector('#plank-start');
  await shot('1-setup', true);

  await page.locator('#plank-start').click();
  await page.waitForSelector('.plank-stage-hold');
  await page.waitForTimeout(2600);
  await shot('2-hold');

  // fake a hold that is past the record, to capture the celebration state
  await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('wt_plank_active_v1'));
    a.startAt = Date.now() - 99 * 1000;
    localStorage.setItem('wt_plank_active_v1', JSON.stringify(a));
  });
  await page.reload();
  await page.waitForSelector('.plank-stage-hold');
  await page.waitForTimeout(900);
  await shot('3-hold-past-best');

  await page.locator('#plank-stop').click();
  await page.waitForSelector('.plank-stage-rest');
  await shot('4-rest');

  await page.locator('#plank-skip-rest').click();
  await page.waitForSelector('.plank-stage-ready');
  await shot('5-ready');

  await page.locator('#plank-go').click();
  await page.waitForSelector('.plank-stage-hold');
  await page.waitForTimeout(1400);
  await page.locator('#plank-stop').click();
  await page.waitForSelector('.plank-stage-rest');
  await page.locator('#plank-skip-rest').click();
  await page.waitForSelector('.plank-stage-ready');
  await page.locator('#plank-go').click();
  await page.waitForSelector('.plank-stage-hold');
  await page.waitForTimeout(1400);
  await page.locator('#plank-stop').click();
  await page.waitForSelector('.plank-summary');
  await shot('6-summary', true);

  await page.locator('#plank-done').click();
  await page.waitForSelector('#plank-start');
  await shot('7-setup-after', true);

  await browser.close();
  console.log('done');
})().catch((e) => { console.error('SHOTS CRASH:', e); process.exit(2); });
