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
  // never touch the real cloud-sync doc from tests (return empty, no network)
  await page.route('**/workout-sync.bboy-abbass.workers.dev/**',
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

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

  console.log('\n[1] Plans auto-load on a fresh device (no template step)');
  await page.waitForSelector('.plan-card');
  check((await page.locator('.plan-card').count()) >= 5, 'all program plans auto-loaded');
  check((await page.locator('[data-tpl]').count()) === 0, 'no "add from template" section');
  const firstName = (await page.locator('.plan-card .name').first().textContent()) || '';
  check(firstName.includes('Push'), `first plan is Push (${firstName.trim()})`);

  console.log('\n[2] Open a plan');
  await page.locator('.plan-card').first().click();      // Push
  await page.waitForSelector('[data-run]');
  check(/#\/plan\//.test(page.url()), 'navigated to plan detail');
  check(await page.locator('[data-run]').first().isVisible(), 'Start workout button present');

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
  check(await page.locator('#logbtn').isVisible(), 'single pinned Log button shown');

  console.log('\n[5] Log the selected set -> rest countdown + vibration');
  const row = page.locator('.set-row').first();
  check(await page.locator('.set-row.active').first().isVisible(), 'first set is auto-selected (highlighted)');
  await row.locator('[data-f="reps"]').fill('10');
  await row.locator('[data-f="weight"]').fill('20');
  await page.locator('#logbtn').click();
  check(await page.locator('.set-row.done').first().isVisible(), 'pinned button logged the selected set');
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
  await page.locator('.plan-card').first().click();
  await page.waitForSelector('[data-run]');
  await page.locator('[data-run]').click();
  await page.waitForSelector('.run-ex');
  const rVal = await page.locator('.run-ex').first().locator('[data-f="reps"]').first().inputValue();
  const wVal = await page.locator('.run-ex').first().locator('[data-f="weight"]').first().inputValue();
  check(rVal === '10' && wVal === '20', `last time is prefilled into the boxes (weight ${wVal}, reps ${rVal})`);
  check((await page.locator('.input.rec-target').count()) >= 1, 'progressive-overload target highlighted on a cell');
  check((await page.locator('.cell-hint').count()) >= 1, 'per-cell "→ N" target shown on the cell to beat');

  console.log('\n[7b] Insights page');
  await page.goto(BASE + '/#/insights');
  await page.waitForSelector('.stat-grid', { timeout: 4000 });
  check((await page.locator('.stat-grid .stat').count()) >= 4, 'insights stat cards render');
  check((await page.locator('.mbar').count()) >= 1, 'muscle focus bars render');
  const muscleTxt = (await page.locator('.mbar-top').first().textContent()) || '';
  check(/Legs|Back|Chest|Shoulders|Arms|Core|Other/.test(muscleTxt), `muscle group shown (${muscleTxt.trim()})`);

  console.log('\n[7c] Only LOGGED sets are saved (prefilled-but-unlogged must not count)');
  // fresh state -> plans auto-load; open Push
  await page.goto(BASE + '/#/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.plan-card');
  await page.locator('.plan-card').first().click();      // Push
  await page.waitForSelector('[data-run]');
  // session 1: log ONLY the first exercise, finish
  await page.locator('[data-run]').click();
  await page.waitForSelector('.set-row');
  let r1 = page.locator('.run-ex').nth(0).locator('.set-row').first();
  await r1.locator('[data-f="weight"]').fill('40');
  await r1.locator('[data-f="reps"]').fill('12');
  await r1.locator('[data-f="reps"]').click();
  await page.locator('#logbtn').click();
  await page.waitForTimeout(150);
  await page.locator('#finish').click();
  await page.waitForSelector('.hist-row');
  const s1 = await page.evaluate(() => JSON.parse(localStorage.getItem('wt_sessions_v1') || '[]'));
  check(s1.length === 1 && s1[0].entries.length === 1 && s1[0].entries[0].name === 'Incline Barbell Bench',
    `session 1 saved only the logged exercise (entries=${s1[0] ? s1[0].entries.map(e => e.name).join(',') : 'none'})`);

  // session 2: start again; Squat is now PREFILLED with a recommendation but
  // log NOTHING. Finishing must save no new session.
  page.once('dialog', (d) => d.accept()); // "No sets logged. Finish anyway?"
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.plan-card');
  await page.locator('.plan-card').first().click();
  await page.waitForSelector('[data-run]');
  await page.locator('[data-run]').click();
  await page.waitForSelector('.run-ex .set-row');
  const prefRep = await page.locator('.run-ex').nth(0).locator('[data-f="reps"]').first().inputValue();
  check(prefRep !== '', `last-time value prefilled in the reps box (${prefRep}) without logging`);
  await page.locator('#finish').click();
  await page.waitForTimeout(200);
  const s2 = await page.evaluate(() => JSON.parse(localStorage.getItem('wt_sessions_v1') || '[]'));
  check(s2.length === 1, `unlogged workout saved nothing (sessions still ${s2.length}, expected 1)`);

  console.log('\n[7d] Editing the plan mid-workout does NOT drop logged sets');
  await page.goto(BASE + '/#/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.plan-card');
  await page.locator('.plan-card').first().click();      // Push
  await page.waitForSelector('[data-run]');
  await page.locator('[data-run]').click();
  await page.waitForSelector('.set-row');
  const logEx = async (i) => {
    const r = page.locator('.run-ex').nth(i).locator('.set-row').first();
    await r.locator('[data-f="weight"]').fill('50');
    await r.locator('[data-f="reps"]').fill('10');
    await r.locator('[data-f="reps"]').click();
    await page.locator('#logbtn').click();
    await page.waitForTimeout(120);
  };
  await logEx(0); // Incline Barbell Bench
  await logEx(2); // Seated DB Shoulder Press
  // remove the 3rd exercise from the plan while the workout is active
  await page.evaluate(() => {
    const pl = JSON.parse(localStorage.getItem('wt_plans_v1'));
    pl[0].exercises = pl[0].exercises.filter((e) => e.name !== 'Seated DB Shoulder Press');
    localStorage.setItem('wt_plans_v1', JSON.stringify(pl));
  });
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.plan-card');
  await page.locator('.plan-card').first().click();
  await page.waitForSelector('[data-run]');
  await page.locator('[data-run]').click();
  await page.waitForSelector('.run-ex');
  await page.locator('#finish').click();
  await page.waitForTimeout(200);
  const sd = await page.evaluate(() => JSON.parse(localStorage.getItem('wt_sessions_v1') || '[]'));
  const savedNames = sd[0] ? sd[0].entries.map((e) => e.name) : [];
  check(savedNames.includes('Incline Barbell Bench') && savedNames.includes('Seated DB Shoulder Press'),
    `both logged exercises saved despite plan edit (${savedNames.join(',')})`);

  console.log('\n[7e] Insights extras (calendar/records), exercise chart, PR toast');
  await page.goto(BASE + '/#/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.plan-card');
  await page.locator('.plan-card').first().click();      // Push
  await page.waitForSelector('[data-run]');
  const logSquat = async (wt, rp) => {
    const row = page.locator('.run-ex').nth(0).locator('.set-row').first();
    await row.locator('[data-f="weight"]').fill(String(wt));
    await row.locator('[data-f="reps"]').fill(String(rp));
    await row.locator('[data-f="reps"]').click();
    await page.locator('#logbtn').click();
    await page.waitForTimeout(120);
  };
  // session 1: Squat 60x10
  await page.locator('[data-run]').click();
  await page.waitForSelector('.set-row');
  await logSquat(60, 10);
  await page.locator('#finish').click();
  await page.waitForSelector('.hist-row');
  // session 2: Squat 70x10 -> beats est-1RM -> PR toast
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.plan-card');
  await page.locator('.plan-card').first().click();
  await page.waitForSelector('[data-run]');
  await page.locator('[data-run]').click();
  await page.waitForSelector('.set-row');
  check((await page.locator('.input.rec-target').count()) >= 1, 'recommendation highlights a cell on the run screen');
  await logSquat(70, 10);
  await page.locator('#finish').click();
  const prToast = await page.waitForSelector('.toast', { timeout: 2500 }).then((h) => h.textContent()).catch(() => '');
  check(/PR/i.test(prToast || ''), `PR toast fires on a new record (${(prToast || '').trim()})`);
  await page.waitForSelector('.hist-row');
  // insights extras
  await page.goto(BASE + '/#/insights');
  await page.waitForSelector('.stat-grid');
  check((await page.locator('.cal .cal-cell').count()) >= 7, 'consistency calendar renders');
  check((await page.locator('[data-ex]').count()) >= 1, 'strength records list renders');
  // exercise progress screen
  await page.locator('[data-ex]').first().click();
  await page.waitForSelector('.spark');
  check((await page.locator('.spark polyline').count()) === 1, 'exercise progress chart renders');
  check(/#\/exercise\//.test(page.url()), 'navigated to exercise progress screen');

  console.log('\n[7f] Exercise progress back-button returns to where you came from');
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.plan-card');
  await page.locator('.plan-card').first().click();
  await page.waitForSelector('[data-ex]');             // plan-detail exercise rows
  const planUrl = page.url();
  await page.locator('[data-ex]').first().click();
  await page.waitForSelector('.spark, .empty');
  check(/#\/exercise\//.test(page.url()), 'plan exercise opens its progress screen');
  await page.locator('[data-back]').click();
  await page.waitForSelector('[data-run]');
  check(page.url() === planUrl && /#\/plan\//.test(page.url()),
    'back returns to the plan, not the general insights page');

  console.log('\n[7g] Rest countdown is timestamp-based and survives a reload');
  await page.goto(BASE + '/#/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.plan-card');
  await page.locator('.plan-card').first().click();      // Push
  await page.waitForSelector('[data-run]');
  await page.locator('[data-run]').click();
  await page.waitForSelector('.set-row');
  const rr = page.locator('.run-ex').nth(0).locator('.set-row').first();
  await rr.locator('[data-f="weight"]').fill('40');
  await rr.locator('[data-f="reps"]').fill('8');
  await rr.locator('[data-f="reps"]').click();
  await page.locator('#logbtn').click();
  await page.waitForSelector('#rest-host .card');                 // 90s rest running
  const rstate = await page.evaluate(() => JSON.parse(localStorage.getItem('wt_active_v1') || '{}').restState);
  check(rstate && rstate.endAt > Date.now(), 'rest end-time persisted to storage (survives suspend)');
  await page.reload();                                            // simulate being killed/restored
  const restored = await page.waitForSelector('#rest-host .card', { timeout: 4000 }).then(() => true).catch(() => false);
  check(restored, 'rest countdown restored after a full reload');

  console.log('\n[7h] Cardio (treadmill / stairmaster) logging');
  await page.goto(BASE + '/#/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.plan-card');
  await page.locator('.plan-card').nth(1).click();        // Legs day (ends with Incline Walk)
  await page.waitForSelector('[data-run]');
  await page.locator('[data-run]').click();
  await page.waitForSelector('.set-row');
  const tre = page.locator('.run-ex').nth(4);              // Incline Walk (treadmill) finisher
  check((await tre.locator('[data-f=incline]').count()) >= 1
    && (await tre.locator('[data-f=speed]').count()) >= 1
    && (await tre.locator('[data-f=minutes]').count()) >= 1, 'treadmill finisher shows incline/speed/min inputs');
  const trow = tre.locator('.set-row').first();
  await trow.locator('[data-f=incline]').fill('12');
  await trow.locator('[data-f=speed]').fill('3');
  await trow.locator('[data-f=minutes]').fill('30');
  await trow.locator('[data-f=minutes]').click();
  await page.locator('#logbtn').click();
  await page.waitForTimeout(150);
  await page.locator('#finish').click();
  await page.waitForSelector('.hist-row');
  const cs = await page.evaluate(() => JSON.parse(localStorage.getItem('wt_sessions_v1') || '[]'));
  const tEntry = cs[0] && cs[0].entries.find((e) => e.kind === 'treadmill');
  check(tEntry && tEntry.sets[0].incline === 12 && tEntry.sets[0].speed === 3 && tEntry.sets[0].minutes === 30,
    'treadmill set saved with machine settings (incline/speed/min)');
  await page.locator('.hist-row').first().click();
  await page.waitForSelector('.card');
  check((await page.locator('text=30 min').count()) >= 1, 'session detail shows cardio settings in plain units');
  await page.goto(BASE + '/#/insights');
  await page.waitForSelector('.stat-grid');
  check((await page.locator('[data-ex]').count()) === 0, 'cardio is not listed as a strength record');

  console.log('\n[7i] Settings: export present + reset wipes all data');
  // seed something first
  await page.goto(BASE + '/#/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.plan-card');               // plans auto-load
  await page.goto(BASE + '/#/settings');
  await page.waitForSelector('#export');
  check(await page.locator('#export').isVisible(), 'export button present');
  check(await page.locator('#reset').isVisible(), 'reset button present');
  const acc = (d) => d.accept();
  page.on('dialog', acc); // two confirms
  await page.locator('#reset').click();
  await page.waitForTimeout(200);
  page.off('dialog', acc);
  const wiped = await page.evaluate(() => ({
    p: localStorage.getItem('wt_plans_v1'), s: localStorage.getItem('wt_sessions_v1'),
  }));
  check(!wiped.p && !wiped.s, 'reset cleared plans + sessions');

  console.log('\n[8] No console errors');
  check(consoleErrors.length === 0, 'no console/page errors' + (consoleErrors.length ? ' -> ' + consoleErrors.join(' | ') : ''));

  console.log('\n[9] Offline still works (service worker cache)');
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.topbar');
  await page.waitForTimeout(1500); // let the worker take control + one-time reload settle
  await page.waitForSelector('.topbar').catch(() => {});
  await page.context().setOffline(true);
  let offlineOk = false;
  try { await page.reload({ timeout: 8000 }); await page.waitForSelector('.topbar', { timeout: 6000 }); offlineOk = true; } catch (_) {}
  check(offlineOk, 'app shell renders with network OFF');
  await page.context().setOffline(false);

  await browser.close();
  console.log('\n' + (fails.length ? `RESULT: ${fails.length} FAILED` : 'RESULT: ALL PASSED'));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(2); });
