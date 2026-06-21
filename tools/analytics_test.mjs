/* Unit tests for the insights/progress helpers in js/db.js.
   Installs an in-memory localStorage shim so the storage-backed helpers run
   under node. Run with `node tools/analytics_test.mjs`. */
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

function seed(sessions) { store['wt_sessions_v1'] = JSON.stringify(sessions); }
function sess(t, entries) { return { id: 'x' + t, planId: 'p', startedAt: t, durationSec: 1000, entries }; }
const D = (n) => 1_700_000_000_000 + n * 86400000; // day n

console.log('est1RM (Epley):');
eq('100x1', DB.est1RM(100, 1), 103);
eq('60x10', DB.est1RM(60, 10), 80);
eq('bodyweight -> 0', DB.est1RM(0, 12), 0);
eq('garbage -> 0', DB.est1RM('x', 'y'), 0);

console.log('isStalled:');
eq('<4 sessions never stalled', DB.isStalled([80, 82, 84]), false);
eq('peak older than last 3 -> stalled', DB.isStalled([84, 83, 82, 81]), true);
eq('new peak in last 3 -> not stalled', DB.isStalled([80, 81, 82, 84]), false);
eq('tie at peak in last 3 -> not stalled', DB.isStalled([84, 80, 82, 84]), false);

console.log('progressForExercise + metric:');
{
  seed([ // newest-first in storage; helper reverses to oldest-first
    sess(D(2), [{ name: 'Squat', sets: [{ reps: 12, weight: 60 }] }]),
    sess(D(1), [{ name: 'Squat', sets: [{ reps: 10, weight: 60 }, { reps: 8, weight: 60 }] }]),
  ]);
  const pts = DB.progressForExercise('squat'); // case-insensitive
  eq('two points', pts.length, 2);
  eq('oldest first', pts[0].t < pts[1].t, true);
  eq('point0 topReps', pts[0].topReps, 10);
  const m = DB.progressMetric(pts);
  eq('loaded', m.loaded, true);
  eq('values are est1RM', JSON.stringify(m.values), JSON.stringify([DB.est1RM(60, 10), DB.est1RM(60, 12)]));
}

console.log('progressMetric — bodyweight uses reps:');
{
  seed([
    sess(D(2), [{ name: 'Pull-Up', sets: [{ reps: 10, weight: 0 }] }]),
    sess(D(1), [{ name: 'Pull-Up', sets: [{ reps: 8, weight: 0 }] }]),
  ]);
  const m = DB.progressMetric(DB.progressForExercise('Pull-Up'));
  eq('not loaded', m.loaded, false);
  eq('reps series', JSON.stringify(m.values), JSON.stringify([8, 10]));
}

console.log('exerciseProgressSummary:');
{
  seed([
    sess(D(2), [{ name: 'Bench', sets: [{ reps: 5, weight: 80 }] }]),
    sess(D(1), [{ name: 'Bench', sets: [{ reps: 5, weight: 100 }] }]),
  ]);
  const rows = DB.exerciseProgressSummary();
  eq('one exercise', rows.length, 1);
  eq('best is the heavier session', rows[0].best, DB.est1RM(100, 5));
  eq('latest is most recent (lighter)', rows[0].latest, DB.est1RM(80, 5));
}

console.log('newPRsIn (call before saving):');
{
  seed([sess(D(1), [{ name: 'Squat', sets: [{ reps: 12, weight: 60 }] }])]); // prior best e1RM 84
  const beats = DB.newPRsIn([{ name: 'Squat', sets: [{ reps: 10, weight: 65 }] }]); // est1RM 87 > 84
  eq('one PR', beats.length, 1);
  eq('PR kind', beats[0].kind, '1RM');
  ok('PR value beats prior', beats[0].value > 84);
  const none = DB.newPRsIn([{ name: 'Squat', sets: [{ reps: 8, weight: 60 }] }]); // est1RM 76 < 84
  eq('no PR when below best', none.length, 0);
  const firstTime = DB.newPRsIn([{ name: 'BrandNew', sets: [{ reps: 5, weight: 50 }] }]);
  eq('first-ever logging is not a PR', firstTime.length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
