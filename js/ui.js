/* ============================================================
   ui.js — pure presentation helpers (no storage, no state)
   Formatting, escaping, inline SVG icons, and the toast.
   ============================================================ */

/** Escape user text before putting it in innerHTML. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Live clock for the running timer: H:MM:SS or MM:SS. */
export function fmtClock(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Compact duration for history rows: "42m", "1h 05m", "38s". */
export function fmtDuration(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  if (s < 60) return `${s}s`;
  // round to whole minutes FIRST, then split, so 7199s -> "2h 00m" (not "1h 60m")
  const totalMin = Math.round(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

/** A plank hold, read at a glance: "47s" under a minute, "1:47" over it. */
export function fmtHold(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Integer with thousands separators, e.g. 12540 -> "12,540". */
export function fmtInt(n) {
  return Math.round(n || 0).toLocaleString();
}

/** Friendly date: "Today", "Yesterday", else "Mon 12 Jun". */
export function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayMs = 86400000;
  const diff = Math.round((startOf(now) - startOf(d)) / dayMs);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

/** Relative day count: "today", "yesterday", else "5 days ago". */
export function fmtAgo(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  return `${diff} days ago`;
}

/** Time of day, e.g. "7:42 AM". */
export function fmtTime(ts) {
  const d = new Date(ts);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

/** Inline SVG icons (stroke = currentColor so they theme automatically). */
const svg = (paths, extra = '') =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;

export const icons = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  play: svg('<path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
  edit: svg('<path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/>'),
  history: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>'),
  chart: svg('<path d="M3 21h18M7 21V11M12 21V5M17 21V14"/>'),
  check: svg('<path d="M20 6L9 17l-5-5"/>'),
  more: svg('<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>'),
  dumbbell: svg('<path d="M6.5 6.5l11 11M3 9l3-3 3 3-3 3zM15 15l3-3 3 3-3 3z"/>'),
  flame: svg('<path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s1 2 2 2c0-3 2-5 2-8z"/>'),
  up: svg('<path d="M3 17l6-6 4 4 7-7M14 8h6v6"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  cloud: svg('<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>'),
  timer: svg('<path d="M10 2.5h4"/><path d="M12 14V9.5"/><circle cx="12" cy="14" r="8"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5H5v1a3 3 0 0 0 3 3M16 5h3v1a3 3 0 0 1-3 3"/><path d="M12 13v4M9 21h6M10 17h4"/>'),
  pulse: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  sound: svg('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'),
  muted: svg('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/>'),
  pause: svg('<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>'),
  next: svg('<path d="M5 4.5l10 7.5-10 7.5z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>'),
  prev: svg('<path d="M19 19.5L9 12l10-7.5z" fill="currentColor" stroke="none"/><path d="M5 5v14"/>'),
};

/** Transient toast message. */
let toastTimer = null;
export function toast(msg) {
  let el = document.querySelector('.toast');
  if (el) el.remove();
  el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 1900);
}

/**
 * Plain-language summary of a set list — units always shown, no mental math.
 *   same reps + weight   -> "3 sets of 10 reps · 12.5 kg"
 *   same weight, reps differ -> "8, 8, 7 reps · 12.5 kg"   (weight stated once)
 *   weights differ        -> "8 reps · 12.5 kg, 6 reps · 15 kg"  (per set)
 *   bodyweight            -> drops the "· N kg" part
 */
export function summariseSets(sets) {
  if (!sets || !sets.length) return '';
  const done = sets.filter((s) => s.reps != null && s.reps !== '');
  if (!done.length) return '';
  const wNum = (s) => (s.weight == null || s.weight === '' ? 0 : +s.weight);
  const reps = done.map((s) => s.reps);
  const weights = done.map(wNum);
  const sameReps = reps.every((r) => r === reps[0]);
  const sameWeight = weights.every((w) => w === weights[0]);
  const loaded = weights.some((w) => w > 0);

  if (sameWeight) {
    const repPart = sameReps
      ? `${done.length} ${done.length === 1 ? 'set' : 'sets'} of ${reps[0]} reps`
      : `${reps.join(', ')} reps`;
    return loaded ? `${repPart} · ${weights[0]} kg` : repPart;
  }
  // weights differ across sets — list each one with full units
  return done
    .map((s) => (wNum(s) ? `${s.reps} reps · ${wNum(s)} kg` : `${s.reps} reps`))
    .join(', ');
}

/**
 * Plain-language summary of cardio sets, e.g. "incline 12 · speed 3 · 30 min".
 * `fields` is the kind's field list ([{key,label}]) passed in by the caller so
 * this stays decoupled from the data layer.
 */
export function summariseCardio(sets, fields) {
  const done = (sets || []).filter((s) => s && s.minutes != null && s.minutes !== '');
  if (!done.length) return '';
  const treadmill = (fields || []).some((f) => f.key === 'speed');
  const one = (s) => [...(fields || []).map((f) => {
    const v = s[f.key];
    if (v == null || v === '') return null;
    return f.key === 'minutes' ? `${v} min` : `${f.label.toLowerCase()} ${v}`;
  }), treadmill ? fmtTreadmill(treadmillEstimate(s.minutes, s.speed)) : null].filter(Boolean).join(' · ');
  return done.map(one).join(', ');
}

/* ---------- treadmill distance + steps ----------
   Distance is belt distance: speed × time, with speed in mph as the gym's
   treadmill shows it — the same number as the machine's own "distance".
   Steps = minutes × walking cadence at that speed, interpolated from the
   CADENCE-Adults level-treadmill table (Tudor-Locke et al. 2019, IJBNPA 16:8,
   76 adults, mean height 170.7 cm). Incline is left out: at a set belt speed it
   shifts cadence only slightly and not consistently. Outside the measured
   0.5–5.5 mph range steps are not estimated (distance still is). */
const CADENCE_MPH = [[0.5, 45.4], [1, 67.8], [1.5, 83.8], [2, 96.1], [2.5, 105.8], [3, 113.6],
  [3.5, 121.5], [4, 129.0], [4.5, 139.9], [5, 146.4], [5.5, 152.0]];
const toNum = (v) => Number(String(v ?? '').replace(',', '.'));
/** Steps per minute at a treadmill speed in mph (null outside 0.5–5.5). */
export function cadenceAt(mph) {
  const v = toNum(mph);
  if (!(v >= 0.5 && v <= 5.5)) return null;
  for (let i = 1; i < CADENCE_MPH.length; i++) {
    const [s1, c1] = CADENCE_MPH[i];
    if (v <= s1) {
      const [s0, c0] = CADENCE_MPH[i - 1];
      return c0 + ((c1 - c0) * (v - s0)) / (s1 - s0);
    }
  }
  return null;
}
/** {miles, steps} for one treadmill set (steps null when the speed is outside the table), or null. */
export function treadmillEstimate(minutes, mph) {
  const m = toNum(minutes), v = toNum(mph);
  if (!(m > 0) || !(v > 0)) return null;
  const cad = cadenceAt(v);
  return { miles: (v * m) / 60, steps: cad == null ? null : Math.round(cad * m) };
}
/** "1.00 mi · ≈2,270 steps" (steps to the nearest 10), or '' with nothing to show. */
export function fmtTreadmill(est) {
  if (!est) return '';
  const mi = `${est.miles.toFixed(2)} mi`;
  return est.steps == null ? mi : `${mi} · ≈${(Math.round(est.steps / 10) * 10).toLocaleString('en-US')} steps`;
}
