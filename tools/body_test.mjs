/* Unit tests for waist tracking in js/db.js and its offline merge in js/sync.js.
   Same in-memory localStorage shim as plank_test.mjs. Run with `node tools/body_test.mjs`. */
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

console.log('waist — entries, goal and height share the weights doc without touching weigh-ins:');
{
  reset();
  DB.addWeight(71.1, { t: T(0) });
  DB.setWeightTarget(64);
  DB.setHeight(169);
  DB.addWaist(89.5, { t: T(7) });
  DB.addWaist(91, { t: T(0), note: 'first' });
  DB.setWaistTarget(84.5);
  const w = DB.getWaist();
  eq('two waist entries', w.entries.length, 2);
  eq('sorted oldest first', w.entries[0].cm, 91);
  eq('note kept', w.entries[0].note, 'first');
  eq('goal stored', w.targetCm, 84.5);
  const doc = DB.getWeights();
  eq('weigh-ins untouched', doc.entries.length, 1);
  eq('weight target untouched', doc.targetKg, 64);
  eq('height stored', doc.heightCm, 169);
  DB.addWeight(70.9, { t: T(8) });
  eq('a later weigh-in keeps the waist log', DB.getWaist().entries.length, 2);
}

console.log('waist — edit, delete, clear goal:');
{
  reset();
  const a = DB.addWaist(91, { t: T(0) });
  const b = DB.addWaist(90, { t: T(1) });
  DB.updateWaist(b.id, { cm: 89.8, note: 'am' });
  eq('edit applied', DB.getWaist().entries[1].cm, 89.8);
  DB.deleteWaist(a.id);
  eq('delete applied', DB.getWaist().entries.map((e) => e.id).join(), b.id);
  DB.setWaistTarget(84.5);
  DB.setWaistTarget(null);
  eq('goal cleared', DB.getWaist().targetCm, null);
}

console.log('waist — empty and malformed docs read as empty:');
{
  reset();
  eq('no doc -> no entries', DB.getWaist().entries.length, 0);
  eq('no doc -> no goal', DB.getWaist().targetCm, null);
  store.wt_weights_v1 = JSON.stringify({ entries: [], waist: { entries: 'junk', targetCm: 'x' } });
  eq('junk entries -> empty', DB.getWaist().entries.length, 0);
  eq('junk goal -> null', DB.getWaist().targetCm, null);
}

console.log('waist — unknown sub-fields from a newer version survive a save:');
{
  reset();
  store.wt_weights_v1 = JSON.stringify({ entries: [], heightCm: 169, waist: { entries: [], targetCm: 84.5, hipsCm: 99 }, future: 1 });
  DB.addWaist(91, { t: T(0) });
  const raw = JSON.parse(store.wt_weights_v1);
  eq('waist sub-field kept', raw.waist.hipsCm, 99);
  eq('doc field kept', raw.future, 1);
}

console.log('waistToHeight:');
{
  eq('91 / 169', Math.round(DB.waistToHeight(91, 169) * 1000) / 1000, 0.538);
  eq('84.5 / 169 is exactly half', DB.waistToHeight(84.5, 169), 0.5);
  eq('no height -> null', DB.waistToHeight(91, null), null);
}

console.log('weightAt — interpolates any field:');
{
  const es = [{ t: T(0), v: 91 }, { t: T(10), v: 89 }];
  eq('midpoint', DB.weightAt(es, T(5), 'v'), 90);
  eq('default field is kg', DB.weightAt([{ t: T(0), kg: 70 }], T(3)), 70);
}

console.log('mergeWaistInto — unions unpushed local entries:');
{
  const local = { entries: [], waist: { entries: [{ id: 'a', t: 1, cm: 91 }, { id: 'b', t: 3, cm: 90 }], targetCm: 84.5 } };
  const remote = { entries: [], waist: { entries: [{ id: 'a', t: 1, cm: 91 }, { id: 'c', t: 2, cm: 90.5 }] } };
  eq('one added', DB.mergeWaistInto(remote, local), 1);
  eq('union sorted by time', remote.waist.entries.map((e) => e.id).join(), 'a,c,b');
  const bare = { entries: [] };
  eq('remote without waist takes the local log', DB.mergeWaistInto(bare, local), 2);
  eq('and its goal', bare.waist.targetCm, 84.5);
  eq('nothing local -> nothing added', DB.mergeWaistInto({ entries: [] }, { entries: [] }), 0);
}

console.log('sync.pull — a waist entry logged offline survives a newer cloud doc and is pushed:');
{
  reset();
  const SYNC = await import('../js/sync.js');
  const puts = [];
  const cloudAt = Date.now() + 60000;
  globalThis.fetch = async (u, opts = {}) => {
    if (opts.method === 'PUT') { puts.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ updatedAt: cloudAt, data: { plans: [], sessions: [],
      weights: { entries: [{ id: 'w1', t: T(0), kg: 71 }], targetKg: 64, heightCm: 169, waist: { entries: [{ id: 'cloud', t: T(0), cm: 91 }], targetCm: 84.5 } } } }) };
  };
  DB.addWaist(90.2, { t: T(1) });
  store.wt_pushed_at = '1'; // this device has work the cloud never saw
  const st = await SYNC.pull();
  await new Promise((r) => setTimeout(r, 50));
  eq('pull applied', st, 'applied');
  eq('local log holds both', DB.getWaist().entries.length, 2);
  eq('merged doc pushed once', puts.length, 1);
  eq('pushed doc carries both', puts[0] && puts[0].data.weights.waist.entries.length, 2);
  eq('weigh-ins came from the cloud', DB.getWeights().entries.length, 1);
}

console.log('sync.pull — a waist-only device fills an empty cloud weights field:');
{
  reset();
  const SYNC = await import('../js/sync.js');
  const puts = [];
  globalThis.fetch = async (u, opts = {}) => {
    if (opts.method === 'PUT') { puts.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ updatedAt: Date.now() + 60000, data: { plans: [], sessions: [], weights: null } }) };
  };
  DB.addWaist(91, { t: T(0) });
  store.wt_pushed_at = '1';
  await SYNC.pull();
  await new Promise((r) => setTimeout(r, 50));
  eq('kept locally', DB.getWaist().entries.length, 1);
  eq('pushed up', puts[0] && puts[0].data.weights.waist.entries.length, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
