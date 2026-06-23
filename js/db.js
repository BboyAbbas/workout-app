/* ============================================================
   db.js — data layer
   All persistence lives here so the UI never touches storage
   directly. Today this is localStorage (plenty for one user's
   workout log). Swap the read/write internals for IndexedDB
   later without changing any UI code.
   ============================================================ */

const KEY_PLANS = 'wt_plans_v1';
const KEY_SESSIONS = 'wt_sessions_v1';
const KEY_ACTIVE = 'wt_active_v1'; // in-progress workout, survives refresh
const KEY_UPDATED = 'wt_updated_at'; // ms timestamp of last plans/sessions change (for cloud sync)

/* ---------- low level ---------- */
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  // mark data dirty + notify the sync layer when plans/sessions change
  if (key === KEY_PLANS || key === KEY_SESSIONS) {
    localStorage.setItem(KEY_UPDATED, String(Date.now()));
    if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('wt-changed'));
  }
}

/* ---------- cloud-sync hooks ---------- */
/** ms timestamp of the last local change to plans/sessions (0 if never). */
export function getUpdatedAt() { return Number(localStorage.getItem(KEY_UPDATED)) || 0; }
/** The full syncable dataset (what gets pushed to / pulled from the cloud). */
export function snapshot() { return { plans: getPlans(), sessions: read(KEY_SESSIONS, []) }; }
/** Replace local data with a pulled remote copy (no re-dispatch -> no push loop). */
export function applyRemote(data, ts) {
  if (data && Array.isArray(data.plans)) localStorage.setItem(KEY_PLANS, JSON.stringify(data.plans));
  if (data && Array.isArray(data.sessions)) localStorage.setItem(KEY_SESSIONS, JSON.stringify(data.sessions));
  localStorage.setItem(KEY_UPDATED, String(ts));
}

export function uid() {
  return 'x' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

/* ---------- plans ---------- */
export function getPlans() {
  return read(KEY_PLANS, []);
}
export function getPlan(id) {
  return getPlans().find((p) => p.id === id) || null;
}
export function savePlan(plan) {
  const plans = getPlans();
  const i = plans.findIndex((p) => p.id === plan.id);
  if (i === -1) plans.push(plan);
  else plans[i] = plan;
  write(KEY_PLANS, plans);
  return plan;
}
export function deletePlan(id) {
  write(KEY_PLANS, getPlans().filter((p) => p.id !== id));
}

export function newPlan() {
  return { id: uid(), name: '', createdAt: Date.now(), exercises: [] };
}
export function newExercise() {
  // reps is a RANGE (repMin..repMax) so progression can use double-progression:
  // push reps to the top of the range, then add weight. `reps` is kept = repMax
  // for backward-compatibility with any older read paths.
  return { id: uid(), name: '', kind: 'strength', sets: 3, repMin: 8, repMax: 12, reps: 12, weight: 0, rest: 90 };
}

/* ---------- cardio (treadmill / stairmaster) ----------
   Cardio exercises log MACHINE SETTINGS per set instead of weight/reps. */
export const CARDIO_KINDS = {
  treadmill: {
    label: 'Treadmill',
    fields: [
      { key: 'incline', label: 'Incline', ph: 'incl' },
      { key: 'speed', label: 'Speed', ph: 'speed' },
      { key: 'minutes', label: 'Min', ph: 'min' },
    ],
  },
  stairmaster: {
    label: 'StairMaster',
    fields: [
      { key: 'level', label: 'Level', ph: 'level' },
      { key: 'minutes', label: 'Min', ph: 'min' },
    ],
  },
  bike: {
    label: 'HIIT Bike',
    fields: [
      { key: 'level', label: 'Level', ph: 'level' },
      { key: 'minutes', label: 'Min', ph: 'min' },
    ],
  },
};
export function isCardio(e) { return !!(e && e.kind && e.kind !== 'strength'); }
export function cardioFields(kind) { return (CARDIO_KINDS[kind] || {}).fields || []; }
/** The required field for a cardio kind (what must be filled to log a set). */
export function cardioRequiredKey(kind) { return 'minutes'; }

export const DEFAULT_REST = 90; // seconds, used when an exercise has none set
export const DEFAULT_INC = 2.5; // kg added when an exercise graduates the rep range
export const DB_INC = 2;        // dumbbells come in fixed steps — an 18.5kg DB doesn't exist

/**
 * Smallest realistic weight jump for an exercise, so a graduation lands on a
 * weight you can actually load. Dumbbell movements step by whole dumbbells
 * (2 kg here); everything else uses 2.5 kg. An explicit `inc` on the exercise
 * always wins — set it per exercise in the plan editor to match your gym.
 */
export function incFor(e) {
  const n = Number(e && e.inc);
  if (Number.isFinite(n) && n > 0) return n;
  const name = ' ' + String((e && e.name) || '').toLowerCase() + ' ';
  if (/ db |dumbbell|goblet/.test(name)) return DB_INC;
  return DEFAULT_INC;
}

/** Snap a weight to the nearest multiple of `step` so it's a real, loadable weight. */
export function roundToStep(w, step) {
  const s = step > 0 ? step : DEFAULT_INC;
  return Math.round((Math.round(w / s) * s) * 100) / 100;
}

/**
 * The working rep range for an exercise. New exercises store repMin/repMax.
 * Older plans only have a single `reps` target — derive a sensible window
 * from it (roughly 70%..100% of the old target) so they progress too.
 */
export function repRange(e) {
  let max = Number(e && e.repMax);
  let min = Number(e && e.repMin);
  const legacy = Number(e && e.reps);
  if (!Number.isFinite(max) || max <= 0) max = (Number.isFinite(legacy) && legacy > 0) ? legacy : 12;
  if (!Number.isFinite(min) || min <= 0) min = Math.max(1, Math.round(max * 0.7));
  if (min > max) min = max;
  return { min, max };
}

/**
 * Double-progression recommendation for the NEXT session of one exercise.
 * Given last session's logged sets [{reps, weight}], the rep range, and the
 * weight increment, decide whether to add weight or chase more reps.
 *
 *  - all working sets hit the top of the range  -> add weight, reset to repMin
 *  - otherwise                                  -> hold weight, beat the reps
 *  - no history                                 -> first time, no number yet
 *
 * "Working sets" = the sets done at the heaviest weight used, so warm-up sets
 * at a lighter weight don't block graduating. Returns {dir, weight, note}
 * where dir is 'up' | 'hold' | 'first' and weight is the recommended load.
 */
export function recommendNext(lastSets, range, inc = DEFAULT_INC, targetSets = 1) {
  const min = range.min, max = range.max;
  const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  if (!lastSets || !lastSets.length) {
    return { dir: 'first', weight: null,
      note: `First time — find a weight you can do for ${min}–${max} reps.` };
  }
  const weights = lastSets.map((s) => N(s.weight)).filter((w) => w > 0);
  const w = weights.length ? Math.max(...weights) : 0;
  // sets done at the top working weight — warm-up sets at a lighter weight don't
  // count toward graduating (bodyweight: every set, since they're all weight 0).
  const topWorking = w > 0 ? lastSets.filter((s) => N(s.weight) === w) : lastSets;
  const need = Math.max(1, targetSets);
  // Graduate only after completing ALL planned sets at the top of the range, at
  // the top weight — so a single logged set (or a partial session) won't bump.
  const hitTop = topWorking.length >= need && topWorking.every((s) => N(s.reps) >= max);
  if (hitTop && w > 0) {
    const nw = roundToStep(w + inc, inc); // land on a real, loadable weight
    return { dir: 'up', weight: nw,
      note: `Add weight: ${w} → ${nw}kg. Reset to ${min} reps and build back up.` };
  }
  if (hitTop && w === 0) {
    // Bodyweight movement that maxed the range — no load to add, so progress reps
    // or external resistance instead of being stuck on the same "hit max" message.
    return { dir: 'hold', weight: null,
      note: `You maxed ${max} reps at bodyweight — add a rep, or some resistance (band/plate).` };
  }
  return { dir: 'hold', weight: w || null,
    note: w
      ? `Stay at ${w}kg — beat last time (goal: ${max} reps on every set).`
      : `Aim for ${min}–${max} reps; add weight or resistance once you hit ${max} on all sets.` };
}

/* ---------- sessions (workout history) ---------- */
export function getSessions() {
  // newest first
  return read(KEY_SESSIONS, []).sort((a, b) => b.startedAt - a.startedAt);
}
export function getSessionsForPlan(planId) {
  return getSessions().filter((s) => s.planId === planId);
}
export function addSession(session) {
  const sessions = read(KEY_SESSIONS, []);
  sessions.push(session);
  write(KEY_SESSIONS, sessions);
  return session;
}
export function deleteSession(id) {
  write(KEY_SESSIONS, read(KEY_SESSIONS, []).filter((s) => s.id !== id));
}

/**
 * Most recent logged performance for a single exercise (by id, then
 * by name as a fallback so renaming a plan's exercise still matches).
 * Returns the array of sets [{reps, weight}] or null.
 */
export function lastEntryForExercise(exerciseId, exerciseName) {
  // History is keyed by exercise NAME (case-insensitive). Progress follows the
  // name: swap a plan's exercise for a different one and the new name starts
  // fresh — it NEVER inherits the old exercise's numbers, even if it reuses the
  // same id (an in-place rename). Switch back to the exact old name and its full
  // history returns as it was. Id is only a fallback for legacy rows logged
  // without a name.
  const name = String(exerciseName || '').toLowerCase();
  for (const s of getSessions()) {
    const entry = name
      ? s.entries.find((e) => String(e.name || '').toLowerCase() === name)
      : s.entries.find((e) => e.exerciseId === exerciseId);
    if (entry && entry.sets && entry.sets.length) return entry.sets;
  }
  return null;
}

/* ---------- progress / records / stalls (insights) ---------- */

/** Epley estimated 1-rep-max. 0 for bodyweight (no external load to estimate from). */
export function est1RM(weight, reps) {
  const w = Number(weight), r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return 0;
  return Math.round(w * (1 + r / 30));
}

/**
 * Per-session progress for ONE exercise (matched by name, case-insensitive),
 * OLDEST first. Each point summarises that session's best effort.
 */
export function progressForExercise(name) {
  const key = String(name || '').toLowerCase();
  const points = [];
  for (const s of [...getSessions()].reverse()) { // getSessions is newest-first
    const entry = (s.entries || []).find((e) => (e.name || '').toLowerCase() === key);
    if (!entry || !entry.sets || !entry.sets.length) continue;
    if (entry.kind && entry.kind !== 'strength') continue; // cardio isn't a strength curve
    let topWeight = 0, topReps = 0, bestE = 0, volume = 0;
    for (const set of entry.sets) {
      const w = Number(set.weight) || 0, r = Number(set.reps) || 0;
      if (w > topWeight) topWeight = w;
      if (r > topReps) topReps = r;
      bestE = Math.max(bestE, est1RM(w, r));
      volume += w * r;
    }
    points.push({ t: s.startedAt, topWeight, topReps, e1rm: bestE, volume });
  }
  return points;
}

/** The metric to chart/track: est-1RM if the exercise is ever loaded, else top reps. */
export function progressMetric(points) {
  const loaded = points.some((p) => p.e1rm > 0);
  return {
    loaded,
    label: loaded ? 'Est. 1RM' : 'Top reps',
    unit: loaded ? 'kg' : 'reps',
    values: points.map((p) => (loaded ? p.e1rm : p.topReps)),
  };
}

/** Stalled = ≥4 tracked sessions and the best result is OLDER than the last 3. */
export function isStalled(values) {
  if (!values || values.length < 4) return false;
  const peak = Math.max(...values);
  const recentPeak = Math.max(...values.slice(-3));
  return recentPeak < peak;
}

/** One row per exercise with logged history (Records + stalls), best metric first. */
export function exerciseProgressSummary() {
  const names = new Set();
  for (const s of getSessions()) for (const e of (s.entries || []))
    if (e.name && !(e.kind && e.kind !== 'strength')) names.add(e.name);
  const rows = [];
  for (const name of names) {
    const points = progressForExercise(name);
    if (!points.length) continue;
    const m = progressMetric(points);
    const best = Math.max(...m.values);
    const latest = m.values[m.values.length - 1];
    const bestPoint = points[m.values.indexOf(best)];
    rows.push({
      name, label: m.label, unit: m.unit, loaded: m.loaded,
      best, latest, bestAt: bestPoint ? bestPoint.t : null,
      sessions: points.length, stalled: isStalled(m.values),
      improving: m.values.length >= 2 && latest > m.values[m.values.length - 2],
    });
  }
  rows.sort((a, b) => b.best - a.best);
  return rows;
}

/**
 * Exercises in `entries` that beat their previous best — for the PR toast.
 * MUST be called BEFORE the new session is saved, so the prior history is clean.
 */
export function newPRsIn(entries) {
  const prs = [];
  for (const e of (entries || [])) {
    if (e.kind && e.kind !== 'strength') continue; // cardio has no 1RM/rep PR
    const pts = progressForExercise(e.name);
    if (!pts.length) continue; // first time logging this exercise isn't a "PR"
    let curE = 0, curReps = 0, curW = 0;
    for (const set of (e.sets || [])) {
      const w = Number(set.weight) || 0, r = Number(set.reps) || 0;
      curE = Math.max(curE, est1RM(w, r)); curReps = Math.max(curReps, r); curW = Math.max(curW, w);
    }
    const priorE = Math.max(...pts.map((p) => p.e1rm));
    const priorReps = Math.max(...pts.map((p) => p.topReps));
    if (curW > 0 || priorE > 0) {
      if (curE > priorE && curE > 0) prs.push({ name: e.name, kind: '1RM', value: curE, unit: 'kg' });
    } else if (curReps > priorReps && curReps > 0) {
      prs.push({ name: e.name, kind: 'reps', value: curReps, unit: 'reps' });
    }
  }
  return prs;
}

/* ---------- active (in-progress) workout ---------- */
export function getActive() {
  return read(KEY_ACTIVE, null);
}
export function setActive(active) {
  if (active) write(KEY_ACTIVE, active);
  else localStorage.removeItem(KEY_ACTIVE);
}

/* ---------- starter templates ("create plans for me") ---------- */
export const TEMPLATES = [
  {
    name: 'Push',
    exercises: [
      { name: 'Bench Press', sets: 4, repMin: 6, repMax: 8, reps: 8, weight: 0, rest: 180 },
      { name: 'Machine Chest Fly', sets: 3, repMin: 12, repMax: 15, reps: 15, weight: 0, rest: 60 },
      { name: 'Seated DB Shoulder Press', sets: 3, repMin: 8, repMax: 12, reps: 12, weight: 0, rest: 90 },
      { name: 'Rope Triceps Pushdown', sets: 3, repMin: 12, repMax: 15, reps: 15, weight: 0, rest: 45 },
      { name: 'HIIT Bike', kind: 'bike', sets: 1, rest: 0 },
    ],
  },
  {
    name: 'Legs',
    exercises: [
      { name: 'Smith Machine Squat', sets: 4, repMin: 6, repMax: 10, reps: 10, weight: 0, rest: 180 },
      { name: 'Leg Press', sets: 3, repMin: 10, repMax: 12, reps: 12, weight: 0, rest: 90 },
      { name: 'Leg Extension', sets: 3, repMin: 12, repMax: 15, reps: 15, weight: 0, rest: 60 },
      { name: 'Standing Calf Raise', sets: 3, repMin: 12, repMax: 15, reps: 15, weight: 0, rest: 45 },
      { name: 'Incline Walk', kind: 'treadmill', sets: 1, rest: 0 },
    ],
  },
  {
    name: 'Pull',
    exercises: [
      { name: 'Lat Pulldown', sets: 4, repMin: 8, repMax: 12, reps: 12, weight: 0, rest: 120 },
      { name: 'One-Arm DB Row', sets: 3, repMin: 8, repMax: 12, reps: 12, weight: 0, rest: 90 },
      { name: 'Face Pulls', sets: 3, repMin: 15, repMax: 20, reps: 20, weight: 0, rest: 45 },
      { name: 'Lying Knee Raises', sets: 3, repMin: 10, repMax: 15, reps: 15, weight: 0, rest: 60 },
      { name: 'StairMaster', kind: 'stairmaster', sets: 1, rest: 0 },
    ],
  },
  {
    name: 'Upper',
    exercises: [
      { name: 'Machine Chest Press', sets: 3, repMin: 10, repMax: 12, reps: 12, weight: 0, rest: 90 },
      { name: 'Seated Cable Row', sets: 3, repMin: 10, repMax: 12, reps: 12, weight: 0, rest: 90 },
      { name: 'DB Lateral Raises', sets: 3, repMin: 15, repMax: 20, reps: 20, weight: 0, rest: 45 },
      { name: 'DB Hammer Curls', sets: 3, repMin: 10, repMax: 12, reps: 12, weight: 0, rest: 60 },
      { name: 'Incline Walk', kind: 'treadmill', sets: 1, rest: 0 },
    ],
  },
  {
    name: 'Lower',
    exercises: [
      { name: 'Romanian Deadlift', sets: 4, repMin: 8, repMax: 10, reps: 10, weight: 0, rest: 120 },
      { name: 'Walking Lunges', sets: 3, repMin: 10, repMax: 12, reps: 12, weight: 0, rest: 90 },
      { name: 'Back Hyperextension', sets: 3, repMin: 12, repMax: 15, reps: 15, weight: 0, rest: 60 },
      { name: 'Cable Woodchopper', sets: 3, repMin: 12, repMax: 15, reps: 15, weight: 0, rest: 45 },
      { name: 'Incline Walk', kind: 'treadmill', sets: 1, rest: 0 },
    ],
  },
];

/** Build a real plan object from a template by name. */
export function planFromTemplate(tpl) {
  return {
    id: uid(),
    name: tpl.name,
    createdAt: Date.now(),
    exercises: tpl.exercises.map((e) => ({ id: uid(), ...e })),
  };
}

/** Create all of the program's plans as real saved plans (used to auto-load
 *  the workouts on a fresh/empty device so there's no "add from template" step). */
export function seedDefaultPlans() {
  for (const tpl of TEMPLATES) savePlan(planFromTemplate(tpl));
}

/* ---------- muscle grouping (for insights) ---------- */
// Inferred from the exercise name — zero tagging needed. Order matters:
// more specific phrases are checked before generic ones.
export const MUSCLES = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Other'];

export function muscleFor(name) {
  const n = ' ' + String(name || '').toLowerCase() + ' ';
  const has = (...k) => k.some((x) => n.includes(x));
  if (has('treadmill', 'stairmaster', 'stair master', 'incline walk', 'run', 'running', 'jog', 'elliptical', 'cycle', 'cycling', 'bike', 'rower', 'rowing', 'cardio')) return 'Cardio';
  if (has('plank', 'crunch', 'sit-up', 'situp', 'ab ', 'abs', 'leg raise', 'knee raise', 'russian twist', 'hollow', 'oblique')) return 'Core';
  if (has('upright row', 'overhead press', 'ohp', 'shoulder', 'lateral raise', 'military', 'arnold', 'rear delt', 'shrug')) return 'Shoulders';
  if (has('leg press', 'leg curl', 'leg extension', 'squat', 'lunge', 'calf', 'romanian', 'rdl', 'hip thrust', 'glute', 'hamstring', 'quad', 'step-up', 'step up')) return 'Legs';
  if (has('bench', 'chest', 'fly', 'flye', 'push-up', 'push up', 'pushup', 'dip', 'pec')) return 'Chest';
  if (has('row', 'pull-up', 'pull up', 'pullup', 'pulldown', 'lat ', 'lat-', 'chin', 'face pull', 'deadlift', 'back extension')) return 'Back';
  if (has('curl', 'tricep', 'triceps', 'pushdown', 'bicep', 'biceps', 'skull', 'hammer', 'preacher', 'kickback', 'forearm')) return 'Arms';
  return 'Other';
}

/* ---------- export / import (backup) ---------- */
export function exportAll() {
  return JSON.stringify(
    { plans: getPlans(), sessions: read(KEY_SESSIONS, []), v: 1 },
    null,
    2
  );
}
/** Wipe ALL local data (plans, history, in-progress workout) on this device.
 *  Marks the change so the empty state also syncs to the cloud. */
export function resetAll() {
  localStorage.removeItem(KEY_PLANS);
  localStorage.removeItem(KEY_SESSIONS);
  localStorage.removeItem(KEY_ACTIVE);
  localStorage.setItem(KEY_UPDATED, String(Date.now()));
  if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('wt-changed'));
}

export function importAll(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || typeof data !== 'object') throw new Error('Invalid backup file');
  // Only accept well-formed records so a bad/old backup can't brick the app:
  // every screen assumes plans have an exercises[] and sessions have an entries[].
  const plans = Array.isArray(data.plans)
    ? data.plans.filter((p) => p && Array.isArray(p.exercises)) : [];
  const sessions = Array.isArray(data.sessions)
    ? data.sessions.filter((s) => s && Array.isArray(s.entries)) : [];
  if (plans.length) write(KEY_PLANS, plans);
  if (sessions.length) write(KEY_SESSIONS, sessions);
}
