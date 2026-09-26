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
  eq('best pace counts only full sessions', IV.bestPace([mk('a', 1, 12, 4), mk('b', 2, 12.5, 2)], '4x4', 'treadmill'), 12);
  eq('best pace from full sessions', IV.bestPace([mk('a', 1, 12, 4), mk('b', 2, 12.5, 4)], '4x4', 'treadmill'), 12.5);
  eq('no best from partial sessions only', IV.bestPace([mk('a', 1, 13, 1)], '4x4', 'treadmill'), null);
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

console.log('resetAll — wipes interval sessions and a live run too (Danger zone says "everything"):');
{
  reset();
  DB.recordIntervalSession({ id: 'a', t: 1, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 4, pace: 12 });
  DB.setIntervalActive(run44());
  DB.resetAll();
  eq('sessions gone', DB.getIntervalSessions().length, 0);
  eq('live run gone', DB.getIntervalActive(), null);
}

console.log('exportAll / importAll — a backup carries interval sessions:');
{
  reset();
  DB.recordIntervalSession({ id: 'a', t: 1, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 4, pace: 12 });
  const backup = JSON.parse(DB.exportAll());
  ok('intervals in the backup', backup.intervals && backup.intervals.sessions.length === 1);
  reset();
  DB.importAll(JSON.stringify(backup));
  eq('interval session restored', DB.getIntervalSessions().length, 1);
  eq('speed restored', DB.getIntervalSessions()[0].pace, 12);
  reset();
  DB.recordIntervalSession({ id: 'keep', t: 1, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 1, pace: null });
  DB.importAll(JSON.stringify({ plans: [{ id: 'p', name: 'X', exercises: [] }], sessions: [], v: 1 }));
  eq('an old backup without intervals leaves them alone', DB.getIntervalSessions().length, 1);
}

console.log('getIntervals — junk entries from a bad backup or pull never block saving:');
{
  reset();
  store.wt_intervals_v1 = JSON.stringify({ sessions: [null, 7, { id: 'ok', t: 1 }], prefs: {} });
  eq('junk dropped on read', DB.getIntervalSessions().length, 1);
  ok('a new run still saves', !!DB.recordIntervalSession({ id: 'new', t: 2, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 1, pace: null }));
  eq('both real sessions kept', DB.getIntervalSessions().length, 2);
}

console.log('mergeIntervalDoc — duplicate ids collapse to one:');
{
  const m = DB.mergeIntervalDoc({ sessions: [] }, { sessions: [{ id: 'r', t: 1, pace: null }, { id: 'r', t: 1, pace: 12 }] });
  eq('one copy', m.sessions.length, 1);
  eq('its speed kept', m.sessions[0].pace, 12);
}

console.log('markDirty — never stamps below a floor, and stamps never go backwards:');
{
  reset();
  const floor = Date.now() + 10 * 60000;
  DB.markDirty(floor);
  ok('stamp at or above the floor', DB.getUpdatedAt() >= floor);
  const before = DB.getUpdatedAt();
  DB.markDirty();
  ok('a later change is stamped strictly newer', DB.getUpdatedAt() > before);
}

console.log('write stamps — a change is always newer than the cloud version it builds on (fast-clock safe):');
{
  reset();
  const cloudAt = Date.now() + 10 * 60000;          // last version seen came from a device whose clock runs fast
  store.wt_updated_at = String(cloudAt); store.wt_pushed_at = String(cloudAt);
  DB.recordIntervalSession({ id: 'd', t: 1, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 1, pace: null });
  ok('stamped newer than the cloud version', DB.getUpdatedAt() > cloudAt);
  const a = DB.getUpdatedAt();
  DB.setIntervalPace('d', 12);
  ok('two changes in the same millisecond still get distinct stamps', DB.getUpdatedAt() > a);
}

console.log('sync.pull — a merge is detected even when the cloud held junk entries:');
{
  reset();
  const SYNC = await import('../js/sync.js');
  const puts = [];
  const cloudAt = Date.now() + 5000;
  globalThis.fetch = async (u, opts = {}) => {
    if (opts.method === 'PUT') { puts.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ updatedAt: cloudAt, data: { plans: [], sessions: [], intervals: { sessions: [null] } } }) };
  };
  DB.recordIntervalSession({ id: 'offline', t: 2, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 1, pace: null });
  store.wt_pushed_at = '1';
  await SYNC.pull();
  await new Promise((r) => setTimeout(r, 50));
  eq('the merged doc is pushed', puts.length, 1);
  eq('with the offline session in it', puts[0] && puts[0].data.intervals.sessions.map((s) => s && s.id).filter(Boolean).join(), 'offline');
}

console.log('sync.push — pushes from one device go out one at a time, newest last:');
{
  reset();
  const SYNC = await import('../js/sync.js');
  const bodies = [];
  let inFlight = 0, maxInFlight = 0;
  globalThis.fetch = (u, opts = {}) => new Promise((resolve) => {
    if (opts.method !== 'PUT') return resolve({ ok: true, json: async () => ({}) });
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    bodies.push(JSON.parse(opts.body));
    setTimeout(() => { inFlight--; resolve({ ok: true, json: async () => ({}) }); }, 30);
  });
  DB.recordIntervalSession({ id: 'x1', t: 1, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 1, pace: null });
  const p1 = SYNC.push();
  DB.recordIntervalSession({ id: 'x2', t: 2, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 1, pace: null });
  const p2 = SYNC.push();
  await p1; await p2;
  await new Promise((r) => setTimeout(r, 150));
  eq('never two uploads in flight', maxInFlight, 1);
  eq('the last upload carries both sessions', bodies.length && bodies[bodies.length - 1].data.intervals.sessions.length, 2);
  eq('the device then counts as fully pushed', store.wt_pushed_at, String(DB.getUpdatedAt()));
}

console.log('sync.pull — merged offline data is pushed newer than the cloud (clock-skew safe):');
{
  reset();
  const SYNC = await import('../js/sync.js');
  const cloudAt = Date.now() + 10 * 60000; // the other device's clock runs ahead
  const puts = [];
  globalThis.fetch = async (u, opts = {}) => {
    if (opts.method === 'PUT') { puts.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ updatedAt: cloudAt, data: { plans: [], sessions: [], intervals: { sessions: [{ id: 'cloud', t: 1 }] } } }) };
  };
  DB.recordIntervalSession({ id: 'local', t: 2, preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 1, pace: null });
  store.wt_pushed_at = '1'; // this device has work the cloud never saw
  const st = await SYNC.pull();
  await new Promise((r) => setTimeout(r, 50));
  eq('pull applied', st, 'applied');
  eq('merged doc was pushed once', puts.length, 1);
  eq('pushed doc carries both sessions', puts[0] && puts[0].data.intervals.sessions.map((s) => s.id).sort().join(), 'cloud,local');
  ok('pushed stamp is newer than the cloud', !!puts[0] && puts[0].updatedAt > cloudAt);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
