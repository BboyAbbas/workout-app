/* Unit tests for the plank trainer's data layer in js/db.js (+ fmtHold in js/ui.js).
   Installs an in-memory localStorage shim so the storage-backed helpers run under
   node, same as analytics_test.mjs. Run with `node tools/plank_test.mjs`. */
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const DB = await import('../js/db.js');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } }
function eq(name, got, want) { ok(`${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, got === want); }
function reset() { for (const k of Object.keys(store)) delete store[k]; }

const T = (n) => 1_700_000_000_000 + n * 86400000; // day n

/* ---------- recording ---------- */
console.log('recordPlankSet — a completed hold is persisted immediately:');
{
  reset();
  const r = DB.recordPlankSet('s1', 47, { at: T(1) });
  ok('returns the saved set', !!r && r.set.sec === 47);
  const p = DB.getPlanks();
  eq('one session stored', p.sessions.length, 1);
  eq('session holds the set', p.sessions[0].sets.length, 1);
  eq('set seconds kept', p.sessions[0].sets[0].sec, 47);
  eq('set timestamped', p.sessions[0].sets[0].at, T(1));
  eq('session id is the caller id', p.sessions[0].id, 's1');
  eq('session start = first set', p.sessions[0].t, T(1));
}

console.log('recordPlankSet — later sets append to the SAME session:');
{
  reset();
  DB.recordPlankSet('s1', 40, { at: T(1) });
  DB.recordPlankSet('s1', 52, { at: T(1) + 90000 });
  const p = DB.getPlanks();
  eq('still one session', p.sessions.length, 1);
  eq('two sets', p.sessions[0].sets.length, 2);
  eq('order preserved', p.sessions[0].sets[1].sec, 52);
  eq('session start stays at the first set', p.sessions[0].t, T(1));
}

console.log('recordPlankSet — a zero-length attempt is NEVER recorded:');
{
  reset();
  eq('0s rejected', DB.recordPlankSet('s1', 0, { at: T(1) }), null);
  eq('sub-second rejected', DB.recordPlankSet('s1', 0.9, { at: T(1) }), null);
  eq('negative rejected', DB.recordPlankSet('s1', -5, { at: T(1) }), null);
  eq('garbage rejected', DB.recordPlankSet('s1', 'x', { at: T(1) }), null);
  eq('nothing stored at all', DB.getPlanks().sessions.length, 0);
  // and a real hold after the rejects still lands
  DB.recordPlankSet('s1', 12, { at: T(1) });
  eq('real hold still records', DB.getPlanks().sessions[0].sets.length, 1);
}

console.log('recordPlankSet — seconds are floored, never rounded up:');
{
  reset();
  DB.recordPlankSet('s1', 59.9, { at: T(1) });
  eq('59.9 -> 59 (never credits time not held)', DB.getPlanks().sessions[0].sets[0].sec, 59);
}

/* ---------- personal best ---------- */
console.log('plankBest — best single hold across every session:');
{
  reset();
  eq('no data -> null', DB.plankBest(), null);
  DB.recordPlankSet('s1', 40, { at: T(1) });
  DB.recordPlankSet('s1', 65, { at: T(1) + 1000 });
  DB.recordPlankSet('s2', 55, { at: T(2) });
  const best = DB.plankBest();
  eq('best sec', best.sec, 65);
  eq('best timestamped', best.at, T(1) + 1000);
}

console.log('isPlankPB — beats the record, evaluated BEFORE recording:');
{
  reset();
  eq('first ever hold is not a "new PB"', DB.isPlankPB(30), false);
  DB.recordPlankSet('s1', 30, { at: T(1) });
  eq('equal to best is not a PB', DB.isPlankPB(30), false);
  eq('below best is not a PB', DB.isPlankPB(29), false);
  eq('above best IS a PB', DB.isPlankPB(31), true);
}

/* ---------- progress / history ---------- */
console.log('plankProgress — one point per session, oldest first:');
{
  reset();
  DB.recordPlankSet('s1', 30, { at: T(1) });
  DB.recordPlankSet('s1', 40, { at: T(1) + 1000 });
  DB.recordPlankSet('s2', 50, { at: T(2) });
  const pts = DB.plankProgress();
  eq('two points', pts.length, 2);
  eq('oldest first', pts[0].t < pts[1].t, true);
  eq('session best', pts[0].best, 40);
  eq('session total', pts[0].total, 70);
  eq('session set count', pts[0].sets, 2);
}

console.log('plankStats — the numbers the screen shows:');
{
  reset();
  eq('empty is safe', DB.plankStats().sessions, 0);
  DB.recordPlankSet('s1', 30, { at: T(1) });
  DB.recordPlankSet('s1', 40, { at: T(1) + 1000 });
  DB.recordPlankSet('s2', 50, { at: T(2) });
  const st = DB.plankStats();
  eq('sessions', st.sessions, 2);
  eq('total sets', st.totalSets, 3);
  eq('total seconds held', st.totalSec, 120);
  eq('best', st.best.sec, 50);
  eq('last session is the newest', st.last.t, T(2));
}

console.log('side records, history, progress, and stats stay separate from front:');
{
  reset();
  store['wt_planks_v1'] = JSON.stringify({ sessions: [{ id: 'legacy', t: T(1), sets: [{ sec: 92, at: T(1) }] }] });
  eq('side hold cannot be appended to front session id', DB.recordPlankSet('legacy', 30, { at: T(1) + 1000, mode: 'side', side: 'L' }), null);
  DB.recordPlankSet('side1', 60, { at: T(2), mode: 'side', side: 'L' });
  DB.recordPlankSet('side1', 45, { at: T(2) + 1000, mode: 'side', side: 'R' });
  DB.recordPlankSet('side2', 40, { at: T(3), mode: 'side', side: 'L' });
  eq('legacy session without mode is front', DB.getPlankSessions('front')[0].id, 'legacy');
  eq('default front record excludes side holds', DB.plankBest().sec, 92);
  eq('side left record', DB.plankBest('side', 'L').sec, 60);
  eq('side right record', DB.plankBest('side', 'R').sec, 45);
  eq('side record without side is strongest side', DB.plankBest('side').sec, 60);
  eq('left PB compares with left only', DB.isPlankPB(55, 'side', 'L'), false);
  eq('right PB compares with right only', DB.isPlankPB(50, 'side', 'R'), true);
  eq('front PB ignores side records', DB.isPlankPB(91, 'front'), false);
  const sideSessions = DB.getPlankSessions('side');
  eq('side history contains only side sessions', sideSessions.length, 2);
  eq('newest side session first', sideSessions[0].id, 'side2');
  eq('side mode persisted', sideSessions[1].mode, 'side');
  eq('side label persisted on hold', sideSessions[1].sets[0].side, 'L');
  const front = DB.plankProgress('front');
  eq('front chart contains only legacy front session', front.length, 1);
  eq('front chart sees legacy best', front[0].best, 92);
  const side = DB.plankProgress('side');
  eq('side chart has both side sessions', side.length, 2);
  eq('weaker side best for complete session', side[0].best, 45);
  eq('one-sided session weaker best is zero', side[1].best, 0);
  eq('one-sided session stays in chart', side[1].sets, 1);
  eq('side stats count only side sessions', DB.plankStats('side').sessions, 2);
  eq('side stats total hold seconds', DB.plankStats('side').totalSec, 145);
  eq('side stats count recorded holds', DB.plankStats('side').totalSets, 3);
  eq('side stats best hold', DB.plankStats('side').best.sec, 60);
}

console.log('getPlankSessions — newest first, sets intact:');
{
  reset();
  DB.recordPlankSet('s1', 30, { at: T(1) });
  DB.recordPlankSet('s2', 50, { at: T(2) });
  const list = DB.getPlankSessions();
  eq('newest first', list[0].id, 's2');
  eq('older second', list[1].id, 's1');
}

console.log('deletePlankSession:');
{
  reset();
  DB.recordPlankSet('s1', 30, { at: T(1) });
  DB.recordPlankSet('s2', 50, { at: T(2) });
  DB.deletePlankSession('s1');
  const list = DB.getPlankSessions();
  eq('one left', list.length, 1);
  eq('the right one left', list[0].id, 's2');
}

/* ---------- preferences (sets + rest carry over) ---------- */
console.log('plank prefs — sets/rest remembered between sessions:');
{
  reset();
  const d = DB.plankPrefs();
  eq('default sets', d.targetSets, DB.PLANK_DEFAULTS.targetSets);
  eq('default rest', d.restSec, DB.PLANK_DEFAULTS.restSec);
  DB.setPlankPrefs({ targetSets: 4, restSec: 90 });
  eq('sets saved', DB.plankPrefs().targetSets, 4);
  eq('rest saved', DB.plankPrefs().restSec, 90);
  eq('nonsense sets ignored', (DB.setPlankPrefs({ targetSets: 0 }), DB.plankPrefs().targetSets), 4);
  eq('nonsense rest ignored', (DB.setPlankPrefs({ restSec: -1 }), DB.plankPrefs().restSec), 90);
  eq('default mode is front', DB.plankPrefs().mode, 'front');
  DB.setPlankPrefs({ mode: 'side' });
  eq('mode saved', DB.plankPrefs().mode, 'side');
  eq('mode exposed on plank doc', DB.getPlanks().mode, 'side');
  DB.setPlankPrefs({ mode: 'unknown' });
  eq('invalid mode ignored', DB.plankPrefs().mode, 'side');
}

/* ---------- cloud sync ---------- */
console.log('snapshot / applyRemote — planks ride the cloud doc:');
{
  reset();
  DB.recordPlankSet('s1', 42, { at: T(1) });
  const snap = DB.snapshot();
  ok('planks present in the pushed snapshot', !!snap.planks && snap.planks.sessions.length === 1);
  ok('existing fields untouched', 'plans' in snap && 'sessions' in snap && 'weights' in snap && 'goal' in snap);

  // a remote doc replaces local planks, and unknown future fields survive verbatim
  reset();
  DB.applyRemote({ plans: [], sessions: [], planks: { sessions: [{ id: 'r1', t: T(3), sets: [{ sec: 88, at: T(3) }] }] }, futureThing: { x: 1 } }, T(3));
  eq('remote planks applied', DB.plankBest().sec, 88);
  const extra = JSON.parse(store['wt_remote_extra_v1']);
  ok('unknown field preserved verbatim', extra.futureThing && extra.futureThing.x === 1);
  ok('planks is NOT treated as unknown', !('planks' in extra));
}

console.log('applyRemote — a doc with no planks key leaves local planks alone (old client):');
{
  reset();
  DB.recordPlankSet('s1', 42, { at: T(1) });
  DB.applyRemote({ plans: [], sessions: [] }, T(2));
  eq('local plank survives a plank-less remote doc', DB.plankBest().sec, 42);
}

console.log('applyRemote — an explicit null planks clears them (deleted elsewhere):');
{
  reset();
  DB.recordPlankSet('s1', 42, { at: T(1) });
  DB.applyRemote({ plans: [], sessions: [], planks: null }, T(2));
  eq('cleared', DB.plankBest(), null);
}

console.log('recording marks data dirty so the next push carries it:');
{
  reset();
  DB.recordPlankSet('s1', 20, { at: T(1) });
  ok('updatedAt stamped', DB.getUpdatedAt() > 0);
}

/* ---------- forward/backward compatibility ---------- */
console.log('planks parked by an OLDER app version are adopted on boot:');
{
  reset();
  // simulate: this build did not know `planks`, so applyRemote parked it in extra
  store['wt_remote_extra_v1'] = JSON.stringify({ planks: { sessions: [{ id: 'p1', t: T(1), sets: [{ sec: 77, at: T(1) }] }] }, stillUnknown: 1 });
  const fresh = await import('../js/db.js?adopt=1'); // re-import runs the boot-time adopt
  eq('parked planks adopted into the real store', fresh.plankBest().sec, 77);
  const extra = JSON.parse(store['wt_remote_extra_v1']);
  ok('adopted key removed from extra', !('planks' in extra));
  ok('genuinely unknown key kept', extra.stillUnknown === 1);
}

/* ---------- up-next rotation is untouched by plank ---------- */
console.log('Up Next never sees plank:');
{
  reset();
  store['wt_plans_v1'] = JSON.stringify([
    { id: 'p1', name: 'Push', exercises: [{ id: 'a', name: 'Bench Press', kind: 'strength' }] },
    { id: 'p2', name: 'Pull', exercises: [{ id: 'b', name: 'Lat Pulldown', kind: 'strength' }] },
  ]);
  store['wt_sessions_v1'] = JSON.stringify([
    { id: 'x1', planId: 'p1', startedAt: T(1), entries: [{ name: 'Bench Press', kind: 'strength', sets: [{ reps: 5, weight: 60 }] }] },
  ]);
  const before = DB.nextPlanId();
  eq('after Push, Pull is next', before, 'p2');
  DB.recordPlankSet('pk1', 120, { at: T(2) });
  DB.recordPlankSet('pk1', 130, { at: T(2) + 1000 });
  eq('a plank session does NOT advance the rotation', DB.nextPlanId(), before);
  eq('plank added no workout session', JSON.parse(store['wt_sessions_v1']).length, 1);
}

/* ---------- the hold / rest / set state machine (pure, so backgrounding is testable) ---------- */
const S = 1000;
console.log('newPlankRun — opens ready for set 1:');
{
  const r = DB.newPlankRun({ targetSets: 3, restSec: 60 }, T(1));
  eq('phase', r.phase, 'ready');
  eq('set index', r.setIndex, 0);
  eq('target sets', r.targetSets, 3);
  eq('rest', r.restSec, 60);
  eq('no holds yet', r.sets.length, 0);
  ok('has an id to record against', typeof r.id === 'string' && r.id.length > 0);
}

console.log('side plank — left hold enters the timestamped switch:');
{
  let r = DB.newPlankRun({ targetSets: 2, restSec: 60, mode: 'side' }, T(1));
  eq('switch duration constant', DB.PLANK_SWITCH_SEC, 5);
  eq('side run starts on left', r.side, 'L');
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 45 * S);
  eq('left stop enters switch', r.phase, 'switch');
  eq('right side is next', r.side, 'R');
  eq('left hold saved with side', r.sets[0] && r.sets[0].side, 'L');
  eq('switch ends in five seconds', r.switchEndAt, T(1) + 50 * S);
  const switchSec = (run, now) => typeof DB.plankSwitchSec === 'function' ? DB.plankSwitchSec(run, now) : undefined;
  eq('switch countdown starts at five', switchSec(r, T(1) + 45 * S), 5);
  eq('switch countdown rounds up', switchSec(r, T(1) + 47 * S + 1), 3);
  eq('switch countdown reaches zero', switchSec(r, r.switchEndAt), 0);
}

console.log('side plank — switch starts right hold at deadline, then rest and next pair:');
{
  let r = DB.newPlankRun({ targetSets: 2, restSec: 30, mode: 'side' }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 45 * S);
  const switchEnd = r.switchEndAt;
  r = DB.plankStep(r, { type: 'tick' }, switchEnd);
  eq('switch deadline starts right hold', r.phase, 'hold');
  eq('right hold starts at switch deadline', r.startAt, switchEnd);
  eq('right side active', r.side, 'R');
  eq('right-start event emitted once', r.lastEvent, 'rightStarted');
  eq('right hold starts at zero elapsed', DB.plankHoldSec(r, switchEnd), 0);
  r = DB.plankStep(r, { type: 'stop' }, switchEnd + 40 * S);
  eq('right stop begins rest', r.phase, 'rest');
  eq('completed pair advances set index', r.setIndex, 1);
  eq('next pair starts on left', r.side, 'L');
  eq('both side holds saved', r.sets.length, 2);
  eq('right hold saved with side', r.sets[1] && r.sets[1].side, 'R');
  eq('normal rest begins after right hold', r.restEndAt, switchEnd + 70 * S);
  r = DB.plankStep(r, { type: 'skipRest' }, switchEnd + 41 * S);
  eq('next set ready after rest skip', r.phase, 'ready');
  eq('next set remains left', r.side, 'L');
}

console.log('side plank — switch can be skipped and right hold starts now:');
{
  let r = DB.newPlankRun({ targetSets: 2, restSec: 30, mode: 'side' }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 45 * S);
  r = DB.plankStep(r, { type: 'skipSwitch' }, T(1) + 47 * S);
  eq('skip enters right hold', r.phase, 'hold');
  eq('skipped right hold starts now', r.startAt, T(1) + 47 * S);
  eq('right side active', r.side, 'R');
  eq('right-start event emitted', r.lastEvent, 'rightStarted');

  let late = DB.newPlankRun({ targetSets: 2, restSec: 30, mode: 'side' }, T(1));
  late = DB.plankStep(late, { type: 'start' }, T(1));
  late = DB.plankStep(late, { type: 'stop' }, T(1) + 45 * S);
  const deadline = late.switchEndAt;
  late = DB.plankStep(late, { type: 'skipSwitch' }, deadline + 2 * S);
  eq('late skip enters right hold', late.phase, 'hold');
  eq('late skip starts at expired switch deadline', late.startAt, deadline);
  let abandoned = DB.newPlankRun({ targetSets: 2, restSec: 30, mode: 'side' }, T(1));
  abandoned = DB.plankStep(abandoned, { type: 'start' }, T(1));
  abandoned = DB.plankStep(abandoned, { type: 'stop' }, T(1) + 45 * S);
  abandoned = DB.plankStep(abandoned, { type: 'skipSwitch' }, abandoned.switchEndAt + DB.PLANK_ABANDON_MS + 1);
  eq('late skip past abandon limit returns ready', abandoned.phase, 'ready');
  eq('late skip past limit abandons right hold', abandoned.lastEvent, 'abandoned');
}

console.log('side plank — mis-taps and cancels keep current side and set:');
{
  let r = DB.newPlankRun({ targetSets: 2, restSec: 30, mode: 'side' }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 300);
  eq('left mis-tap returns ready', r.phase, 'ready');
  eq('left mis-tap stays left', r.side, 'L');
  eq('left mis-tap stores nothing', r.sets.length, 0);
  r = DB.plankStep(r, { type: 'start' }, T(1) + S);
  r = DB.plankStep(r, { type: 'cancel' }, T(1) + 4 * S);
  eq('left cancel returns ready', r.phase, 'ready');
  eq('left cancel stays left', r.side, 'L');
  eq('left cancel stores nothing', r.sets.length, 0);
  r = DB.plankStep(r, { type: 'start' }, T(1) + 5 * S);
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 50 * S);
  r = DB.plankStep(r, { type: 'skipSwitch' }, T(1) + 51 * S);
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 51300);
  eq('right mis-tap returns ready', r.phase, 'ready');
  eq('right mis-tap stays right', r.side, 'R');
  eq('right mis-tap keeps left hold only', r.sets.length, 1);
  r = DB.plankStep(r, { type: 'start' }, T(1) + 52 * S);
  r = DB.plankStep(r, { type: 'cancel' }, T(1) + 55 * S);
  eq('right cancel returns ready', r.phase, 'ready');
  eq('right cancel stays right', r.side, 'R');
  eq('right cancel keeps left hold only', r.sets.length, 1);
  eq('left record remains intact', r.sets[0].side, 'L');
}

console.log('side plank — switch resumes before and after deadline:');
{
  let r = DB.newPlankRun({ targetSets: 2, restSec: 30, mode: 'side' }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 45 * S);
  const end = r.switchEndAt;
  const mid = DB.plankResume(r, end - 2 * S);
  eq('mid-switch remains switching', mid.phase, 'switch');
  eq('mid-switch deadline stays fixed', mid.switchEndAt, end);
  const late = DB.plankResume(r, end + 8 * S);
  eq('expired switch resumes in right hold', late.phase, 'hold');
  eq('right hold uses exact switch end as start', late.startAt, end);
  eq('expired switch resumes right side', late.side, 'R');
  eq('expired switch emits right-start event', late.lastEvent, 'rightStarted');
  const abandoned = DB.plankResume(r, end + DB.PLANK_ABANDON_MS + 1);
  eq('right hold past abandon limit returns ready', abandoned.phase, 'ready');
  eq('abandoned right side stays selected', abandoned.side, 'R');
  eq('abandoned right hold is not added', abandoned.sets.length, 1);
  eq('left hold remains saved', abandoned.sets[0].side, 'L');
}

console.log('side plank — finish during switch and add set resumes missing right side:');
{
  let r = DB.newPlankRun({ targetSets: 2, restSec: 30, mode: 'side' }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 45 * S);
  r = DB.plankStep(r, { type: 'finish' }, T(1) + 46 * S);
  eq('finish ends from switch', r.phase, 'done');
  r = DB.plankStep(r, { type: 'addSet' }, T(1) + 47 * S);
  eq('partial set remains within original target', r.targetSets, 2);
  eq('added set resumes same partial pair on right', r.side, 'R');
  eq('partial left hold is retained', r.sets.length, 1);
  eq('right hold is ready to start', r.phase, 'ready');
}

console.log('start -> hold, and the clock runs off an absolute timestamp:');
{
  let r = DB.newPlankRun({ targetSets: 3, restSec: 60 }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  eq('phase', r.phase, 'hold');
  eq('startAt stamped', r.startAt, T(1));
  eq('elapsed at 0s', DB.plankHoldSec(r, T(1)), 0);
  eq('elapsed at 47.9s floors to 47', DB.plankHoldSec(r, T(1) + 47900), 47);
  // the phone slept for 5 minutes mid-hold: the clock is still right on return
  eq('survives backgrounding (no drift)', DB.plankHoldSec(r, T(1) + 300 * S), 300);
}

console.log('stop -> the hold is recorded and rest begins:');
{
  let r = DB.newPlankRun({ targetSets: 3, restSec: 60 }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 45 * S);
  eq('phase', r.phase, 'rest');
  eq('event', r.lastEvent, 'recorded');
  eq('one hold', r.sets.length, 1);
  eq('hold length', r.sets[0].sec, 45);
  eq('advanced to set 2', r.setIndex, 1);
  eq('rest ends 60s later', r.restEndAt, T(1) + 45 * S + 60 * S);
}

console.log('stop on a mis-tap -> nothing recorded, still on the same set:');
{
  let r = DB.newPlankRun({ targetSets: 3, restSec: 60 }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 300); // 0.3s
  eq('phase back to ready', r.phase, 'ready');
  eq('event', r.lastEvent, 'discarded');
  eq('no hold recorded', r.sets.length, 0);
  eq('still set 1', r.setIndex, 0);
  eq('no rest started', r.restEndAt, 0);
}

console.log('cancel — abandon a hold on purpose, record nothing:');
{
  let r = DB.newPlankRun({ targetSets: 3, restSec: 60 }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'cancel' }, T(1) + 90 * S); // a real 90s hold, thrown away
  eq('phase', r.phase, 'ready');
  eq('nothing recorded', r.sets.length, 0);
  eq('still set 1', r.setIndex, 0);
  eq('event', r.lastEvent, 'cancelled');
}

console.log('rest — skip, nudge, and auto-advance when it runs out:');
{
  let r = DB.newPlankRun({ targetSets: 3, restSec: 60 }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 40 * S);
  const restStart = T(1) + 40 * S;
  eq('rest remaining', DB.plankRestSec(r, restStart), 60);
  eq('rest counts down', DB.plankRestSec(r, restStart + 25 * S), 35);
  eq('never negative', DB.plankRestSec(r, restStart + 999 * S), 0);

  let n = DB.plankStep(r, { type: 'nudgeRest', delta: 15 }, restStart);
  eq('+15s', DB.plankRestSec(n, restStart), 75);
  n = DB.plankStep(n, { type: 'nudgeRest', delta: -15 }, restStart);
  eq('-15s', DB.plankRestSec(n, restStart), 60);
  n = DB.plankStep(n, { type: 'nudgeRest', delta: -600 }, restStart);
  ok('cannot be nudged into the past', DB.plankRestSec(n, restStart) >= 1);

  const skipped = DB.plankStep(r, { type: 'skipRest' }, restStart + 5 * S);
  eq('skip -> ready for the next set', skipped.phase, 'ready');
  eq('skip does not lose the recorded hold', skipped.sets.length, 1);

  const ticked = DB.plankStep(r, { type: 'tick' }, restStart + 61 * S);
  eq('rest over -> ready', ticked.phase, 'ready');
  eq('event tells the UI to beep', ticked.lastEvent, 'restDone');
  eq('a tick before rest ends changes nothing', DB.plankStep(r, { type: 'tick' }, restStart + 5 * S).phase, 'rest');
}

console.log('the last set finishes the session — no trailing rest:');
{
  let r = DB.newPlankRun({ targetSets: 2, restSec: 60 }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 30 * S);
  eq('after set 1 -> rest', r.phase, 'rest');
  r = DB.plankStep(r, { type: 'skipRest' }, T(1) + 31 * S);
  r = DB.plankStep(r, { type: 'start' }, T(1) + 40 * S);
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 80 * S);
  eq('after the last set -> done', r.phase, 'done');
  eq('no rest after the last set', r.restEndAt, 0);
  eq('both holds kept', r.sets.length, 2);
}

console.log('rest of 0 skips the countdown entirely:');
{
  let r = DB.newPlankRun({ targetSets: 3, restSec: 0 }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 30 * S);
  eq('straight to ready', r.phase, 'ready');
}

console.log('one more set — extend a finished session instead of starting a new one:');
{
  let r = DB.newPlankRun({ targetSets: 1, restSec: 30 }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 30 * S);
  eq('done', r.phase, 'done');
  r = DB.plankStep(r, { type: 'addSet' }, T(1) + 31 * S);
  eq('ready again', r.phase, 'ready');
  eq('target grew', r.targetSets, 2);
  eq('same session id (sets keep grouping together)', r.sets.length, 1);
}

console.log('finish — end early from anywhere, keeping what was held:');
{
  let r = DB.newPlankRun({ targetSets: 5, restSec: 60 }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  r = DB.plankStep(r, { type: 'stop' }, T(1) + 30 * S);
  r = DB.plankStep(r, { type: 'finish' }, T(1) + 35 * S);
  eq('done', r.phase, 'done');
  eq('kept the hold', r.sets.length, 1);
  eq('rest cleared', r.restEndAt, 0);
}

console.log('plankResume — coming back to an interrupted run:');
{
  let r = DB.newPlankRun({ targetSets: 3, restSec: 60 }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  // back after 4 minutes: still a plausible hold, keep counting
  const soon = DB.plankResume(r, T(1) + 4 * 60 * S);
  eq('still holding', soon.phase, 'hold');
  eq('same start', soon.startAt, T(1));
  // back the next day: nobody planked overnight — drop it, record NOTHING
  const late = DB.plankResume(r, T(2));
  eq('abandoned', late.phase, 'ready');
  eq('nothing invented', late.sets.length, 0);
  eq('still on set 1', late.setIndex, 0);

  // a rest that ran out while away just opens the next set
  let q = DB.plankStep(DB.plankStep(DB.newPlankRun({ targetSets: 3, restSec: 60 }, T(1)), { type: 'start' }, T(1)), { type: 'stop' }, T(1) + 30 * S);
  eq('rest expired while away -> ready', DB.plankResume(q, T(1) + 600 * S).phase, 'ready');
  eq('rest still running -> rest', DB.plankResume(q, T(1) + 40 * S).phase, 'rest');
  eq('a finished run resumes as done', DB.plankResume({ ...q, phase: 'done' }, T(2)).phase, 'done');
  eq('null-safe', DB.plankResume(null, T(1)), null);
}

/* ---------- backup / reset carry plank data ---------- */
console.log('resetAll — wipes planks too (Danger zone says "everything"):');
{
  reset();
  DB.recordPlankSet('s1', 42, { at: T(1) });
  DB.resetAll();
  eq('planks gone', DB.plankBest(), null);
  eq('plank store cleared, not left as a husk', DB.getPlanks().sessions.length, 0);
}

console.log('exportAll / importAll — a backup carries planks (and weights + goal):');
{
  reset();
  DB.recordPlankSet('s1', 42, { at: T(1) });
  DB.addWeight(70.5, { t: T(1) });
  DB.setGoal({ name: 'g', startKg: 76, targetKg: 72, endDate: '2099-01-01' });
  store['wt_plans_v1'] = JSON.stringify([{ id: 'p1', name: 'Push', exercises: [] }]);
  const backup = JSON.parse(DB.exportAll());
  ok('planks in the backup', backup.planks && backup.planks.sessions.length === 1);
  ok('weights in the backup', backup.weights && backup.weights.entries.length === 1);
  ok('goal in the backup', backup.goal && backup.goal.targetKg === 72);

  reset();
  DB.importAll(JSON.stringify(backup));
  eq('plank record restored', DB.plankBest().sec, 42);
  eq('weight restored', DB.getWeights().entries.length, 1);
  eq('goal restored', DB.getGoal().targetKg, 72);
}

console.log('importAll — an OLD backup with no planks key is still accepted:');
{
  reset();
  DB.recordPlankSet('s1', 42, { at: T(1) });
  DB.importAll(JSON.stringify({ plans: [{ id: 'p', name: 'X', exercises: [] }], sessions: [], v: 1 }));
  eq('plans imported', DB.getPlans().length, 1);
  eq('existing planks untouched by a plank-less backup', DB.plankBest().sec, 42);
}

/* ---------- offline merge (what sync.js does on pull) ---------- */
console.log('mergePlankDoc — a plank logged offline survives a remote pull:');
{
  const remote = { sessions: [{ id: 'r1', t: T(1), sets: [{ sec: 30, at: T(1) }] }] };
  const local = {
    sessions: [
      { id: 'r1', t: T(1), sets: [{ sec: 30, at: T(1) }] },
      { id: 'l1', t: T(2), sets: [{ sec: 44, at: T(2) }] }, // logged offline
    ],
  };
  const m = DB.mergePlankDoc(remote, local);
  eq('offline session merged in', m.sessions.length, 2);
  ok('the offline hold is there', m.sessions.some((s) => s.id === 'l1' && s.sets[0].sec === 44));
}

console.log('mergePlankDoc — two devices adding sets to the SAME session keep both:');
{
  const remote = { sessions: [{ id: 'x', t: T(1), sets: [{ sec: 30, at: T(1) }, { sec: 35, at: T(1) + 60000 }] }] };
  const local = { sessions: [{ id: 'x', t: T(1), sets: [{ sec: 30, at: T(1) }, { sec: 50, at: T(1) + 120000 }] }] };
  const m = DB.mergePlankDoc(remote, local);
  eq('one session', m.sessions.length, 1);
  eq('all three distinct holds kept', m.sessions[0].sets.length, 3);
  eq('sets ordered by time', m.sessions[0].sets[2].sec, 50);
  ok('the duplicate was not doubled', m.sessions[0].sets.filter((s) => s.sec === 30).length === 1);
}

console.log('mergePlankDoc — equal-time equal-length side holds remain distinct:');
{
  const at = T(1);
  const remote = { sessions: [{ id: 'side', mode: 'side', t: at, sets: [{ sec: 45, at, side: 'L' }] }] };
  const local = { sessions: [{ id: 'side', mode: 'side', t: at, sets: [{ sec: 45, at, side: 'L' }, { sec: 45, at, side: 'R' }] }] };
  const m = DB.mergePlankDoc(remote, local);
  eq('left and right remain two sets', m.sessions[0].sets.length, 2);
  ok('left side kept', m.sessions[0].sets.some((s) => s.side === 'L'));
  ok('right side kept', m.sessions[0].sets.some((s) => s.side === 'R'));
}

console.log('mergePlankDoc — nothing local to add leaves the remote doc untouched:');
{
  const remote = { sessions: [{ id: 'r1', t: T(1), sets: [{ sec: 30, at: T(1) }] }] };
  const m = DB.mergePlankDoc(remote, { sessions: [] });
  eq('unchanged', m.sessions.length, 1);
  eq('no phantom merge', DB.mergePlankDoc(remote, null).sessions.length, 1);
}

console.log('mergePlankDoc — remote has no plank doc yet, local does:');
{
  const local = { sessions: [{ id: 'l1', t: T(2), sets: [{ sec: 44, at: T(2) }] }], targetSets: 4, restSec: 90 };
  const m = DB.mergePlankDoc(null, local);
  eq('local doc adopted whole', m.sessions.length, 1);
  eq('prefs came along', m.targetSets, 4);
}

console.log('mergePlankDoc — a remote-side deletion is respected when local has nothing new:');
{
  // local === what we last pushed; remote dropped a session on another device
  const remote = { sessions: [{ id: 'a', t: T(1), sets: [{ sec: 30, at: T(1) }] }] };
  const local = { sessions: [{ id: 'a', t: T(1), sets: [{ sec: 30, at: T(1) }] }] };
  eq('no resurrection of identical data', DB.mergePlankDoc(remote, local).sessions.length, 1);
}

/* ---------- formatting ---------- */
const UI = await import('../js/ui.js');
console.log('fmtHold — plank-length readout:');
{
  eq('under a minute', UI.fmtHold(47), '47s');
  eq('exactly a minute', UI.fmtHold(60), '1:00');
  eq('over a minute', UI.fmtHold(107), '1:47');
  eq('pads seconds', UI.fmtHold(65), '1:05');
  eq('zero', UI.fmtHold(0), '0s');
  eq('negative clamps', UI.fmtHold(-3), '0s');
}

console.log('plankStep — a hold left running 30+ min is dropped even when stopped on screen:');
{
  let r = DB.newPlankRun({ targetSets: 3, restSec: 60 }, T(1));
  r = DB.plankStep(r, { type: 'start' }, T(1));
  const s = DB.plankStep(r, { type: 'stop' }, T(1) + DB.PLANK_ABANDON_MS);
  eq('nothing recorded', s.sets.length, 0);
  eq('event', s.lastEvent, 'abandoned');
  eq('same set, ready again', s.phase, 'ready');
  eq('a reload exactly at the limit also drops it', DB.plankResume(r, T(1) + DB.PLANK_ABANDON_MS).lastEvent, 'abandoned');
  const ok29 = DB.plankStep(r, { type: 'stop' }, T(1) + DB.PLANK_ABANDON_MS - 60000);
  eq('a 29-minute hold still counts', ok29.lastEvent, 'recorded');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
