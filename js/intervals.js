/* ============================================================
   intervals.js — the Interval Trainer's pure logic.
   Presets, the block list, the timestamp-driven run state machine,
   counting, cues and the speed target. No DOM and no storage:
   db.js persists, app.js renders. `now` is always passed in, so
   every flow — including "the phone was away for nine minutes" —
   is testable under node.
   ============================================================ */

export const MACHINES = {
  treadmill: { id: 'treadmill', name: 'Treadmill', word: 'speed', ask: 'Speed on the hard rounds', unit: 'km/h',
    step: 0.5, min: 1, max: 25, start: 10, easyHint: 'easy jog or walk' },
  bike: { id: 'bike', name: 'Bike', word: 'level', ask: 'Level on the hard rounds', unit: 'level',
    step: 1, min: 1, max: 40, start: 10, easyHint: 'easy spin' },
};
export const MACHINE_IDS = ['treadmill', 'bike'];

/* 4×4 and 10×1: NTNU CERG (ntnu.edu/cerg/advice) — 10 min warm-up, 3 min active
   breaks, 5 min cool-down, all at 60–70 % HRmax. Sprints: 20–30 s all-out,
   1–2 min easy, 6–8 times. Tabata: 20/10 × 8 (Tabata et al. 1996). */
export const PRESETS = [
  { id: '4x4', chip: '4×4', name: 'Norwegian 4×4', blurb: 'Raises VO₂ max · 1–2× a week', hardHint: 'only a few words out',
    cfg: { warmSec: 600, hardSec: 240, easySec: 180, rounds: 4, coolSec: 300 } },
  { id: 'sprints', chip: 'Sprints', name: 'Sprints', blurb: 'Quick bursts · recover between them', hardHint: 'all-out',
    cfg: { warmSec: 600, hardSec: 30, easySec: 90, rounds: 8, coolSec: 300 } },
  { id: 'tabata', chip: 'Tabata', name: 'Tabata', blurb: '20 s on / 10 s off', hardHint: 'all-out',
    cfg: { warmSec: 300, hardSec: 20, easySec: 10, rounds: 8, coolSec: 300 } },
  { id: '10x1', chip: '10×1', name: '10×1', blurb: '1 min hard / 1 min easy', hardHint: 'hard but steady',
    cfg: { warmSec: 600, hardSec: 60, easySec: 60, rounds: 10, coolSec: 300 } },
  { id: 'custom', chip: 'Custom', name: 'Custom', blurb: 'Your own mix', hardHint: 'hard',
    cfg: { warmSec: 600, hardSec: 240, easySec: 180, rounds: 4, coolSec: 300 } },
];
export function presetById(id) { return PRESETS.find((p) => p.id === id) || PRESETS[0]; }

export const KIND_NAME = { warm: 'Warm-up', hard: 'Hard', easy: 'Easy', cool: 'Cool-down' };
export const KIND_WORD = { warm: 'Warm up', hard: 'Go hard', easy: 'Easy', cool: 'Cool down' };

export const FINISHER_WARM_SEC = 180;           // already warm after a workout
export const WEEK_TARGET = 2;                   // the 4×4 dose: 1–2 sessions a week
export const HEADS_UP_SEC = 7;                  // warning before every switch
export const HEARTBEAT_MS = 5000;               // how often a live run stamps seenAt
export const ABANDON_MS = 30 * 60 * 1000;       // paused / unseen this long = walked away
export const SUMMARY_TTL_MS = 6 * 3600 * 1000;  // an un-dismissed summary survives this long
export const ROUND_DONE_FRACTION = 0.9;         // a skip near the end still counts the round

/* ---------- settings ---------- */
const LIMITS = {
  warmSec: { min: 0, max: 1200 }, hardSec: { min: 5, max: 600 }, easySec: { min: 5, max: 600 },
  rounds: { min: 1, max: 20 }, coolSec: { min: 0, max: 1200 },
};
const FIELDS = Object.keys(LIMITS);

/** Any cfg-shaped value → five safe whole numbers (missing/junk fields take `fallback`). */
export function cleanCfg(cfg, fallback = PRESETS[0].cfg) {
  const out = {};
  for (const k of FIELDS) {
    const raw = cfg ? cfg[k] : undefined;
    const n = raw == null || raw === '' ? NaN : Math.round(Number(raw));
    out[k] = Number.isFinite(n) ? Math.max(LIMITS[k].min, Math.min(LIMITS[k].max, n)) : fallback[k];
  }
  return out;
}
export function sameCfg(a, b) { return FIELDS.every((k) => a[k] === b[k]); }

/** One −/+ tap. Warm-up/cool-down move a minute; hard/easy 5 s under a minute,
 *  15 s from a minute up (going down from exactly 1:00 uses the small step). */
export function stepField(field, value, dir) {
  const L = LIMITS[field];
  if (!L) return value;
  const v = Number(value) || 0;
  let next;
  if (field === 'rounds') next = v + dir;
  else if (field === 'warmSec' || field === 'coolSec') next = v + 60 * dir;
  else next = v + ((dir > 0 ? v < 60 : v <= 60) ? 5 : 15) * dir;
  return Math.max(L.min, Math.min(L.max, next));
}

/** warm-up, then hard/easy per round (no easy after the last), then cool-down.
 *  An easy block carries the round it follows. */
export function buildBlocks(cfg) {
  const c = cleanCfg(cfg);
  const b = [];
  if (c.warmSec > 0) b.push({ kind: 'warm', sec: c.warmSec, round: 0 });
  for (let r = 1; r <= c.rounds; r++) {
    b.push({ kind: 'hard', sec: c.hardSec, round: r });
    if (r < c.rounds) b.push({ kind: 'easy', sec: c.easySec, round: r });
  }
  if (c.coolSec > 0) b.push({ kind: 'cool', sec: c.coolSec, round: 0 });
  return b;
}
export function planTotals(cfg) {
  const b = buildBlocks(cfg);
  return {
    totalSec: b.reduce((a, x) => a + x.sec, 0),
    hardSec: b.filter((x) => x.kind === 'hard').reduce((a, x) => a + x.sec, 0),
  };
}
export function fmtBlock(sec) { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export function fmtMinutes(sec) { return sec % 60 === 0 ? `${sec / 60} min` : fmtBlock(sec); }

/* ---------- the run ----------
   The current block stores the ABSOLUTE time it started (shifted forward by any
   pause), never a counted tick, so a locked screen or a reload cannot drift.
   spent[i] = seconds actually run in block i, written when the block ends. */
export function newIntervalRun({ id, preset, machine, cfg, from = null, target = null }, now = Date.now()) {
  const c = cleanCfg(cfg);
  return {
    id, preset, machine, cfg: c, from, target,
    phase: 'run', startedAt: now, endedAt: 0,
    idx: 0, blockStartAt: now, pausedAt: 0,
    spent: buildBlocks(c).map(() => 0),
    seenAt: now, lastEvent: null, saved: false, recorded: false,
  };
}
export function currentBlock(run) { return run ? buildBlocks(run.cfg)[run.idx] || null : null; }
export function nextBlock(run) { return run ? buildBlocks(run.cfg)[run.idx + 1] || null : null; }
function inBlockMs(run, now) { return Math.max(0, (run.pausedAt || now) - run.blockStartAt); }
export function blockLeftSec(run, now = Date.now()) {
  const b = run && run.phase === 'run' ? currentBlock(run) : null;
  return b ? Math.max(0, Math.ceil((b.sec * 1000 - inBlockMs(run, now)) / 1000)) : 0;
}
export function sessionLeftSec(run, now = Date.now()) {
  if (!run || run.phase !== 'run') return 0;
  const blocks = buildBlocks(run.cfg);
  let s = blockLeftSec(run, now);
  for (let i = run.idx + 1; i < blocks.length; i++) s += blocks[i].sec;
  return s;
}

export function intervalStep(run, action, now = Date.now()) {
  if (!run || !action || run.phase !== 'run') return run;
  const blocks = buildBlocks(run.cfg);
  const r = { ...run, spent: [...run.spent], lastEvent: null };
  const finish = (at) => { r.phase = 'done'; r.endedAt = at; r.pausedAt = 0; r.lastEvent = 'done'; return r; };
  const ranSec = () => Math.min(blocks[r.idx].sec, Math.floor(inBlockMs(run, now) / 1000));

  switch (action.type) {
    case 'tick': { // the block ran out (on screen, or any number of times while away)
      if (r.pausedAt) return run;
      let moved = false;
      while (r.idx < blocks.length && now - r.blockStartAt >= blocks[r.idx].sec * 1000) {
        r.spent[r.idx] = blocks[r.idx].sec;
        r.blockStartAt += blocks[r.idx].sec * 1000;
        r.idx++;
        moved = true;
      }
      if (!moved) return run;
      if (r.idx >= blocks.length) return finish(r.blockStartAt);
      r.lastEvent = 'switch';
      return r;
    }
    case 'pause':
      if (r.pausedAt) return run;
      r.pausedAt = now; r.lastEvent = 'paused';
      return r;
    case 'resume':
      if (!r.pausedAt) return run;
      r.blockStartAt += now - r.pausedAt; r.pausedAt = 0; r.lastEvent = 'resumed';
      return r;
    case 'skip':
      r.spent[r.idx] = ranSec();
      r.idx++;
      if (r.idx >= blocks.length) return finish(r.pausedAt || now);
      r.blockStartAt = now;
      if (r.pausedAt) r.pausedAt = now;
      r.lastEvent = 'switch';
      return r;
    case 'back':
      if (inBlockMs(run, now) > 3000 || r.idx === 0) { r.lastEvent = 'restart'; }
      else { r.idx--; r.spent[r.idx] = 0; r.lastEvent = 'switch'; }
      r.blockStartAt = now;
      if (r.pausedAt) r.pausedAt = now;
      return r;
    case 'end':
      r.spent[r.idx] = ranSec();
      return finish(r.pausedAt || now);
    case 'heartbeat':
      r.seenAt = now;
      return r;
    default:
      return run;
  }
}

/** Re-enter a persisted run. Same object back when nothing changed. */
export function intervalResume(run, now = Date.now()) {
  if (!run) return null;
  if (run.phase === 'done') return now - (run.endedAt || 0) > SUMMARY_TTL_MS ? null : run;
  if (run.pausedAt) {
    if (now - run.pausedAt <= ABANDON_MS) return run;
    return { ...intervalStep(run, { type: 'end' }, run.pausedAt), lastEvent: 'abandoned' };
  }
  const seen = run.seenAt || run.startedAt;
  if (now - seen > ABANDON_MS) {
    const caught = intervalStep(run, { type: 'tick' }, seen);
    const ended = caught.phase === 'done' ? caught : intervalStep(caught, { type: 'end' }, seen);
    return { ...ended, lastEvent: 'abandoned' };
  }
  return intervalStep(run, { type: 'tick' }, now);
}

export function runStats(run) {
  const blocks = buildBlocks(run.cfg);
  let hardSec = 0, totalSec = 0, roundsDone = 0;
  blocks.forEach((b, i) => {
    const s = Math.max(0, Math.min(b.sec, Number(run.spent[i]) || 0));
    totalSec += s;
    if (b.kind === 'hard') {
      hardSec += s;
      if (s >= b.sec * ROUND_DONE_FRACTION) roundsDone++;
    }
  });
  return { hardSec, totalSec, roundsDone, rounds: run.cfg.rounds };
}

/** The stored record for a finished run (the speed is added afterwards). */
export function toSession(run) {
  const st = runStats(run);
  return {
    id: run.id, t: run.startedAt, endedAt: run.endedAt,
    preset: run.preset, machine: run.machine, cfg: { ...run.cfg },
    roundsDone: st.roundsDone, hardSec: st.hardSec, totalSec: st.totalSec,
    pace: null, after: run.from ? run.from.planName || null : null,
  };
}

/* ---------- cues ---------- */
export function cueAt(blockSec, leftSec) {
  if (leftSec === HEADS_UP_SEC && blockSec > 10) return 'heads';
  if (leftSec >= 1 && leftSec <= 3 && blockSec >= 5) return 'tick';
  return null;
}
export function voiceLine(block, run, spokenTarget = '') {
  if (!block) return 'Session done.';
  if (block.kind === 'warm') return 'Warm up. Easy pace.';
  if (block.kind === 'cool') return 'Cool down. Easy pace.';
  if (block.kind === 'easy') return 'Easy. Recover.';
  return `Round ${block.round} of ${run.cfg.rounds}. Go hard.${spokenTarget ? ` ${spokenTarget}.` : ''}`;
}

/* ---------- speed (treadmill km/h, bike level) ---------- */
export function cleanPace(machine, v) {
  const m = MACHINES[machine] || MACHINES.treadmill;
  if (v == null || v === '') return null;
  const n = Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const r = m.step < 1 ? Math.round(n * 10) / 10 : Math.round(n);
  return Math.max(m.min, Math.min(m.max, r));
}
export function stepPace(machine, v, dir) {
  const m = MACHINES[machine] || MACHINES.treadmill;
  const base = cleanPace(machine, v) ?? m.start;
  return cleanPace(machine, base + m.step * dir);
}
export function fmtPace(machine, pace) {
  if (pace == null || !Number.isFinite(Number(pace))) return '';
  return machine === 'bike' ? `L${Math.round(pace)}` : `${Number(pace).toFixed(1)} km/h`;
}
export function fmtPaceShort(machine, pace) {
  if (pace == null) return '';
  return machine === 'bike' ? `L${Math.round(pace)}` : Number(pace).toFixed(1);
}
export function fmtPaceInput(machine, pace) {
  if (pace == null) return '';
  return machine === 'bike' ? String(Math.round(pace)) : Number(pace).toFixed(1);
}
export function spokenPace(machine, pace) {
  if (pace == null) return '';
  return machine === 'bike' ? `Level ${Math.round(pace)}` : Number(pace).toFixed(1);
}

/* ---------- history ---------- */
const withPace = (sessions, preset, machine) =>
  (sessions || []).filter((s) => s && s.preset === preset && s.machine === machine && s.pace != null);
export function lastWithPace(sessions, preset, machine) {
  return withPace(sessions, preset, machine).sort((a, b) => b.t - a.t)[0] || null;
}
/** One step up only when the last session with a speed finished every round. */
export function paceTarget(sessions, preset, machine) {
  const last = lastWithPace(sessions, preset, machine);
  if (!last) return null;
  const full = last.roundsDone >= ((last.cfg && last.cfg.rounds) || Infinity);
  return full ? cleanPace(machine, last.pace + (MACHINES[machine] || MACHINES.treadmill).step) : last.pace;
}
export function bestPace(sessions, preset, machine) {
  const p = withPace(sessions, preset, machine).map((s) => Number(s.pace));
  return p.length ? Math.max(...p) : null;
}
/** Sessions with at least one round since Monday 00:00 local (the heatmap's week). */
export function weekCount(sessions, now = Date.now()) {
  const d = new Date(now);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
  return (sessions || []).filter((s) => s && s.t >= monday && (Number(s.roundsDone) || 0) >= 1).length;
}
