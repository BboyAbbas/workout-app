/* Unit tests for the double-progression engine in js/db.js.
   Pure functions, no DOM/localStorage — run with `node tools/rec_test.mjs`. */
import { recommendNext, repRange, DEFAULT_INC, incFor, roundToStep } from '../js/db.js';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}
function eq(name, got, want) {
  ok(name + ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, got === want);
}

console.log('repRange:');
{
  const a = repRange({ repMin: 8, repMax: 12 });
  eq('explicit min', a.min, 8); eq('explicit max', a.max, 12);

  const b = repRange({ reps: 10 });            // legacy single target -> 70%..100%
  eq('legacy min', b.min, 7); eq('legacy max', b.max, 10);

  const c = repRange({ reps: 5 });             // strength target stays tight
  eq('legacy low min', c.min, 4); eq('legacy low max', c.max, 5);

  const d = repRange({ repMin: 15, repMax: 8 }); // inverted -> clamped
  ok('inverted clamped', d.min <= d.max);

  const e = repRange({});                        // nothing -> sane default
  eq('default max', e.max, 12);
}

console.log('recommendNext — first time:');
{
  const r = recommendNext(null, { min: 8, max: 12 });
  eq('dir', r.dir, 'first');
  eq('weight', r.weight, null);
}

console.log('recommendNext — graduate (all sets hit top):');
{
  const last = [{ reps: 12, weight: 60 }, { reps: 12, weight: 60 }, { reps: 12, weight: 60 }];
  const r = recommendNext(last, { min: 8, max: 12 });
  eq('dir', r.dir, 'up');
  eq('weight = +2.5', r.weight, 62.5);
}

console.log('recommendNext — hold (missed top on one set):');
{
  const last = [{ reps: 12, weight: 60 }, { reps: 10, weight: 60 }, { reps: 12, weight: 60 }];
  const r = recommendNext(last, { min: 8, max: 12 });
  eq('dir', r.dir, 'hold');
  eq('weight unchanged', r.weight, 60);
}

console.log('recommendNext — warm-up set is ignored:');
{
  // 40kg warm-up + two top sets at 60kg should still graduate the 60kg load
  const last = [{ reps: 5, weight: 40 }, { reps: 12, weight: 60 }, { reps: 12, weight: 60 }];
  const r = recommendNext(last, { min: 8, max: 12 });
  eq('dir', r.dir, 'up');
  eq('weight from top load', r.weight, 62.5);
}

console.log('recommendNext — exceeding the top still graduates:');
{
  const last = [{ reps: 14, weight: 50 }, { reps: 13, weight: 50 }];
  const r = recommendNext(last, { min: 8, max: 12 });
  eq('dir', r.dir, 'up');
  eq('weight', r.weight, 52.5);
}

console.log('recommendNext — bodyweight (no load) holds for reps:');
{
  const last = [{ reps: 8, weight: 0 }, { reps: 7, weight: 0 }];
  const r = recommendNext(last, { min: 5, max: 10 });
  eq('dir', r.dir, 'hold');
  eq('weight', r.weight, null);
}

console.log('recommendNext — custom increment:');
{
  const last = [{ reps: 8, weight: 100 }, { reps: 8, weight: 100 }];
  const r = recommendNext(last, { min: 5, max: 8 }, 5);
  eq('weight = +5', r.weight, 105);
}

console.log('recommendNext — needs ALL planned sets at top to graduate:');
{
  // only 1 of 3 planned sets logged at top -> must NOT bump the weight
  const one = recommendNext([{ reps: 12, weight: 100 }], { min: 8, max: 12 }, 2.5, 3);
  eq('1/3 sets -> hold', one.dir, 'hold');
  eq('1/3 weight held', one.weight, 100);
  // 2 of 3 -> still hold
  const two = recommendNext([{ reps: 12, weight: 100 }, { reps: 12, weight: 100 }], { min: 8, max: 12 }, 2.5, 3);
  eq('2/3 sets -> hold', two.dir, 'hold');
  // all 3 -> graduate
  const three = recommendNext(
    [{ reps: 12, weight: 100 }, { reps: 12, weight: 100 }, { reps: 12, weight: 100 }],
    { min: 8, max: 12 }, 2.5, 3);
  eq('3/3 sets -> up', three.dir, 'up');
  eq('3/3 weight +2.5', three.weight, 102.5);
}

console.log('recommendNext — bodyweight maxed (no load to add):');
{
  const last = [{ reps: 10, weight: 0 }, { reps: 10, weight: 0 }, { reps: 10, weight: 0 }];
  const r = recommendNext(last, { min: 5, max: 10 }, 2.5, 3);
  eq('dir', r.dir, 'hold');
  eq('weight', r.weight, null);
  ok('note mentions bodyweight/resistance', /bodyweight|resistance/i.test(r.note));
}

console.log('recommendNext — bodyweight not yet maxed:');
{
  const r = recommendNext([{ reps: 7, weight: 0 }], { min: 5, max: 10 }, 2.5, 3);
  eq('dir', r.dir, 'hold');
  ok('note says aim', /aim/i.test(r.note));
}

console.log('incFor — dumbbell moves step by a real dumbbell, others 2.5:');
{
  eq('One-Arm DB Row -> 2', incFor({ name: 'One-Arm DB Row' }), 2);
  eq('DB Lateral Raises -> 2', incFor({ name: 'DB Lateral Raises' }), 2);
  eq('Goblet Squat -> 2', incFor({ name: 'Goblet Squat' }), 2);
  eq('Bench Press -> 2.5', incFor({ name: 'Bench Press' }), 2.5);
  eq('Lat Pulldown -> 2.5', incFor({ name: 'Lat Pulldown' }), 2.5);
  eq('explicit inc wins', incFor({ name: 'One-Arm DB Row', inc: 5 }), 5);
}

console.log('roundToStep — snaps to a loadable weight:');
{
  eq('18 on a 2kg step', roundToStep(18, 2), 18);
  eq('18.5 snaps to 18 on 2kg', roundToStep(18.5, 2), 18);
  eq('92.5 on a 2.5 step', roundToStep(92.5, 2.5), 92.5);
}

console.log('recommendNext — dumbbell graduates to a REAL weight (16 -> 18, not 18.5):');
{
  const last = [{ reps: 12, weight: 16 }, { reps: 12, weight: 16 }, { reps: 12, weight: 16 }];
  const r = recommendNext(last, { min: 8, max: 12 }, incFor({ name: 'One-Arm DB Row' }), 3);
  eq('dir', r.dir, 'up');
  eq('weight = real 18kg DB (not 18.5)', r.weight, 18);
}

console.log('DEFAULT_INC is 2.5:');
eq('inc', DEFAULT_INC, 2.5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
