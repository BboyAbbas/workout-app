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

console.log('summariseSets — clear, units always, weight stated once:');
eq('uniform', summariseSets([{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }, { reps: 8, weight: 60 }]), '3 sets of 8 reps · 60 kg');
eq('uniform bodyweight', summariseSets([{ reps: 10, weight: 0 }, { reps: 10, weight: 0 }]), '2 sets of 10 reps');
eq('same weight, reps drop (the confusing case)', summariseSets([{ reps: 8, weight: 12.5 }, { reps: 8, weight: 12.5 }, { reps: 7, weight: 12.5 }]), '8, 8, 7 reps · 12.5 kg');
eq('mixed reps bodyweight', summariseSets([{ reps: 12, weight: 0 }, { reps: 10, weight: 0 }]), '12, 10 reps');
eq('weights differ -> per set', summariseSets([{ reps: 8, weight: 60 }, { reps: 6, weight: 80 }]), '8 reps · 60 kg, 6 reps · 80 kg');
eq('single set', summariseSets([{ reps: 10, weight: 20 }]), '1 set of 10 reps · 20 kg');
eq('empty', summariseSets([]), '');
eq('no reps logged', summariseSets([{ reps: '', weight: 60 }]), '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
