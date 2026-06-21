/* ============================================================
   app.js — router, screens, and all interaction.
   Pulls data from db.js, renders into #app, wires events.
   Hash-based routing keeps it a single static page (easy host).
   ============================================================ */

import * as DB from './db.js';
import {
  esc, fmtClock, fmtDuration, fmtDate, fmtTime, fmtInt,
  icons, toast, summariseSets,
} from './ui.js';

const app = document.getElementById('app');

/* timers that must be cleared whenever we leave a screen */
let tickers = [];
function addTicker(id) { tickers.push(id); }
function clearTickers() { tickers.forEach(clearInterval); tickers = []; }

/* ---------- tiny helpers ---------- */
function go(hash) { location.hash = hash; }
function mount(html) { app.innerHTML = html; app.firstElementChild?.classList.add('fade-in'); }
function num(v, fallback = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; }
function qs(sel) { return app.querySelector(sel); }
function qsa(sel) { return Array.from(app.querySelectorAll(sel)); }

function topbar(title, { back = null, sub = '', right = '' } = {}) {
  return `
    <header class="topbar">
      ${back !== null ? `<button class="icon-btn" data-nav="${esc(back)}" aria-label="Back">${icons.back}</button>` : ''}
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
        <p>Make one yourself, or start from a template.</p>
      </div>
      <button class="btn btn-primary btn-block" data-nav="#/plan/new">${icons.plus} Create your own</button>
      <div class="section-label">Templates</div>
      ${DB.TEMPLATES.map((t, i) => `
        <div class="card plan-card tappable" data-tpl="${i}">
          <div class="meta">
            <p class="name">${esc(t.name)}</p>
            <p class="desc">${t.exercises.length} exercises · tap to preview</p>
          </div>
          <button class="icon-btn" aria-label="Add">${icons.plus}</button>
        </div>`).join('')}
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

  // Templates stay reachable once plans exist (tap to add a copy you can edit).
  const templatesBlock = `
    <div class="section-label">Add from a template</div>
    ${DB.TEMPLATES.map((t, i) => `
      <div class="card plan-card tappable" data-tpl="${i}">
        <div class="meta">
          <p class="name">${esc(t.name)}</p>
          <p class="desc">${t.exercises.length} exercises · tap to add</p>
        </div>
        <button class="icon-btn" aria-label="Add">${icons.plus}</button>
      </div>`).join('')}`;

  mount(`
    ${topbar('Workouts', {
      sub: plans.length ? `${plans.length} plan${plans.length > 1 ? 's' : ''}` : '',
      right: `
        <button class="icon-btn" data-nav="#/insights" aria-label="Insights">${icons.chart}</button>
        <button class="icon-btn" data-nav="#/history" aria-label="History">${icons.history}</button>`,
    })}
    <main class="screen">
      ${resumeBar}
      ${body}
      ${plans.length ? templatesBlock : ''}
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
  qsa('[data-tpl]').forEach((c) =>
    c.addEventListener('click', () => go('#/template/' + c.dataset.tpl)));
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
            <p class="desc" style="margin:0;color:var(--muted)">Target ${e.sets}×${repTxt}</p>
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
            const ltTxt = lt ? summariseSets(lt) : '';
            const rng = DB.repRange(e);
            const repTxt = rng.min === rng.max ? `${rng.max}` : `${rng.min}–${rng.max}`;
            return `
              <div class="card">
                <p class="name" style="margin:0 0 4px;font-weight:620">${esc(e.name || 'Exercise')}</p>
                <p class="desc" style="margin:0;color:var(--muted)">
                  Target ${e.sets}×${repTxt}${e.weight ? ` @ ${e.weight}` : ''}
                  ${ltTxt ? ` · last <b style="color:var(--accent)">${esc(ltTxt)}</b>` : ''}
                </p>
              </div>`;
          }).join('')}

      <div class="spacer"></div>
      <button class="btn btn-primary btn-block" data-run>${icons.play} Start workout</button>
      <div class="spacer"></div>
      <div class="btn-row">
        <button class="btn" data-nav="#/plan/${id}/history">${icons.history} History (${sessions.length})</button>
        <button class="btn" data-nav="#/plan/${id}/edit">${icons.edit} Edit</button>
      </div>
    </main>
  `);

  qs('[data-run]').addEventListener('click', () => startRun(id));
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
        plan.exercises[i].name = row.querySelector('[data-f=name]').value;
        plan.exercises[i].sets = num(row.querySelector('[data-f=sets]').value, 1);
        let lo = num(row.querySelector('[data-f=repMin]').value, 0);
        let hi = num(row.querySelector('[data-f=repMax]').value, 0);
        if (hi <= 0) hi = lo;            // only one filled -> single target
        if (lo <= 0) lo = hi;
        if (lo > hi) { const t = lo; lo = hi; hi = t; } // tolerate swapped entry
        plan.exercises[i].repMin = lo;
        plan.exercises[i].repMax = hi;
        plan.exercises[i].reps = hi;     // keep legacy field = top of range
        plan.exercises[i].weight = num(row.querySelector('[data-f=weight]').value, 0);
        plan.exercises[i].rest = num(row.querySelector('[data-f=rest]').value, DB.DEFAULT_REST);
      });
    }

    qs('#add-ex').addEventListener('click', () => {
      readRows();
      plan.exercises.push(DB.newExercise());
      render();
    });

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
    const rng = DB.repRange(e);
    return `
      <div class="ex-row" data-i="${i}">
        <div class="ex-row-head">
          <input class="input" data-f="name" placeholder="Exercise name" value="${esc(e.name)}" />
          <button class="icon-btn ex-del" data-i="${i}" aria-label="Remove">${icons.trash}</button>
        </div>
        <div class="num-grid num-grid-4">
          <div class="field"><label>Sets</label><input class="input" data-f="sets" inputmode="numeric" value="${esc(e.sets)}" /></div>
          <div class="field"><label>Rep min</label><input class="input" data-f="repMin" inputmode="numeric" value="${esc(rng.min)}" /></div>
          <div class="field"><label>Rep max</label><input class="input" data-f="repMax" inputmode="numeric" value="${esc(rng.max)}" /></div>
          <div class="field"><label>Weight</label><input class="input" data-f="weight" inputmode="decimal" value="${esc(e.weight)}" /></div>
        </div>
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
    const range = DB.repRange(e);
    const rec = DB.recommendNext(last.length ? last : null, range, DB.DEFAULT_INC, e.sets);
    const sets = Array.from({ length: Math.max(1, e.sets) }, (_, i) => {
      if (rec.dir === 'up') {
        return { reps: range.min, weight: rec.weight, done: false };
      }
      if (rec.dir === 'hold') {
        const lr = Number(last[i]?.reps);
        const reps = Number.isFinite(lr) && lr > 0 ? Math.min(range.max, lr + 1) : range.min;
        const weight = rec.weight ?? last[i]?.weight ?? (e.weight || '');
        return { reps, weight, done: false };
      }
      return { reps: '', weight: e.weight || '', done: false }; // first time
    });
    entries[e.id] = {
      exerciseId: e.id,
      name: e.name,
      rest: e.rest ?? DB.DEFAULT_REST,
      targetSets: e.sets,
      targetReps: range.max,
      repMin: range.min,
      repMax: range.max,
      rec: { dir: rec.dir, note: rec.note },
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

  // rest-timer state lives outside the DOM so re-renders don't kill it
  const rest = { id: null, remaining: 0, total: 0, exId: null };
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
      const last = DB.lastEntryForExercise(exId, en.name);
      const lastTxt = last ? summariseSets(last) : 'first time';
      const rows = en.sets.map((s, si) => {
        const isActive = activeSel && activeSel.exId === exId && activeSel.si === si;
        return `
        <div class="set-row ${s.done ? 'done' : ''} ${isActive ? 'active' : ''}" data-ex="${exId}" data-si="${si}">
          <button class="set-n" data-select="${exId}" data-si="${si}" aria-label="Set ${si + 1}">${s.done ? icons.check : (si + 1)}</button>
          <input class="input" data-f="weight" inputmode="decimal" placeholder="kg" value="${esc(s.weight)}" />
          <input class="input" data-f="reps" inputmode="numeric" placeholder="reps" value="${esc(s.reps)}" />
        </div>`;
      }).join('');
      const recHtml = en.rec
        ? `<p class="rec rec-${en.rec.dir}">${en.rec.dir === 'up' ? icons.up : icons.target} ${esc(en.rec.note)}</p>`
        : '';
      return `
        <div class="card run-ex">
          <p class="name">${esc(en.name)}</p>
          <p class="lasttime">Last time: <b>${esc(lastTxt)}</b></p>
          ${recHtml}
          <div class="hint-cols"><span>#</span><span>Weight</span><span>Reps</span></div>
          ${rows}
          <button class="btn btn-sm btn-ghost btn-block" data-addset="${exId}" style="margin-top:8px">${icons.plus} Add set</button>
        </div>`;
    }).join('');

    mount(`
      <div class="timer-bar">
        <div style="flex:1">
          <div class="label">Elapsed</div>
          <div class="time" id="elapsed">00:00</div>
        </div>
        <button class="btn btn-primary" id="finish">${icons.check} Finish</button>
      </div>
      <main class="screen" style="padding-bottom:200px">
        ${exHtml}
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
  function startElapsed() {
    if (elapsedId) clearInterval(elapsedId);
    const elEl = qs('#elapsed');
    const tick = () => {
      const secs = (Date.now() - active.startedAt) / 1000;
      if (elEl) elEl.textContent = fmtClock(secs);
    };
    tick();
    elapsedId = setInterval(tick, 1000);
    addTicker(elapsedId);
  }

  /* ---- rest countdown + vibration ---- */
  function startRest(seconds, exId) {
    stopRest();
    rest.total = seconds; rest.remaining = seconds; rest.exId = exId;
    rest.id = setInterval(() => {
      rest.remaining -= 1;
      if (rest.remaining <= 0) { finishRest(); return; }
      drawRest();
    }, 1000);
    addTicker(rest.id);
    drawRest();
  }
  function finishRest() {
    stopRest();
    // buzz pattern — Android fires this; iOS ignores silently
    if (navigator.vibrate) navigator.vibrate([400, 120, 400]);
    toast('Rest done — next set 💪');
    drawRest(); // clears the bar
  }
  function stopRest() {
    if (rest.id) { clearInterval(rest.id); rest.id = null; }
    rest.remaining = 0; rest.exId = null;
  }
  function drawRest() {
    const host = qs('#rest-host');
    if (!host) return;
    if (!rest.id) { host.innerHTML = ''; return; }
    const pct = rest.total ? (rest.remaining / rest.total) * 100 : 0;
    host.innerHTML = `
      <div class="card" style="margin:0 0 10px;border-color:var(--accent);display:flex;align-items:center;gap:14px;padding:12px 14px">
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Rest</span>
            <span style="font-variant-numeric:tabular-nums;font-size:22px;font-weight:700">${fmtClock(rest.remaining)}</span>
          </div>
          <div style="height:6px;background:var(--surface-2);border-radius:3px;margin-top:8px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:var(--accent);transition:width 1s linear"></div>
          </div>
        </div>
        <button class="btn btn-sm" id="rest-add">+15s</button>
        <button class="btn btn-sm btn-primary" id="rest-skip">Skip</button>
      </div>`;
    const add = qs('#rest-add');
    const skip = qs('#rest-skip');
    if (add) add.addEventListener('click', () => { rest.remaining += 15; rest.total += 15; drawRest(); });
    if (skip) skip.addEventListener('click', () => { stopRest(); drawRest(); });
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
    });

    // tap a set's number to select it as the active set
    qsa('[data-select]').forEach((b) =>
      b.addEventListener('click', () => selectActive(b.dataset.select, +b.dataset.si)));

    // add an extra set to an exercise
    qsa('[data-addset]').forEach((b) =>
      b.addEventListener('click', () => {
        const en = active.entries[b.dataset.addset];
        const prev = en.sets[en.sets.length - 1] || {};
        en.sets.push({ reps: prev.reps ?? '', weight: prev.weight ?? '', done: false });
        persist();
        render();
      }));

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
    if (!activeSel) return finishWorkout(); // all sets done -> button is "Finish workout"
    const { exId, si } = activeSel;
    const en = active.entries[exId];
    const s = en.sets[si];
    const row = app.querySelector(`.set-row[data-ex="${exId}"][data-si="${si}"]`);
    if (row) {
      s.reps = row.querySelector('[data-f=reps]').value;
      s.weight = row.querySelector('[data-f=weight]').value;
    }
    if (s.reps === '' || s.reps == null) {
      toast('Enter reps first');
      if (row) row.querySelector('[data-f=reps]').focus();
      return;
    }
    s.done = true;
    persist();
    startRest(en.rest || DB.DEFAULT_REST, exId);
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
      const sets = en.sets
        .filter((s) => s.done)
        .map((s) => ({ reps: num(s.reps, 0), weight: num(s.weight, 0) }));
      return { exerciseId: exId, name: en.name, sets };
    }).filter((e) => e.sets.length);

    if (!entries.length) {
      if (!confirm('No sets logged. Finish anyway? (nothing will be saved)')) return;
      DB.setActive(null);
      return go('#/plan/' + planId);
    }

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
    toast(`Done · ${fmtDuration(durationSec)}`);
    go('#/plan/' + planId + '/history');
  }

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
      ${s.entries.map((e) => `
        <div class="card">
          <p class="name" style="margin:0 0 8px;font-weight:620">${esc(e.name)}</p>
          ${e.sets.map((set, i) => `
            <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
              <span style="color:var(--muted)">Set ${i + 1}</span>
              <span style="font-weight:600">${esc(set.reps)} reps${set.weight ? ` · ${esc(set.weight)}` : ''}</span>
            </div>`).join('')}
        </div>`).join('')}
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

      <div class="section-label">Volume lifted</div>
      <div class="card">
        <div class="stat-v" style="font-size:30px">${fmtInt(volume)} <span style="font-size:16px;color:var(--muted)">kg total</span></div>
        <div class="stat-l">${fmtInt(reps)} reps · ${totalSets} sets across all workouts</div>
      </div>

      <div class="section-label">Muscle focus (by sets)</div>
      <div class="card">
        ${muscleRows.map(([m, c]) => {
          const pct = Math.round((c / totalSets) * 100);
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
}

/* ============================================================
   Router
   ============================================================ */
function router() {
  clearTickers();
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\//, '').split('/'); // ["plan","<id>","run"]

  if (hash === '#/' || hash === '' || hash === '#') return screenHome();
  if (parts[0] === 'history') return screenHistory(null);
  if (parts[0] === 'insights') return screenInsights();
  if (parts[0] === 'session') return screenSession(parts[1]);
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

// global nav delegation for [data-nav]
document.addEventListener('click', (e) => {
  const n = e.target.closest('[data-nav]');
  if (n) go(n.dataset.nav);
});

window.addEventListener('hashchange', router);
window.addEventListener('load', router);
router();
