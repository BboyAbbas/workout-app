/* ============================================================
   db.js — data layer
   All persistence lives here so the UI never touches storage
   directly. Today this is localStorage (plenty for one user's
   workout log). Swap the read/write internals for IndexedDB
   later without changing any UI code.
   ============================================================ */

import * as IV from './intervals.js';

const KEY_PLANS = 'wt_plans_v1';
const KEY_SESSIONS = 'wt_sessions_v1';
const KEY_ACTIVE = 'wt_active_v1'; // in-progress workout, survives refresh
const KEY_GOAL = 'wt_goal_v1'; // weight-loss goal {targetKg, startKg, startDate, endDate}
const KEY_WEIGHTS = 'wt_weights_v1'; // body log {entries:[{id,t,kg,note}], targetKg, heightCm, waist:{entries:[{id,t,cm,note}], targetCm}}
const KEY_PLANKS = 'wt_planks_v1'; // plank trainer {sessions:[{id,t,mode,sets:[{sec,at,side?}]}], targetSets, restSec, mode}
const KEY_PLANK_ACTIVE = 'wt_plank_active_v1'; // in-progress plank run, survives refresh (device-local, never synced)
const KEY_INTERVALS = 'wt_intervals_v1'; // interval trainer {sessions:[...], prefs:{preset,machine,muted,cfgs}}
const KEY_INTERVAL_ACTIVE = 'wt_interval_active_v1'; // in-progress interval run, survives refresh (device-local, never synced)
const KEY_EXTRA = 'wt_remote_extra_v1'; // synced fields this app version doesn't know (see applyRemote)
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
  if (key === KEY_PLANS || key === KEY_SESSIONS || key === KEY_GOAL || key === KEY_WEIGHTS || key === KEY_PLANKS || key === KEY_INTERVALS) {
    stampChange();
    if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('wt-changed'));
  }
}

/* ---------- cloud-sync hooks ---------- */
/** ms timestamp of the last local change to plans/sessions (0 if never). */
export function getUpdatedAt() { return Number(localStorage.getItem(KEY_UPDATED)) || 0; }
/* Every local change is stamped STRICTLY newer than the previous stamp — which,
   after a pull, is the cloud version this device last saw. So a change made on
   a device whose clock runs behind still wins over the version it was built on
   (other devices pull it instead of ignoring it), and two changes in the same
   millisecond never share a stamp (the second would look already-pushed). */
function stampChange(floor = 0) {
  localStorage.setItem(KEY_UPDATED, String(Math.max(Date.now(), getUpdatedAt() + 1, Number(floor) || 0)));
}
/** Mark local data as changed (forces the next push) without touching content.
 *  `floor`: never stamp below it — a pull that merged local work back in passes
 *  the cloud stamp + 1. */
export function markDirty(floor = 0) { stampChange(floor); }
/* Fields this app version reads and owns. Anything ELSE in the cloud doc is
   from a newer version — it is preserved verbatim (KEY_EXTRA) and merged back
   into every push, so an out-of-date client can never strip a field it doesn't
   understand. */
const KNOWN_SYNC_FIELDS = ['plans', 'sessions', 'goal', 'weights', 'planks', 'intervals'];

/** The full syncable dataset (what gets pushed to / pulled from the cloud). */
export function snapshot() {
  return {
    ...read(KEY_EXTRA, {}), // unknown fields ride along untouched
    plans: getPlans(),
    sessions: read(KEY_SESSIONS, []),
    goal: getGoal(),
    weights: read(KEY_WEIGHTS, null),
    planks: read(KEY_PLANKS, null),
    intervals: read(KEY_INTERVALS, null),
  };
}
/** Replace local data with a pulled remote copy (no re-dispatch -> no push loop). */
export function applyRemote(data, ts) {
  if (data && Array.isArray(data.plans)) localStorage.setItem(KEY_PLANS, JSON.stringify(data.plans));
  if (data && Array.isArray(data.sessions)) localStorage.setItem(KEY_SESSIONS, JSON.stringify(data.sessions));
  if (data && 'goal' in data) {
    if (data.goal) localStorage.setItem(KEY_GOAL, JSON.stringify(data.goal));
    else localStorage.removeItem(KEY_GOAL);
  }
  if (data && 'weights' in data) {
    if (data.weights) localStorage.setItem(KEY_WEIGHTS, JSON.stringify(data.weights));
    else localStorage.removeItem(KEY_WEIGHTS);
  }
  if (data && 'planks' in data) {
    if (data.planks) localStorage.setItem(KEY_PLANKS, JSON.stringify(data.planks));
    else localStorage.removeItem(KEY_PLANKS);
  }
  if (data && 'intervals' in data) {
    if (data.intervals) localStorage.setItem(KEY_INTERVALS, JSON.stringify(data.intervals));
    else localStorage.removeItem(KEY_INTERVALS);
  }
  const extra = {};
  for (const k of Object.keys(data || {})) if (!KNOWN_SYNC_FIELDS.includes(k)) extra[k] = data[k];
  localStorage.setItem(KEY_EXTRA, JSON.stringify(extra));
  localStorage.setItem(KEY_UPDATED, String(ts));
}

/* An app update can teach this version a field an OLDER version had parked in
   KEY_EXTRA (applyRemote preserves unknown cloud fields verbatim). Adopt those
   into their real stores on boot — without this the data stays invisible until
   the cloud doc's updatedAt moves again, because a pull at the same timestamp
   is treated as already applied (bit us 2026-07-25: 226 weight entries pulled
   by the previous app version sat parked while the weight screen showed empty). */
const FIELD_STORES = { plans: KEY_PLANS, sessions: KEY_SESSIONS, goal: KEY_GOAL, weights: KEY_WEIGHTS, planks: KEY_PLANKS, intervals: KEY_INTERVALS };
(function adoptParkedFields() {
  try {
    const extra = read(KEY_EXTRA, null);
    if (!extra || typeof extra !== 'object') return;
    let changed = false;
    for (const f of KNOWN_SYNC_FIELDS) {
      if (!(f in extra)) continue;
      // adopt only into an empty store — never clobber newer local data
      if (extra[f] != null && localStorage.getItem(FIELD_STORES[f]) == null) {
        localStorage.setItem(FIELD_STORES[f], JSON.stringify(extra[f]));
      }
      delete extra[f];
      changed = true;
    }
    if (changed) localStorage.setItem(KEY_EXTRA, JSON.stringify(extra));
  } catch (_) {}
})();

/* ---------- weight-loss goal (home-screen countdown) ---------- */
export function getGoal() { return read(KEY_GOAL, null); }
export function setGoal(goal) {
  if (goal) return write(KEY_GOAL, goal);
  localStorage.removeItem(KEY_GOAL);
  stampChange();
  if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('wt-changed'));
}

export function uid() {
  return 'x' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

/* ---------- body-weight tracking (weight screen) ---------- */
export function getWeights() {
  const w = read(KEY_WEIGHTS, null);
  if (!w || !Array.isArray(w.entries)) return { entries: [], targetKg: null, heightCm: null };
  return w;
}
function saveWeights(w) {
  w.entries.sort((a, b) => a.t - b.t);
  write(KEY_WEIGHTS, w);
}
export function addWeight(kg, { t = Date.now(), note = '' } = {}) {
  const w = getWeights();
  const entry = { id: uid(), t, kg, note };
  w.entries.push(entry);
  saveWeights(w);
  return entry;
}
export function updateWeight(id, patch) {
  const w = getWeights();
  const e = w.entries.find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, patch);
  saveWeights(w);
}
export function deleteWeight(id) {
  const w = getWeights();
  w.entries = w.entries.filter((x) => x.id !== id);
  saveWeights(w);
}
export function setWeightTarget(kg) {
  const w = getWeights();
  w.targetKg = kg;
  saveWeights(w);
}
/** Linearly interpolated value of `key` at time t (null with no data). */
export function weightAt(entries, t, key = 'kg') {
  if (!entries.length) return null;
  if (t <= entries[0].t) return entries[0][key];
  const last = entries[entries.length - 1];
  if (t >= last.t) return last[key];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].t >= t) {
      const a = entries[i - 1], b = entries[i];
      return a[key] + (b[key] - a[key]) * ((t - a.t) / (b.t - a.t || 1));
    }
  }
  return last[key];
}
export function setHeight(cm) {
  const w = getWeights();
  w.heightCm = cm;
  saveWeights(w);
}

/* ---------- waist tracking (weight screen, Waist tab) ----------
   Rides inside the weights doc next to heightCm, so it syncs with it and an
   older app version keeps it untouched. The goal is a ceiling: reached only
   when the waist is UNDER targetCm. */
export function getWaist() {
  const w = getWeights().waist;
  return {
    entries: w && Array.isArray(w.entries) ? w.entries : [],
    targetCm: w && Number.isFinite(w.targetCm) ? w.targetCm : null,
  };
}
function saveWaist(waist) {
  const w = getWeights();
  waist.entries.sort((a, b) => a.t - b.t);
  w.waist = { ...w.waist, ...waist };
  saveWeights(w);
}
export function addWaist(cm, { t = Date.now(), note = '' } = {}) {
  const waist = getWaist();
  const entry = { id: uid(), t, cm, note };
  waist.entries.push(entry);
  saveWaist(waist);
  return entry;
}
export function updateWaist(id, patch) {
  const waist = getWaist();
  const e = waist.entries.find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, patch);
  saveWaist(waist);
}
export function deleteWaist(id) {
  const waist = getWaist();
  waist.entries = waist.entries.filter((x) => x.id !== id);
  saveWaist(waist);
}
export function setWaistTarget(cm) {
  const waist = getWaist();
  waist.targetCm = cm;
  saveWaist(waist);
}
/** Waist ÷ height (null without both). */
export function waistToHeight(cm, heightCm) {
  return cm > 0 && heightCm > 0 ? cm / heightCm : null;
}
/** Union a local weights doc's unpushed waist entries into a pulled one.
 *  Returns how many were added (the pulled doc is changed in place). */
export function mergeWaistInto(remoteWeights, localWeights) {
  const mine = localWeights && localWeights.waist && Array.isArray(localWeights.waist.entries) ? localWeights.waist.entries : [];
  if (!remoteWeights || !mine.length) return 0;
  const theirs = remoteWeights.waist && Array.isArray(remoteWeights.waist.entries) ? remoteWeights.waist.entries : null;
  if (!theirs) { remoteWeights.waist = { ...localWeights.waist }; return mine.length; }
  const have = new Set(theirs.map((e) => e && e.id));
  const miss = mine.filter((e) => e && e.id && !have.has(e.id));
  if (miss.length) remoteWeights.waist.entries = theirs.concat(miss).sort((a, b) => a.t - b.t);
  return miss.length;
}

/* ---------- plank trainer ----------
   Planks are a HOLD, not a lift: seconds per hold, with separate front, left
   and right records to chase. They live in their own store — never in `plans` or
   `sessions` — so the up-next rotation and the strength analytics cannot see
   them at all. Same shape as the weight log: one doc, own sync field, unknown
   sub-fields preserved. */
export const PLANK_DEFAULTS = { targetSets: 3, restSec: 60, mode: 'front' };
export const PLANK_SET_OPTIONS = [1, 2, 3, 4, 5];
export const PLANK_REST_OPTIONS = [30, 45, 60, 90, 120];
export const MIN_PLANK_SEC = 1; // below this it was a mis-tap, not a plank
export const PLANK_SWITCH_SEC = 5;

const okSets = (n) => Number.isFinite(n) && n >= 1 && n <= 10;
const okRest = (n) => Number.isFinite(n) && n >= 0 && n <= 600;
const okPlankMode = (mode) => mode === 'front' || mode === 'side';
const plankSessionMode = (session) => session && session.mode === 'side' ? 'side' : 'front';

export function getPlanks() {
  const raw = read(KEY_PLANKS, null);
  const p = raw && typeof raw === 'object' ? raw : {};
  const ts = Number(p.targetSets), rs = Number(p.restSec);
  return {
    ...p, // a newer version's extra sub-fields ride along untouched
    sessions: Array.isArray(p.sessions) ? p.sessions : [],
    targetSets: okSets(ts) ? Math.round(ts) : PLANK_DEFAULTS.targetSets,
    restSec: okRest(rs) ? Math.round(rs) : PLANK_DEFAULTS.restSec,
    mode: okPlankMode(p.mode) ? p.mode : PLANK_DEFAULTS.mode,
  };
}
function savePlanks(p) {
  p.sessions.sort((a, b) => a.t - b.t);
  write(KEY_PLANKS, p);
}

/** Mode, sets + rest the trainer opens with (whatever was used last time). */
export function plankPrefs() {
  const p = getPlanks();
  return { targetSets: p.targetSets, restSec: p.restSec, mode: p.mode };
}
export function setPlankPrefs({ targetSets, restSec, mode } = {}) {
  const p = getPlanks();
  const ts = Number(targetSets), rs = Number(restSec);
  let changed = false;
  if (okSets(ts)) { p.targetSets = Math.round(ts); changed = true; }
  if (okRest(rs)) { p.restSec = Math.round(rs); changed = true; }
  if (okPlankMode(mode)) { p.mode = mode; changed = true; }
  if (changed) savePlanks(p);
  return { targetSets: p.targetSets, restSec: p.restSec, mode: p.mode };
}

/**
 * Save ONE finished hold, the instant it finishes — never batched at the end of
 * the session. An abandoned run therefore keeps every set that was actually
 * held, and a crash/reload can lose at most the hold still in progress.
 * Seconds are FLOORED, so a hold is never credited with time it didn't reach,
 * and anything under a second is a mis-tap: not stored, not a record, ignored.
 * Returns {session, set} or null when nothing was recorded.
 */
export function recordPlankSet(sessionId, sec, { at = Date.now(), targetSets = null, restSec = null, mode = 'front', side = null } = {}) {
  const n = Math.floor(Number(sec));
  if (!Number.isFinite(n) || n < MIN_PLANK_SEC) return null;
  const selectedMode = okPlankMode(mode) ? mode : 'front';
  if (selectedMode === 'side' && side !== 'L' && side !== 'R') return null;
  const p = getPlanks();
  let s = p.sessions.find((x) => x && x.id === sessionId);
  if (s && plankSessionMode(s) !== selectedMode) return null;
  if (!s) {
    s = { id: sessionId, t: at, sets: [], mode: selectedMode };
    if (okSets(Number(targetSets))) s.targetSets = Math.round(Number(targetSets));
    if (okRest(Number(restSec))) s.restSec = Math.round(Number(restSec));
    Object.assign(s, activeWorkoutLink());
    p.sessions.push(s);
  }
  if (!Array.isArray(s.sets)) s.sets = [];
  const set = selectedMode === 'side' ? { sec: n, at, side } : { sec: n, at };
  s.sets.push(set);
  s.endedAt = at;
  savePlanks(p);
  return { session: s, set };
}

export function deletePlankSession(id) {
  const p = getPlanks();
  p.sessions = p.sessions.filter((s) => s && s.id !== id);
  savePlanks(p);
}

/** Plank sessions, newest first (what the history list shows). */
export function getPlankSessions(mode = 'front') {
  const selectedMode = okPlankMode(mode) ? mode : 'front';
  return getPlanks().sessions.filter((s) => plankSessionMode(s) === selectedMode).sort((a, b) => b.t - a.t);
}

/** The longest single hold ever, or null. This is THE number the trainer chases. */
export function plankBest(mode = 'front', side = null) {
  const selectedMode = okPlankMode(mode) ? mode : 'front';
  let best = null;
  for (const s of getPlanks().sessions) {
    if (plankSessionMode(s) !== selectedMode) continue;
    for (const set of (s.sets || [])) {
      if (selectedMode === 'side' && (side === 'L' || side === 'R') && set.side !== side) continue;
      if (selectedMode === 'side' && set.side !== 'L' && set.side !== 'R') continue;
      const sec = Number(set && set.sec) || 0;
      if (sec > 0 && (!best || sec > best.sec)) best = { sec, at: Number(set.at) || s.t, sessionId: s.id };
    }
  }
  return best;
}

/** Would this hold beat the record? MUST be asked BEFORE recording it.
 *  The first plank ever isn't a "new best" — there was nothing to beat. */
export function isPlankPB(sec, mode = 'front', side = null) {
  const n = Math.floor(Number(sec));
  if (!Number.isFinite(n) || n < MIN_PLANK_SEC) return false;
  const b = plankBest(mode, side);
  return !!b && n > b.sec;
}

/** One point per session, OLDEST first — the progress curve. */
export function plankProgress(mode = 'front') {
  const selectedMode = okPlankMode(mode) ? mode : 'front';
  return getPlanks().sessions
    .filter((s) => plankSessionMode(s) === selectedMode)
    .sort((a, b) => a.t - b.t)
    .map((s) => {
      const holds = (s.sets || []).filter((x) => Number(x && x.sec) > 0
        && (selectedMode !== 'side' || x.side === 'L' || x.side === 'R'));
      const secs = holds.map((x) => Number(x.sec) || 0);
      const left = selectedMode === 'side' ? secsForSide(holds, 'L') : [];
      const right = selectedMode === 'side' ? secsForSide(holds, 'R') : [];
      return {
        id: s.id, t: s.t,
        best: selectedMode === 'side'
          ? left.length && right.length ? Math.min(Math.max(...left), Math.max(...right)) : 0
          : secs.length ? Math.max(...secs) : 0,
        total: secs.reduce((a, b) => a + b, 0),
        sets: secs.length,
      };
    })
    .filter((p) => p.sets > 0);
}

function secsForSide(sets, side) {
  return sets.filter((x) => x.side === side).map((x) => Number(x.sec) || 0);
}

/* ---------- the plank run: hold / switch / rest / next-set state machine ----------
   Pure and timestamp-driven: every phase stores an ABSOLUTE time, never an
   accumulated counter, so a locked screen, a backgrounded tab or a full reload
   cannot make the clock drift. `now` is passed in, so the whole flow —
   including "what happens if the app was away for four minutes" — is testable
   without a browser. Nothing here touches storage; the screen persists the
   returned state and records finished holds itself. */
export const PLANK_ABANDON_MS = 30 * 60 * 1000; // a "hold" left running this long wasn't one

export function newPlankRun({ targetSets, restSec, mode = 'front' } = {}, now = Date.now()) {
  const ts = Number(targetSets), rs = Number(restSec);
  const selectedMode = okPlankMode(mode) ? mode : 'front';
  return {
    id: uid(),
    phase: 'ready',
    mode: selectedMode,
    side: selectedMode === 'side' ? 'L' : null,
    setIndex: 0,
    targetSets: okSets(ts) ? Math.round(ts) : PLANK_DEFAULTS.targetSets,
    restSec: okRest(rs) ? Math.round(rs) : PLANK_DEFAULTS.restSec,
    startAt: 0,
    switchEndAt: 0,
    switchTick: 0,
    restEndAt: 0,
    sets: [],
    lastEvent: null,
    createdAt: now,
  };
}

/** Seconds held so far in the running set (floored — never credit unheld time). */
export function plankHoldSec(run, now = Date.now()) {
  if (!run || run.phase !== 'hold' || !run.startAt) return 0;
  return Math.max(0, Math.floor((now - run.startAt) / 1000));
}
/** Seconds left of the rest countdown (0 when not resting / already over). */
export function plankRestSec(run, now = Date.now()) {
  if (!run || run.phase !== 'rest' || !run.restEndAt) return 0;
  return Math.max(0, Math.round((run.restEndAt - now) / 1000));
}

/** Seconds left in the switch countdown, rounded up to the next whole second. */
export function plankSwitchSec(run, now = Date.now()) {
  if (!run || run.phase !== 'switch' || !run.switchEndAt) return 0;
  return Math.max(0, Math.ceil((run.switchEndAt - now) / 1000));
}

function startRightSide(run, now, startAt = run.switchEndAt) {
  if (now - run.switchEndAt > PLANK_ABANDON_MS) {
    return { ...run, phase: 'ready', side: 'R', startAt: 0, switchEndAt: 0, switchTick: 0,
      restEndAt: 0, lastEvent: 'abandoned' };
  }
  return { ...run, phase: 'hold', side: 'R', startAt, switchEndAt: 0,
    switchTick: 0, restEndAt: 0, lastEvent: 'rightStarted' };
}

export function plankStep(run, action, now = Date.now()) {
  if (!run || !action) return run;
  const r = { ...run, sets: [...run.sets], lastEvent: null };
  switch (action.type) {
    case 'start':
      if (r.phase === 'hold') return run;
      r.phase = 'hold'; r.startAt = now; r.switchEndAt = 0; r.restEndAt = 0;
      return r;

    case 'stop': {
      if (r.phase !== 'hold') return run;
      const sec = plankHoldSec(run, now);
      r.startAt = 0;
      if (now - run.startAt >= PLANK_ABANDON_MS) { // left running, not held — same rule as a reload
        r.phase = 'ready'; r.switchEndAt = 0; r.restEndAt = 0; r.lastEvent = 'abandoned';
        return r;
      }
      if (sec < MIN_PLANK_SEC) { // a mis-tap, not a plank: nothing recorded, same set
        r.phase = 'ready'; r.switchEndAt = 0; r.restEndAt = 0; r.lastEvent = 'discarded';
        return r;
      }
      r.sets.push(r.mode === 'side' ? { sec, at: now, side: r.side } : { sec, at: now });
      r.lastEvent = 'recorded';
      if (r.mode === 'side' && r.side === 'L') {
        r.side = 'R'; r.phase = 'switch'; r.switchEndAt = now + PLANK_SWITCH_SEC * 1000;
        r.switchTick = 0; r.restEndAt = 0;
        return r;
      }
      r.setIndex = r.setIndex + 1;
      if (r.mode === 'side') { r.side = 'L'; r.switchEndAt = 0; r.switchTick = 0; }
      if (r.setIndex >= r.targetSets) { r.phase = 'done'; r.restEndAt = 0; return r; }
      if (r.restSec > 0) { r.phase = 'rest'; r.restEndAt = now + r.restSec * 1000; return r; }
      r.phase = 'ready'; r.restEndAt = 0;
      return r;
    }

    case 'cancel': // deliberately bin a hold in progress
      if (r.phase !== 'hold') return run;
      r.phase = 'ready'; r.startAt = 0; r.switchEndAt = 0; r.restEndAt = 0; r.lastEvent = 'cancelled';
      return r;

    case 'skipSwitch':
      if (r.phase !== 'switch') return run;
      return startRightSide(r, now, Math.min(now, r.switchEndAt));

    case 'skipRest':
      if (r.phase !== 'rest') return run;
      r.phase = 'ready'; r.restEndAt = 0;
      return r;

    case 'nudgeRest': {
      if (r.phase !== 'rest') return run;
      const d = Number(action.delta) || 0;
      r.restEndAt = Math.max(now + 1000, r.restEndAt + d * 1000); // never into the past
      return r;
    }

    case 'tick': // a countdown ran out (on screen, or while the phone was away)
      if (r.phase === 'switch') {
        if (plankSwitchSec(run, now) > 0) return run;
        return startRightSide(r, now);
      }
      if (r.phase !== 'rest' || plankRestSec(run, now) > 0) return run;
      r.phase = 'ready'; r.restEndAt = 0; r.lastEvent = 'restDone';
      return r;

    case 'addSet': // "one more" from the summary — keeps the same session
      if (!(r.mode === 'side' && r.side === 'R' && r.setIndex < r.targetSets)) {
        r.targetSets = Math.min(10, r.targetSets + 1);
      }
      r.phase = 'ready'; r.startAt = 0; r.switchEndAt = 0; r.switchTick = 0; r.restEndAt = 0;
      return r;

    case 'finish': // end early, keeping every hold already recorded
      r.phase = 'done'; r.startAt = 0; r.switchEndAt = 0; r.restEndAt = 0;
      return r;

    default:
      return run;
  }
}

/**
 * Re-enter a run persisted before a reload / background. A hold still inside the
 * plausible window keeps counting (the phone screen sleeping mid-plank is normal);
 * one left running past PLANK_ABANDON_MS was the app being left open, not a plank,
 * so it is dropped and NOTHING is recorded for it. A rest that expired meanwhile
 * simply opens the next set.
 */
export function plankResume(run, now = Date.now()) {
  if (!run) return run;
  if (run.phase === 'switch') {
    if (!run.switchEndAt) return { ...run, phase: 'ready', side: 'R', switchEndAt: 0, switchTick: 0, lastEvent: 'abandoned' };
    if (plankSwitchSec(run, now) <= 0) return startRightSide(run, now);
    return run;
  }
  if (run.phase === 'hold') {
    if (!run.startAt || now - run.startAt >= PLANK_ABANDON_MS) {
      return { ...run, phase: 'ready', startAt: 0, switchEndAt: 0, restEndAt: 0, lastEvent: 'abandoned' };
    }
    return run;
  }
  if (run.phase === 'rest' && plankRestSec(run, now) <= 0) {
    return { ...run, phase: 'ready', restEndAt: 0, lastEvent: 'restDone' };
  }
  return run;
}

/* ---------- device-local in-progress plank run (never synced) ---------- */
export function getPlankActive() { return read(KEY_PLANK_ACTIVE, null); }
export function setPlankActive(run) {
  if (run) localStorage.setItem(KEY_PLANK_ACTIVE, JSON.stringify(run));
  else localStorage.removeItem(KEY_PLANK_ACTIVE);
}

/**
 * Union a remote plank doc with the local one, for the pull path in sync.js —
 * the same "local work that never reached the cloud must survive" rule the
 * session and weight lists follow. Sessions merge by id, and sets merge WITHIN
 * a shared session (two devices can each add a hold to the same run), keyed by
 * duration+timestamp+side so re-pulling the same doc never duplicates a hold.
 * Only ever called when local has unpushed changes, so an untouched local copy
 * still lets a deletion made on another device stick.
 */
export function mergePlankDoc(remote, local) {
  const l = local && typeof local === 'object' && Array.isArray(local.sessions) ? local : null;
  if (!l || !l.sessions.length) return remote || null;
  if (!remote || typeof remote !== 'object' || !Array.isArray(remote.sessions)) return l;
  const out = { ...remote, sessions: remote.sessions.map((s) => ({ ...s, sets: [...(s.sets || [])] })) };
  const byId = new Map(out.sessions.map((s) => [s.id, s]));
  const setKey = (x) => `${Number(x && x.sec) || 0}@${Number(x && x.at) || 0}@${x && x.side || ''}`;
  for (const ls of l.sessions) {
    if (!ls || !ls.id) continue;
    const rs = byId.get(ls.id);
    if (!rs) { out.sessions.push({ ...ls, sets: [...(ls.sets || [])] }); continue; }
    const have = new Set((rs.sets || []).map(setKey));
    for (const set of (ls.sets || [])) if (!have.has(setKey(set))) { rs.sets.push(set); have.add(setKey(set)); }
    rs.sets.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  }
  out.sessions.sort((a, b) => a.t - b.t);
  return out;
}

/* ---------- interval trainer ----------
   Timed intervals (4×4, sprints, …) live in their own store, like planks — never
   in `plans` or `sessions`, so up-next, main History and the strength records
   cannot see them. The run state machine is pure (js/intervals.js); this is
   only storage + sync. */
export function getIntervals() {
  const raw = read(KEY_INTERVALS, null);
  const d = raw && typeof raw === 'object' ? raw : {};
  const pr = d.prefs && typeof d.prefs === 'object' ? d.prefs : {};
  return {
    ...d, // a newer version's extra sub-fields ride along untouched
    // junk from a hand-edited backup or a bad pull is dropped, so it can never
    // make the sort in saveIntervals throw and block every later save
    sessions: Array.isArray(d.sessions) ? d.sessions.filter((s) => s && typeof s === 'object' && s.id) : [],
    prefs: {
      ...pr,
      preset: IV.PRESETS.some((p) => p.id === pr.preset) ? pr.preset : IV.PRESETS[0].id,
      machine: IV.MACHINE_IDS.includes(pr.machine) ? pr.machine : IV.MACHINE_IDS[0],
      muted: !!pr.muted,
      cfgs: pr.cfgs && typeof pr.cfgs === 'object' ? pr.cfgs : {},
    },
  };
}
function saveIntervals(d) {
  d.sessions.sort((a, b) => a.t - b.t);
  write(KEY_INTERVALS, d);
}

export function intervalPrefs() { return getIntervals().prefs; }
export function setIntervalPrefs({ preset, machine, muted } = {}) {
  const d = getIntervals();
  if (IV.PRESETS.some((p) => p.id === preset)) d.prefs.preset = preset;
  if (IV.MACHINE_IDS.includes(machine)) d.prefs.machine = machine;
  if (muted !== undefined) d.prefs.muted = !!muted;
  saveIntervals(d);
  return d.prefs;
}
/** The timing a preset opens with: the saved edit, else its defaults. */
export function intervalCfg(presetId) {
  const p = IV.presetById(presetId);
  return IV.cleanCfg(getIntervals().prefs.cfgs[p.id] || p.cfg, p.cfg);
}
/** Save a preset's timing; a copy equal to the defaults is dropped. */
export function setIntervalCfg(presetId, cfg) {
  const p = IV.presetById(presetId);
  const d = getIntervals();
  const clean = IV.cleanCfg(cfg, p.cfg);
  if (IV.sameCfg(clean, p.cfg)) delete d.prefs.cfgs[p.id];
  else d.prefs.cfgs[p.id] = clean;
  saveIntervals(d);
  return clean;
}

/** Save a finished run once — the moment it ends. A second call for the same
 *  run id is refused, so a re-render or a double tap can never double-log. */
export function recordIntervalSession(session) {
  if (!session || !session.id) return null;
  const d = getIntervals();
  if (d.sessions.some((s) => s && s.id === session.id)) return null;
  const s = session.workoutId ? session : { ...session, ...activeWorkoutLink() };
  d.sessions.push(s);
  saveIntervals(d);
  return s;
}
export function setIntervalPace(id, pace) {
  const d = getIntervals();
  const s = d.sessions.find((x) => x && x.id === id);
  if (!s) return null;
  s.pace = pace == null ? null : IV.cleanPace(s.machine, pace);
  saveIntervals(d);
  return s;
}
export function deleteIntervalSession(id) {
  const d = getIntervals();
  d.sessions = d.sessions.filter((s) => s && s.id !== id);
  saveIntervals(d);
}
/** Interval sessions, newest first. */
export function getIntervalSessions() {
  return [...getIntervals().sessions].sort((a, b) => b.t - a.t);
}

/* device-local in-progress interval run (never synced) */
export function getIntervalActive() { return read(KEY_INTERVAL_ACTIVE, null); }
export function setIntervalActive(run) {
  if (run) localStorage.setItem(KEY_INTERVAL_ACTIVE, JSON.stringify(run));
  else localStorage.removeItem(KEY_INTERVAL_ACTIVE);
}

/**
 * Union a remote interval doc with the local one (pull path in sync.js), same
 * rule as planks: local work that never reached the cloud survives. Sessions
 * merge by id; for a shared id the remote copy wins, but a speed entered here
 * fills a remote gap. Remote prefs win. Only called when local has unpushed
 * changes, so an untouched local copy still lets a remote deletion stick.
 */
export function mergeIntervalDoc(remote, local) {
  const l = local && typeof local === 'object' && Array.isArray(local.sessions) ? local : null;
  if (!l || !l.sessions.length) return remote || null;
  if (!remote || typeof remote !== 'object' || !Array.isArray(remote.sessions)) return l;
  const out = { ...remote, sessions: remote.sessions.filter((s) => s && s.id).map((s) => ({ ...s })) };
  const byId = new Map(out.sessions.map((s) => [s.id, s]));
  for (const ls of l.sessions) {
    if (!ls || !ls.id) continue;
    const rs = byId.get(ls.id);
    if (!rs) { const copy = { ...ls }; out.sessions.push(copy); byId.set(ls.id, copy); continue; } // a repeated id collapses
    if (rs.pace == null && ls.pace != null) rs.pace = ls.pace;
  }
  out.sessions.sort((a, b) => a.t - b.t);
  return out;
}

/** Headline numbers for the trainer screen. */
export function plankStats(mode = 'front') {
  const selectedMode = okPlankMode(mode) ? mode : 'front';
  const pts = plankProgress(selectedMode);
  return {
    sessions: pts.length,
    totalSets: pts.reduce((a, p) => a + p.sets, 0),
    totalSec: pts.reduce((a, p) => a + p.total, 0),
    best: plankBest(selectedMode),
    last: pts.length ? pts[pts.length - 1] : null,
  };
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
      { key: 'minutes', label: 'Min', ph: 'min' },
      { key: 'incline', label: 'Incline', ph: 'incl' },
      { key: 'speed', label: 'Speed', ph: 'speed' },
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
 * The next loadable weight ABOVE `w`: the smallest multiple of `step` strictly
 * heavier than it. Snapping `w + step` to the grid can overshoot when `w`
 * itself isn't on the grid (a 4 kg machine on a 2.5 step would "graduate" to
 * 7.5) — this never jumps more than one real step.
 */
export function nextWeightUp(w, step) {
  const s = step > 0 ? step : DEFAULT_INC;
  return Math.round(((Math.floor(w / s + 1e-9) + 1) * s) * 100) / 100;
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
  const weights = lastSets.map((s) => N(s.weight)).filter((x) => x > 0);
  // Working weight = the heaviest load that actually produced reps IN the range
  // (>= min). A too-heavy attempt that got dumped after a few reps (7 @ 80kg,
  // then back to 60) must not become the weight to chase. If no set reached the
  // range bottom at all, fall back to the heaviest weight used.
  const inRange = lastSets.filter((s) => N(s.weight) > 0 && N(s.reps) >= min);
  const w = inRange.length ? Math.max(...inRange.map((s) => N(s.weight)))
    : weights.length ? Math.max(...weights) : 0;
  // sets done at the top working weight — warm-up sets at a lighter weight don't
  // count toward graduating (bodyweight: every set, since they're all weight 0).
  const topWorking = w > 0 ? lastSets.filter((s) => N(s.weight) === w) : lastSets;
  const need = Math.max(1, targetSets);
  // Graduate only after completing ALL planned sets at the top of the range, at
  // the top weight — so a single logged set (or a partial session) won't bump.
  const hitTop = topWorking.length >= need && topWorking.every((s) => N(s.reps) >= max);
  if (hitTop && w > 0) {
    const nw = nextWeightUp(w, inc); // next real, loadable weight above the current one
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
/** A plan is cardio-only when every exercise is a cardio kind (a lifting plan
 *  with a cardio finisher does NOT count). Cardio is done spontaneously, so
 *  these plans stay out of the up-next rotation entirely. */
export function isCardioPlan(p) {
  return !!(p && p.exercises && p.exercises.length && p.exercises.every(isCardio));
}
/** The plan that's up next: the one after the most recently trained plan in
 *  list order (wraps around). No history yet -> the first plan. Cardio-only
 *  plans are not part of the queue — never marked next, and logging a cardio
 *  session never advances the rotation. */
export function nextPlanId() {
  const rot = getPlans().filter((p) => !isCardioPlan(p));
  if (!rot.length) return null;
  const last = getSessions().find((s) => rot.some((p) => p.id === s.planId));
  if (!last) return rot[0].id;
  const i = rot.findIndex((p) => p.id === last.planId);
  return rot[(i + 1) % rot.length].id;
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
/** Replace a saved session in place (history editing). No-op if the id is gone. */
export function updateSession(session) {
  const sessions = read(KEY_SESSIONS, []);
  const i = sessions.findIndex((s) => s.id === session.id);
  if (i === -1) return null;
  sessions[i] = session;
  write(KEY_SESSIONS, sessions);
  return session;
}

/**
 * Build the SAVED entries for a finished session from an in-progress workout:
 * only the sets the user actually logged (`done`), normalised to numbers. Shared
 * by the manual Finish button and the idle auto-finish so both save an identical
 * shape. Pure (no storage) — safe to unit test.
 */
export function buildSessionEntries(active) {
  const out = [];
  for (const en of Object.values((active && active.entries) || {})) {
    const cardio = isCardio(en);
    const fields = cardio ? (en.fields || cardioFields(en.kind)) : null;
    const sets = (en.sets || [])
      .filter((s) => s.done)
      .map((s) => {
        if (cardio) { const o = {}; for (const f of fields) o[f.key] = Number(s[f.key]) || 0; return o; }
        return { reps: Number(s.reps) || 0, weight: Number(s.weight) || 0 };
      });
    if (sets.length) out.push({ exerciseId: en.exerciseId, name: en.name, kind: en.kind || 'strength', sets });
  }
  return out;
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
/** The open workout as {workoutId, workoutPlan}, or null when none is open.
 *  Plank and interval sessions recorded meanwhile carry it, so a day reads as
 *  one visit ("Push + planks") instead of loose records. workoutId is the id
 *  the workout's session is saved under when it finishes. */
export function activeWorkoutLink() {
  const a = getActive();
  return a && a.id ? { workoutId: a.id, workoutPlan: a.planName || null } : null;
}
export function setActive(active) {
  if (active) write(KEY_ACTIVE, active);
  else localStorage.removeItem(KEY_ACTIVE);
}
/** Stamp the active workout's last-interaction time (drives the idle watchdog).
 *  Cheap — writes only KEY_ACTIVE, never triggers cloud sync. Returns the active
 *  workout with the new timestamp, or null if none is in progress. */
export function touchActive() {
  const a = getActive();
  if (!a) return null;
  a.lastActivityAt = Date.now();
  setActive(a);
  return a;
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
  if (has('plank', 'crunch', 'sit-up', 'situp', 'ab ', 'abs', 'leg raise', 'knee raise', 'russian twist', 'hollow', 'oblique', 'woodchop')) return 'Core';
  if (has('upright row', 'overhead press', 'ohp', 'shoulder', 'lateral raise', 'military', 'arnold', 'rear delt', 'shrug')) return 'Shoulders';
  if (has('leg press', 'leg curl', 'leg extension', 'squat', 'lunge', 'calf', 'romanian', 'rdl', 'hip thrust', 'glute', 'hamstring', 'quad', 'step-up', 'step up')) return 'Legs';
  if (has('bench', 'chest', 'fly', 'flye', 'push-up', 'push up', 'pushup', 'dip', 'pec')) return 'Chest';
  if (has('row', 'pull-up', 'pull up', 'pullup', 'pulldown', 'lat ', 'lat-', 'chin', 'face pull', 'deadlift', 'back extension', 'hyperextension')) return 'Back';
  if (has('curl', 'tricep', 'triceps', 'pushdown', 'bicep', 'biceps', 'skull', 'hammer', 'preacher', 'kickback', 'forearm')) return 'Arms';
  return 'Other';
}

/* ---------- export / import (backup) ---------- */
export function exportAll() {
  // Everything that syncs, so a backup can't silently drop a record the app
  // still shows (weigh-ins, the goal, plank PBs, interval sessions) — importAll
  // only applies the keys it finds, so an older backup without them still restores fine.
  return JSON.stringify(
    {
      plans: getPlans(), sessions: read(KEY_SESSIONS, []),
      weights: read(KEY_WEIGHTS, null), goal: getGoal(), planks: read(KEY_PLANKS, null),
      intervals: read(KEY_INTERVALS, null),
      v: 1,
    },
    null,
    2
  );
}
/** Wipe ALL local data (plans, history, planks, intervals, in-progress runs) on
 *  this device. Marks the change so the empty state also syncs to the cloud. */
export function resetAll() {
  localStorage.removeItem(KEY_PLANS);
  localStorage.removeItem(KEY_SESSIONS);
  localStorage.removeItem(KEY_ACTIVE);
  localStorage.removeItem(KEY_PLANKS);
  localStorage.removeItem(KEY_PLANK_ACTIVE);
  localStorage.removeItem(KEY_INTERVALS);
  localStorage.removeItem(KEY_INTERVAL_ACTIVE);
  stampChange();
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
  // Newer backup fields: applied only when present, so an old file still works.
  if (data.weights && Array.isArray(data.weights.entries)) write(KEY_WEIGHTS, data.weights);
  if (data.goal && typeof data.goal === 'object') write(KEY_GOAL, data.goal);
  if (data.planks && Array.isArray(data.planks.sessions)) write(KEY_PLANKS, data.planks);
  if (data.intervals && Array.isArray(data.intervals.sessions)) write(KEY_INTERVALS, data.intervals);
}
