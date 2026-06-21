/* Unit tests for pure formatting helpers in js/ui.js.
   Run with `node tools/ui_test.mjs`. */
import { fmtDuration, summariseSets } from '../js/ui.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log(`  FAIL ${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); }
}

console.log('fmtDuration — minute carry at hour boundary:');
eq('38s', fmtDuration(38), '38s');
eq('42m', fmtDuration(2520), '42m');
eq('3599s -> 1h 00m (not 60m)', fmtDuration(3599), '1h 00m');
eq('7199s -> 2h 00m (not 1h 60m)', fmtDuration(7199), '2h 00m');
eq('3600s -> 1h 00m', fmtDuration(3600), '1h 00m');
eq('negative clamps', fmtDuration(-5), '0s');

console.log('summariseSets — uniform vs mixed:');
eq('all same w/ weight', summariseSets([{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }, { reps: 8, weight: 60 }]), '3×8 @ 60');
eq('all same bodyweight', summariseSets([{ reps: 10, weight: 0 }, { reps: 10, weight: 0 }]), '2×10');
eq('mixed WEIGHT -> per set', summariseSets([{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }, { reps: 8, weight: 70 }]), '8@60, 8@60, 8@70');
eq('mixed REPS -> per set', summariseSets([{ reps: 12, weight: 60 }, { reps: 10, weight: 60 }]), '12@60, 10@60');
eq('single set', summariseSets([{ reps: 10, weight: 20 }]), '1×10 @ 20');
eq('empty', summariseSets([]), '');
eq('no reps logged', summariseSets([{ reps: '', weight: 60 }]), '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
