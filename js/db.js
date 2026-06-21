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
  return { id: uid(), name: '', sets: 3, reps: 10, weight: 0, rest: 90 };
}

export const DEFAULT_REST = 90; // seconds, used when an exercise has none set

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
  for (const s of getSessions()) {
    let entry = s.entries.find((e) => e.exerciseId === exerciseId);
    if (!entry && exerciseName) {
      entry = s.entries.find(
        (e) => (e.name || '').toLowerCase() === exerciseName.toLowerCase()
      );
    }
    if (entry && entry.sets && entry.sets.length) return entry.sets;
  }
  return null;
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
    name: 'Full Body',
    exercises: [
      { name: 'Squat', sets: 3, reps: 8, weight: 0 },
      { name: 'Bench Press', sets: 3, reps: 8, weight: 0 },
      { name: 'Bent-Over Row', sets: 3, reps: 10, weight: 0 },
      { name: 'Overhead Press', sets: 3, reps: 10, weight: 0 },
      { name: 'Plank (sec)', sets: 3, reps: 45, weight: 0 },
    ],
  },
  {
    name: 'Push Day',
    exercises: [
      { name: 'Bench Press', sets: 4, reps: 8, weight: 0 },
      { name: 'Incline Dumbbell Press', sets: 3, reps: 10, weight: 0 },
      { name: 'Overhead Press', sets: 3, reps: 10, weight: 0 },
      { name: 'Lateral Raise', sets: 3, reps: 15, weight: 0 },
      { name: 'Triceps Pushdown', sets: 3, reps: 12, weight: 0 },
    ],
  },
  {
    name: 'Pull Day',
    exercises: [
      { name: 'Deadlift', sets: 3, reps: 5, weight: 0 },
      { name: 'Pull-Up', sets: 3, reps: 8, weight: 0 },
      { name: 'Barbell Row', sets: 3, reps: 10, weight: 0 },
      { name: 'Face Pull', sets: 3, reps: 15, weight: 0 },
      { name: 'Biceps Curl', sets: 3, reps: 12, weight: 0 },
    ],
  },
  {
    name: 'Leg Day',
    exercises: [
      { name: 'Squat', sets: 4, reps: 6, weight: 0 },
      { name: 'Romanian Deadlift', sets: 3, reps: 10, weight: 0 },
      { name: 'Leg Press', sets: 3, reps: 12, weight: 0 },
      { name: 'Leg Curl', sets: 3, reps: 12, weight: 0 },
      { name: 'Calf Raise', sets: 4, reps: 15, weight: 0 },
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

/* ---------- muscle grouping (for insights) ---------- */
// Inferred from the exercise name — zero tagging needed. Order matters:
// more specific phrases are checked before generic ones.
export const MUSCLES = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Other'];

export function muscleFor(name) {
  const n = ' ' + String(name || '').toLowerCase() + ' ';
  const has = (...k) => k.some((x) => n.includes(x));
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
export function importAll(json) {
  const data = JSON.parse(json);
  if (data.plans) write(KEY_PLANS, data.plans);
  if (data.sessions) write(KEY_SESSIONS, data.sessions);
}
