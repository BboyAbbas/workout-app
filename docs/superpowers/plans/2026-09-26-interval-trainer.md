# Interval Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Interval Trainer (Norwegian 4×4, sprints, Tabata, 10×1, custom) beside the Plank Trainer, reachable from home and as a finisher from a live workout, with a 7 s heads-up cue, a speed target per preset and machine, its own synced store, and heatmap credit.

**Architecture:** A new pure module `js/intervals.js` holds presets, the block list and a timestamp-driven state machine (same principle as `plankStep`). `js/db.js` owns the new store `wt_intervals_v1` and the cloud field `intervals`; `js/app.js` renders home, finisher entry and the setup/run/summary screen and fires the cues. No sync-worker change.

**Tech Stack:** Vanilla ES modules PWA, `localStorage`, Web Audio, `speechSynthesis`, `navigator.vibrate`, Screen Wake Lock. Tests: plain Node scripts (`npm test`) and Playwright-driven Chromium (`tools/smoke_test.cjs`).

**Spec:** `docs/superpowers/specs/2026-09-26-interval-trainer-design.md` (mockups beside it: `2026-09-26-interval-trainer-mockups.html`).

## Global Constraints

- Machines: `treadmill` and `bike` only. Machine chips show only `Treadmill` / `Bike` — no unit text.
- Phase colours: warm-up and cool-down `#8b93a7`, hard `var(--accent)`, easy `#6aa9ff`.
- Presets exactly: `4x4` 600/240/180/4/300 · `sprints` 600/30/90/8/300 · `tabata` 300/20/10/8/300 · `10x1` 600/60/60/10/300 · `custom` = 4×4 (warmSec/hardSec/easySec/rounds/coolSec).
- Ranges: warm-up and cool-down 0–1200 s step 60; hard and easy 5–600 s, step 5 below 60 s, 15 from 60 s; rounds 1–20.
- Cues: heads-up at 7 s left on blocks > 10 s; ticks at 3-2-1 on blocks ≥ 5 s; switch = long tone + `vibrate([400,120,400])` + voice; mute silences tones and voice, never vibration.
- A round counts when its hard block ran ≥ 90 %. A session is recorded only when hard time ≥ 1 s, the moment the run ends.
- Reopen rules: paused > 30 min → end at `pausedAt`; not seen > 30 min → end at `seenAt`; summary kept until Save/Skip, dropped after 6 h.
- Speed target per preset + machine: last session with a speed, +0.5 km/h (treadmill) or +1 level (bike) only if it finished every round.
- Finisher warm-up = `min(preset warm-up, 180 s)`, for that run only. A linked run calls `bumpActivity()` every 5 s heartbeat.
- Week target 2; week starts Monday 00:00 local; a session counts when `roundsDone ≥ 1`.
- Interval sessions never enter `plans`, workout `sessions`, up-next, main History, or strength records.
- Every file keeps its existing comment style; copy is sentence case; section labels are rendered uppercase by CSS.
- Release: `js/intervals.js` in `sw.js` `SHELL`; `CACHE` bumped `workout-v54` → `workout-v55`.

## Review Focus

1. **Phone away for several blocks, then back** — the run lands on the correct block with the correct time left and plays at most one switch cue. (Pinned: Task 1 catch-up test; Task 5 smoke "a phone away for minutes lands on the right block".)
2. **Double-tap on Skip at the very end** — the run finishes once, records once, never goes negative. (Pinned: Task 1 "step on a done run is ignored"; Task 2 "second record refused".)
3. **Android decimal comma in the speed box (`12,5`), empty box, junk** — comma accepted; empty or junk saves the session without a speed. (Pinned: Task 1 pace tests; Task 5 smoke fills `12,5`.)
4. **Cloud pull re-renders the router mid-run** — the run keeps going, nothing is recorded twice. (Pinned: Task 5 smoke hashchange mid-run.)
5. **Workout discarded or finished while the finisher ran** — Save goes home instead of a dead workout screen; `after` is still stored. (Pinned: Task 6 smoke "a workout discarded meanwhile sends Save home".)

---

### Task 1: Pure interval engine

**Files:**
- Create: `js/intervals.js`
- Create: `tools/interval_test.mjs`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: nothing.
- Produces (all named exports of `js/intervals.js`):
  - `MACHINES: { treadmill|bike: { id, name, word, ask, unit, step, min, max, start, easyHint } }`, `MACHINE_IDS: string[]`
  - `PRESETS: { id, chip, name, blurb, hardHint, cfg }[]`, `presetById(id) → preset`
  - `KIND_NAME`, `KIND_WORD` (maps `warm|hard|easy|cool` → label)
  - Constants: `FINISHER_WARM_SEC=180`, `WEEK_TARGET=2`, `HEADS_UP_SEC=7`, `HEARTBEAT_MS=5000`, `ABANDON_MS`, `SUMMARY_TTL_MS`, `ROUND_DONE_FRACTION=0.9`
  - `cleanCfg(cfg, fallback?) → cfg`, `sameCfg(a, b) → bool`, `stepField(field, value, dir) → number`
  - `buildBlocks(cfg) → {kind, sec, round}[]`, `planTotals(cfg) → {totalSec, hardSec}`, `fmtBlock(sec) → 'm:ss'`, `fmtMinutes(sec) → '16 min' | '2:40'`
  - `newIntervalRun({id, preset, machine, cfg, from, target}, now) → run`
  - `currentBlock(run)`, `nextBlock(run)`, `blockLeftSec(run, now)`, `sessionLeftSec(run, now)`
  - `intervalStep(run, {type}, now) → run` (types `tick|pause|resume|skip|back|end|heartbeat`; `lastEvent` ∈ `switch|done|paused|resumed|restart|null`)
  - `intervalResume(run, now) → run | null` (`lastEvent: 'abandoned'` when ended by the 30 min rules)
  - `runStats(run) → {hardSec, totalSec, roundsDone, rounds}`, `toSession(run) → session`
  - `cueAt(blockSec, leftSec) → 'heads'|'tick'|null`, `voiceLine(block|null, run, spokenTarget) → string`
  - `cleanPace(machine, v) → number|null`, `stepPace(machine, v, dir)`, `fmtPace`, `fmtPaceShort`, `fmtPaceInput`, `spokenPace`
  - `lastWithPace(sessions, preset, machine)`, `paceTarget(sessions, preset, machine) → number|null`, `bestPace(...)`, `weekCount(sessions, now) → number`

- [ ] **Step 1: Write the failing test**

Create `tools/interval_test.mjs`:

```js
/* Unit tests for the Interval Trainer: the pure engine in js/intervals.js and
   its store/sync helpers in js/db.js. Installs the same in-memory localStorage
   shim as plank_test.mjs. Run with `node tools/interval_test.mjs`. */
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const IV = await import('../js/intervals.js');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } }
function eq(name, got, want) { ok(`${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, got === want); }

const T0 = 1_700_000_000_000;
const S = (n) => T0 + n * 1000; // n seconds after T0
const MIN = 60;
const run44 = (at = S(0)) => IV.newIntervalRun(
  { id: 'r1', preset: '4x4', machine: 'treadmill', cfg: IV.presetById('4x4').cfg, target: 12.5 }, at);

/* ---------- presets and blocks ---------- */
console.log('buildBlocks — the Norwegian 4×4 in order:');
{
  const b = IV.buildBlocks(IV.presetById('4x4').cfg);
  eq('9 blocks (warm, 4 hard, 3 easy, cool)', b.length, 9);
  eq('starts with warm-up', b[0].kind, 'warm');
  eq('no easy after the last hard', b[7].kind + '>' + b[8].kind, 'hard>cool');
  eq('round numbers on hard blocks', b.filter((x) => x.kind === 'hard').map((x) => x.round).join(','), '1,2,3,4');
  eq('easy block carries the round it follows', b[2].round, 1);
  const t = IV.planTotals(IV.presetById('4x4').cfg);
  eq('40 min total', t.totalSec, 40 * MIN);
  eq('16 min hard', t.hardSec, 16 * MIN);
}

console.log('buildBlocks — zero warm-up / cool-down drop the block:');
{
  const b = IV.buildBlocks({ warmSec: 0, hardSec: 20, easySec: 10, rounds: 2, coolSec: 0 });
  eq('hard, easy, hard', b.map((x) => x.kind).join(','), 'hard,easy,hard');
}

console.log('presets — every preset matches the spec table:');
{
  const want = { '4x4': [600, 240, 180, 4, 300], sprints: [600, 30, 90, 8, 300], tabata: [300, 20, 10, 8, 300],
    '10x1': [600, 60, 60, 10, 300], custom: [600, 240, 180, 4, 300] };
  for (const [id, v] of Object.entries(want)) {
    const c = IV.presetById(id).cfg;
    eq(`${id} cfg`, [c.warmSec, c.hardSec, c.easySec, c.rounds, c.coolSec].join(','), v.join(','));
  }
  eq('five presets', IV.PRESETS.length, 5);
  eq('unknown preset falls back to 4×4', IV.presetById('nope').id, '4x4');
  eq('two machines', IV.MACHINE_IDS.join(','), 'treadmill,bike');
}

console.log('stepField — steps and limits:');
{
  eq('warm-up +1 min', IV.stepField('warmSec', 600, 1), 660);
  eq('warm-up floor 0', IV.stepField('warmSec', 0, -1), 0);
  eq('warm-up cap 20 min', IV.stepField('warmSec', 1200, 1), 1200);
  eq('hard 0:55 -> 1:00', IV.stepField('hardSec', 55, 1), 60);
  eq('hard 1:00 -> 1:15', IV.stepField('hardSec', 60, 1), 75);
  eq('hard 1:00 -> 0:55', IV.stepField('hardSec', 60, -1), 55);
  eq('hard 1:15 -> 1:00', IV.stepField('hardSec', 75, -1), 60);
  eq('easy floor 5 s', IV.stepField('easySec', 5, -1), 5);
  eq('hard cap 10 min', IV.stepField('hardSec', 600, 1), 600);
  eq('rounds +1', IV.stepField('rounds', 4, 1), 5);
  eq('rounds floor 1', IV.stepField('rounds', 1, -1), 1);
  eq('rounds cap 20', IV.stepField('rounds', 20, 1), 20);
}

console.log('cleanCfg — junk becomes safe numbers:');
{
  const c = IV.cleanCfg({ warmSec: 'x', hardSec: -4, easySec: 99999, rounds: 2.6, coolSec: null });
  eq('junk warm-up -> fallback', c.warmSec, 600);
  eq('negative hard -> 5 s floor', c.hardSec, 5);
  eq('huge easy -> 10 min cap', c.easySec, 600);
  eq('rounds rounded', c.rounds, 3);
  eq('missing cool-down -> fallback', c.coolSec, 300);
  ok('sameCfg true for equal', IV.sameCfg(IV.presetById('4x4').cfg, IV.presetById('custom').cfg));
  ok('sameCfg false after an edit', !IV.sameCfg(IV.presetById('4x4').cfg, { ...IV.presetById('4x4').cfg, rounds: 5 }));
  eq('fmtBlock 4:00', IV.fmtBlock(240), '4:00');
  eq('fmtBlock 0:30', IV.fmtBlock(30), '0:30');
  eq('fmtMinutes whole', IV.fmtMinutes(960), '16 min');
  eq('fmtMinutes part', IV.fmtMinutes(160), '2:40');
}

/* ---------- the run state machine ---------- */
console.log('run — starts in the first block:');
{
  const r = run44();
  eq('phase', r.phase, 'run');
  eq('idx', r.idx, 0);
  eq('block left = 10:00', IV.blockLeftSec(r, S(0)), 600);
  eq('session left = 40:00', IV.sessionLeftSec(r, S(0)), 2400);
  eq('block left after 61 s', IV.blockLeftSec(r, S(61)), 539);
  eq('next block is hard', IV.nextBlock(r).kind, 'hard');
}

console.log('tick — nothing moves inside a block:');
{ const r = run44(); ok('same object back', IV.intervalStep(r, { type: 'tick' }, S(599)) === r); }

console.log('tick — exactly at the edge the next block starts:');
{
  const r = IV.intervalStep(run44(), { type: 'tick' }, S(600));
  eq('now in hard 1', r.idx, 1);
  eq('event', r.lastEvent, 'switch');
  eq('warm-up fully spent', r.spent[0], 600);
  eq('hard block starts at the edge, not at the tick', r.blockStartAt, S(600));
}

console.log('tick — catches up across many blocks at once (phone was away):');
{
  // 10 warm + 4 hard + 3 easy + 4 hard = 21 min, plus 30 s into easy 2
  const r = IV.intervalStep(run44(), { type: 'tick' }, S(21 * MIN + 30));
  eq('in easy after round 2', IV.currentBlock(r).kind + IV.currentBlock(r).round, 'easy2');
  eq('150 s left of it', IV.blockLeftSec(r, S(21 * MIN + 30)), 150);
  eq('two full rounds counted', IV.runStats(r).roundsDone, 2);
}

console.log('tick — past the last block the run is done at the exact end:');
{
  const r = IV.intervalStep(run44(), { type: 'tick' }, S(3 * 3600));
  eq('done', r.phase, 'done');
  eq('event', r.lastEvent, 'done');
  eq('ended at 40:00', r.endedAt, S(2400));
  const st = IV.runStats(r);
  eq('4 rounds', st.roundsDone, 4);
  eq('16 min hard', st.hardSec, 960);
  eq('40 min total', st.totalSec, 2400);
}

console.log('pause / resume — paused time never counts:');
{
  let r = IV.intervalStep(run44(), { type: 'pause' }, S(100));
  eq('frozen while paused', IV.blockLeftSec(r, S(400)), 500);
  ok('tick while paused does nothing', IV.intervalStep(r, { type: 'tick' }, S(5000)) === r);
  r = IV.intervalStep(r, { type: 'resume' }, S(400));
  eq('resumes where it froze', IV.blockLeftSec(r, S(400)), 500);
  const twice = IV.intervalStep(IV.intervalStep(r, { type: 'pause' }, S(410)), { type: 'pause' }, S(420));
  eq('pause twice keeps the first pause', twice.pausedAt, S(410));
}

console.log('skip — ends the block now and records only the time run:');
{
  let r = IV.intervalStep(run44(), { type: 'tick' }, S(600)); // in hard 1
  r = IV.intervalStep(r, { type: 'skip' }, S(700));           // 100 s of 240
  eq('now in easy 1', IV.currentBlock(r).kind, 'easy');
  eq('hard 1 spent 100 s', r.spent[1], 100);
  eq('round not counted (<90%)', IV.runStats(r).roundsDone, 0);
  eq('new block starts at the tap', r.blockStartAt, S(700));
  eq('event', r.lastEvent, 'switch');
}

console.log('skip — near the end still counts the round (>=90%):');
{
  let r = IV.intervalStep(run44(), { type: 'tick' }, S(600));
  r = IV.intervalStep(r, { type: 'skip' }, S(820)); // 220 of 240 = 91.7%
  eq('round counted', IV.runStats(r).roundsDone, 1);
}

console.log('skip — while paused stays paused:');
{
  let r = IV.intervalStep(run44(), { type: 'pause' }, S(50));
  r = IV.intervalStep(r, { type: 'skip' }, S(80));
  ok('still paused', !!r.pausedAt);
  eq('warm-up credited 50 s, not 80', r.spent[0], 50);
  eq('next block untouched while paused', IV.blockLeftSec(r, S(999)), 240);
}

console.log('skip — on the last block finishes the run, once:');
{
  let r = IV.intervalStep(run44(), { type: 'tick' }, S(2390)); // 10 s left of cool-down
  r = IV.intervalStep(r, { type: 'skip' }, S(2395));
  eq('done', r.phase, 'done');
  eq('ended at the tap', r.endedAt, S(2395));
  ok('a step on a done run is ignored', IV.intervalStep(r, { type: 'skip' }, S(2396)) === r);
}

console.log('back — restarts the block after 3 s, else goes to the previous one:');
{
  const r = IV.intervalStep(run44(), { type: 'tick' }, S(600)); // hard 1 starts at 600
  let b = IV.intervalStep(r, { type: 'back' }, S(640));          // 40 s in
  eq('restart keeps the block', b.idx, 1);
  eq('restart resets its clock', IV.blockLeftSec(b, S(640)), 240);
  eq('restart event', b.lastEvent, 'restart');
  b = IV.intervalStep(r, { type: 'back' }, S(602));              // 2 s in
  eq('goes back to warm-up', b.idx, 0);
  eq('warm-up spent reset', b.spent[0], 0);
  eq('full warm-up again', IV.blockLeftSec(b, S(602)), 600);
  eq('switch event', b.lastEvent, 'switch');
  eq('back in the first block restarts it', IV.intervalStep(run44(), { type: 'back' }, S(1)).idx, 0);
}

console.log('end — keeps what was run:');
{
  let r = IV.intervalStep(run44(), { type: 'tick' }, S(1080)); // 60 s into hard 2
  r = IV.intervalStep(r, { type: 'end' }, S(1080));
  eq('done', r.phase, 'done');
  eq('ended now', r.endedAt, S(1080));
  const st = IV.runStats(r);
  eq('1 round', st.roundsDone, 1);
  eq('hard = 240 + 60', st.hardSec, 300);
}

console.log('end — during warm-up records no hard time:');
{ const r = IV.intervalStep(run44(), { type: 'end' }, S(30)); eq('hard 0', IV.runStats(r).hardSec, 0); }

console.log('heartbeat — stamps seenAt only:');
{
  const r = IV.intervalStep(run44(), { type: 'heartbeat' }, S(42));
  eq('seenAt', r.seenAt, S(42));
  eq('idx unchanged', r.idx, 0);
  eq('no event', r.lastEvent, null);
}

/* ---------- reopening ---------- */
console.log('resume — a short absence just catches up:');
{ const r = IV.intervalResume(run44(), S(700)); eq('in hard 1', r.idx, 1); }

console.log('resume — an unchanged run comes back as the same object:');
{ const r0 = run44(); ok('identity kept', IV.intervalResume(r0, S(10)) === r0); }

console.log('resume — paused over 30 min ends at the pause:');
{
  let r = IV.intervalStep(IV.intervalStep(run44(), { type: 'tick' }, S(700)), { type: 'pause' }, S(720)); // 120 s into hard 1
  r = IV.intervalResume(r, S(720) + 31 * 60000);
  eq('done', r.phase, 'done');
  eq('ended at the pause', r.endedAt, S(720));
  eq('event', r.lastEvent, 'abandoned');
  eq('hard time up to the pause', IV.runStats(r).hardSec, 120);
}

console.log('resume — not seen for over 30 min ends where it was last seen:');
{
  let r = IV.intervalStep(run44(), { type: 'heartbeat' }, S(660)); // seen 60 s into hard 1
  r = IV.intervalResume(r, S(660) + 45 * 60000);
  eq('done', r.phase, 'done');
  eq('ended at seenAt', r.endedAt, S(660));
  eq('event', r.lastEvent, 'abandoned');
  eq('only 60 s hard credited', IV.runStats(r).hardSec, 60);
}

console.log('resume — a run seen recently that ran out finishes normally:');
{
  let r = IV.intervalStep(run44(), { type: 'heartbeat' }, S(2395));
  r = IV.intervalResume(r, S(2410));
  eq('event', r.lastEvent, 'done');
  eq('all 4 rounds', IV.runStats(r).roundsDone, 4);
}

console.log('resume — a finished summary stays 6 h, then is dropped:');
{
  const done = IV.intervalStep(run44(), { type: 'tick' }, S(2400));
  ok('kept at 5 h', IV.intervalResume(done, S(2400) + 5 * 3600000) === done);
  eq('dropped after 6 h', IV.intervalResume(done, S(2400) + 7 * 3600000), null);
  eq('null stays null', IV.intervalResume(null, S(1)), null);
}

console.log('toSession — the record written when a run ends:');
{
  const done = IV.intervalStep({ ...run44(), from: { planId: 'p1', planName: 'Push' } }, { type: 'tick' }, S(2400));
  const s = IV.toSession(done);
  eq('id', s.id, 'r1');
  eq('t = start', s.t, S(0));
  eq('endedAt', s.endedAt, S(2400));
  eq('after', s.after, 'Push');
  eq('pace starts empty', s.pace, null);
  eq('rounds', s.roundsDone, 4);
  eq('standalone has no after', IV.toSession(IV.intervalStep(run44(), { type: 'tick' }, S(2400))).after, null);
}

/* ---------- cues ---------- */
console.log('cueAt — heads-up at 7 s on blocks over 10 s, ticks at 3-2-1 on blocks of 5 s+:');
{
  eq('4:00 block at 7 s', IV.cueAt(240, 7), 'heads');
  eq('4:00 block at 8 s', IV.cueAt(240, 8), null);
  eq('4:00 block at 3 s', IV.cueAt(240, 3), 'tick');
  eq('4:00 block at 1 s', IV.cueAt(240, 1), 'tick');
  eq('4:00 block at 0 s', IV.cueAt(240, 0), null);
  eq('Tabata 10 s rest: no heads-up', IV.cueAt(10, 7), null);
  eq('Tabata 10 s rest: ticks', IV.cueAt(10, 2), 'tick');
  eq('11 s block gets the heads-up', IV.cueAt(11, 7), 'heads');
  eq('4 s block: no ticks', IV.cueAt(4, 2), null);
}

console.log('voiceLine — what the phone says at each switch:');
{
  const r = run44();
  const b = IV.buildBlocks(r.cfg);
  eq('warm', IV.voiceLine(b[0], r, ''), 'Warm up. Easy pace.');
  eq('hard with target', IV.voiceLine(b[3], r, '12.5'), 'Round 2 of 4. Go hard. 12.5.');
  eq('hard without target', IV.voiceLine(b[1], r, ''), 'Round 1 of 4. Go hard.');
  eq('easy', IV.voiceLine(b[2], r, ''), 'Easy. Recover.');
  eq('cool', IV.voiceLine(b[8], r, ''), 'Cool down. Easy pace.');
  eq('done', IV.voiceLine(null, r, ''), 'Session done.');
}

/* ---------- speed ---------- */
console.log('pace — cleaning, stepping, formatting:');
{
  eq('comma decimal accepted', IV.cleanPace('treadmill', '12,5'), 12.5);
  eq('one decimal kept, not snapped to the step', IV.cleanPace('treadmill', '12.3'), 12.3);
  eq('empty -> null', IV.cleanPace('treadmill', ''), null);
  eq('junk -> null', IV.cleanPace('treadmill', 'fast'), null);
  eq('zero -> null', IV.cleanPace('treadmill', 0), null);
  eq('treadmill cap 25', IV.cleanPace('treadmill', 40), 25);
  eq('bike rounds to whole levels', IV.cleanPace('bike', 13.6), 14);
  eq('treadmill +0.5', IV.stepPace('treadmill', 12.3, 1), 12.8);
  eq('bike +1', IV.stepPace('bike', 14, 1), 15);
  eq('empty box steps from 10', IV.stepPace('treadmill', '', 1), 10.5);
  eq('format treadmill', IV.fmtPace('treadmill', 12), '12.0 km/h');
  eq('format bike', IV.fmtPace('bike', 14), 'L14');
  eq('format null', IV.fmtPace('bike', null), '');
  eq('short treadmill', IV.fmtPaceShort('treadmill', 12.5), '12.5');
  eq('input bike', IV.fmtPaceInput('bike', 14), '14');
  eq('spoken treadmill', IV.spokenPace('treadmill', 12.5), '12.5');
  eq('spoken bike', IV.spokenPace('bike', 14), 'Level 14');
  eq('spoken null', IV.spokenPace('bike', null), '');
}

console.log('paceTarget — one step up only after a full session:');
{
  const cfg = IV.presetById('4x4').cfg;
  const mk = (id, t, pace, roundsDone, machine = 'treadmill', preset = '4x4') => ({ id, t, preset, machine, cfg, roundsDone, pace });
  eq('no history -> no target', IV.paceTarget([], '4x4', 'treadmill'), null);
  eq('full session -> +0.5', IV.paceTarget([mk('a', 1, 12, 4)], '4x4', 'treadmill'), 12.5);
  eq('short session -> same speed', IV.paceTarget([mk('a', 1, 12, 3)], '4x4', 'treadmill'), 12);
  eq('latest wins', IV.paceTarget([mk('a', 1, 11, 4), mk('b', 2, 12, 3)], '4x4', 'treadmill'), 12);
  eq('a session without a speed is skipped', IV.paceTarget([mk('a', 1, 12, 4), mk('b', 2, null, 4)], '4x4', 'treadmill'), 12.5);
  eq('other machine ignored', IV.paceTarget([mk('a', 1, 12, 4, 'bike')], '4x4', 'treadmill'), null);
  eq('other preset ignored', IV.paceTarget([mk('a', 1, 12, 4, 'treadmill', 'sprints')], '4x4', 'treadmill'), null);
  eq('bike +1 level', IV.paceTarget([mk('a', 1, 14, 4, 'bike')], '4x4', 'bike'), 15);
  eq('best pace', IV.bestPace([mk('a', 1, 12, 4), mk('b', 2, 12.5, 2)], '4x4', 'treadmill'), 12.5);
  eq('no best without speeds', IV.bestPace([mk('a', 1, null, 4)], '4x4', 'treadmill'), null);
}

console.log('weekCount — sessions with a round since Monday:');
{
  const wed = new Date(2026, 8, 23, 18, 0).getTime(); // Wed 23 Sep 2026
  const mon = new Date(2026, 8, 21, 7, 0).getTime();
  const sun = new Date(2026, 8, 20, 20, 0).getTime();
  const s = [{ t: mon, roundsDone: 4 }, { t: sun, roundsDone: 4 }, { t: wed - 3600000, roundsDone: 0 }];
  eq('only the Monday session counts', IV.weekCount(s, wed), 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tools/interval_test.mjs`
Expected: crash with `Cannot find module ... js/intervals.js` (ERR_MODULE_NOT_FOUND).

- [ ] **Step 3: Write the engine**

Create `js/intervals.js`:

```js
/* ============================================================
   intervals.js — the Interval Trainer's pure logic.
   Presets, the block list, the timestamp-driven run state machine,
   counting, cues and the speed target. No DOM and no storage:
   db.js persists, app.js renders. `now` is always passed in, so
   every flow — including "the phone was away for nine minutes" —
   is testable under node.
   ============================================================ */

export const MACHINES = {
  treadmill: { id: 'treadmill', name: 'Treadmill', word: 'speed', ask: 'Speed on the hard rounds', unit: 'km/h',
    step: 0.5, min: 1, max: 25, start: 10, easyHint: 'easy jog or walk' },
  bike: { id: 'bike', name: 'Bike', word: 'level', ask: 'Level on the hard rounds', unit: 'level',
    step: 1, min: 1, max: 40, start: 10, easyHint: 'easy spin' },
};
export const MACHINE_IDS = ['treadmill', 'bike'];

/* 4×4 and 10×1: NTNU CERG (ntnu.edu/cerg/advice) — 10 min warm-up, 3 min active
   breaks, 5 min cool-down, all at 60–70 % HRmax. Sprints: 20–30 s all-out,
   1–2 min easy, 6–8 times. Tabata: 20/10 × 8 (Tabata et al. 1996). */
export const PRESETS = [
  { id: '4x4', chip: '4×4', name: 'Norwegian 4×4', blurb: 'Raises VO₂ max · 1–2× a week', hardHint: 'only a few words out',
    cfg: { warmSec: 600, hardSec: 240, easySec: 180, rounds: 4, coolSec: 300 } },
  { id: 'sprints', chip: 'Sprints', name: 'Sprints', blurb: 'Quick bursts · recover between them', hardHint: 'all-out',
    cfg: { warmSec: 600, hardSec: 30, easySec: 90, rounds: 8, coolSec: 300 } },
  { id: 'tabata', chip: 'Tabata', name: 'Tabata', blurb: '20 s on / 10 s off', hardHint: 'all-out',
    cfg: { warmSec: 300, hardSec: 20, easySec: 10, rounds: 8, coolSec: 300 } },
  { id: '10x1', chip: '10×1', name: '10×1', blurb: '1 min hard / 1 min easy', hardHint: 'hard but steady',
    cfg: { warmSec: 600, hardSec: 60, easySec: 60, rounds: 10, coolSec: 300 } },
  { id: 'custom', chip: 'Custom', name: 'Custom', blurb: 'Your own mix', hardHint: 'hard',
    cfg: { warmSec: 600, hardSec: 240, easySec: 180, rounds: 4, coolSec: 300 } },
];
export function presetById(id) { return PRESETS.find((p) => p.id === id) || PRESETS[0]; }

export const KIND_NAME = { warm: 'Warm-up', hard: 'Hard', easy: 'Easy', cool: 'Cool-down' };
export const KIND_WORD = { warm: 'Warm up', hard: 'Go hard', easy: 'Easy', cool: 'Cool down' };

export const FINISHER_WARM_SEC = 180;           // already warm after a workout
export const WEEK_TARGET = 2;                   // the 4×4 dose: 1–2 sessions a week
export const HEADS_UP_SEC = 7;                  // warning before every switch
export const HEARTBEAT_MS = 5000;               // how often a live run stamps seenAt
export const ABANDON_MS = 30 * 60 * 1000;       // paused / unseen this long = walked away
export const SUMMARY_TTL_MS = 6 * 3600 * 1000;  // an un-dismissed summary survives this long
export const ROUND_DONE_FRACTION = 0.9;         // a skip near the end still counts the round

/* ---------- settings ---------- */
const LIMITS = {
  warmSec: { min: 0, max: 1200 }, hardSec: { min: 5, max: 600 }, easySec: { min: 5, max: 600 },
  rounds: { min: 1, max: 20 }, coolSec: { min: 0, max: 1200 },
};
const FIELDS = Object.keys(LIMITS);

/** Any cfg-shaped value → five safe whole numbers (missing/junk fields take `fallback`). */
export function cleanCfg(cfg, fallback = PRESETS[0].cfg) {
  const out = {};
  for (const k of FIELDS) {
    const raw = cfg ? cfg[k] : undefined;
    const n = raw == null || raw === '' ? NaN : Math.round(Number(raw));
    out[k] = Number.isFinite(n) ? Math.max(LIMITS[k].min, Math.min(LIMITS[k].max, n)) : fallback[k];
  }
  return out;
}
export function sameCfg(a, b) { return FIELDS.every((k) => a[k] === b[k]); }

/** One −/+ tap. Warm-up/cool-down move a minute; hard/easy 5 s under a minute,
 *  15 s from a minute up (going down from exactly 1:00 uses the small step). */
export function stepField(field, value, dir) {
  const L = LIMITS[field];
  if (!L) return value;
  const v = Number(value) || 0;
  let next;
  if (field === 'rounds') next = v + dir;
  else if (field === 'warmSec' || field === 'coolSec') next = v + 60 * dir;
  else next = v + ((dir > 0 ? v < 60 : v <= 60) ? 5 : 15) * dir;
  return Math.max(L.min, Math.min(L.max, next));
}

/** warm-up, then hard/easy per round (no easy after the last), then cool-down.
 *  An easy block carries the round it follows. */
export function buildBlocks(cfg) {
  const c = cleanCfg(cfg);
  const b = [];
  if (c.warmSec > 0) b.push({ kind: 'warm', sec: c.warmSec, round: 0 });
  for (let r = 1; r <= c.rounds; r++) {
    b.push({ kind: 'hard', sec: c.hardSec, round: r });
    if (r < c.rounds) b.push({ kind: 'easy', sec: c.easySec, round: r });
  }
  if (c.coolSec > 0) b.push({ kind: 'cool', sec: c.coolSec, round: 0 });
  return b;
}
export function planTotals(cfg) {
  const b = buildBlocks(cfg);
  return {
    totalSec: b.reduce((a, x) => a + x.sec, 0),
    hardSec: b.filter((x) => x.kind === 'hard').reduce((a, x) => a + x.sec, 0),
  };
}
export function fmtBlock(sec) { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export function fmtMinutes(sec) { return sec % 60 === 0 ? `${sec / 60} min` : fmtBlock(sec); }

/* ---------- the run ----------
   The current block stores the ABSOLUTE time it started (shifted forward by any
   pause), never a counted tick, so a locked screen or a reload cannot drift.
   spent[i] = seconds actually run in block i, written when the block ends. */
export function newIntervalRun({ id, preset, machine, cfg, from = null, target = null }, now = Date.now()) {
  const c = cleanCfg(cfg);
  return {
    id, preset, machine, cfg: c, from, target,
    phase: 'run', startedAt: now, endedAt: 0,
    idx: 0, blockStartAt: now, pausedAt: 0,
    spent: buildBlocks(c).map(() => 0),
    seenAt: now, lastEvent: null, saved: false, recorded: false,
  };
}
export function currentBlock(run) { return run ? buildBlocks(run.cfg)[run.idx] || null : null; }
export function nextBlock(run) { return run ? buildBlocks(run.cfg)[run.idx + 1] || null : null; }
function inBlockMs(run, now) { return Math.max(0, (run.pausedAt || now) - run.blockStartAt); }
export function blockLeftSec(run, now = Date.now()) {
  const b = run && run.phase === 'run' ? currentBlock(run) : null;
  return b ? Math.max(0, Math.ceil((b.sec * 1000 - inBlockMs(run, now)) / 1000)) : 0;
}
export function sessionLeftSec(run, now = Date.now()) {
  if (!run || run.phase !== 'run') return 0;
  const blocks = buildBlocks(run.cfg);
  let s = blockLeftSec(run, now);
  for (let i = run.idx + 1; i < blocks.length; i++) s += blocks[i].sec;
  return s;
}

export function intervalStep(run, action, now = Date.now()) {
  if (!run || !action || run.phase !== 'run') return run;
  const blocks = buildBlocks(run.cfg);
  const r = { ...run, spent: [...run.spent], lastEvent: null };
  const finish = (at) => { r.phase = 'done'; r.endedAt = at; r.pausedAt = 0; r.lastEvent = 'done'; return r; };
  const ranSec = () => Math.min(blocks[r.idx].sec, Math.floor(inBlockMs(run, now) / 1000));

  switch (action.type) {
    case 'tick': { // the block ran out (on screen, or any number of times while away)
      if (r.pausedAt) return run;
      let moved = false;
      while (r.idx < blocks.length && now - r.blockStartAt >= blocks[r.idx].sec * 1000) {
        r.spent[r.idx] = blocks[r.idx].sec;
        r.blockStartAt += blocks[r.idx].sec * 1000;
        r.idx++;
        moved = true;
      }
      if (!moved) return run;
      if (r.idx >= blocks.length) return finish(r.blockStartAt);
      r.lastEvent = 'switch';
      return r;
    }
    case 'pause':
      if (r.pausedAt) return run;
      r.pausedAt = now; r.lastEvent = 'paused';
      return r;
    case 'resume':
      if (!r.pausedAt) return run;
      r.blockStartAt += now - r.pausedAt; r.pausedAt = 0; r.lastEvent = 'resumed';
      return r;
    case 'skip':
      r.spent[r.idx] = ranSec();
      r.idx++;
      if (r.idx >= blocks.length) return finish(r.pausedAt || now);
      r.blockStartAt = now;
      if (r.pausedAt) r.pausedAt = now;
      r.lastEvent = 'switch';
      return r;
    case 'back':
      if (inBlockMs(run, now) > 3000 || r.idx === 0) { r.lastEvent = 'restart'; }
      else { r.idx--; r.spent[r.idx] = 0; r.lastEvent = 'switch'; }
      r.blockStartAt = now;
      if (r.pausedAt) r.pausedAt = now;
      return r;
    case 'end':
      r.spent[r.idx] = ranSec();
      return finish(r.pausedAt || now);
    case 'heartbeat':
      r.seenAt = now;
      return r;
    default:
      return run;
  }
}

/** Re-enter a persisted run. Same object back when nothing changed. */
export function intervalResume(run, now = Date.now()) {
  if (!run) return null;
  if (run.phase === 'done') return now - (run.endedAt || 0) > SUMMARY_TTL_MS ? null : run;
  if (run.pausedAt) {
    if (now - run.pausedAt <= ABANDON_MS) return run;
    return { ...intervalStep(run, { type: 'end' }, run.pausedAt), lastEvent: 'abandoned' };
  }
  const seen = run.seenAt || run.startedAt;
  if (now - seen > ABANDON_MS) {
    const caught = intervalStep(run, { type: 'tick' }, seen);
    const ended = caught.phase === 'done' ? caught : intervalStep(caught, { type: 'end' }, seen);
    return { ...ended, lastEvent: 'abandoned' };
  }
  return intervalStep(run, { type: 'tick' }, now);
}

export function runStats(run) {
  const blocks = buildBlocks(run.cfg);
  let hardSec = 0, totalSec = 0, roundsDone = 0;
  blocks.forEach((b, i) => {
    const s = Math.max(0, Math.min(b.sec, Number(run.spent[i]) || 0));
    totalSec += s;
    if (b.kind === 'hard') {
      hardSec += s;
      if (s >= b.sec * ROUND_DONE_FRACTION) roundsDone++;
    }
  });
  return { hardSec, totalSec, roundsDone, rounds: run.cfg.rounds };
}

/** The stored record for a finished run (the speed is added afterwards). */
export function toSession(run) {
  const st = runStats(run);
  return {
    id: run.id, t: run.startedAt, endedAt: run.endedAt,
    preset: run.preset, machine: run.machine, cfg: { ...run.cfg },
    roundsDone: st.roundsDone, hardSec: st.hardSec, totalSec: st.totalSec,
    pace: null, after: run.from ? run.from.planName || null : null,
  };
}

/* ---------- cues ---------- */
export function cueAt(blockSec, leftSec) {
  if (leftSec === HEADS_UP_SEC && blockSec > 10) return 'heads';
  if (leftSec >= 1 && leftSec <= 3 && blockSec >= 5) return 'tick';
  return null;
}
export function voiceLine(block, run, spokenTarget = '') {
  if (!block) return 'Session done.';
  if (block.kind === 'warm') return 'Warm up. Easy pace.';
  if (block.kind === 'cool') return 'Cool down. Easy pace.';
  if (block.kind === 'easy') return 'Easy. Recover.';
  return `Round ${block.round} of ${run.cfg.rounds}. Go hard.${spokenTarget ? ` ${spokenTarget}.` : ''}`;
}

/* ---------- speed (treadmill km/h, bike level) ---------- */
export function cleanPace(machine, v) {
  const m = MACHINES[machine] || MACHINES.treadmill;
  if (v == null || v === '') return null;
  const n = Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const r = m.step < 1 ? Math.round(n * 10) / 10 : Math.round(n);
  return Math.max(m.min, Math.min(m.max, r));
}
export function stepPace(machine, v, dir) {
  const m = MACHINES[machine] || MACHINES.treadmill;
  const base = cleanPace(machine, v) ?? m.start;
  return cleanPace(machine, base + m.step * dir);
}
export function fmtPace(machine, pace) {
  if (pace == null || !Number.isFinite(Number(pace))) return '';
  return machine === 'bike' ? `L${Math.round(pace)}` : `${Number(pace).toFixed(1)} km/h`;
}
export function fmtPaceShort(machine, pace) {
  if (pace == null) return '';
  return machine === 'bike' ? `L${Math.round(pace)}` : Number(pace).toFixed(1);
}
export function fmtPaceInput(machine, pace) {
  if (pace == null) return '';
  return machine === 'bike' ? String(Math.round(pace)) : Number(pace).toFixed(1);
}
export function spokenPace(machine, pace) {
  if (pace == null) return '';
  return machine === 'bike' ? `Level ${Math.round(pace)}` : Number(pace).toFixed(1);
}

/* ---------- history ---------- */
const withPace = (sessions, preset, machine) =>
  (sessions || []).filter((s) => s && s.preset === preset && s.machine === machine && s.pace != null);
export function lastWithPace(sessions, preset, machine) {
  return withPace(sessions, preset, machine).sort((a, b) => b.t - a.t)[0] || null;
}
/** One step up only when the last session with a speed finished every round. */
export function paceTarget(sessions, preset, machine) {
  const last = lastWithPace(sessions, preset, machine);
  if (!last) return null;
  const full = last.roundsDone >= ((last.cfg && last.cfg.rounds) || Infinity);
  return full ? cleanPace(machine, last.pace + (MACHINES[machine] || MACHINES.treadmill).step) : last.pace;
}
export function bestPace(sessions, preset, machine) {
  const p = withPace(sessions, preset, machine).map((s) => Number(s.pace));
  return p.length ? Math.max(...p) : null;
}
/** Sessions with at least one round since Monday 00:00 local (the heatmap's week). */
export function weekCount(sessions, now = Date.now()) {
  const d = new Date(now);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
  return (sessions || []).filter((s) => s && s.t >= monday && (Number(s.roundsDone) || 0) >= 1).length;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tools/interval_test.mjs`
Expected: last line `N passed, 0 failed`, exit code 0.

- [ ] **Step 5: Add the test to `npm test`**

In `package.json` replace the test script with:

```json
"test": "node tools/rec_test.mjs && node tools/ui_test.mjs && node tools/analytics_test.mjs && node tools/plank_test.mjs && node tools/interval_test.mjs"
```

Run: `npm test` — Expected: every suite ends with 0 failed, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add js/intervals.js tools/interval_test.mjs package.json
git commit -m "feat(intervals): pure interval engine — presets, blocks, timestamp state machine, cues, speed target"
```

---

### Task 2: Store and cloud sync

**Files:**
- Modify: `js/db.js` (header keys ~L14-16, `write()` ~L31, `KNOWN_SYNC_FIELDS` L46, `snapshot()` ~L49-58, `applyRemote()` ~L60-79, `FIELD_STORES` L87; new section after `mergePlankDoc` ~L440)
- Modify: `js/sync.js` (helper next to `countPlankSets` L29; merge after the plank merge ~L90)
- Test: `tools/interval_test.mjs` (append)

**Interfaces:**
- Consumes: `IV.cleanCfg`, `IV.sameCfg`, `IV.presetById`, `IV.PRESETS`, `IV.MACHINE_IDS`, `IV.cleanPace`, `IV.toSession`, `IV.newIntervalRun`, `IV.intervalStep` (Task 1).
- Produces (named exports of `js/db.js`):
  - `getIntervals() → { ...doc, sessions: [], prefs: { preset, machine, muted, cfgs } }`
  - `intervalPrefs() → prefs`, `setIntervalPrefs({ preset?, machine?, muted? }) → prefs`
  - `intervalCfg(presetId) → cfg`, `setIntervalCfg(presetId, cfg) → cfg`
  - `recordIntervalSession(session) → session | null` (null when the id already exists)
  - `setIntervalPace(id, pace|null) → session | null`, `deleteIntervalSession(id)`, `getIntervalSessions() → newest first`
  - `getIntervalActive() → run | null`, `setIntervalActive(run | null)`
  - `mergeIntervalDoc(remote, local) → doc`
  - Cloud field `intervals` in `snapshot()` / `applyRemote()`.

- [ ] **Step 1: Write the failing tests**

In `tools/interval_test.mjs`, insert this block directly **above** the final `console.log(\`\n${pass} passed...` line:

```js
/* ---------- store + sync (js/db.js) ---------- */
const DB = await import('../js/db.js');
function reset() { for (const k of Object.keys(store)) delete store[k]; }
const cfg44 = IV.presetById('4x4').cfg;

console.log('store — defaults on an empty device:');
{
  reset();
  const d = DB.getIntervals();
  eq('no sessions', d.sessions.length, 0);
  eq('4×4 preselected', d.prefs.preset, '4x4');
  eq('treadmill preselected', d.prefs.machine, 'treadmill');
  eq('sound on', d.prefs.muted, false);
}

console.log('prefs — preset, machine and mute are remembered; junk ignored:');
{
  reset();
  DB.setIntervalPrefs({ preset: 'sprints', machine: 'bike', muted: true });
  const p = DB.intervalPrefs();
  eq('preset', p.preset, 'sprints');
  eq('machine', p.machine, 'bike');
  eq('muted', p.muted, true);
  DB.setIntervalPrefs({ preset: 'nope', machine: 'rower' });
  eq('bad preset ignored', DB.intervalPrefs().preset, 'sprints');
  eq('rower is not a machine', DB.intervalPrefs().machine, 'bike');
}

console.log('cfg — each preset remembers its own numbers:');
{
  reset();
  eq('default 4×4 hard', DB.intervalCfg('4x4').hardSec, 240);
  DB.setIntervalCfg('4x4', { ...DB.intervalCfg('4x4'), hardSec: 255 });
  eq('edited 4×4 hard', DB.intervalCfg('4x4').hardSec, 255);
  eq('sprints untouched', DB.intervalCfg('sprints').hardSec, 30);
  DB.setIntervalCfg('4x4', cfg44);
  ok('back to default drops the saved copy', !('4x4' in DB.getIntervals().prefs.cfgs));
}

console.log('record — saved once, speed added later:');
{
  reset();
  const done = IV.intervalStep(run44(), { type: 'tick' }, S(2400));
  ok('recorded', !!DB.recordIntervalSession(IV.toSession(done)));
  eq('a second record of the same run is refused', DB.recordIntervalSession(IV.toSession(done)), null);
  eq('one session', DB.getIntervalSessions().length, 1);
  DB.setIntervalPace('r1', '12,5');
  eq('speed stored', DB.getIntervalSessions()[0].pace, 12.5);
  DB.setIntervalPace('r1', null);
  eq('speed cleared', DB.getIntervalSessions()[0].pace, null);
  eq('unknown id', DB.setIntervalPace('nope', 12), null);
  DB.deleteIntervalSession('r1');
  eq('deleted', DB.getIntervalSessions().length, 0);
}

console.log('record — newest first:');
{
  reset();
  DB.recordIntervalSession({ id: 'old', t: 1, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 4, pace: null });
  DB.recordIntervalSession({ id: 'new', t: 9, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 4, pace: null });
  eq('newest first', DB.getIntervalSessions().map((s) => s.id).join(','), 'new,old');
}

console.log('sync — intervals ride the snapshot and applyRemote:');
{
  reset();
  DB.recordIntervalSession({ id: 'a', t: 5, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 4, hardSec: 960, totalSec: 2400, pace: null, after: null });
  ok('snapshot carries intervals', DB.snapshot().intervals.sessions.length === 1);
  ok('a local interval write marks data dirty', DB.getUpdatedAt() > 0);
  DB.applyRemote({ plans: [], sessions: [], intervals: { sessions: [{ id: 'b', t: 9 }], prefs: {} } }, 123);
  eq('remote doc applied', DB.getIntervalSessions()[0].id, 'b');
  ok('intervals are not parked as an unknown field', !('intervals' in JSON.parse(store.wt_remote_extra_v1 || '{}')));
  DB.applyRemote({ plans: [], sessions: [], intervals: null }, 124);
  eq('explicit null removes it', DB.getIntervalSessions().length, 0);
  DB.recordIntervalSession({ id: 'c', t: 1, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 1, pace: null });
  DB.applyRemote({ plans: [], sessions: [] }, 125);
  eq('a doc without the key leaves local data', DB.getIntervalSessions().length, 1);
}

console.log('mergeIntervalDoc — offline sessions survive a pull:');
{
  const remote = { prefs: { preset: 'tabata' }, sessions: [{ id: 'x', t: 1, pace: null }, { id: 'y', t: 3, pace: 11 }] };
  const local = { prefs: { preset: '4x4' }, sessions: [{ id: 'x', t: 1, pace: 12 }, { id: 'z', t: 2, pace: null }] };
  const m = DB.mergeIntervalDoc(remote, local);
  eq('union by id, sorted by time', m.sessions.map((s) => s.id).join(','), 'x,z,y');
  eq('local speed fills a remote gap', m.sessions[0].pace, 12);
  eq('remote prefs win', m.prefs.preset, 'tabata');
  ok('remote untouched when local is empty', DB.mergeIntervalDoc(remote, { sessions: [] }) === remote);
  ok('local kept when remote has none', DB.mergeIntervalDoc(null, local) === local);
  eq('remote speed never overwritten',
    DB.mergeIntervalDoc({ sessions: [{ id: 'y', t: 3, pace: 11 }] }, { sessions: [{ id: 'y', t: 3, pace: 9 }] }).sessions[0].pace, 11);
  eq('input not mutated', remote.sessions[0].pace, null);
}

console.log('active run — device-local, never synced:');
{
  reset();
  DB.setIntervalActive(run44());
  eq('stored', DB.getIntervalActive().id, 'r1');
  ok('not in the cloud snapshot', !JSON.stringify(DB.snapshot()).includes('"r1"'));
  eq('writing the run does not mark data dirty', DB.getUpdatedAt(), 0);
  DB.setIntervalActive(null);
  eq('cleared', DB.getIntervalActive(), null);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/interval_test.mjs`
Expected: crash `TypeError: DB.getIntervals is not a function`.

- [ ] **Step 3: Implement the store in `js/db.js`**

3a. Add the import as the first statement after the header comment block (before `const KEY_PLANS`):

```js
import * as IV from './intervals.js';
```

3b. Below `const KEY_PLANK_ACTIVE = ...` add:

```js
const KEY_INTERVALS = 'wt_intervals_v1'; // interval trainer {sessions:[...], prefs:{preset,machine,muted,cfgs}}
const KEY_INTERVAL_ACTIVE = 'wt_interval_active_v1'; // in-progress interval run, survives refresh (device-local, never synced)
```

3c. In `write()`, extend the dirty condition:

```js
  if (key === KEY_PLANS || key === KEY_SESSIONS || key === KEY_GOAL || key === KEY_WEIGHTS || key === KEY_PLANKS || key === KEY_INTERVALS) {
```

3d. Replace `KNOWN_SYNC_FIELDS`:

```js
const KNOWN_SYNC_FIELDS = ['plans', 'sessions', 'goal', 'weights', 'planks', 'intervals'];
```

3e. In `snapshot()` add after `planks: read(KEY_PLANKS, null),`:

```js
    intervals: read(KEY_INTERVALS, null),
```

3f. In `applyRemote()` add after the `planks` block:

```js
  if (data && 'intervals' in data) {
    if (data.intervals) localStorage.setItem(KEY_INTERVALS, JSON.stringify(data.intervals));
    else localStorage.removeItem(KEY_INTERVALS);
  }
```

3g. Replace `FIELD_STORES`:

```js
const FIELD_STORES = { plans: KEY_PLANS, sessions: KEY_SESSIONS, goal: KEY_GOAL, weights: KEY_WEIGHTS, planks: KEY_PLANKS, intervals: KEY_INTERVALS };
```

3h. After the end of `mergePlankDoc` (before `/** Headline numbers for the trainer screen. */`), add:

```js
/* ---------- interval trainer ----------
   Timed intervals (4×4, sprints, …) live in their own store, like planks — never
   in `plans` or `sessions`, so up-next, main History and the strength records
   cannot see them. The run state machine is pure (js/intervals.js); this is
   only storage + sync. */
export function getIntervals() {
  const raw = read(KEY_INTERVALS, null);
  const d = raw && typeof raw === 'object' ? raw : {};
  const pr = d.prefs && typeof d.prefs === 'object' ? d.prefs : {};
  return {
    ...d, // a newer version's extra sub-fields ride along untouched
    sessions: Array.isArray(d.sessions) ? d.sessions : [],
    prefs: {
      ...pr,
      preset: IV.PRESETS.some((p) => p.id === pr.preset) ? pr.preset : IV.PRESETS[0].id,
      machine: IV.MACHINE_IDS.includes(pr.machine) ? pr.machine : IV.MACHINE_IDS[0],
      muted: !!pr.muted,
      cfgs: pr.cfgs && typeof pr.cfgs === 'object' ? pr.cfgs : {},
    },
  };
}
function saveIntervals(d) {
  d.sessions.sort((a, b) => a.t - b.t);
  write(KEY_INTERVALS, d);
}

export function intervalPrefs() { return getIntervals().prefs; }
export function setIntervalPrefs({ preset, machine, muted } = {}) {
  const d = getIntervals();
  if (IV.PRESETS.some((p) => p.id === preset)) d.prefs.preset = preset;
  if (IV.MACHINE_IDS.includes(machine)) d.prefs.machine = machine;
  if (muted !== undefined) d.prefs.muted = !!muted;
  saveIntervals(d);
  return d.prefs;
}
/** The timing a preset opens with: the saved edit, else its defaults. */
export function intervalCfg(presetId) {
  const p = IV.presetById(presetId);
  return IV.cleanCfg(getIntervals().prefs.cfgs[p.id] || p.cfg, p.cfg);
}
/** Save a preset's timing; a copy equal to the defaults is dropped. */
export function setIntervalCfg(presetId, cfg) {
  const p = IV.presetById(presetId);
  const d = getIntervals();
  const clean = IV.cleanCfg(cfg, p.cfg);
  if (IV.sameCfg(clean, p.cfg)) delete d.prefs.cfgs[p.id];
  else d.prefs.cfgs[p.id] = clean;
  saveIntervals(d);
  return clean;
}

/** Save a finished run once — the moment it ends. A second call for the same
 *  run id is refused, so a re-render or a double tap can never double-log. */
export function recordIntervalSession(session) {
  if (!session || !session.id) return null;
  const d = getIntervals();
  if (d.sessions.some((s) => s && s.id === session.id)) return null;
  d.sessions.push(session);
  saveIntervals(d);
  return session;
}
export function setIntervalPace(id, pace) {
  const d = getIntervals();
  const s = d.sessions.find((x) => x && x.id === id);
  if (!s) return null;
  s.pace = pace == null ? null : IV.cleanPace(s.machine, pace);
  saveIntervals(d);
  return s;
}
export function deleteIntervalSession(id) {
  const d = getIntervals();
  d.sessions = d.sessions.filter((s) => s && s.id !== id);
  saveIntervals(d);
}
/** Interval sessions, newest first. */
export function getIntervalSessions() {
  return [...getIntervals().sessions].sort((a, b) => b.t - a.t);
}

/* device-local in-progress interval run (never synced) */
export function getIntervalActive() { return read(KEY_INTERVAL_ACTIVE, null); }
export function setIntervalActive(run) {
  if (run) localStorage.setItem(KEY_INTERVAL_ACTIVE, JSON.stringify(run));
  else localStorage.removeItem(KEY_INTERVAL_ACTIVE);
}

/**
 * Union a remote interval doc with the local one (pull path in sync.js), same
 * rule as planks: local work that never reached the cloud survives. Sessions
 * merge by id; for a shared id the remote copy wins, but a speed entered here
 * fills a remote gap. Remote prefs win. Only called when local has unpushed
 * changes, so an untouched local copy still lets a remote deletion stick.
 */
export function mergeIntervalDoc(remote, local) {
  const l = local && typeof local === 'object' && Array.isArray(local.sessions) ? local : null;
  if (!l || !l.sessions.length) return remote || null;
  if (!remote || typeof remote !== 'object' || !Array.isArray(remote.sessions)) return l;
  const out = { ...remote, sessions: remote.sessions.map((s) => ({ ...s })) };
  const byId = new Map(out.sessions.map((s) => [s.id, s]));
  for (const ls of l.sessions) {
    if (!ls || !ls.id) continue;
    const rs = byId.get(ls.id);
    if (!rs) { out.sessions.push({ ...ls }); continue; }
    if (rs.pace == null && ls.pace != null) rs.pace = ls.pace;
  }
  out.sessions.sort((a, b) => a.t - b.t);
  return out;
}
```

- [ ] **Step 4: Wire the pull merge in `js/sync.js`**

Below `countPlankSets` add:

```js
function countIntervalFacts(doc) { // sessions + speeds: either one arriving means the cloud lacked it
  if (!doc || !Array.isArray(doc.sessions)) return 0;
  return doc.sessions.reduce((n, s) => n + 1 + (s && s.pace != null ? 1 : 0), 0);
}
```

Directly after the plank merge block (the `if (mineP && ...) { ... }` that ends with `mergedIn += Math.max(0, countPlankSets(data.planks) - before);` and its closing `}`), add:

```js
        // interval sessions recorded offline, and speeds typed in afterwards
        const mineI = local.intervals;
        if (mineI && Array.isArray(mineI.sessions) && mineI.sessions.length) {
          const before = countIntervalFacts(data.intervals);
          data.intervals = DB.mergeIntervalDoc(data.intervals, mineI);
          mergedIn += Math.max(0, countIntervalFacts(data.intervals) - before);
        }
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all five suites end with 0 failed. (`plank_test.mjs` and the others still import `db.js`; the new `import` must not break them.)

- [ ] **Step 6: Commit**

```bash
git add js/db.js js/sync.js tools/interval_test.mjs
git commit -m "feat(intervals): own store + cloud field 'intervals' with offline merge"
```

---

### Task 3: Home "Trainers" block, heatmap credit, icons and styles

**Files:**
- Modify: `js/ui.js` (icons, ~L89-107)
- Modify: `css/styles.css` (append a new section before the final `@media (prefers-reduced-motion: reduce)` block at ~L551)
- Modify: `js/app.js` (import L7-13; `screenHome` splice ~L188 and empty branch ~L160; `plankHomeCard` ~L1707-1726; `consistencyBlock` ~L2093; home call L268; Insights call ~L2211)
- Test: `tools/smoke_test.cjs` (new `[7i]` section inserted right before `console.log('\n[8] No console errors');`)

**Interfaces:**
- Consumes: `IV.*` (Task 1), `DB.getIntervalSessions`, `DB.getIntervalActive` (Task 2).
- Produces: `icons.pulse|sound|muted|pause|next|prev` in `ui.js`; `intervalHomeCard()`, `trainersBlock()` in `app.js`; `consistencyBlock(sessions, ivSessions = [])`; all `.iv-*` CSS used by Tasks 4-6.

- [ ] **Step 1: Write the failing smoke checks**

In `tools/smoke_test.cjs`, insert before `console.log('\n[8] No console errors');`:

```js
  console.log('\n[7i] Interval Trainer — home, setup, run, summary, finisher');
  await page.evaluate(() => { localStorage.removeItem('wt_intervals_v1'); localStorage.removeItem('wt_interval_active_v1'); });
  await page.goto(BASE + '/#/');
  await page.waitForSelector('#iv-card');
  const trainerOrder = await page.evaluate(() => Array.from(
    document.querySelectorAll('.plan-card, #iv-card, #plank-card, .section-label'))
    .map((n) => n.id || (n.classList.contains('section-label') ? 'LABEL:' + n.textContent.trim()
      : ((n.querySelector('.name') || {}).textContent || ''))));
  const iCar = trainerOrder.findIndex((x) => x.includes('Cardio'));
  check(trainerOrder[iCar + 1] === 'LABEL:Trainers' && trainerOrder[iCar + 2] === 'iv-card' && trainerOrder[iCar + 3] === 'plank-card',
    `Trainers label, then Interval, then Plank, under Cardio (${trainerOrder.join(' | ')})`);
  check(((await page.locator('#iv-card .plank-home-best').textContent()) || '').replace(/\s+/g, '').startsWith('0/2'),
    'the week count starts at 0/2');
  // today's heatmap cell, read from its "N sets" title — compared after the run
  const todaySets = () => page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.cal .cal-cell:not(.cal-future)'));
    const m = /(\d+) sets/.exec((cells[cells.length - 1] || {}).title || '');
    return m ? Number(m[1]) : -1;
  });
  const heatBefore = await todaySets();
```

- [ ] **Step 2: Run to verify it fails**

Start the server if it is not running: `python -m http.server 8099 --bind 127.0.0.1` (from the repo root, in the background).
Run: `node tools/smoke_test.cjs`
Expected: `TEST CRASH` — timeout waiting for `#iv-card`.

- [ ] **Step 3: Icons in `js/ui.js`**

Add inside `export const icons = { ... }` after `trophy`:

```js
  pulse: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  sound: svg('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'),
  muted: svg('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/>'),
  pause: svg('<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>'),
  next: svg('<path d="M5 4.5l10 7.5-10 7.5z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>'),
  prev: svg('<path d="M19 19.5L9 12l10-7.5z" fill="currentColor" stroke="none"/><path d="M5 5v14"/>'),
```

- [ ] **Step 4: Styles in `css/styles.css`**

Insert this section immediately **before** the final `@media (prefers-reduced-motion: reduce) {` block:

```css
/* ---------- Interval trainer ---------- */
:root {
  --iv-hard: var(--accent); /* effort = the app's green, same as a plank hold */
  --iv-easy: #6aa9ff;       /* recovery = the plank rest blue */
  --iv-warm: #8b93a7;       /* warm-up / cool-down = calm slate */
}

/* home card: the plank card's anatomy; a running session gets the up-next glow */
.iv-of { font-size: 14px; color: var(--muted); font-weight: 650; }
.plank-home.iv-live { border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent) inset, 0 4px 18px rgba(52, 211, 153, 0.18); }

/* live-workout finisher entry — dashed: optional, not part of the plan */
.iv-finisher { display: flex; align-items: center; gap: 14px; border-style: dashed; }
.iv-finisher .meta { flex: 1; min-width: 0; }
.iv-finisher .name { font-size: 16px; font-weight: 620; margin: 0 0 3px; }
.iv-finisher .desc { font-size: 13px; color: var(--muted); margin: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* the whole session as one strip, each block to scale */
.iv-strip { display: flex; gap: 3px; width: 100%; height: 10px; }
.iv-strip i { display: block; min-width: 3px; border-radius: 3px; background: var(--iv-warm); position: relative; overflow: hidden; }
.iv-strip i.hard { background: var(--iv-hard); }
.iv-strip i.easy { background: var(--iv-easy); }
.iv-strip.live i.past { opacity: 0.28; }
.iv-strip.live i.future { opacity: 0.55; }
.iv-strip.live i.now { opacity: 1; outline: 2px solid rgba(244, 246, 248, 0.9); outline-offset: 1px; }
.iv-strip.live i.now::after { /* time already run inside the current block */
  content: ''; position: absolute; inset: 0 auto 0 0; width: var(--done, 0%);
  background: rgba(15, 17, 21, 0.55);
}

/* setup */
.iv-chips5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.iv-chips5 .chip-tab { min-width: 0; min-height: 46px; font-size: 13px; padding: 0 2px; letter-spacing: -0.01em; }
.iv-chips2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.iv-chips2 .chip-tab { min-height: 48px; font-size: 15px; }
.iv-finisher-note { margin: 12px 2px 0; font-size: 13px; color: var(--accent); font-weight: 600; }
.iv-hero { margin-top: 14px; padding: 18px 16px 16px;
  background: radial-gradient(120% 100% at 50% 0%, rgba(52, 211, 153, 0.10), transparent 70%), var(--surface); }
.iv-hero-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.iv-hero-name { font-size: 22px; font-weight: 750; letter-spacing: -0.01em; }
.iv-hero-total { font-size: 22px; font-weight: 750; font-variant-numeric: tabular-nums; white-space: nowrap; }
.iv-hero-total span { font-size: 13px; color: var(--muted); font-weight: 600; }
.iv-hero-sub { font-size: 13px; color: var(--muted); margin: 2px 0 14px; display: flex; justify-content: space-between; gap: 10px; }
.iv-hero .iv-strip { height: 12px; }
.iv-rows { padding: 4px 16px; }
.iv-row { display: flex; align-items: center; gap: 10px; padding: 11px 0; border-bottom: 1px solid var(--border); }
.iv-row:last-child { border-bottom: none; }
.iv-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--iv-warm); flex: none; }
.iv-dot.hard { background: var(--iv-hard); }
.iv-dot.easy { background: var(--iv-easy); }
.iv-dot.none { background: transparent; border: 1px solid var(--border); }
.iv-row-l { flex: 1; font-size: 15px; font-weight: 600; }
.iv-row-l small { display: block; font-size: 12px; color: var(--muted); font-weight: 500; }
.iv-row .rest-ctl-val { min-width: 58px; font-size: 17px; }
.iv-row .rest-step { width: 40px; height: 40px; }
.iv-reset { width: 100%; margin-top: -4px; }
.iv-prog { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
.iv-prog .l { flex: 1; font-size: 13px; color: var(--muted); }
.iv-prog .l b { color: var(--text); font-size: 15px; }
.iv-prog .t { text-align: right; line-height: 1.15; }
.iv-prog .t b { display: block; color: var(--accent); font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
.iv-prog .t span { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; }
.iv-tag { font-size: 11px; font-weight: 700; color: var(--muted); background: var(--surface-2);
  padding: 2px 8px; border-radius: 999px; margin-left: 6px; vertical-align: 1px; }

/* run: the stage takes the phase colour */
.iv-stage { position: relative; isolation: isolate; display: flex; flex-direction: column; align-items: center; gap: 16px; padding-top: 4px; }
.iv-stage::before { /* soft phase-coloured glow behind the ring: readable from the treadmill */
  content: ''; position: absolute; left: -18px; right: -18px; top: 20px; height: 420px; z-index: -1;
  background: radial-gradient(60% 50% at 50% 45%, var(--glow), transparent 75%);
}
.iv-stage.hard { --ph: var(--iv-hard); --glow: rgba(52, 211, 153, 0.16); }
.iv-stage.easy { --ph: var(--iv-easy); --glow: rgba(106, 169, 255, 0.16); }
.iv-stage.warm { --ph: var(--iv-warm); --glow: rgba(139, 147, 167, 0.12); }
.iv-stage > .btn { width: 100%; }
.iv-stage .plank-ring-wrap { width: min(84vw, 318px); }
.iv-stage .plank-ring-fill { stroke: var(--ph); stroke-width: 13; }
.iv-stage.paused .plank-ring-wrap, .iv-stage.paused .iv-strip { opacity: 0.45; }
.iv-stage.paused .iv-time { animation: iv-blink 1.4s ease-in-out infinite; }
@keyframes iv-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.iv-phase { font-size: 15px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ph); }
.iv-time { font-size: 76px; font-weight: 780; font-variant-numeric: tabular-nums; letter-spacing: -0.03em; line-height: 1; }
.iv-round { font-size: 14px; color: var(--muted); font-weight: 600; }
.iv-pace { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--muted);
  border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: 7px 14px; }
.iv-pace b { color: var(--accent); font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; }
.iv-pace.off { visibility: hidden; }
.iv-next { width: 100%; display: flex; align-items: center; gap: 12px; margin: 0; padding: 13px 16px; border-left: 4px solid var(--nx); }
.iv-next.easy { --nx: var(--iv-easy); }
.iv-next.hard { --nx: var(--iv-hard); }
.iv-next.warm { --nx: var(--iv-warm); }
.iv-next .k { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; }
.iv-next .v { font-size: 17px; font-weight: 700; }
.iv-next .v span { color: var(--nx); }
.iv-next .r { margin-left: auto; text-align: right; font-size: 13px; color: var(--muted); }
/* last 7 s of a block: the next block announces itself */
.iv-next.soon { border: 1px solid var(--nx); border-left-width: 4px;
  background: color-mix(in srgb, var(--nx) 14%, var(--surface)); animation: iv-soon 1s ease-in-out infinite; }
.iv-next.soon .k { color: var(--nx); }
.iv-next.soon .r b { color: var(--text); font-size: 15px; }
@keyframes iv-soon { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 50% { box-shadow: 0 0 22px -2px var(--nx); } }
.iv-stage.soon .iv-time { animation: iv-tick 1s ease-in-out infinite; }
@keyframes iv-tick { 0%, 100% { transform: none; } 12% { transform: scale(1.06); } }
.iv-ctrl { display: flex; gap: 10px; width: 100%; }
.iv-ctrl .btn { height: 64px; }
.iv-ctrl .iv-side { width: 64px; padding: 0; flex: none; }
.iv-ctrl .iv-side svg { width: 22px; height: 22px; }
.iv-ctrl .btn-primary { flex: 1; font-size: 18px; font-weight: 750; }
.iv-ctrl .btn-primary svg { width: 22px; height: 22px; }

/* summary: speed entry */
.plank-pb-banner.iv-partial { border-color: var(--border); color: var(--text); background: var(--surface); }
.iv-pace-q { margin: 0 0 4px; font-weight: 620; text-align: center; }
.iv-pace-in { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 6px 0 4px; }
.iv-pace-in .rest-step { width: 52px; height: 52px; font-size: 24px; border-radius: 12px; }
.iv-pace-in .input { width: 130px; font-size: 32px; font-weight: 750; text-align: center; padding: 8px 6px;
  border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: rgba(52, 211, 153, 0.06); }
.iv-pace-in .u { font-size: 15px; color: var(--muted); font-weight: 600; }
.iv-pace-hint { text-align: center; font-size: 13px; color: var(--muted); margin: 0; }
.iv-pace-hint b { color: var(--accent); }
```

Then extend the existing reduced-motion block at the end of the file so it reads:

```css
@media (prefers-reduced-motion: reduce) {
  .plank-ring-wrap.past-best { animation: none; }
  .plank-pb.beat, .plank-pb-banner { animation: none; }
  .plank-ring-fill { transition: none; }
  .iv-next.soon, .iv-stage.soon .iv-time, .iv-stage.paused .iv-time { animation: none; }
}
```

- [ ] **Step 5: Home block and heatmap in `js/app.js`**

5a. Imports — add below `import * as DB from './db.js';`:

```js
import * as IV from './intervals.js';
```

5b. In `plankHomeCard()`, delete the line `    <div class="section-label">Plank</div>` (the label moves into `trainersBlock`). Update the comment above the function to: `/** The home-screen Plank Trainer card (inside the "Trainers" block). */`

5c. Directly above `plankHomeCard()` add:

```js
/** Home: "Trainers" — the interval card, then the plank card, under the cardio block. */
function trainersBlock() {
  return `<div class="section-label">Trainers</div>${intervalHomeCard()}${plankHomeCard()}`;
}

/** Home entry for the Interval Trainer: last session + sessions this week vs the 4×4 dose. */
function intervalHomeCard() {
  const sessions = DB.getIntervalSessions();
  const run = DB.getIntervalActive();
  const live = !!(run && run.phase === 'run');
  let sub = 'Timed intervals for bursts and pace';
  if (live) {
    const b = IV.currentBlock(run);
    sub = `Running · ${b ? IV.KIND_NAME[b.kind] : 'Intervals'} · tap to return`;
  } else if (sessions.length) {
    const s = sessions[0];
    sub = [IV.presetById(s.preset).chip, s.pace != null ? IV.fmtPace(s.machine, s.pace) : null, fmtAgo(s.t)]
      .filter(Boolean).join(' · ');
  }
  return `
    <div class="card plank-home tappable${live ? ' iv-live' : ''}" id="iv-card" data-nav="#/intervals">
      <div class="plank-home-icon">${icons.pulse}</div>
      <div class="meta">
        <p class="name">Interval Trainer</p>
        <p class="desc">${esc(sub)}</p>
      </div>
      <div class="plank-home-best">
        <b>${IV.weekCount(sessions, Date.now())}<span class="iv-of">/${IV.WEEK_TARGET}</span></b>
        <span>this week</span>
      </div>
    </div>`;
}
```

5d. In `screenHome()`: in the empty-plans branch replace `${plankHomeCard()}` with `${trainersBlock()}`. Replace the splice line and its comment:

```js
    // The trainers (intervals, plank) sit directly under the cardio block — after
    // the LAST cardio-only plan wherever it sits in the list, or at the end when
    // there isn't one. Position follows the data, not a hard-coded index.
    let lastCardio = -1;
    plans.forEach((p, i) => { if (DB.isCardioPlan(p)) lastCardio = i; });
    cards.splice(lastCardio >= 0 ? lastCardio + 1 : cards.length, 0, trainersBlock());
```

5e. Heatmap: in the home `mount`, replace `${consistencyBlock(DB.getSessions())}` with `${consistencyBlock(DB.getSessions(), DB.getIntervalSessions())}`. In `screenInsights`, replace `${consistencyBlock(sessions)}` with `${consistencyBlock(sessions, DB.getIntervalSessions())}`.

5f. Replace the head of `consistencyBlock` through the end of the sets-per-day loop with:

```js
function consistencyBlock(sessions, ivSessions = []) {
  if (!sessions.length && !ivSessions.length) return '';
  const startOfDay = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const todayStart = startOfDay(Date.now());
  const dow = (new Date().getDay() + 6) % 7;           // 0 = Monday

  // sets-per-day buckets — an interval session adds one "set" per finished hard round
  const dayCounts = {};
  for (const s of sessions) {
    const d = startOfDay(s.startedAt);
    let c = 0; for (const e of (s.entries || [])) c += (e.sets || []).length;
    dayCounts[d] = (dayCounts[d] || 0) + c;
  }
  for (const s of ivSessions) {
    const r = Number(s && s.roundsDone) || 0;
    if (r > 0) { const d = startOfDay(s.t); dayCounts[d] = (dayCounts[d] || 0) + r; }
  }
```

(The rest of the function is unchanged.)

- [ ] **Step 6: Run the checks**

Run: `npm test` — Expected: 0 failed.
Run: `node tools/smoke_test.cjs` — Expected: the three new `[7i]` checks PASS; `[7z]` plank checks still PASS; `RESULT: ALL PASSED`.

- [ ] **Step 7: Commit**

```bash
git add js/ui.js css/styles.css js/app.js tools/smoke_test.cjs
git commit -m "feat(intervals): Trainers block on home, heatmap credit, icons and styles"
```

---

### Task 4: Interval screen — route and setup

**Files:**
- Modify: `js/app.js` (new section placed directly after `screenPlank()` ends, before the consistency heatmap section ~L2089; router ~L2378)
- Test: `tools/smoke_test.cjs` (append inside `[7i]`)

**Interfaces:**
- Consumes: Tasks 1-3; app helpers `mount`, `qs`, `qsa`, `topbar`, `esc`, `fmtClock`, `fmtDate`, `fmtDuration`, `icons`, `toast`, `go`, `render` pattern, `plankRing`, `RING_C`, `addTicker`, `clearTickers`, `onLeaveScreen`, `acquireWakeLock`, `releaseWakeLock`, `unlockAudio`, `playBeep`, `bumpActivity`.
- Produces: `screenIntervals(finisherRoute: boolean)`; route `#/intervals` and `#/intervals/finisher`; helpers `ivStrip(blocks, run?, now?)`, `IV_COLOR`; setup DOM ids used by tests: `[data-preset]`, `[data-machine]`, `[data-step][data-dir]`, `#iv-v-<field>`, `#iv-reset`, `#iv-start`, `.iv-finisher-note`, `[data-del]`. Task 5 fills `runView()` / `doneView()` inside this same function.

- [ ] **Step 1: Write the failing smoke checks**

Append inside `[7i]` (after `const heatBefore = await todaySets();`):

```js
  console.log('  · setup: presets, steppers, machines');
  await page.locator('#iv-card').click();
  await page.waitForSelector('#iv-start');
  check(/#\/intervals$/.test(page.url()), 'interval route opens');
  check((await page.locator('[data-preset]').count()) === 5, 'five preset chips');
  check((await page.locator('[data-machine]').count()) === 2, 'two machine chips');
  check(!/km\/h|level/i.test((await page.locator('.iv-chips2').textContent()) || ''), 'machine chips carry no unit text');
  const hardVal = async () => ((await page.locator('#iv-v-hardSec').textContent()) || '').trim();
  check(await hardVal() === '4:00', '4×4 opens with 4:00 hard');
  await page.locator('[data-step="hardSec"][data-dir="1"]').click();
  check(await hardVal() === '4:15', 'hard +15 s');
  await page.locator('[data-preset="tabata"]').click();
  check(await hardVal() === '0:20', 'Tabata shows its own 0:20');
  await page.locator('[data-preset="4x4"]').click();
  check(await hardVal() === '4:15', '4×4 remembered its edit');
  check(await page.locator('#iv-reset').isVisible(), 'Reset to default shows after an edit');
  await page.locator('#iv-reset').click();
  check(await hardVal() === '4:00', 'reset restores 4:00');
  await page.locator('[data-machine="bike"]').click();
  await page.reload();
  await page.waitForSelector('#iv-start');
  check((await page.locator('[data-machine="bike"].on').count()) === 1, 'chosen machine survives a reload');
  await page.locator('[data-machine="treadmill"]').click();
  check(((await page.locator('.iv-prog').textContent()) || '').includes('No speed logged yet'), 'no history: no target yet');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/smoke_test.cjs`
Expected: `TEST CRASH` — timeout waiting for `#iv-start`.

- [ ] **Step 3: Route**

In `router()`, below `if (parts[0] === 'plank') return screenPlank();` add:

```js
  if (parts[0] === 'intervals') return screenIntervals(parts[1] === 'finisher');
```

- [ ] **Step 4: The screen with its setup view**

Insert after the closing `}` of `screenPlank()`:

```js
/* ============================================================
   SCREEN: Interval Trainer (#/intervals, #/intervals/finisher)
   Setup → run → summary. The clock is pure timestamps
   (js/intervals.js); this screen persists the run, paints it
   and fires the cues. Sessions live in their own store — never
   a plan, never a workout session.
   ============================================================ */
const IV_COLOR = { warm: 'warm', cool: 'warm', hard: 'hard', easy: 'easy' };

/** Every block to scale. With a run: finished blocks fade, the current one fills. */
function ivStrip(blocks, run = null, now = Date.now()) {
  return `<div class="iv-strip${run ? ' live' : ''}" id="iv-strip">${blocks.map((b, i) => {
    let st = '', done = '';
    if (run) {
      st = i < run.idx ? ' past' : i === run.idx ? ' now' : ' future';
      if (i === run.idx) done = `--done:${Math.round((1 - IV.blockLeftSec(run, now) / b.sec) * 100)}%`;
    }
    return `<i class="${IV_COLOR[b.kind]}${st}" style="flex:${b.sec} 1 0;${done}"></i>`;
  }).join('')}</div>`;
}

function screenIntervals(finisherRoute = false) {
  const act = DB.getActive();
  const from = finisherRoute && act ? { planId: act.planId, planName: act.planName } : null;
  const cued = new Set();                // cue keys already played on this screen
  const muted = () => DB.intervalPrefs().muted;
  let warmOverride = null;               // finisher-only warm-up edit (never saved to the preset)
  let paceDraft = null;                  // summary: what is typed in the speed box

  function persist() { DB.setIntervalActive(run); }

  const loaded = DB.getIntervalActive();
  let run = IV.intervalResume(loaded, Date.now());
  if (run !== loaded) {
    if (run && run.phase === 'done' && !run.saved) finishRun(true);
    else persist();
    if (run && run.lastEvent === 'abandoned') toast('Ended a session you left — saved what you did');
  }

  /* ---- setup ---- */
  function setupView() {
    const prefs = DB.intervalPrefs();
    const preset = IV.presetById(prefs.preset);
    const machine = prefs.machine;
    const m = IV.MACHINES[machine];
    const saved = DB.intervalCfg(preset.id);
    const warm = from ? (warmOverride ?? Math.min(saved.warmSec, IV.FINISHER_WARM_SEC)) : saved.warmSec;
    const cfg = { ...saved, warmSec: warm };
    const tot = IV.planTotals(cfg);
    const sessions = DB.getIntervalSessions();
    const last = IV.lastWithPace(sessions, preset.id, machine);
    const target = IV.paceTarget(sessions, preset.id, machine);
    const best = IV.bestPace(sessions, preset.id, machine);
    const edited = !IV.sameCfg(saved, preset.cfg);

    const row = (field, label, hint, dot) => `
      <div class="iv-row">
        <i class="iv-dot ${dot}"></i>
        <div class="iv-row-l">${label}${hint ? `<small>${esc(hint)}</small>` : ''}</div>
        <button class="rest-step" data-step="${field}" data-dir="-1" aria-label="Less ${label}">−</button>
        <div class="rest-ctl-val" id="iv-v-${field}">${field === 'rounds' ? cfg.rounds : IV.fmtBlock(cfg[field])}</div>
        <button class="rest-step" data-step="${field}" data-dir="1" aria-label="More ${label}">+</button>
      </div>`;

    const prog = last ? `
      <div class="card iv-prog">
        <div class="l">Last ${esc(preset.chip)} · ${esc(fmtDate(last.t))}<br><b>${esc(IV.fmtPace(machine, last.pace))}</b> · ${
          last.roundsDone >= last.cfg.rounds ? `all ${last.cfg.rounds} rounds` : `${last.roundsDone}/${last.cfg.rounds} rounds`}</div>
        <div class="t"><b>→ ${esc(IV.fmtPaceShort(machine, target))}</b><span>today</span></div>
      </div>` : `
      <div class="card iv-prog"><div class="l">No ${m.word} logged yet for ${esc(preset.chip)} on ${esc(m.name)}</div></div>`;

    const stats = sessions.length ? `
      <div class="stat-grid">
        <div class="card stat"><div class="stat-v">${sessions.length}</div><div class="stat-l">Sessions</div></div>
        <div class="card stat"><div class="stat-v">${IV.weekCount(sessions, Date.now())}<span class="u">/${IV.WEEK_TARGET}</span></div><div class="stat-l">This week</div></div>
        <div class="card stat"><div class="stat-v">${esc(fmtDuration(sessions.reduce((a, s) => a + (Number(s.hardSec) || 0), 0)))}</div><div class="stat-l">Hard time</div></div>
        <div class="card stat"><div class="stat-v">${best != null ? esc(IV.fmtPaceShort(machine, best)) : '—'}${best != null && machine === 'treadmill' ? '<span class="u">km/h</span>' : ''}</div><div class="stat-l">Best ${esc(preset.chip)} ${m.word}</div></div>
      </div>` : '';

    const history = sessions.length ? `
      <div class="section-label">History</div>
      ${sessions.slice(0, 20).map((s) => {
        const p = IV.presetById(s.preset);
        const mm = IV.MACHINES[s.machine] || IV.MACHINES.treadmill;
        const rounds = (s.cfg && s.cfg.rounds) || s.roundsDone || 0;
        return `
        <div class="card hist-row plank-hist-row">
          <div class="when">
            <p class="date">${esc(fmtDate(s.t))}${s.after ? `<span class="iv-tag">after ${esc(s.after)}</span>` : ''}</p>
            <p class="summary">${esc(p.chip)} · ${esc(mm.name)} · ${s.roundsDone || 0}/${rounds} rounds</p>
          </div>
          <div class="dur">${s.pace != null ? esc(IV.fmtPaceShort(s.machine, s.pace)) : '—'}</div>
          <button class="icon-btn btn-danger plank-del" data-del="${esc(s.id)}" aria-label="Delete">${icons.trash}</button>
        </div>`;
      }).join('')}` : '';

    mount(`
      ${topbar('Intervals', {
        back: from ? `#/plan/${from.planId}/run` : '#/',
        sub: sessions.length ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} logged` : 'bursts and pace, on a timer',
      })}
      <main class="screen">
        <div class="iv-chips5">${IV.PRESETS.map((p) =>
          `<button class="chip-tab${p.id === preset.id ? ' on' : ''}" data-preset="${p.id}">${esc(p.chip)}</button>`).join('')}</div>
        ${from ? `<p class="iv-finisher-note">Finisher after ${esc(from.planName)} · the workout clock keeps running</p>` : ''}
        <div class="card iv-hero">
          <div class="iv-hero-top">
            <div class="iv-hero-name">${esc(preset.name)}</div>
            <div class="iv-hero-total">${Math.round(tot.totalSec / 60)}<span> min</span></div>
          </div>
          <div class="iv-hero-sub"><span>${esc(preset.blurb)}</span><span>${esc(IV.fmtMinutes(tot.hardSec))} hard</span></div>
          ${ivStrip(IV.buildBlocks(cfg))}
        </div>
        <div class="section-label">Timing</div>
        <div class="card iv-rows">
          ${row('warmSec', 'Warm-up', 'easy pace', 'warm')}
          ${row('hardSec', 'Hard', preset.hardHint, 'hard')}
          ${row('easySec', 'Easy', m.easyHint, 'easy')}
          ${row('rounds', 'Rounds', '', 'none')}
          ${row('coolSec', 'Cool-down', 'easy pace', 'warm')}
        </div>
        ${edited ? '<button class="btn btn-ghost plank-sub iv-reset" id="iv-reset">Reset to default</button>' : ''}
        <div class="section-label">Machine</div>
        <div class="iv-chips2">${IV.MACHINE_IDS.map((id) =>
          `<button class="chip-tab${id === machine ? ' on' : ''}" data-machine="${id}">${IV.MACHINES[id].name}</button>`).join('')}</div>
        ${prog}
        <button class="btn btn-primary btn-block plank-cta" id="iv-start">${icons.play} Start ${esc(preset.chip)}</button>
        <div class="spacer"></div><div class="spacer"></div>
        ${stats}
        ${history}
        <div class="spacer"></div>
      </main>
    `);

    qsa('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      DB.setIntervalPrefs({ preset: b.dataset.preset }); warmOverride = null; render();
    }));
    qsa('[data-machine]').forEach((b) => b.addEventListener('click', () => {
      DB.setIntervalPrefs({ machine: b.dataset.machine }); render();
    }));
    qsa('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const field = b.dataset.step, dir = Number(b.dataset.dir);
      if (from && field === 'warmSec') warmOverride = IV.stepField(field, warm, dir);
      else DB.setIntervalCfg(preset.id, { ...saved, [field]: IV.stepField(field, saved[field], dir) });
      render();
    }));
    const reset = qs('#iv-reset');
    if (reset) reset.addEventListener('click', () => { DB.setIntervalCfg(preset.id, preset.cfg); warmOverride = null; render(); });
    qsa('[data-del]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Delete this interval session?')) return;
      DB.deleteIntervalSession(b.dataset.del); render();
    }));
    qs('#iv-start').addEventListener('click', () => {
      unlockAudio(); // the Start tap is the gesture that unlocks sound for the whole run
      run = IV.newIntervalRun({ id: DB.uid(), preset: preset.id, machine, cfg, from, target }, Date.now());
      persist();
      cued.clear();
      announce(IV.currentBlock(run));
      acquireWakeLock();
      render();
    });
  }

  /* ---- run + summary: Task 5 ---- */
  function runView() { mount(`${topbar('Intervals', { back: '#/' })}<main class="screen"></main>`); }
  function doneView() { runView(); }
  function announce() {}
  function finishRun() {}
  function startTicking() {}

  function render() {
    clearTickers();
    if (!run) return setupView();
    if (run.phase === 'done') return doneView();
    runView();
    startTicking();
  }

  render();
}
```

(`runView`, `doneView`, `announce`, `finishRun`, `startTicking` are stubs here so the setup screen ships and tests on its own; Task 5 replaces each stub in place.)

- [ ] **Step 5: Run the checks**

Run: `npm test` — Expected: 0 failed.
Run: `node tools/smoke_test.cjs` — Expected: all `[7i]` checks so far PASS, `RESULT: ALL PASSED`.

- [ ] **Step 6: Commit**

```bash
git add js/app.js tools/smoke_test.cjs
git commit -m "feat(intervals): interval screen route + setup (presets, steppers, machines, target, history)"
```

---

### Task 5: Run, cues and summary

**Files:**
- Modify: `js/app.js` (audio helpers next to `playBeep` ~L68-85; replace the five stubs inside `screenIntervals`)
- Test: `tools/smoke_test.cjs` (append inside `[7i]`)

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: `playTone('heads'|'tick'|'switch')`, `speak(text)` (module-level in `app.js`); run DOM ids `.iv-stage.(hard|easy|warm)[.paused][.soon]`, `#iv-strip`, `.iv-time`, `#iv-pace`, `#iv-next`, `#iv-back`, `#iv-pause`, `#iv-skip`, `#iv-end`, `#iv-mute`; summary ids `#iv-pace-val`, `#iv-pace-dn`, `#iv-pace-up`, `#iv-pb`, `#iv-save`, `#iv-skip-pace`.

- [ ] **Step 1: Write the failing smoke checks**

Append inside `[7i]`:

```js
  console.log('  · run a tiny custom session end to end');
  // Custom made tiny so the run takes seconds: no warm-up, 5 s hard, 5 s easy, 2 rounds, no cool-down
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('wt_intervals_v1') || '{}');
    d.prefs = { ...(d.prefs || {}), preset: 'custom', machine: 'treadmill', muted: true,
      cfgs: { custom: { warmSec: 0, hardSec: 5, easySec: 5, rounds: 2, coolSec: 0 } } };
    d.sessions = d.sessions || [];
    localStorage.setItem('wt_intervals_v1', JSON.stringify(d));
  });
  await page.reload();
  await page.waitForSelector('#iv-start');
  await page.evaluate(() => { window.__vibes = []; });
  await page.locator('#iv-start').click();
  await page.waitForSelector('.iv-stage.hard');
  check(((await page.locator('.topbar h1').textContent()) || '').trim() === 'Hard', 'run opens on the hard block');
  check((await page.locator('#iv-strip i').count()) === 3, 'strip shows 3 blocks (hard, easy, hard)');
  check((await page.evaluate(() => JSON.parse(localStorage.getItem('wt_interval_active_v1') || 'null'))) !== null,
    'the run is persisted on the device');
  const tA = await page.locator('.iv-time').textContent();
  await page.waitForTimeout(1300);
  check(tA !== await page.locator('.iv-time').textContent(), 'countdown ticks');

  console.log('  · pause freezes, reload keeps it paused');
  await page.locator('#iv-pause').click();
  await page.waitForSelector('.iv-stage.paused');
  const pA = await page.locator('.iv-time').textContent();
  await page.waitForTimeout(1300);
  check(pA === await page.locator('.iv-time').textContent(), 'paused clock does not move');
  await page.reload();
  await page.waitForSelector('.iv-stage.paused', { timeout: 4000 });
  check(true, 'a paused run is still paused after a reload');
  await page.locator('#iv-pause').click();
  await page.waitForSelector('.iv-stage.hard:not(.paused)');

  console.log('  · a router re-render mid-run keeps the run and records nothing');
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  await page.waitForSelector('.iv-stage', { timeout: 4000 });
  check((await page.evaluate(() => (JSON.parse(localStorage.getItem('wt_intervals_v1')).sessions || []).length)) === 0,
    'nothing recorded mid-run');

  console.log('  · skip, then let the clock finish it');
  await page.locator('#iv-skip').click();                     // hard 1 (<90 %) -> easy 1
  await page.waitForSelector('.iv-stage.easy');
  check((await page.evaluate(() => window.__vibes.length)) > 0, 'a switch buzzes even when muted');
  await page.waitForSelector('.iv-stage.hard', { timeout: 9000 });     // easy runs out on its own
  await page.waitForSelector('.plank-summary', { timeout: 9000 });     // last hard runs out -> summary
  const ivSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('wt_intervals_v1')).sessions);
  check(ivSaved.length === 1 && ivSaved[0].roundsDone === 1,
    `saved the moment it ended (${ivSaved.length} session, ${ivSaved[0] && ivSaved[0].roundsDone} round)`);
  check(ivSaved[0].pace === null, 'speed stays empty until entered');
  check(((await page.locator('.plank-pb-banner').first().textContent()) || '').includes('1 of 2'), 'banner: 1 of 2 rounds');
  await page.reload();
  await page.waitForSelector('#iv-pace-val', { timeout: 4000 });
  check(true, 'the summary survives a reload (the speed box is still there)');

  console.log('  · speed entry, then home');
  await page.fill('#iv-pace-val', '12,5');
  await page.locator('#iv-save').click();
  await page.waitForSelector('#iv-card');
  const ivOne = await page.evaluate(() => JSON.parse(localStorage.getItem('wt_intervals_v1')).sessions[0]);
  check(ivOne.pace === 12.5, 'speed saved (comma decimal accepted)');
  check((await page.evaluate(() => localStorage.getItem('wt_interval_active_v1'))) === null, 'the finished run is cleared');
  check(((await page.locator('#iv-card .plank-home-best').textContent()) || '').replace(/\s+/g, '').startsWith('1/2'), 'week count now 1/2');
  check(((await page.locator('#iv-card .desc').textContent()) || '').includes('12.5 km/h'), 'home card shows the last speed');
  check(await todaySets() === heatBefore + 1, `heatmap credits the finished round (${heatBefore} -> ${await todaySets()})`);
  const ivNotWorkout = await page.evaluate(() => ({
    plans: JSON.parse(localStorage.getItem('wt_plans_v1') || '[]').some((p) => /interval/i.test(p.name || '')),
    sessions: JSON.parse(localStorage.getItem('wt_sessions_v1') || '[]').some((s) => /interval/i.test(s.planName || '')),
  }));
  check(!ivNotWorkout.plans && !ivNotWorkout.sessions, 'intervals never become a plan or a workout session');
  const snapIv = await page.evaluate(async () => { const DB = await import('./js/db.js'); return DB.snapshot().intervals.sessions.length; });
  check(snapIv === 1, 'intervals ride the cloud snapshot');

  console.log('  · a phone away for minutes lands on the right block');
  await page.goto(BASE + '/#/intervals');
  await page.waitForSelector('#iv-start');
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('wt_intervals_v1'));
    d.prefs.cfgs.custom = { warmSec: 0, hardSec: 240, easySec: 180, rounds: 4, coolSec: 0 };
    localStorage.setItem('wt_intervals_v1', JSON.stringify(d));
  });
  await page.reload();
  await page.waitForSelector('#iv-start');
  await page.locator('#iv-start').click();
  await page.waitForSelector('.iv-stage.hard');
  await page.evaluate(() => { // pretend 9 min passed (hard 4 + easy 3 + 2 min into hard 2) while seen recently
    const a = JSON.parse(localStorage.getItem('wt_interval_active_v1'));
    const shift = 9 * 60 * 1000;
    a.startedAt -= shift; a.blockStartAt -= shift; a.seenAt = Date.now() - 2000;
    localStorage.setItem('wt_interval_active_v1', JSON.stringify(a));
  });
  await page.reload();
  await page.waitForSelector('.iv-stage.hard', { timeout: 4000 });
  const away = ((await page.locator('.topbar .sub').textContent()) || '');
  check(/Round 2 of 4/.test(away), `caught up to round 2 (${away.trim()})`);
  await page.locator('#iv-end').click();
  await page.waitForSelector('.plank-summary');
  await page.locator('#iv-skip-pace').click();
  await page.waitForSelector('#iv-card');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/smoke_test.cjs`
Expected: FAIL/CRASH at `run opens on the hard block` (the stub run view has no stage).

- [ ] **Step 3: Audio helpers**

Directly after `playBeep()` in `js/app.js` add:

```js
/* interval cues: 'heads' = two-note warning (7 s left), 'tick' = 3-2-1 blip, 'switch' = long tone */
function playTone(kind) {
  if (!audioCtx) unlockAudio();
  if (!audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const notes = kind === 'heads' ? [[660, 0, 0.16], [880, 0.2, 0.16]]
      : kind === 'tick' ? [[1046, 0, 0.09]]
        : [[988, 0, 0.7]];
    for (const [freq, at, len] of notes) {
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      const start = t0 + at, end = start + len;
      osc.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.7, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(start); osc.stop(end + 0.05);
    }
  } catch (_) {}
}
function speak(text) { // the phone's own offline voice; silently absent on phones without one
  try {
    if (!text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch (_) {}
}
```

- [ ] **Step 4: Replace the stubs inside `screenIntervals`**

Replace the block from `/* ---- run + summary: Task 5 ---- */` through `function startTicking() {}` with:

```js
  /* ---- one action through the pure state machine, then the side effects ---- */
  function apply(action) {
    const next = IV.intervalStep(run, action, Date.now());
    if (next === run) return;
    run = next;
    const ev = run.lastEvent;
    if (run.phase === 'done') { finishRun(false); render(); return; }
    persist();
    if (ev === 'switch') { announce(IV.currentBlock(run)); render(); return; }
    if (ev === 'restart' || ev === 'paused' || ev === 'resumed') render();
  }

  /** Switch cue: buzz always; tone + voice unless muted. */
  function announce(block) {
    if (navigator.vibrate) navigator.vibrate([400, 120, 400]);
    if (muted()) return;
    playTone('switch');
    const line = IV.voiceLine(block, run, IV.spokenPace(run.machine, block && block.kind === 'hard' ? run.target : null));
    setTimeout(() => speak(line), 450);
  }

  /** The run just ended: record it once (quiet when it ended while away). */
  function finishRun(quiet) {
    if (!run.saved) {
      run.saved = true;
      run.recorded = IV.runStats(run).hardSec >= 1;
      if (run.recorded) DB.recordIntervalSession(IV.toSession(run));
      else toast('Nothing logged — no hard block run');
      if (!quiet) {
        if (navigator.vibrate) navigator.vibrate([400, 120, 400]);
        if (!muted()) { playBeep(); setTimeout(() => speak(IV.voiceLine(null, run)), 1500); }
      }
    }
    persist();
    releaseWakeLock();
  }

  function roundSub(b) {
    const n = run.cfg.rounds;
    if (b.kind === 'hard') return `Round ${b.round} of ${n}`;
    if (b.kind === 'easy') return `Round ${b.round} of ${n}`;
    return b.kind === 'warm' ? 'Warm-up first' : 'Last block';
  }
  function midLine(b) {
    const n = run.cfg.rounds;
    if (b.kind === 'hard') return `round ${b.round} of ${n}`;
    if (b.kind === 'easy') return `round ${b.round + 1} next`;
    return b.kind === 'warm' ? `${n} rounds ahead` : 'last block';
  }

  /* ---- run ---- */
  function runView() {
    const b = IV.currentBlock(run);
    const now = Date.now();
    const back = run.from ? `#/plan/${run.from.planId}/run` : '#/';
    mount(`
      ${topbar(IV.KIND_NAME[b.kind], {
        back,
        sub: `${roundSub(b)} · ${fmtClock(IV.sessionLeftSec(run, now))} left`,
        right: `<button class="icon-btn" id="iv-mute" aria-label="${muted() ? 'Sound off' : 'Sound on'}">${muted() ? icons.muted : icons.sound}</button>`,
      })}
      <main class="screen plank-screen">
        <div class="iv-stage ${IV_COLOR[b.kind]}${run.pausedAt ? ' paused' : ''}" id="iv-stage">
          ${ivStrip(IV.buildBlocks(run.cfg), run, now)}
          ${plankRing(1)}
          <div class="iv-pace${b.kind === 'hard' && run.target != null ? '' : ' off'}" id="iv-pace">Hold <b>${esc(IV.fmtPace(run.machine, run.target))}</b></div>
          <div class="card iv-next" id="iv-next"></div>
          <div class="iv-ctrl">
            <button class="btn iv-side" id="iv-back" aria-label="Restart block">${icons.prev}</button>
            <button class="btn btn-primary" id="iv-pause">${run.pausedAt ? `${icons.play} Resume` : `${icons.pause} Pause`}</button>
            <button class="btn iv-side" id="iv-skip" aria-label="Skip block">${icons.next}</button>
          </div>
          <button class="btn btn-ghost plank-sub" id="iv-end">End session</button>
        </div>
      </main>
    `);
    qs('#iv-pause').addEventListener('click', () => apply({ type: run.pausedAt ? 'resume' : 'pause' }));
    qs('#iv-skip').addEventListener('click', () => apply({ type: 'skip' }));
    qs('#iv-back').addEventListener('click', () => apply({ type: 'back' }));
    qs('#iv-end').addEventListener('click', () => {
      if (confirm('End the session? Rounds you finished are saved.')) apply({ type: 'end' });
    });
    qs('#iv-mute').addEventListener('click', () => {
      DB.setIntervalPrefs({ muted: !muted() });
      if (muted()) { try { window.speechSynthesis.cancel(); } catch (_) {} }
      render();
    });
  }

  /* live redraw: numbers, ring, strip, next card — never the whole screen */
  function paint() {
    if (!run || run.phase !== 'run') return;
    const now = Date.now();
    const b = IV.currentBlock(run);
    const nb = IV.nextBlock(run);
    const left = IV.blockLeftSec(run, now);
    const soon = !run.pausedAt && b.sec > 10 && left <= IV.HEADS_UP_SEC;
    const m = IV.MACHINES[run.machine];

    const mid = qs('#plank-ring-mid');
    if (mid) mid.innerHTML = `<div class="iv-phase">${IV.KIND_WORD[b.kind]}</div><div class="iv-time">${fmtClock(left)}</div><div class="iv-round">${midLine(b)}</div>`;
    const fill = qs('#plank-ring-fill');
    if (fill) fill.setAttribute('stroke-dashoffset', String((RING_C * (1 - left / b.sec)).toFixed(1)));
    const cur = qs('#iv-strip .now');
    if (cur) cur.style.setProperty('--done', `${Math.round((1 - left / b.sec) * 100)}%`);
    const sub = qs('.topbar .sub');
    if (sub) sub.textContent = `${roundSub(b)} · ${fmtClock(IV.sessionLeftSec(run, now))} left`;
    const stage = qs('#iv-stage');
    if (stage) stage.classList.toggle('soon', soon);

    const next = qs('#iv-next');
    if (next) {
      next.className = `card iv-next ${IV_COLOR[nb ? nb.kind : 'cool']}${soon ? ' soon' : ''}`;
      if (!nb) {
        next.innerHTML = `<div><div class="k">${soon ? 'Almost done' : 'Next'}</div><div class="v">Finish</div></div>`;
      } else if (soon) {
        const setIt = nb.kind === 'hard' && run.target != null
          ? `<div class="r">set the ${m.word}<br><b>${esc(IV.fmtPace(run.machine, run.target))}</b></div>` : '';
        next.innerHTML = `<div><div class="k">Get ready</div><div class="v"><span>${IV.KIND_NAME[nb.kind]}</span> in ${left}</div></div>${setIt}`;
      } else {
        const note = nb.kind === 'hard' ? `round ${nb.round} of ${run.cfg.rounds}`
          : nb.kind === 'easy' ? `then round ${nb.round + 1}` : 'then done';
        next.innerHTML = `<div><div class="k">Next</div><div class="v"><span>${IV.KIND_NAME[nb.kind]}</span> ${IV.fmtBlock(nb.sec)}</div></div><div class="r">${note}</div>`;
      }
    }

    // cues: each (block, second) plays once; vibration even when muted
    if (!run.pausedAt) {
      const cue = IV.cueAt(b.sec, left);
      const key = `${run.idx}:${left}`;
      if (cue && !cued.has(key)) {
        cued.add(key);
        if (!muted()) playTone(cue);
        if (cue === 'heads' && navigator.vibrate) navigator.vibrate(150);
      }
      if (left <= 0) apply({ type: 'tick' });
    }
  }

  function startTicking() {
    addTicker(setInterval(paint, 250));
    addTicker(setInterval(() => {
      apply({ type: 'heartbeat' });
      // a finisher keeps its workout alive, so the idle auto-finish never ends it mid-run
      const a = run && run.from ? DB.getActive() : null;
      if (a && a.planId === run.from.planId) bumpActivity();
    }, IV.HEARTBEAT_MS));
    paint();
  }

  /* ---- summary ---- */
  function doneView() {
    const st = IV.runStats(run);
    const preset = IV.presetById(run.preset);
    const m = IV.MACHINES[run.machine];
    const prior = DB.getIntervalSessions().filter((s) => s.id !== run.id);
    const lastP = IV.lastWithPace(prior, run.preset, run.machine);
    const bestPrior = IV.bestPace(prior, run.preset, run.machine);
    const a = DB.getActive();
    const backHash = run.from && a && a.planId === run.from.planId ? `#/plan/${run.from.planId}/run` : null;
    const val = paceDraft ?? IV.fmtPaceInput(run.machine, run.target);
    const all = st.roundsDone >= run.cfg.rounds;
    const primary = run.recorded
      ? (backHash ? `Save · back to ${esc(run.from.planName)}` : 'Save')
      : (backHash ? `Back to ${esc(run.from.planName)}` : 'Done');

    mount(`
      ${topbar('Intervals done', { back: '#/', sub: `${preset.name} · ${m.name}` })}
      <main class="screen plank-screen">
        <div class="plank-stage plank-summary">
          <div class="plank-pb-banner first${all ? '' : ' iv-partial'}">${icons.check}<b>${all
            ? `All ${run.cfg.rounds} rounds done` : `${st.roundsDone} of ${run.cfg.rounds} rounds`}</b><span>${esc(fmtClock(st.hardSec))} hard</span></div>
          <div class="plank-pb-banner" id="iv-pb" style="display:none">${icons.trophy}<b>New best ${esc(preset.chip)} ${m.word}</b><span id="iv-pb-v"></span></div>
          ${st.hardSec ? `
          <div class="card plank-totals">
            <div><div class="stat-l">Hard</div><div class="stat-v">${esc(fmtClock(st.hardSec))}</div></div>
            <div><div class="stat-l">Total</div><div class="stat-v">${esc(fmtClock(st.totalSec))}</div></div>
            <div><div class="stat-l">Rounds</div><div class="stat-v">${st.roundsDone}/${run.cfg.rounds}</div></div>
          </div>` : '<div class="empty"><p>No hard block run — nothing logged.</p></div>'}
          ${run.recorded ? `
          <div class="card">
            <p class="iv-pace-q">${m.ask}</p>
            <div class="iv-pace-in">
              <button class="rest-step" id="iv-pace-dn" aria-label="Less">−</button>
              <input class="input" id="iv-pace-val" inputmode="decimal" autocomplete="off" value="${esc(val)}" placeholder="${m.word}">
              <span class="u">${m.unit}</span>
              <button class="rest-step" id="iv-pace-up" aria-label="More">+</button>
            </div>
            <p class="iv-pace-hint">${lastP ? `Last time ${esc(IV.fmtPaceShort(run.machine, lastP.pace))}` : `First ${m.word} for ${esc(preset.chip)} on ${m.name}`}${
              run.target != null ? ` · target <b>→ ${esc(IV.fmtPaceShort(run.machine, run.target))}</b>` : ''}</p>
          </div>` : ''}
          <button class="btn btn-primary plank-cta" id="iv-save">${icons.check} ${primary}</button>
          ${run.recorded ? `<button class="btn btn-ghost plank-sub" id="iv-skip-pace">Skip — don't log a ${m.word}</button>` : ''}
          <div class="spacer"></div>
        </div>
      </main>
    `);

    const input = qs('#iv-pace-val');
    const showPB = () => { // live gold banner while the typed speed beats the best
      const v = input ? IV.cleanPace(run.machine, input.value) : null;
      const beat = v != null && bestPrior != null && v > bestPrior;
      const pb = qs('#iv-pb');
      if (pb) pb.style.display = beat ? '' : 'none';
      const pv = qs('#iv-pb-v');
      if (pv && beat) pv.textContent = IV.fmtPace(run.machine, v);
      return { v, beat };
    };
    if (input) {
      input.addEventListener('input', () => { paceDraft = input.value; showPB(); });
      const nudge = (dir) => {
        const v = IV.stepPace(run.machine, input.value || run.target, dir);
        input.value = IV.fmtPaceInput(run.machine, v); paceDraft = input.value; showPB();
      };
      qs('#iv-pace-dn').addEventListener('click', () => nudge(-1));
      qs('#iv-pace-up').addEventListener('click', () => nudge(1));
      showPB();
    }
    const leave = () => {
      run = null; paceDraft = null;
      DB.setIntervalActive(null); releaseWakeLock();
      go(backHash || '#/');
    };
    qs('#iv-save').addEventListener('click', () => {
      if (run.recorded && input) {
        const { v, beat } = showPB();
        if (v != null) {
          DB.setIntervalPace(run.id, v);
          if (beat) {
            if (navigator.vibrate) navigator.vibrate([120, 60, 120, 60, 320]);
            toast(`🏆 New best ${preset.chip} ${m.word} — ${IV.fmtPace(run.machine, v)}`);
          } else if (bestPrior == null) {
            toast(`First ${m.word} logged — ${IV.fmtPace(run.machine, v)} is the one to beat`);
          } else toast(`Saved — ${IV.fmtPace(run.machine, v)}`);
        }
      }
      leave();
    });
    const skipPace = qs('#iv-skip-pace');
    if (skipPace) skipPace.addEventListener('click', leave);
  }
```

Then, directly **after** the `render()` function inside `screenIntervals` and **before** the final `render();` call, add the screen lifecycle:

```js
  // Keep the screen on while a run is live, and recompute the instant the app
  // comes back — the clock is timestamp-based, so it self-corrects.
  const onVis = () => {
    if (document.visibilityState !== 'visible' || !run) return;
    const resumed = IV.intervalResume(run, Date.now());
    if (resumed === run) { if (run.phase === 'run') { acquireWakeLock(); paint(); } return; }
    run = resumed;
    if (!run) { persist(); render(); return; }
    if (run.phase === 'done') finishRun(run.lastEvent === 'abandoned');
    else { persist(); acquireWakeLock(); if (run.lastEvent === 'switch') announce(IV.currentBlock(run)); }
    render();
  };
  document.addEventListener('visibilitychange', onVis);
  onLeaveScreen(() => {
    document.removeEventListener('visibilitychange', onVis);
    releaseWakeLock();
    try { window.speechSynthesis.cancel(); } catch (_) {}
  });
  if (run && run.phase === 'run') acquireWakeLock();
```

- [ ] **Step 5: Run the checks**

Run: `npm test` — Expected: 0 failed.
Run: `node tools/smoke_test.cjs` — Expected: every `[7i]` check PASS, `[8] no console/page errors` PASS, `RESULT: ALL PASSED`.

- [ ] **Step 6: Commit**

```bash
git add js/app.js tools/smoke_test.cjs
git commit -m "feat(intervals): run screen with 7 s heads-up, 3-2-1, voice, pause/skip/back, summary with speed + PB"
```

---

### Task 6: Finisher entry on the live workout

**Files:**
- Modify: `js/app.js` (`screenRun` mount ~L758: insert after `${exHtml}`; new helper `intervalFinisherCard()` placed right after `intervalHomeCard()`)
- Test: `tools/smoke_test.cjs` (append inside `[7i]`)

**Interfaces:**
- Consumes: Tasks 1-5; `DB.getActive()`, `bumpActivity()`.
- Produces: `intervalFinisherCard()`; DOM `#iv-finisher` (tap → `#/intervals/finisher`).

- [ ] **Step 1: Write the failing smoke checks**

Append inside `[7i]`:

```js
  console.log('  · finisher from a live workout, and back to it');
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.plan-card [data-run]');
  await page.locator('.plan-card [data-run]').first().click();
  await page.waitForSelector('#logbtn');
  const runHash = page.url().split('#')[1];
  check(await page.locator('#iv-finisher').isVisible(), 'the live workout offers an interval finisher');
  await page.locator('#iv-finisher').click();
  await page.waitForSelector('#iv-start');
  check(/#\/intervals\/finisher$/.test(page.url()), 'finisher route opens');
  check(await page.locator('.iv-finisher-note').isVisible(), 'setup says it is a finisher after the workout');
  await page.locator('[data-preset="4x4"]').click();
  check(((await page.locator('#iv-v-warmSec').textContent()) || '').trim() === '3:00', 'finisher warm-up starts at 3:00');
  check((await page.evaluate(() => JSON.parse(localStorage.getItem('wt_intervals_v1')).prefs.cfgs['4x4'])) === undefined,
    'the 3:00 finisher warm-up is not saved into the 4×4 preset');
  await page.locator('#iv-start').click();
  await page.waitForSelector('.iv-stage.warm');
  // AFTER the Start tap (any tap stamps activity): make the workout look idle for
  // 49 min, then touch nothing — only the finisher heartbeat can keep it alive
  await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('wt_active_v1'));
    a.lastActivityAt = Date.now() - 49 * 60 * 1000;
    localStorage.setItem('wt_active_v1', JSON.stringify(a));
  });
  await page.waitForTimeout(5600); // one heartbeat, no taps
  const idleMs = await page.evaluate(() => Date.now() - JSON.parse(localStorage.getItem('wt_active_v1')).lastActivityAt);
  check(idleMs < 10000, `the finisher keeps the workout active (idle ${Math.round(idleMs / 1000)} s)`);
  await page.locator('#iv-skip').click();                         // warm-up -> hard 1
  await page.waitForSelector('.iv-stage.hard');
  await page.waitForTimeout(1200);
  await page.locator('#iv-end').click();
  await page.waitForSelector('.plank-summary');
  check(((await page.locator('#iv-save').textContent()) || '').includes('back to'), 'Save offers the way back to the workout');
  await page.locator('#iv-save').click();
  await page.waitForSelector('#logbtn');
  check(page.url().endsWith(runHash), 'Save lands back on the live workout');
  const fin = await page.evaluate(() => JSON.parse(localStorage.getItem('wt_intervals_v1')).sessions.find((s) => s.after));
  check(!!fin && fin.after.length > 0, `the session remembers the workout it followed (${fin && fin.after})`);

  console.log('  · a workout discarded meanwhile sends Save home');
  await page.locator('#iv-finisher').click();
  await page.waitForSelector('#iv-start');
  await page.locator('#iv-start').click();
  await page.waitForSelector('.iv-stage');
  await page.locator('#iv-skip').click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => localStorage.removeItem('wt_active_v1'));  // workout gone
  await page.locator('#iv-end').click();
  await page.waitForSelector('.plank-summary');
  await page.locator('#iv-save').click();
  await page.waitForSelector('#iv-card');
  check(true, 'Save with no live workout goes home');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/smoke_test.cjs`
Expected: FAIL `the live workout offers an interval finisher`, then a crash on `#iv-finisher` click.

- [ ] **Step 3: The finisher card**

After `intervalHomeCard()` add:

```js
/** Live workout: the optional interval finisher, after the last exercise. */
function intervalFinisherCard() {
  const prefs = DB.intervalPrefs();
  const p = IV.presetById(prefs.preset);
  const live = DB.getIntervalActive();
  const running = !!(live && live.phase === 'run');
  const target = IV.paceTarget(DB.getIntervalSessions(), p.id, prefs.machine);
  const warm = Math.min(DB.intervalCfg(p.id).warmSec, IV.FINISHER_WARM_SEC);
  const desc = running ? 'Running · tap to return'
    : [p.chip, `warm-up ${IV.fmtBlock(warm)}`, target != null ? `→ ${IV.fmtPace(prefs.machine, target)}` : null]
      .filter(Boolean).join(' · ');
  return `
    <div class="card iv-finisher tappable" id="iv-finisher" data-nav="#/intervals/finisher">
      <div class="plank-home-icon">${icons.pulse}</div>
      <div class="meta">
        <p class="name">${running ? 'Interval finisher' : 'Add an interval finisher'}</p>
        <p class="desc">${esc(desc)}</p>
      </div>
      <button class="icon-btn btn-primary" style="border-radius:12px" aria-label="Start finisher">${icons.play}</button>
    </div>`;
}
```

In `screenRun`'s mount, change

```js
        ${exHtml}
        <div class="card">
```

to

```js
        ${exHtml}
        ${intervalFinisherCard()}
        <div class="card">
```

- [ ] **Step 4: Run the checks**

Run: `npm test` — Expected: 0 failed.
Run: `node tools/smoke_test.cjs` — Expected: all `[7i]` checks PASS, `RESULT: ALL PASSED`.

- [ ] **Step 5: Commit**

```bash
git add js/app.js tools/smoke_test.cjs
git commit -m "feat(intervals): finisher entry on the live workout, keeps the workout alive, returns to it"
```

---

### Task 7: Release, screenshots, final check

**Files:**
- Modify: `sw.js` (L5 `CACHE`, `SHELL` list L8-14)
- Modify: `README.md` (Features list, new "Interval Trainer" section after "Plank Trainer", Tests section)
- Create: `tools/interval_shots.cjs`

**Interfaces:**
- Consumes: the finished feature.
- Produces: offline-cached `js/intervals.js`, screenshots in `tools/shots/interval-*.png` (git-ignored folder).

- [ ] **Step 1: Service worker**

In `sw.js`: change `const CACHE = 'workout-v54';` to `const CACHE = 'workout-v55';` and add `'js/intervals.js',` to `SHELL` directly after `'js/db.js',`.

- [ ] **Step 2: README**

In the Features list, after the Plank Trainer bullet add:

```markdown
- **Interval Trainer** — timed intervals (Norwegian 4×4, sprints, Tabata, 10×1, custom) under "Trainers", or as a finisher from a live workout (see below).
```

After the "## Plank Trainer" section add:

```markdown
## Interval Trainer

A Timer Plus-style interval timer for the treadmill or the bike.

- Presets: Norwegian 4×4 (10:00 warm-up · 4:00 hard / 3:00 easy × 4 · 5:00 cool-down, per NTNU CERG), Sprints, Tabata, 10×1, and one Custom slot. Each preset remembers your edits.
- The run screen paints the phase colour (hard = green, easy = blue, warm-up/cool-down = slate), shows the whole session as a strip, and the speed to hold.
- Cues: a heads-up tone and buzz 7 s before every switch, 3-2-1 ticks, then a tone, a buzz and a spoken line. Mute keeps the buzz.
- Pause, restart / previous block, skip. The clock is worked out from timestamps, so a reload or a short lock never loses your place; a run left paused or unseen for 30 min ends and keeps what you did.
- The session is saved the moment it ends. On the summary you add the speed (km/h) or level you held; next time the setup shows a target one step up if you finished every round.
- From a live workout, "Add an interval finisher" starts with a 3:00 warm-up, keeps the workout clock running, and returns to the workout.
- Data lives in its own store (`wt_intervals_v1`) and cloud-sync field `intervals`. Each finished hard round counts as one set on the Consistency heatmap; sessions never enter plans, workout history, up-next or strength records.
```

In "## Tests", change the unit-test comment line to `npm test        # rec_test + ui_test + analytics_test + plank_test + interval_test` and add under the e2e commands: `node tools/interval_shots.cjs                   # screenshots of the interval states`.

- [ ] **Step 3: Screenshot tool**

Create `tools/interval_shots.cjs`:

```js
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
```

- [ ] **Step 4: Full proof**

Run: `npm test` — Expected: 0 failed in every suite.
Run (server on :8099): `node tools/smoke_test.cjs` — Expected: `RESULT: ALL PASSED` (including `[8] no console/page errors` and `[9] offline`).
Run: `node tools/interval_shots.cjs` — Expected: 7 `shot:` lines, `done`.

- [ ] **Step 5: Visual check against the mockups**

Open each `tools/shots/interval-*.png` with the Read tool and compare it with the matching mockup screen in `docs/superpowers/specs/2026-09-26-interval-trainer-mockups.html` (home, finisher card, setup, run hard, run 7 s heads-up, summary). Fix any layout defect (overflow, wrapped chip, clipped text, wrong colour) in `css/styles.css` / `js/app.js`, re-run `node tools/interval_shots.cjs`, and look again. Done only when every shot matches its mockup and no text is clipped.

- [ ] **Step 6: Commit and push**

```bash
git add sw.js README.md tools/interval_shots.cjs
git commit -m "release(intervals): cache js/intervals.js (workout-v55), README, screenshot tool"
git push origin main
git rev-parse HEAD origin/main   # both hashes must match
```

Report to Abbas that sound, voice and vibration can only be confirmed on his phone.
