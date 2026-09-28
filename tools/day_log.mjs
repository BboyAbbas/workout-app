/* Day-by-day view of the synced doc, for reading training history at a glance.
   Each day lists its workouts with the plank and interval sessions done DURING
   them nested underneath (linked by workoutId), then whatever was done on its
   own that day (a plank-only evening, an interval-only session).

     import { dayLog, formatDayLog } from './day_log.mjs';
     const days = dayLog(doc.data, { days: 30 });   // structured, newest day first
     console.log(formatDayLog(days));               // readable text

   Pure: no storage, no network. Dates are the machine's local time. */
import { PRESETS } from '../js/intervals.js';
import { treadmillEstimate, fmtTreadmill } from '../js/ui.js';

const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const hhmm = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const mss = (s) => `${Math.floor(s / 60)}:${pad2(Math.round(s % 60))}`;
const isCardioEntry = (e) => !!e && e.kind != null && e.kind !== 'strength';

function workoutView(s) {
  const exercises = (s.entries || []).map((e) => ({ name: e.name, kind: e.kind || 'strength', sets: e.sets || [] }));
  const cardio = exercises.filter(isCardioEntry).length;
  return {
    id: s.id, type: 'workout', plan: s.planName || '', start: s.startedAt,
    kind: !exercises.length ? 'empty' : cardio === exercises.length ? 'cardio only' : cardio ? 'strength + cardio' : 'strength',
    clockMin: Math.round((Number(s.durationSec) || 0) / 60),
    exercises, planks: [], intervals: [],
  };
}
function plankView(p) {
  return {
    id: p.id, type: 'plank', start: p.t, mode: p.mode === 'side' ? 'side' : 'front',
    holds: (p.sets || []).map((x) => ({ sec: Number(x.sec) || 0, side: x.side || null })),
    workoutId: p.workoutId || null, workoutPlan: p.workoutPlan || null,
  };
}
function intervalView(s) {
  const preset = PRESETS.find((p) => p.id === s.preset);
  return {
    id: s.id, type: 'interval', start: s.t, preset: preset ? preset.name : s.preset, machine: s.machine,
    rounds: s.roundsDone ?? null, ofRounds: s.cfg && s.cfg.rounds != null ? s.cfg.rounds : null,
    hardMin: Math.round((Number(s.hardSec) || 0) / 60), totalMin: Math.round((Number(s.totalSec) || 0) / 60),
    pace: s.pace ?? null, workoutId: s.workoutId || null, workoutPlan: s.workoutPlan || s.after || null,
  };
}

/** Structured days, newest first. `days`: only the last N calendar days (default all). */
export function dayLog(data, { days = null, now = Date.now() } = {}) {
  const d = data || {};
  const workouts = (Array.isArray(d.sessions) ? d.sessions : []).filter((s) => s && s.id).map(workoutView);
  const planks = ((d.planks && d.planks.sessions) || []).filter((p) => p && p.id).map(plankView);
  const intervals = ((d.intervals && d.intervals.sessions) || []).filter((s) => s && s.id).map(intervalView);
  const byId = new Map(workouts.map((w) => [w.id, w]));
  const loose = [];
  for (const x of [...planks, ...intervals]) {
    const w = x.workoutId && byId.get(x.workoutId);
    if (w) (x.type === 'plank' ? w.planks : w.intervals).push(x);
    else loose.push(x); // on its own — or its workout was never saved (workoutPlan still says which)
  }
  const out = new Map();
  const at = (t) => { const k = dayKey(t); if (!out.has(k)) out.set(k, { date: k, workouts: [], alone: [] }); return out.get(k); };
  for (const w of workouts) at(w.start).workouts.push(w);
  for (const x of loose) at(x.start).alone.push(x);
  const cutoff = days ? dayKey(now - (days - 1) * 86400000) : '';
  return [...out.values()]
    .filter((day) => day.date >= cutoff)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((day) => {
      day.workouts.sort((a, b) => a.start - b.start);
      day.alone.sort((a, b) => a.start - b.start);
      for (const w of day.workouts) { w.planks.sort((a, b) => a.start - b.start); w.intervals.sort((a, b) => a.start - b.start); }
      return day;
    });
}

function plankLine(p) {
  const holds = p.holds.map((h) => (h.side ? `${h.side} ` : '') + mss(h.sec)).join(', ');
  return `plank ${p.mode} · ${p.holds.length} hold${p.holds.length === 1 ? '' : 's'} (${holds})`;
}
function intervalLine(s) {
  const rounds = s.rounds != null ? ` · ${s.rounds}${s.ofRounds != null ? '/' + s.ofRounds : ''} rounds` : '';
  const pace = s.pace != null ? ` · ${s.pace}${s.machine === 'bike' ? ' lvl' : ' km/h'}` : '';
  return `intervals ${s.preset} · ${s.machine}${rounds} · ${s.hardMin} min hard / ${s.totalMin} min total${pace}`;
}
function setsText(e) {
  if (!isCardioEntry(e)) {
    const n = e.sets.length;
    const top = Math.max(0, ...e.sets.map((s) => Number(s.weight) || 0));
    return `${n} set${n === 1 ? '' : 's'}${top ? ` · top ${top} kg` : ''}`;
  }
  const min = e.sets.reduce((m, s) => m + (Number(s.minutes) || 0), 0);
  const first = e.sets[0] || {};
  const extra = Object.keys(first).filter((k) => k !== 'minutes').map((k) => `${k} ${first[k]}`);
  // treadmill: summed distance + steps (steps only when every set's speed is in the table)
  const ests = e.sets.map((s) => treadmillEstimate(s.minutes, s.speed)).filter(Boolean);
  const tm = ests.length ? fmtTreadmill({
    miles: ests.reduce((a, x) => a + x.miles, 0),
    steps: ests.every((x) => x.steps != null) ? ests.reduce((a, x) => a + x.steps, 0) : null,
  }) : '';
  return [`${min} min`, ...extra, tm].filter(Boolean).join(' · ');
}

/** Readable text of dayLog() output. */
export function formatDayLog(days) {
  const lines = [];
  for (const day of days) {
    const wd = new Date(day.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
    const parts = [...day.workouts.map((w) => `${w.plan}${w.planks.length ? ' + plank' : ''}${w.intervals.length ? ' + intervals' : ''}`)];
    for (const type of ['plank', 'interval']) {
      const n = day.alone.filter((x) => x.type === type).length;
      if (n) parts.push(`${type === 'plank' ? 'plank' : 'intervals'} only${n > 1 ? ` ×${n}` : ''}`);
    }
    lines.push(`${day.date} ${wd} — ${parts.join(' · ')}`);
    for (const w of day.workouts) {
      lines.push(`  ${hhmm(w.start)} WORKOUT ${w.plan} (${w.kind}) · clock ${w.clockMin} min`);
      for (const e of w.exercises) lines.push(`        ${e.name}: ${setsText(e)}`);
      for (const p of w.planks) lines.push(`    + ${hhmm(p.start)} during it: ${plankLine(p)}`);
      for (const s of w.intervals) lines.push(`    + ${hhmm(s.start)} during it: ${intervalLine(s)}`);
    }
    for (const x of day.alone) {
      const orphan = x.workoutId ? ` (during a ${x.workoutPlan || ''} workout that was never saved)` : '';
      lines.push(`  ${hhmm(x.start)} ON ITS OWN: ${x.type === 'plank' ? plankLine(x) : intervalLine(x)}${orphan}`);
    }
  }
  return lines.join('\n');
}
