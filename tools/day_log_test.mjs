/* Unit tests for workout links (planks / intervals done during a workout carry
   its id) and for tools/day_log.mjs. Run with `node tools/day_log_test.mjs`. */
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const DB = await import('../js/db.js');
const { dayLog, formatDayLog } = await import('./day_log.mjs');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } }
function eq(name, got, want) { ok(`${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, got === want); }
function reset() { for (const k of Object.keys(store)) delete store[k]; }
const at = (day, h, m = 0) => new Date(2026, 8, day, h, m).getTime(); // Sep <day> 2026, local time
const cfg44 = { warmSec: 600, hardSec: 240, easySec: 180, rounds: 4, coolSec: 300 };

console.log('links — planks and intervals recorded while a workout is open carry its id:');
{
  reset();
  DB.setActive({ id: 'w1', planId: 'p', planName: 'Push', startedAt: at(24, 16), entries: {} });
  DB.recordPlankSet('pk1', 60, { at: at(24, 16, 30) });
  DB.recordPlankSet('pk1', 55, { at: at(24, 16, 33) });
  DB.recordIntervalSession({ id: 'iv1', t: at(24, 17), preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 4, pace: null });
  const pk = DB.getPlanks().sessions[0], iv = DB.getIntervalSessions()[0];
  eq('plank linked', pk.workoutId, 'w1');
  eq('plank names the plan', pk.workoutPlan, 'Push');
  eq('interval linked', iv.workoutId, 'w1');
  DB.setActive(null);
  DB.recordPlankSet('pk2', 70, { at: at(24, 22) });
  DB.recordIntervalSession({ id: 'iv2', t: at(25, 9), preset: '4x4', machine: 'bike', cfg: cfg44, roundsDone: 4, pace: null });
  eq('plank with no workout open has no link', DB.getPlanks().sessions.find((s) => s.id === 'pk2').workoutId, undefined);
  eq('interval with no workout open has no link', DB.getIntervalSessions().find((s) => s.id === 'iv2').workoutId, undefined);
  DB.setActive({ planId: 'p', planName: 'Legs', startedAt: at(26, 8), entries: {} }); // older app: no id
  eq('an open workout without an id links nothing', DB.activeWorkoutLink(), null);
}

console.log('dayLog — nests linked sessions under their workout, keeps solo ones apart:');
{
  const data = {
    sessions: [
      { id: 'w1', planName: 'Push', startedAt: at(24, 16), durationSec: 3540,
        entries: [{ name: 'Bench Press', kind: 'strength', sets: [{ reps: 8, weight: 50 }, { reps: 7, weight: 50 }] }] },
      { id: 'w2', planName: 'Cardio', startedAt: at(25, 16), durationSec: 7,
        entries: [{ name: 'Incline Walk', kind: 'treadmill', sets: [{ minutes: 30, incline: 12, speed: 3 }] }] },
    ],
    planks: { sessions: [
      { id: 'pk1', t: at(24, 16, 30), sets: [{ sec: 60 }, { sec: 55 }], workoutId: 'w1', workoutPlan: 'Push' },
      { id: 'pk2', t: at(24, 22), sets: [{ sec: 70 }] },
      { id: 'pk3', t: at(23, 20), sets: [{ sec: 40 }], workoutId: 'gone', workoutPlan: 'Pull' },
    ] },
    intervals: { sessions: [
      { id: 'iv1', t: at(24, 17), preset: '4x4', machine: 'treadmill', cfg: cfg44, roundsDone: 4, hardSec: 960, totalSec: 2400, pace: 12, workoutId: 'w1' },
      { id: 'iv2', t: at(26, 9), preset: '4x4', machine: 'bike', cfg: cfg44, roundsDone: 3, hardSec: 720, totalSec: 2100, pace: null },
    ] },
  };
  const days = dayLog(data, { now: at(26, 23) });
  eq('four days, newest first', days.map((d) => d.date).join(), '2026-09-26,2026-09-25,2026-09-24,2026-09-23');
  const d24 = days.find((d) => d.date === '2026-09-24');
  eq('push day has one workout', d24.workouts.length, 1);
  eq('its plank is nested', d24.workouts[0].planks.map((p) => p.id).join(), 'pk1');
  eq('its interval is nested', d24.workouts[0].intervals.map((s) => s.id).join(), 'iv1');
  eq('the evening plank stays on its own', d24.alone.map((x) => x.id).join(), 'pk2');
  const d25 = days.find((d) => d.date === '2026-09-25');
  eq('cardio day reads as cardio only', d25.workouts[0].kind, 'cardio only');
  const d26 = days.find((d) => d.date === '2026-09-26');
  eq('interval-only day has no workout', d26.workouts.length, 0);
  eq('and one solo interval', d26.alone[0].type, 'interval');
  const d23 = days.find((d) => d.date === '2026-09-23');
  eq('a link to an unsaved workout falls back to solo', d23.alone[0].id, 'pk3');
  eq('last N days', dayLog(data, { days: 2, now: at(26, 23) }).length, 2);
  const text = formatDayLog(days);
  ok('text: push day headline', text.includes('2026-09-24 Thu — Push + plank + intervals · plank only'));
  ok('text: plank nested under the workout', /WORKOUT Push[\s\S]*\+ 16:30 during it: plank front · 2 holds \(1:00, 0:55\)/.test(text));
  ok('text: interval nested with pace', text.includes('during it: intervals Norwegian 4×4 · treadmill · 4/4 rounds · 16 min hard / 40 min total · 12 km/h'));
  ok('text: solo interval day', text.includes('2026-09-26 Sat — intervals only'));
  ok('text: cardio minutes and settings', text.includes('Incline Walk: 30 min · incline 12 · speed 3'));
  ok('text: orphan link explained', text.includes('(during a Pull workout that was never saved)'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
