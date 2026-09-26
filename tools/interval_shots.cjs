/* Screenshots of every Interval Trainer state, at phone size, for a visual check.
   Run: node tools/interval_shots.cjs   (needs the dev server on :8099)
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
    await page.screenshot({ path: `${OUT}/interval-${name}.png`, fullPage: full });
    console.log('  shot:', name);
  };
  const shiftRun = (sec) => page.evaluate((s) => { // move the live run forward by s seconds
    const a = JSON.parse(localStorage.getItem('wt_interval_active_v1'));
    a.startedAt -= s * 1000; a.blockStartAt -= s * 1000; a.seenAt = Date.now();
    localStorage.setItem('wt_interval_active_v1', JSON.stringify(a));
  }, sec);

  await page.goto(BASE + '/#/');
  for (let i = 0; i < 6; i++) {
    try { await page.evaluate(() => localStorage.clear()); break; }
    catch (_) { await page.waitForTimeout(400); }
  }
  await page.reload().catch(() => {});
  await page.waitForSelector('.plan-card');

  // realistic history: a cardio plan + three past interval sessions
  await page.evaluate(() => {
    const plans = JSON.parse(localStorage.getItem('wt_plans_v1') || '[]');
    plans.push({ id: 'cardio1', name: 'Cardio', createdAt: Date.now(),
      exercises: [{ id: 'c1', name: 'Incline Walk', kind: 'treadmill', sets: 1, rest: 0 }] });
    localStorage.setItem('wt_plans_v1', JSON.stringify(plans));
    const day = 86400000, now = Date.now();
    const cfg = { warmSec: 600, hardSec: 240, easySec: 180, rounds: 4, coolSec: 300 };
    const mk = (id, ago, preset, machine, c, roundsDone, pace, after = null) => ({
      id, t: now - ago * day, endedAt: now - ago * day + 2400000, preset, machine, cfg: c,
      roundsDone, hardSec: roundsDone * c.hardSec, totalSec: 2400, pace, after });
    localStorage.setItem('wt_intervals_v1', JSON.stringify({
      prefs: { preset: '4x4', machine: 'treadmill', muted: true, cfgs: {} },
      sessions: [
        mk('i1', 10, '4x4', 'treadmill', cfg, 3, 11.5),
        mk('i2', 7, 'sprints', 'bike', { warmSec: 600, hardSec: 30, easySec: 90, rounds: 8, coolSec: 300 }, 8, 14),
        mk('i3', 4, '4x4', 'treadmill', cfg, 4, 12, 'Push'),
      ],
    }));
  });
  await page.reload();
  await page.waitForSelector('#iv-card');
  await page.locator('#iv-card').scrollIntoViewIfNeeded();
  await shot('0-home');

  await page.locator('#iv-card').click();
  await page.waitForSelector('#iv-start');
  await shot('1-setup', true);

  await page.locator('#iv-start').click();
  await page.waitForSelector('.iv-stage');
  await shiftRun(600 + 48);            // into hard 1, 3:12 left
  await page.reload();
  await page.waitForSelector('.iv-stage.hard');
  await page.waitForTimeout(600);
  await shot('2-run-hard');

  await shiftRun(192 + 173);           // 7 s left of easy 1
  await page.reload();
  await page.waitForSelector('.iv-stage.easy');
  await page.waitForTimeout(400);
  await shot('3-run-heads-up');

  await page.locator('#iv-pause').click();
  await page.waitForSelector('.iv-stage.paused');
  await shot('4-paused');
  await page.locator('#iv-pause').click();

  await page.locator('#iv-end').click();
  await page.waitForSelector('.plank-summary');
  await shot('5-summary', true);
  await page.locator('#iv-skip-pace').click();

  // the finisher card on a live workout
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.plan-card [data-run]');
  await page.locator('.plan-card [data-run]').first().click();
  await page.waitForSelector('#iv-finisher');
  await page.locator('#iv-finisher').scrollIntoViewIfNeeded();
  await shot('6-finisher-card');

  await browser.close();
  console.log('done');
})().catch((e) => { console.error('SHOTS CRASH:', e); process.exit(2); });
