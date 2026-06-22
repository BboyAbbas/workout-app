/* ============================================================
   app.js — router, screens, and all interaction.
   Pulls data from db.js, renders into #app, wires events.
   Hash-based routing keeps it a single static page (easy host).
   ============================================================ */

import * as DB from './db.js';
import { initSync, pull, push } from './sync.js';
import { ensurePushSubscribed, scheduleServerRestAlert, cancelServerRestAlert } from './push.js';
import {
  esc, fmtClock, fmtDuration, fmtDate, fmtTime, fmtInt,
  icons, toast, summariseSets, summariseCardio,
} from './ui.js';

const app = document.getElementById('app');

/* timers that must be cleared whenever we leave a screen */
let tickers = [];
function addTicker(id) { tickers.push(id); }
function clearTickers() { tickers.forEach(clearInterval); tickers = []; }

/* cleanup callbacks (event listeners, wake lock) run when leaving a screen */
let leaveFns = [];
function onLeaveScreen(fn) { leaveFns.push(fn); }
function runLeave() { leaveFns.forEach((fn) => { try { fn(); } catch (_) {} }); leaveFns = []; }

/* keep the screen awake during a workout (auto-released by the OS on background) */
let wakeLock = null;
async function acquireWakeLock() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
}
function releaseWakeLock() { try { if (wakeLock) wakeLock.release(); } catch (_) {} wakeLock = null; }

/* ---------- offline rest-done alert (sound + notification) ----------
   A web app cannot vibrate from a backgrounded/locked screen (navigator.vibrate
   is blocked when hidden, and the API that scheduled local alarms was dropped by
   Chrome). So when the screen is off we: (a) keep a faint but audible hum playing
   so the OS doesn't freeze our 1-second timer, and (b) play a real alarm sound the
   instant rest ends. A service-worker notification rides on top for the buzz/banner
   (its vibration is governed by the phone's notification settings). Server push
   (push.js) is the online path that needs none of this. */
let audioCtx = null, humOsc = null, humGain = null;
function unlockAudio() { // must run from a user gesture (Start / Log tap)
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) {}
}
function startHum() { // faint, ~ -50 dB — a SILENT track does not keep timers alive
  if (!audioCtx) unlockAudio();
  if (!audioCtx || humOsc) return;
  try {
    const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
    osc.frequency.value = 60; g.gain.value = 0.003;
    osc.connect(g).connect(audioCtx.destination); osc.start();
    humOsc = osc; humGain = g;
  } catch (_) {}
}
function stopHum() {
  try { if (humOsc) humOsc.stop(); } catch (_) {}
  try { if (humGain) humGain.disconnect(); } catch (_) {}
  humOsc = humGain = null;
}
function playBeep() { // three loud rising chirps on the audio clock
  if (!audioCtx) unlockAudio();
  if (!audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      const start = t0 + i * 0.5, end = start + 0.38;
      osc.frequency.setValueAtTime(880, start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.8, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(start); osc.stop(end + 0.05);
    }
  } catch (_) {}
}
function mediaSession(on) { // gives the rest timer lock-screen presence while audio plays
  try {
    if (!('mediaSession' in navigator)) return;
    if (on) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Rest timer', artist: 'Workout' });
      navigator.mediaSession.playbackState = 'playing';
    } else {
      navigator.mediaSession.playbackState = 'none';
    }
  } catch (_) {}
}
function notifyRestDone() { // fire through the SW so it shows backgrounded/locked
  const opts = { body: 'Time for your next set', tag: 'rest', renotify: true, silent: false, vibrate: [400, 120, 400] };
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification('Rest done 💪', opts))
        .catch(() => { try { new Notification('Rest done 💪', opts); } catch (_) {} });
    } else { new Notification('Rest done 💪', opts); }
  } catch (_) {}
}
function askNotifyPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (_) {}
}

/* ---------- tiny helpers ---------- */
function go(hash) { location.hash = hash; }
function mount(html) { app.innerHTML = html; app.firstElementChild?.classList.add('fade-in'); }
function num(v, fallback = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; }
function qs(sel) { return app.querySelector(sel); }
function qsa(sel) { return Array.from(app.querySelectorAll(sel)); }
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function topbar(title, { back = null, sub = '', right = '' } = {}) {
  return `
    <header class="topbar">
      ${back === 'back'
        ? `<button class="icon-btn" data-back aria-label="Back">${icons.back}</button>`
        : back !== null
          ? `<button class="icon-btn" data-nav="${esc(back)}" aria-label="Back">${icons.back}</button>`
          : ''}
      <div style="flex:1;min-width:0">
        <h1>${esc(title)}</h1>
        ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
      </div>
      ${right}
    </header>`;
}

/* ============================================================
   SCREEN: Home — list of plans
   ============================================================ */
function screenHome() {
  const plans = DB.getPlans();
  const active = DB.getActive();

  let body;
  if (!plans.length) {
    body = `
      <div class="empty">
        <div class="big">${icons.dumbbell}</div>
        <p style="font-size:18px;color:var(--text);font-weight:600">No plans yet</p>
        <p>Load your workout plans, or make one yourself.</p>
      </div>
      <button class="btn btn-primary btn-block" id="seed-plans">${icons.plus} Load my workout plans</button>
      <div class="spacer"></div>
      <button class="btn btn-block" data-nav="#/plan/new">${icons.plus} Create your own</button>
    `;
  } else {
    body = plans.map((p) => {
      const last = DB.getSessionsForPlan(p.id)[0];
      const desc = last
        ? `${p.exercises.length} exercises · last ${fmtDate(last.startedAt).toLowerCase()}`
        : `${p.exercises.length} exercises`;
      return `
        <div class="card plan-card tappable" data-plan="${p.id}">
          <div class="meta">
            <p class="name">${esc(p.name || 'Untitled')}</p>
            <p class="desc">${esc(desc)}</p>
          </div>
          <button class="icon-btn btn-primary" style="border-radius:12px" data-run="${p.id}" aria-label="Start">${icons.play}</button>
        </div>`;
    }).join('');
  }

  const resumeBar = active ? `
    <div class="card tappable" data-resume="1" style="border-color:var(--accent);display:flex;align-items:center;gap:12px">
      <div style="flex:1">
        <p class="name" style="margin:0 0 2px;font-weight:650">Workout in progress</p>
        <p class="desc" style="margin:0;color:var(--muted)">${esc(active.planName || '')} · tap to resume</p>
      </div>
      <button class="icon-btn btn-primary" style="border-radius:12px">${icons.play}</button>
    </div>` : '';

  mount(`
    ${topbar('Workouts', {
      sub: plans.length ? `${plans.length} plan${plans.length > 1 ? 's' : ''}` : '',
      right: `
        <button class="icon-btn" data-nav="#/insights" aria-label="Insights">${icons.chart}</button>
        <button class="icon-btn" data-nav="#/history" aria-label="History">${icons.history}</button>
        <button class="icon-btn" data-nav="#/settings" aria-label="Settings">${icons.gear}</button>`,
    })}
    <main class="screen">
      ${resumeBar}
      ${body}
    </main>
    ${plans.length ? `<button class="fab" data-nav="#/plan/new">${icons.plus}<span>Plan</span></button>` : ''}
  `);

  qsa('[data-plan]').forEach((c) =>
    c.addEventListener('click', (e) => {
      if (e.target.closest('[data-run]')) return;
      go('#/plan/' + c.dataset.plan);
    }));
  qsa('[data-run]').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); startRun(b.dataset.run); }));
  const seed = qs('#seed-plans');
  if (seed) seed.addEventListener('click', () => { DB.seedDefaultPlans(); toast('Workouts loaded'); screenHome(); });
  const r = qs('[data-resume]');
  if (r) r.addEventListener('click', () => go('#/plan/' + active.planId + '/run'));
}

/* ============================================================
   SCREEN: Template preview — look before adding
   ============================================================ */
function screenTemplate(i) {
  const tpl = DB.TEMPLATES[+i];
  if (!tpl) return go('#/');

  mount(`
    ${topbar(tpl.name, { back: '#/', sub: `${tpl.exercises.length} exercises · template` })}
    <main class="screen">
      <p class="desc" style="color:var(--muted);margin:0 0 6px">Preview — nothing is added until you tap below.</p>
      ${tpl.exercises.map((e) => {
        const rng = DB.repRange(e);
        const repTxt = rng.min === rng.max ? `${rng.max}` : `${rng.min}–${rng.max}`;
        return `
          <div class="card">
            <p class="name" style="margin:0 0 4px;font-weight:620">${esc(e.name)}</p>
            <p class="desc" style="margin:0;color:var(--muted)">Target ${e.sets} × ${repTxt} reps</p>
          </div>`;
      }).join('')}
      <div class="spacer"></div>
      <button class="btn btn-primary btn-block" id="tpl-add">${icons.plus} Add to my plans</button>
      <div class="spacer"></div>
    </main>
  `);

  qs('#tpl-add').addEventListener('click', () => {
    const plan = DB.planFromTemplate(tpl);
    DB.savePlan(plan);
    toast('Plan added');
    go('#/plan/' + plan.id);
  });
}

/* ============================================================
   SCREEN: Plan detail — overview + Start
   ============================================================ */
function screenPlan(id) {
  const p = DB.getPlan(id);
  if (!p) return go('#/');
  const sessions = DB.getSessionsForPlan(id);
  // If THIS plan has an unfinished workout, the button resumes it instead of
  // starting fresh (tapping Start already resumes via startRun — the label was
  // the only thing lying about it).
  const act = DB.getActive();
  const resuming = !!(act && act.planId === id);

  mount(`
    ${topbar(p.name || 'Untitled', {
      back: '#/',
      sub: `${p.exercises.length} exercises`,
      right: `<button class="icon-btn" data-nav="#/plan/${id}/edit" aria-label="Edit">${icons.edit}</button>`,
    })}
    <main class="screen">
      ${p.exercises.length === 0
        ? `<div class="empty"><p>No exercises yet.</p></div>`
        : p.exercises.map((e) => {
            const lt = DB.lastEntryForExercise(e.id, e.name);
            const cardio = DB.isCardio(e);
            const ltTxt = lt ? (cardio ? summariseCardio(lt, DB.cardioFields(e.kind)) : summariseSets(lt)) : '';
            let targetTxt;
            if (cardio) {
              targetTxt = `${(DB.CARDIO_KINDS[e.kind] || {}).label || 'Cardio'} · settings logged each time`;
            } else {
              const rng = DB.repRange(e);
              const repTxt = rng.min === rng.max ? `${rng.max}` : `${rng.min}–${rng.max}`;
              targetTxt = `Target ${e.sets} × ${repTxt} reps${e.weight ? ` · ${e.weight} kg` : ''}`;
            }
            // only strength exercises link to the strength-progress chart
            const cls = cardio ? 'card' : 'card tappable';
            const dataEx = cardio ? '' : ` data-ex="${esc(e.name || '')}"`;
            return `
              <div class="${cls}"${dataEx}>
                <p class="name" style="margin:0 0 4px;font-weight:620">${esc(e.name || 'Exercise')}</p>
                <p class="desc" style="margin:0;color:var(--muted)">
                  ${targetTxt}
                  ${ltTxt ? `<br>last time: <b style="color:var(--accent)">${esc(ltTxt)}</b>` : ''}
                </p>
              </div>`;
          }).join('')}

      <div class="spacer"></div>
      <button class="btn btn-primary btn-block" data-run>${icons.play} ${resuming ? 'Resume workout' : 'Start workout'}</button>
      <div class="spacer"></div>
      <div class="btn-row">
        <button class="btn" data-nav="#/plan/${id}/history">${icons.history} History (${sessions.length})</button>
        <button class="btn" data-nav="#/plan/${id}/edit">${icons.edit} Edit</button>
      </div>
    </main>
  `);

  qs('[data-run]').addEventListener('click', () => startRun(id));
  qsa('[data-ex]').forEach((c) =>
    c.addEventListener('click', () => go('#/exercise/' + encodeURIComponent(c.dataset.ex))));
}

/* ============================================================
   SCREEN: Editor — create / modify a plan
   ============================================================ */
function screenEditor(id) {
  const isNew = id === 'new';
  let plan = isNew ? DB.newPlan() : structuredClone(DB.getPlan(id));
  if (!plan) return go('#/');
  if (isNew && plan.exercises.length === 0) plan.exercises.push(DB.newExercise());

  function render() {
    mount(`
      ${topbar(isNew ? 'New plan' : 'Edit plan', { back: isNew ? '#/' : '#/plan/' + id })}
      <main class="screen">
        <div class="field">
          <label>Plan name</label>
          <input class="input" id="plan-name" placeholder="e.g. Push Day" value="${esc(plan.name)}" />
        </div>

        <div class="section-label">Exercises</div>
        <div class="hint-cols" style="grid-template-columns:1fr;padding-left:2px">
          <span style="text-align:left;color:var(--muted)">name · sets · rep range · weight · rest(s)</span>
        </div>
        <div id="ex-list">
          ${plan.exercises.map((e, i) => exerciseRow(e, i)).join('')}
        </div>

        <button class="btn btn-block" id="add-ex">${icons.plus} Add exercise</button>

        <div class="spacer"></div><div class="spacer"></div>
        <button class="btn btn-primary btn-block" id="save">${icons.check} Save plan</button>
        <div class="spacer"></div>
        ${!isNew ? `<button class="btn btn-danger btn-block" id="del">${icons.trash} Delete plan</button>` : ''}
        <div class="spacer"></div>
      </main>
    `);

    qs('#plan-name').addEventListener('input', (ev) => { plan.name = ev.target.value; });

    function readRows() {
      qsa('.ex-row').forEach((row) => {
        const i = +row.dataset.i;
        const ex = plan.exercises[i];
        ex.name = row.querySelector('[data-f=name]').value;
        const kindSel = row.querySelector('[data-f=kind]');
        if (kindSel) ex.kind = kindSel.value;
        ex.sets = num(row.querySelector('[data-f=sets]')?.value, 1);
        ex.rest = num(row.querySelector('[data-f=rest]')?.value, DB.DEFAULT_REST);
        if (!DB.isCardio(ex)) { // strength-only fields (cardio rows don't render them)
          let lo = num(row.querySelector('[data-f=repMin]')?.value, 0);
          let hi = num(row.querySelector('[data-f=repMax]')?.value, 0);
          if (hi <= 0) hi = lo;            // only one filled -> single target
          if (lo <= 0) lo = hi;
          if (lo > hi) { const t = lo; lo = hi; hi = t; } // tolerate swapped entry
          ex.repMin = lo;
          ex.repMax = hi;
          ex.reps = hi;                    // keep legacy field = top of range
          ex.weight = num(row.querySelector('[data-f=weight]')?.value, 0);
        }
      });
    }

    qs('#add-ex').addEventListener('click', () => {
      readRows();
      plan.exercises.push(DB.newExercise());
      render();
    });

    // switching Strength <-> Treadmill/StairMaster swaps which fields show
    qsa('[data-f=kind]').forEach((sel) =>
      sel.addEventListener('change', () => { readRows(); render(); }));

    qsa('.ex-del').forEach((b) =>
      b.addEventListener('click', () => {
        readRows();
        plan.exercises.splice(+b.dataset.i, 1);
        if (plan.exercises.length === 0) plan.exercises.push(DB.newExercise());
        render();
      }));

    qs('#save').addEventListener('click', () => {
      readRows();
      plan.name = (plan.name || '').trim();
      if (!plan.name) { toast('Name the plan first'); qs('#plan-name').focus(); return; }
      plan.exercises = plan.exercises.filter((e) => (e.name || '').trim());
      DB.savePlan(plan);
      toast('Saved');
      go('#/plan/' + plan.id);
    });

    const del = qs('#del');
    if (del) del.addEventListener('click', () => {
      if (confirm('Delete this plan? Past workout history is kept.')) {
        DB.deletePlan(plan.id);
        go('#/');
      }
    });
  }

  function exerciseRow(e, i) {
    const kind = e.kind || 'strength';
    const cardio = DB.isCardio(e);
    const rng = DB.repRange(e);
    const kindOpts = [['strength', 'Strength'], ...Object.entries(DB.CARDIO_KINDS).map(([k, v]) => [k, v.label])]
      .map(([v, l]) => `<option value="${v}" ${v === kind ? 'selected' : ''}>${l}</option>`).join('');
    const settings = cardio
      ? `<div class="num-grid">
          <div class="field"><label>Sets</label><input class="input" data-f="sets" inputmode="numeric" value="${esc(e.sets ?? 1)}" /></div>
          <div class="field" style="grid-column:span 2"><label>Logged each workout</label>
            <input class="input" disabled style="opacity:.6" value="${esc(DB.cardioFields(kind).map((f) => f.label).join(' · '))}" /></div>
        </div>`
      : `<div class="num-grid num-grid-4">
          <div class="field"><label>Sets</label><input class="input" data-f="sets" inputmode="numeric" value="${esc(e.sets)}" /></div>
          <div class="field"><label>Rep min</label><input class="input" data-f="repMin" inputmode="numeric" value="${esc(rng.min)}" /></div>
          <div class="field"><label>Rep max</label><input class="input" data-f="repMax" inputmode="numeric" value="${esc(rng.max)}" /></div>
          <div class="field"><label>Weight</label><input class="input" data-f="weight" inputmode="decimal" value="${esc(e.weight)}" /></div>
        </div>`;
    return `
      <div class="ex-row" data-i="${i}">
        <div class="ex-row-head">
          <input class="input" data-f="name" placeholder="Exercise name" value="${esc(e.name)}" />
          <button class="icon-btn ex-del" data-i="${i}" aria-label="Remove">${icons.trash}</button>
        </div>
        <div class="field" style="margin:0 0 10px">
          <label>Type</label>
          <select class="input" data-f="kind">${kindOpts}</select>
        </div>
        ${settings}
        <div class="spacer"></div>
        <div class="field" style="margin:0">
          <label>Rest between sets (seconds)</label>
          <input class="input" data-f="rest" inputmode="numeric" value="${esc(e.rest ?? DB.DEFAULT_REST)}" />
        </div>
      </div>`;
  }

  render();
}

/* ============================================================
   SCREEN: Run — the live workout (timer + set logging + rest)
   ============================================================ */
function startRun(planId) {
  const plan = DB.getPlan(planId);
  if (!plan) return;
  askNotifyPermission(); // user tapped Start — a valid gesture to ask
  unlockAudio();         // same gesture unlocks the offline audio alert for later
  ensurePushSubscribed(); // register this device for the online (server) alert
  const existing = DB.getActive();
  if (existing && existing.planId === planId) return go('#/plan/' + planId + '/run');
  if (existing && existing.planId !== planId &&
      !confirm('Another workout is in progress. Discard it and start this one?')) {
    return go('#/plan/' + existing.planId + '/run');
  }

  // Build a fresh active session. Each set is prefilled with a double-progression
  // recommendation off last time's performance: hit the top of the rep range on
  // every set -> the weight goes up and reps reset to the bottom; otherwise the
  // weight holds and the target is to beat last time's reps.
  const entries = {};
  for (const e of plan.exercises) {
    const last = DB.lastEntryForExercise(e.id, e.name) || [];

    // CARDIO (treadmill / stairmaster): log machine settings, prefilled from
    // last time. No rep/weight recommendation — just beat your own numbers.
    if (DB.isCardio(e)) {
      const fields = DB.cardioFields(e.kind);
      const sets = Array.from({ length: Math.max(1, e.sets || 1) }, (_, i) => {
        const s = { done: false };
        for (const f of fields) s[f.key] = last[i]?.[f.key] ?? '';
        return s;
      });
      entries[e.id] = {
        exerciseId: e.id, name: e.name, kind: e.kind, fields,
        rest: e.rest ?? 0, targetSets: e.sets || 1, sets,
      };
      continue;
    }

    const range = DB.repRange(e);
    const rec = DB.recommendNext(last.length ? last : null, range, DB.DEFAULT_INC, e.sets);
    // Prefill each set with LAST TIME's numbers so there's no math to redo. The
    // progressive-overload target is shown as a highlight + arrow on the cell to
    // push (see render), not baked into the prefilled value.
    const sets = Array.from({ length: Math.max(1, e.sets) }, (_, i) => ({
      reps: last[i]?.reps ?? '',
      weight: last[i]?.weight ?? (e.weight || ''),
      done: false,
    }));
    const lastBestReps = last.length ? Math.max(...last.map((s) => Number(s.reps) || 0)) : 0;
    const recView = { dir: rec.dir };
    if (rec.dir === 'up') recView.newWeight = rec.weight;            // push the weight up
    if (rec.dir === 'hold' && last.length) {                          // beat the reps
      recView.targetReps = lastBestReps >= range.max ? lastBestReps + 1 : range.max;
    }
    entries[e.id] = {
      exerciseId: e.id,
      name: e.name,
      kind: 'strength',
      rest: e.rest ?? DB.DEFAULT_REST,
      targetSets: e.sets,
      repMin: range.min,
      repMax: range.max,
      rec: recView,
      sets,
    };
  }
  DB.setActive({ planId, planName: plan.name, startedAt: Date.now(), entries });
  go('#/plan/' + planId + '/run');
}

function screenRun(planId) {
  let active = DB.getActive();
  if (!active || active.planId !== planId) return go('#/plan/' + planId);
  // Iterate the workout's OWN snapshot, not the live plan. Editing the plan
  // mid-workout (add/remove/rename an exercise) must never drop or blank the
  // sets already logged in this session.
  const order = Object.keys(active.entries);

  // rest-timer state lives outside the DOM so re-renders don't kill it.
  // endAt is an absolute timestamp so the countdown survives backgrounding,
  // lock-screen throttling, and even a full reload (persisted in active).
  const rest = { id: null, total: 0, exId: null, endAt: 0 };
  let elapsedId = null; // single elapsed ticker, replaced (not stacked) each render
  let activeSel = firstPending(); // the set the one pinned Log button will save

  function persist() { DB.setActive(active); }

  // first not-yet-logged set, scanning exercises in order (null if all done)
  function firstPending() {
    for (const exId of order) {
      const en = active.entries[exId];
      if (!en) continue;
      const si = en.sets.findIndex((s) => !s.done);
      if (si !== -1) return { exId, si };
    }
    return null;
  }

  // highlight a set as the active one WITHOUT re-rendering (keeps input focus)
  function selectActive(exId, si) {
    activeSel = { exId, si };
    qsa('.set-row').forEach((r) =>
      r.classList.toggle('active', r.dataset.ex === exId && +r.dataset.si === si));
    updateLogLabel();
  }
  function logLabel() {
    return activeSel
      ? `Log ${active.entries[activeSel.exId].name} · set ${activeSel.si + 1}`
      : 'Finish workout';
  }
  function updateLogLabel() {
    const btn = qs('#logbtn');
    if (btn) btn.textContent = logLabel();
  }

  function render() {
    const exHtml = order.map((exId) => {
      const en = active.entries[exId];
      if (!en) return '';

      // CARDIO row: one input per machine setting, prefilled from last time.
      if (DB.isCardio(en)) {
        const fields = en.fields || DB.cardioFields(en.kind);
        const cols = `grid-template-columns:40px repeat(${fields.length},1fr)`;
        const crows = en.sets.map((s, si) => {
          const isActive = activeSel && activeSel.exId === exId && activeSel.si === si;
          const inputs = fields.map((f) =>
            `<div class="cell"><input class="input" data-f="${f.key}" inputmode="decimal" enterkeyhint="go" placeholder="${esc(f.ph)}" value="${esc(s[f.key] ?? '')}" /></div>`).join('');
          return `
          <div class="set-row ${s.done ? 'done' : ''} ${isActive ? 'active' : ''}" data-ex="${exId}" data-si="${si}" style="${cols}">
            <button class="set-n" data-select="${exId}" data-si="${si}" aria-label="Set ${si + 1}">${s.done ? icons.check : (si + 1)}</button>
            ${inputs}
          </div>`;
        }).join('');
        const chip = (DB.CARDIO_KINDS[en.kind] || {}).label || 'Cardio';
        return `
          <div class="card run-ex">
            <p class="name">${esc(en.name)} <span class="kind-chip">${esc(chip)}</span></p>
            <div class="hint-cols" style="${cols}"><span>#</span>${fields.map((f) => `<span>${esc(f.label)}</span>`).join('')}</div>
            ${crows}
            <button class="btn btn-sm btn-ghost btn-block" data-addset="${exId}" style="margin-top:8px">${icons.plus} Add set</button>
          </div>`;
      }

      const rec = en.rec || { dir: 'first' };
      const upW = rec.dir === 'up' && rec.newWeight != null;
      const holdR = rec.dir === 'hold' && rec.targetReps != null;
      const rows = en.sets.map((s, si) => {
        const isActive = activeSel && activeSel.exId === exId && activeSel.si === si;
        // green ring + a "→ N" target chip on the exact cell to beat, per set,
        // only while the set is un-logged. The chip sits inside the cell corner.
        const wCls = upW && !s.done ? ' rec-target' : '';
        const rCls = holdR && !s.done ? ' rec-target' : '';
        const wHint = upW && !s.done ? `<span class="cell-hint">→ ${rec.newWeight}</span>` : '';
        const rHint = holdR && !s.done ? `<span class="cell-hint">→ ${rec.targetReps}</span>` : '';
        return `
        <div class="set-row ${s.done ? 'done' : ''} ${isActive ? 'active' : ''}" data-ex="${exId}" data-si="${si}">
          <button class="set-n" data-select="${exId}" data-si="${si}" aria-label="Set ${si + 1}">${s.done ? icons.check : (si + 1)}</button>
          <div class="cell">${wHint}<input class="input${wCls}" data-f="weight" inputmode="decimal" enterkeyhint="go" placeholder="kg" value="${esc(s.weight)}" /></div>
          <div class="cell">${rHint}<input class="input${rCls}" data-f="reps" inputmode="numeric" enterkeyhint="go" placeholder="reps" value="${esc(s.reps)}" /></div>
        </div>`;
      }).join('');
      return `
        <div class="card run-ex">
          <p class="name">${esc(en.name)}</p>
          <div class="rest-ctl">
            <span class="rest-ctl-label">Rest</span>
            <button class="rest-step" data-rest-dec="${exId}" aria-label="Less rest">−</button>
            <span class="rest-ctl-val" data-rest-val="${exId}">${fmtClock(en.rest != null ? en.rest : DB.DEFAULT_REST)}</span>
            <button class="rest-step" data-rest-inc="${exId}" aria-label="More rest">+</button>
          </div>
          <div class="hint-cols"><span>#</span><span>Weight</span><span>Reps</span></div>
          ${rows}
          <button class="btn btn-sm btn-ghost btn-block" data-addset="${exId}" style="margin-top:8px">${icons.plus} Add set</button>
        </div>`;
    }).join('');

    const hasRec = Object.values(active.entries)
      .some((en) => en.rec && (en.rec.dir === 'up' || en.rec.dir === 'hold'));
    const legend = hasRec
      ? `<p class="run-legend">Boxes show last time. <b class="rec-chip">→</b> green target = beat it for progress.</p>`
      : '';

    mount(`
      <div class="timer-bar">
        <div style="flex:1">
          <div class="label">Elapsed</div>
          <div class="time" id="elapsed">00:00</div>
        </div>
      </div>
      <main class="screen" style="padding-bottom:200px">
        ${legend}
        ${exHtml}
        <div class="spacer"></div>
        <button class="btn btn-primary btn-block" id="finish">${icons.check} Finish workout</button>
        <div class="spacer"></div>
        <button class="btn btn-danger btn-block" id="discard">Discard workout</button>
      </main>
      <footer class="run-foot">
        <div id="rest-host"></div>
        <button class="btn btn-primary btn-block log-pinned" id="logbtn">${esc(logLabel())}</button>
      </footer>
    `);

    startElapsed();
    bindRun();
    if (rest.id) drawRest(); // keep showing rest bar across re-render
  }

  /* ---- elapsed (total workout) timer ---- */
  // Computed from startedAt every tick, so backgrounding/lock can't make it
  // drift — when the app returns it shows the true elapsed time.
  function startElapsed() {
    if (elapsedId) clearInterval(elapsedId);
    elapsedId = setInterval(drawElapsed, 1000);
    addTicker(elapsedId);
    drawElapsed();
  }
  function drawElapsed() {
    const elEl = qs('#elapsed');
    if (elEl) elEl.textContent = fmtClock((Date.now() - active.startedAt) / 1000);
  }

  /* ---- rest countdown (timestamp-based, survives background) ---- */
  function restRemaining() {
    return rest.endAt ? Math.max(0, Math.round((rest.endAt - Date.now()) / 1000)) : 0;
  }
  function startRest(seconds, exId) {
    stopRest();
    rest.total = seconds; rest.exId = exId; rest.endAt = Date.now() + seconds * 1000;
    active.restState = { endAt: rest.endAt, total: rest.total, exId }; persist();
    scheduleServerRestAlert(rest.endAt); // online path: server fires a push at rest end
    rest.id = setInterval(tickRest, 1000);
    addTicker(rest.id);
    drawRest();
  }
  function resumeRest() { // restore an in-flight rest after reload/return
    const rs = active.restState;
    if (!rs || !(rs.endAt > Date.now())) { if (rs) { delete active.restState; persist(); } return; }
    rest.total = rs.total; rest.exId = rs.exId; rest.endAt = rs.endAt;
    scheduleServerRestAlert(rest.endAt); // re-arm the online push after a reload/return
    rest.id = setInterval(tickRest, 1000);
    addTicker(rest.id);
  }
  function tickRest() {
    if (restRemaining() <= 0) { finishRest(); return; }
    drawRest();
  }
  function finishRest() {
    playBeep();        // audible alarm first, while the audio context is still alive
    // buzz pattern — fires when the app is in front; blocked when hidden (the notification buzzes there)
    if (navigator.vibrate) navigator.vibrate([400, 120, 400]);
    notifyRestDone();  // notification buzz/banner for the backgrounded/locked case
    stopRest();        // clears the countdown + tears down the keep-alive hum
    toast('Rest done — next set 💪');
    drawRest(); // clears the bar
  }
  function stopRest() {
    if (rest.id) { clearInterval(rest.id); rest.id = null; }
    rest.endAt = 0; rest.exId = null;
    stopHum(); mediaSession(false); // silence the keep-alive hum, release audio focus
    cancelServerRestAlert();        // drop the pending online push (skipped/finished)
    if (active.restState) { delete active.restState; persist(); }
  }
  function drawRest() {
    const host = qs('#rest-host');
    if (!host) return;
    if (!rest.id) { host.innerHTML = ''; return; }
    const remaining = restRemaining();
    const pct = rest.total ? (remaining / rest.total) * 100 : 0;
    host.innerHTML = `
      <div class="card" style="margin:0 0 10px;border-color:var(--accent);display:flex;align-items:center;gap:10px;padding:12px 14px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Rest</span>
            <span style="font-variant-numeric:tabular-nums;font-size:22px;font-weight:700">${fmtClock(remaining)}</span>
          </div>
          <div style="height:6px;background:var(--surface-2);border-radius:3px;margin-top:8px;overflow:hidden">
            <div style="height:100%;width:${Math.min(100, pct)}%;background:var(--accent);transition:width 1s linear"></div>
          </div>
        </div>
        <button class="btn btn-sm" id="rest-sub">−15s</button>
        <button class="btn btn-sm" id="rest-add">+15s</button>
        <button class="btn btn-sm btn-primary" id="rest-skip">Skip</button>
      </div>`;
    const sub = qs('#rest-sub');
    const add = qs('#rest-add');
    const skip = qs('#rest-skip');
    if (sub) sub.addEventListener('click', () => {
      rest.endAt = Math.max(Date.now() + 1000, rest.endAt - 15000); // never drop below ~1s left
      rest.total = Math.max(1, rest.total - 15);
      if (active.restState) { active.restState.endAt = rest.endAt; active.restState.total = rest.total; persist(); }
      scheduleServerRestAlert(rest.endAt); // move the online push to the new end time
      drawRest();
    });
    if (add) add.addEventListener('click', () => {
      rest.endAt += 15000; rest.total += 15;
      if (active.restState) { active.restState.endAt = rest.endAt; active.restState.total = rest.total; persist(); }
      scheduleServerRestAlert(rest.endAt); // move the online push to the new end time
      drawRest();
    });
    if (skip) skip.addEventListener('click', () => { stopRest(); drawRest(); });
  }

  /* ---- per-exercise rest length (shown on each card, saved as the default) ---- */
  // Changing rest here applies to this workout's remaining sets immediately AND
  // is written back to the plan, so it's the new default every future workout.
  function changeRest(exId, delta) {
    const en = active.entries[exId];
    if (!en) return;
    const cur = en.rest != null ? en.rest : DB.DEFAULT_REST;
    const next = Math.max(0, cur + delta);
    if (next === cur) return;
    en.rest = next;
    persist();
    saveRestToPlan(exId, next);
    const valEl = qs(`[data-rest-val="${exId}"]`);
    if (valEl) valEl.textContent = fmtClock(next);
  }
  function saveRestToPlan(exId, secs) {
    const plan = DB.getPlan(planId);
    if (!plan) return;
    const ex = plan.exercises.find((e) => e.id === exId);
    if (ex && ex.rest !== secs) { ex.rest = secs; DB.savePlan(plan); }
  }

  /* ---- event wiring ---- */
  function bindRun() {
    qsa('.set-row .input').forEach((inp) => {
      // typing persists to state
      inp.addEventListener('input', () => {
        const row = inp.closest('.set-row');
        const s = active.entries[row.dataset.ex].sets[+row.dataset.si];
        s[inp.dataset.f] = inp.value;
        persist();
      });
      // focusing a set makes it the active one (what the Log button saves)
      inp.addEventListener('focus', () => {
        const row = inp.closest('.set-row');
        selectActive(row.dataset.ex, +row.dataset.si);
      });
      // the keyboard's "Go"/Enter key logs that set — same as tapping the Log
      // button. Saves a reach to the bottom of the screen mid-set.
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const row = inp.closest('.set-row');
        selectActive(row.dataset.ex, +row.dataset.si);
        inp.blur(); // drop the keyboard, mirroring a Log tap
        onLog();
      });
    });

    // tap a set's number to select it as the active set
    qsa('[data-select]').forEach((b) =>
      b.addEventListener('click', () => selectActive(b.dataset.select, +b.dataset.si)));

    // add an extra set to an exercise
    qsa('[data-addset]').forEach((b) =>
      b.addEventListener('click', () => {
        const en = active.entries[b.dataset.addset];
        const prev = en.sets[en.sets.length - 1] || {};
        en.sets.push({ ...prev, done: false }); // carry prev fields (reps/weight or cardio settings)
        persist();
        render();
      }));

    // per-exercise rest steppers (±15s) — see changeRest
    qsa('[data-rest-inc]').forEach((b) =>
      b.addEventListener('click', () => changeRest(b.dataset.restInc, 15)));
    qsa('[data-rest-dec]').forEach((b) =>
      b.addEventListener('click', () => changeRest(b.dataset.restDec, -15)));

    // THE one pinned button: log the selected set, then jump to the next
    qs('#logbtn').addEventListener('click', onLog);

    qs('#finish').addEventListener('click', finishWorkout);
    qs('#discard').addEventListener('click', () => {
      if (confirm('Discard this workout? Nothing will be saved.')) {
        stopRest(); DB.setActive(null); go('#/plan/' + planId);
      }
    });
  }

  function onLog() {
    unlockAudio(); // a tap keeps the offline audio alert armed (covers resumed workouts)
    if (!activeSel) return finishWorkout(); // all sets done -> button is "Finish workout"
    const { exId, si } = activeSel;
    const en = active.entries[exId];
    const s = en.sets[si];
    const row = app.querySelector(`.set-row[data-ex="${exId}"][data-si="${si}"]`);
    if (row) row.querySelectorAll('.input').forEach((inp) => { s[inp.dataset.f] = inp.value; });
    // cardio needs minutes; strength needs reps
    const reqKey = DB.isCardio(en) ? 'minutes' : 'reps';
    if (s[reqKey] === '' || s[reqKey] == null) {
      toast(`Enter ${reqKey} first`);
      if (row) row.querySelector(`[data-f=${reqKey}]`)?.focus();
      return;
    }
    s.done = true;
    persist();
    const restSecs = en.rest != null ? en.rest : DB.DEFAULT_REST; // cardio rest 0 -> no timer
    if (restSecs > 0) startRest(restSecs, exId);
    activeSel = firstPending(); // advance to the next unlogged set (null when done)
    render();
  }

  function finishWorkout() {
    stopRest();
    const endedAt = Date.now();
    const durationSec = Math.round((endedAt - active.startedAt) / 1000);
    const entries = order.map((exId) => {
      const en = active.entries[exId];
      // Only sets the user actually logged (pressed "Log set") count. Prefilled
      // recommendation values are NOT performance, so an exercise that was never
      // logged saves no entry and won't drive next time's recommendation.
      const cardio = DB.isCardio(en);
      const fields = cardio ? (en.fields || DB.cardioFields(en.kind)) : null;
      const sets = en.sets
        .filter((s) => s.done)
        .map((s) => {
          if (cardio) { const o = {}; for (const f of fields) o[f.key] = num(s[f.key], 0); return o; }
          return { reps: num(s.reps, 0), weight: num(s.weight, 0) };
        });
      return { exerciseId: exId, name: en.name, kind: en.kind || 'strength', sets };
    }).filter((e) => e.sets.length);

    if (!entries.length) {
      if (!confirm('No sets logged. Finish anyway? (nothing will be saved)')) return;
      DB.setActive(null);
      return go('#/plan/' + planId);
    }

    const prs = DB.newPRsIn(entries); // compute BEFORE saving (needs prior history)
    DB.addSession({
      id: DB.uid(),
      planId,
      planName: active.planName,
      startedAt: active.startedAt,
      endedAt,
      durationSec,
      entries,
    });
    DB.setActive(null);
    toast(prs.length
      ? `🏆 New PR — ${prs.map((p) => p.name).join(', ')}!`
      : `Done · ${fmtDuration(durationSec)}`);
    go('#/plan/' + planId + '/history');
  }

  // Keep the screen awake while working out, and recompute the timers the
  // instant the app returns from background/lock (they're timestamp-based, so
  // they self-correct — and a rest that finished while away fires on return).
  acquireWakeLock();
  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      acquireWakeLock();
      stopHum(); mediaSession(false); // back on screen: live timer drives the alert
      drawElapsed();
      if (rest.id) { if (restRemaining() <= 0) finishRest(); else drawRest(); }
    } else if (rest.id && restRemaining() > 0) {
      // backgrounded/locked mid-rest: a faint hum stops the OS freezing our timer,
      // so the alarm sound + notification still fire on time.
      unlockAudio(); startHum(); mediaSession(true);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  onLeaveScreen(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    releaseWakeLock(); stopHum(); mediaSession(false);
  });

  resumeRest(); // restore an in-flight rest countdown after a reload/return
  render();
}

/* ============================================================
   SCREEN: History (all, or per plan)
   ============================================================ */
function screenHistory(planId) {
  const sessions = planId ? DB.getSessionsForPlan(planId) : DB.getSessions();
  const plan = planId ? DB.getPlan(planId) : null;

  const body = sessions.length === 0
    ? `<div class="empty"><div class="big">${icons.history}</div><p>No workouts logged yet.</p></div>`
    : sessions.map((s) => {
        const exCount = s.entries.length;
        const setCount = s.entries.reduce((a, e) => a + e.sets.length, 0);
        return `
          <div class="card hist-row tappable" data-session="${s.id}">
            <div class="when">
              <p class="date">${esc(fmtDate(s.startedAt))}${planId ? '' : ' · ' + esc(s.planName || '')}</p>
              <p class="summary">${fmtTime(s.startedAt)} · ${exCount} exercises · ${setCount} sets</p>
            </div>
            <div class="dur">${fmtDuration(s.durationSec)}</div>
          </div>`;
      }).join('');

  mount(`
    ${topbar(plan ? plan.name + ' — history' : 'History', { back: planId ? '#/plan/' + planId : '#/' })}
    <main class="screen">${body}</main>
  `);

  qsa('[data-session]').forEach((c) =>
    c.addEventListener('click', () => go('#/session/' + c.dataset.session)));
}

/* ============================================================
   SCREEN: Session detail — what you actually did
   ============================================================ */
function screenSession(sessionId) {
  const s = DB.getSessions().find((x) => x.id === sessionId);
  if (!s) return go('#/history');

  mount(`
    ${topbar(fmtDate(s.startedAt), {
      back: '#/plan/' + s.planId + '/history',
      sub: `${esc(s.planName || '')} · ${fmtTime(s.startedAt)}`,
      right: `<button class="icon-btn btn-danger" id="del-session" aria-label="Delete">${icons.trash}</button>`,
    })}
    <main class="screen">
      <div class="card" style="display:flex;gap:18px;align-items:center">
        <div>
          <div class="label" style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Duration</div>
          <div style="font-size:26px;font-weight:700;color:var(--accent)">${fmtDuration(s.durationSec)}</div>
        </div>
        <div style="border-left:1px solid var(--border);padding-left:18px">
          <div class="label" style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Sets</div>
          <div style="font-size:26px;font-weight:700">${s.entries.reduce((a, e) => a + e.sets.length, 0)}</div>
        </div>
      </div>
      ${s.entries.map((e) => {
        const cardio = DB.isCardio(e);
        const fields = cardio ? DB.cardioFields(e.kind) : null;
        return `
        <div class="card">
          <p class="name" style="margin:0 0 8px;font-weight:620">${esc(e.name)}</p>
          ${e.sets.map((set, i) => {
            const detail = cardio
              ? (summariseCardio([set], fields) || '—')
              : `${esc(set.reps)} reps${set.weight ? ` · ${esc(set.weight)} kg` : ''}`;
            return `
            <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
              <span style="color:var(--muted)">Set ${i + 1}</span>
              <span style="font-weight:600">${detail}</span>
            </div>`;
          }).join('')}
        </div>`;
      }).join('')}
      <div class="spacer"></div>
    </main>
  `);

  qs('#del-session').addEventListener('click', () => {
    if (confirm('Delete this workout from history?')) {
      DB.deleteSession(s.id);
      go('#/plan/' + s.planId + '/history');
    }
  });
}

/* Tiny inline line chart (no deps). Scales values to the viewBox. */
function sparkline(values, { h = 64, pad = 8 } = {}) {
  const vals = values.length === 1 ? [values[0], values[0]] : values;
  if (!vals.length) return '';
  const w = 320;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (vals.length - 1);
  const pts = vals.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lx, ly] = pts[pts.length - 1].split(',');
  return `
    <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="progress chart">
      <polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(' ')}"/>
      <circle cx="${lx}" cy="${ly}" r="3.5" fill="var(--accent)"/>
    </svg>`;
}

/* ============================================================
   SCREEN: Exercise progress — chart + per-session history for one lift
   ============================================================ */
function screenExercise(name) {
  const points = DB.progressForExercise(name);
  if (!points.length) {
    mount(`
      ${topbar(name, { back: 'back' })}
      <main class="screen"><div class="empty"><p>No history for ${esc(name)} yet.</p></div></main>`);
    return;
  }
  const m = DB.progressMetric(points);
  const best = Math.max(...m.values);
  const latest = m.values[m.values.length - 1];
  const delta = latest - m.values[0];
  const stalled = DB.isStalled(m.values);

  const rows = [...points].reverse().map((p) => {
    const setTxt = p.topWeight ? `${p.topReps} reps · ${p.topWeight} kg` : `${p.topReps} reps`;
    const e = m.loaded && p.e1rm ? ` · est. 1RM ${p.e1rm} kg` : '';
    return `<div class="kv"><span>${esc(fmtDate(p.t))}</span><b>${setTxt}${e}</b></div>`;
  }).join('');

  mount(`
    ${topbar(name, { back: 'back', sub: `${points.length} session${points.length > 1 ? 's' : ''}` })}
    <main class="screen">
      ${stalled ? `<div class="card banner-warn">${icons.target} <span>Stalled — your best was a few sessions ago. Try a small deload (−10%) and build back up.</span></div>` : ''}
      <div class="stat-grid stat-grid-2">
        <div class="card stat"><div class="stat-v">${best}<span class="u">${m.unit}</span></div><div class="stat-l">Best ${m.label}</div></div>
        <div class="card stat"><div class="stat-v">${latest}<span class="u">${m.unit}</span></div><div class="stat-l">Latest</div></div>
      </div>
      <div class="section-label">${m.label} over time ${delta !== 0 ? `<span style="color:${delta > 0 ? 'var(--accent)' : 'var(--muted)'}">(${delta > 0 ? '+' : ''}${delta}${m.unit})</span>` : ''}</div>
      <div class="card chart-card">${sparkline(m.values)}</div>
      <div class="section-label">Every session</div>
      <div class="card">${rows}</div>
      <div class="spacer"></div>
    </main>
  `);
}

/* ============================================================
   SCREEN: Insights — overview of everything logged
   ============================================================ */
function screenInsights() {
  const sessions = DB.getSessions(); // newest first

  if (!sessions.length) {
    mount(`
      ${topbar('Insights', { back: '#/' })}
      <main class="screen">
        <div class="empty"><div class="big">${icons.chart}</div>
        <p>Finish a workout and your stats show up here.</p></div>
      </main>`);
    return;
  }

  const n = sessions.length;
  const totalSec = sessions.reduce((a, s) => a + (s.durationSec || 0), 0);
  const avgSec = totalSec / n;
  const longest = Math.max(...sessions.map((s) => s.durationSec || 0));

  const startOfDay = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const todayStart = startOfDay(Date.now());
  const dow = (new Date().getDay() + 6) % 7;           // 0 = Monday
  const weekStart = todayStart - dow * 86400000;
  const weekCount = sessions.filter((s) => s.startedAt >= weekStart).length;

  // current day-streak (counts today, or starts at yesterday if today is a rest day)
  const daySet = new Set(sessions.map((s) => startOfDay(s.startedAt)));
  let streak = 0, day = todayStart;
  if (!daySet.has(day)) day -= 86400000;
  while (daySet.has(day)) { streak++; day -= 86400000; }

  // volume / reps / sets-per-muscle / time-of-day
  let volume = 0, reps = 0, totalSets = 0;
  const muscle = {};
  const buckets = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 };
  for (const s of sessions) {
    const h = new Date(s.startedAt).getHours();
    const b = h >= 5 && h < 12 ? 'Morning' : h >= 12 && h < 17 ? 'Afternoon' : h >= 17 && h < 22 ? 'Evening' : 'Night';
    buckets[b]++;
    for (const e of s.entries) {
      const m = DB.muscleFor(e.name);
      for (const set of e.sets) {
        reps += +set.reps || 0;
        volume += (+set.reps || 0) * (+set.weight || 0);
        muscle[m] = (muscle[m] || 0) + 1;
        totalSets++;
      }
    }
  }
  const usualTime = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0][0];
  const muscleRows = Object.entries(muscle).sort((a, b) => b[1] - a[1]);
  const maxM = muscleRows.length ? muscleRows[0][1] : 1;
  const setDenom = totalSets || 1; // guard NaN% if an imported session has no sets

  // longest streak ever (consecutive workout days)
  let bestStreak = 0, run = 0;
  const sortedDays = [...daySet].sort((a, b) => a - b);
  for (let i = 0; i < sortedDays.length; i++) {
    run = (i > 0 && sortedDays[i] - sortedDays[i - 1] === 86400000) ? run + 1 : 1;
    if (run > bestStreak) bestStreak = run;
  }

  // sets-per-day -> consistency calendar (last 13 weeks, Mon-top columns)
  const dayCounts = {};
  for (const s of sessions) {
    const d = startOfDay(s.startedAt);
    let c = 0; for (const e of (s.entries || [])) c += (e.sets || []).length;
    dayCounts[d] = (dayCounts[d] || 0) + c;
  }
  const WEEKS = 13;
  const mondayThisWeek = todayStart - dow * 86400000;
  const calStart = mondayThisWeek - (WEEKS - 1) * 7 * 86400000;
  let calCells = '';
  for (let wk = 0; wk < WEEKS; wk++) {
    for (let d = 0; d < 7; d++) {
      const day = calStart + (wk * 7 + d) * 86400000;
      if (day > todayStart) { calCells += '<div class="cal-cell cal-future"></div>'; continue; }
      const c = dayCounts[day] || 0;
      const lvl = c === 0 ? 0 : c <= 4 ? 1 : c <= 8 ? 2 : c <= 14 ? 3 : 4;
      calCells += `<div class="cal-cell cal-l${lvl}" title="${esc(fmtDate(day))} · ${c} sets"></div>`;
    }
  }

  const progress = DB.exerciseProgressSummary(); // strength records, best-first
  const stalls = progress.filter((r) => r.stalled);

  const stat = (label, value) =>
    `<div class="card stat"><div class="stat-v">${value}</div><div class="stat-l">${label}</div></div>`;

  mount(`
    ${topbar('Insights', { back: '#/', sub: `${n} workout${n > 1 ? 's' : ''} logged` })}
    <main class="screen">
      <div class="stat-grid">
        ${stat('Workouts', n)}
        ${stat('This week', weekCount)}
        ${stat('Day streak', streak)}
        ${stat('Total time', fmtDuration(totalSec))}
      </div>

      <div class="section-label">Consistency</div>
      <div class="card">
        <div class="cal">${calCells}</div>
        <div class="cal-legend">
          <span>best streak <b>${bestStreak}</b> day${bestStreak === 1 ? '' : 's'}</span>
          <span class="cal-key">less ${[0, 1, 2, 3, 4].map((l) => `<i class="cal-cell cal-l${l}"></i>`).join('')} more</span>
        </div>
      </div>

      <div class="section-label">Volume lifted</div>
      <div class="card">
        <div class="stat-v" style="font-size:30px">${fmtInt(volume)} <span style="font-size:16px;color:var(--muted)">kg total</span></div>
        <div class="stat-l">${fmtInt(reps)} reps · ${totalSets} sets across all workouts</div>
      </div>

      ${progress.length ? `
      <div class="section-label">Strength records</div>
      ${progress.slice(0, 8).map((r) => `
        <div class="card hist-row tappable" data-ex="${esc(r.name)}">
          <div class="when">
            <p class="date">${esc(r.name)} ${r.stalled ? '<span class="chip chip-warn">stalled</span>' : (r.improving ? '<span class="chip chip-up">↑ up</span>' : '')}</p>
            <p class="summary">best <b>${r.best}${r.unit}</b> · now ${r.latest}${r.unit} · ${r.sessions} session${r.sessions === 1 ? '' : 's'}</p>
          </div>
          <div class="dur">${icons.chart}</div>
        </div>`).join('')}` : ''}

      ${stalls.length ? `
      <div class="section-label">Needs attention</div>
      <div class="card banner-warn">${icons.target} <span>${stalls.map((r) => esc(r.name)).join(', ')} ${stalls.length === 1 ? 'has' : 'have'} stalled — try a small deload (−10%) and build back up.</span></div>` : ''}

      <div class="section-label">Muscle focus (by sets)</div>
      <div class="card">
        ${muscleRows.map(([m, c]) => {
          const pct = Math.round((c / setDenom) * 100);
          return `
          <div class="mbar">
            <div class="mbar-top"><span>${m}</span><span>${c} set${c === 1 ? '' : 's'} · ${pct}%</span></div>
            <div class="mbar-track"><div class="mbar-fill" style="width:${Math.max(4, (c / maxM) * 100)}%"></div></div>
          </div>`;
        }).join('')}
      </div>

      <div class="section-label">Patterns</div>
      <div class="card">
        <div class="kv"><span>Usual training time</span><b>${usualTime}</b></div>
        <div class="kv"><span>Average session</span><b>${fmtDuration(avgSec)}</b></div>
        <div class="kv"><span>Longest session</span><b>${fmtDuration(longest)}</b></div>
      </div>

      <div class="section-label">Recent</div>
      ${sessions.slice(0, 5).map((s) => `
        <div class="card hist-row tappable" data-session="${s.id}">
          <div class="when">
            <p class="date">${esc(fmtDate(s.startedAt))} · ${esc(s.planName || '')}</p>
            <p class="summary">${fmtTime(s.startedAt)} · ${s.entries.length} exercises</p>
          </div>
          <div class="dur">${fmtDuration(s.durationSec)}</div>
        </div>`).join('')}
      <div class="spacer"></div>
    </main>
  `);

  qsa('[data-session]').forEach((c) =>
    c.addEventListener('click', () => go('#/session/' + c.dataset.session)));
  qsa('[data-ex]').forEach((c) =>
    c.addEventListener('click', () => go('#/exercise/' + encodeURIComponent(c.dataset.ex))));
}

/* ============================================================
   SCREEN: Settings — backup / restore / reset
   ============================================================ */
function screenSettings() {
  mount(`
    ${topbar('Settings', { back: '#/' })}
    <main class="screen">
      <div class="section-label">Your data</div>
      <div class="card">
        <div class="kv"><span>Plans</span><b>${DB.getPlans().length}</b></div>
        <div class="kv"><span>Logged workouts</span><b>${DB.getSessions().length}</b></div>
      </div>

      <div class="section-label">Cloud sync</div>
      <div class="card">
        <div class="kv"><span>Status</span><b style="color:var(--accent)">On</b></div>
        <div class="kv"><span>Last change</span><b>${DB.getUpdatedAt() ? esc(fmtDate(DB.getUpdatedAt()) + ' · ' + fmtTime(DB.getUpdatedAt())) : '—'}</b></div>
      </div>
      <button class="btn btn-block" id="syncnow">${icons.cloud} Sync now</button>

      <div class="spacer"></div><div class="spacer"></div>
      <div class="section-label">Backup</div>
      <p class="desc" style="color:var(--muted);margin:0 0 10px;font-size:13px">Export a file to back up, move to another device, or send for analysis.</p>
      <button class="btn btn-block" id="export">${icons.chart} Export backup (.json)</button>
      <div class="spacer"></div>
      <button class="btn btn-block" id="import-btn">${icons.plus} Import backup</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden />

      <div class="spacer"></div><div class="spacer"></div>
      <div class="section-label">Danger zone</div>
      <button class="btn btn-danger btn-block" id="reset">${icons.trash} Reset all data</button>
      <div class="spacer"></div>
    </main>
  `);

  qs('#syncnow').addEventListener('click', async () => {
    toast('Syncing…');
    await push(); await pull();
    toast('Synced');
    if (location.hash === '#/settings') screenSettings();
  });
  qs('#export').addEventListener('click', () => {
    downloadText('workout-backup.json', DB.exportAll());
    toast('Backup downloaded');
  });
  qs('#import-btn').addEventListener('click', () => qs('#import-file').click());
  qs('#import-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { DB.importAll(await f.text()); toast('Backup imported'); go('#/'); }
    catch (_) { toast('Could not read that file'); }
  });
  qs('#reset').addEventListener('click', () => {
    if (!confirm('Delete ALL plans and workout history on this device? This cannot be undone.')) return;
    if (!confirm('Really reset? Everything on this device will be erased.')) return;
    DB.resetAll();
    toast('All data reset');
    go('#/');
  });
}

/* ============================================================
   Router
   ============================================================ */
function router() {
  clearTickers();
  runLeave();
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\//, '').split('/'); // ["plan","<id>","run"]

  if (hash === '#/' || hash === '' || hash === '#') return screenHome();
  if (parts[0] === 'history') return screenHistory(null);
  if (parts[0] === 'insights') return screenInsights();
  if (parts[0] === 'session') return screenSession(parts[1]);
  if (parts[0] === 'exercise') return screenExercise(decodeURIComponent(parts.slice(1).join('/')));
  if (parts[0] === 'settings') return screenSettings();
  if (parts[0] === 'template') return screenTemplate(parts[1]);
  if (parts[0] === 'plan') {
    if (parts[1] === 'new') return screenEditor('new');
    const id = parts[1];
    if (parts[2] === 'edit') return screenEditor(id);
    if (parts[2] === 'run') return screenRun(id);
    if (parts[2] === 'history') return screenHistory(id);
    return screenPlan(id);
  }
  screenHome();
}

// global nav delegation for [data-nav] and history-back for [data-back]
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-back]')) {
    if (history.length > 1) history.back(); else go('#/insights');
    return;
  }
  const n = e.target.closest('[data-nav]');
  if (n) go(n.dataset.nav);
});

window.addEventListener('hashchange', router);
window.addEventListener('load', router);
router();

// cloud sync: pull newest on load/focus, push on change. Re-render on remote apply.
// After the first pull, if there are still no plans (fresh device / post-reset),
// auto-load the program's plans so the app is ready with no "add template" step.
initSync(() => router()).then(() => {
  if (!DB.getPlans().length) { DB.seedDefaultPlans(); router(); }
});
