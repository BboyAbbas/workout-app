/* ============================================================
   app.js — router, screens, and all interaction.
   Pulls data from db.js, renders into #app, wires events.
   Hash-based routing keeps it a single static page (easy host).
   ============================================================ */

import * as DB from './db.js';
import {
  esc, fmtClock, fmtDuration, fmtDate, fmtTime,
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
            <p class="desc">${t.exercises.length} exercises · tap to add</p>
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

  mount(`
    ${topbar('Workouts', {
      sub: plans.length ? `${plans.length} plan${plans.length > 1 ? 's' : ''}` : '',
      right: `<button class="icon-btn" data-nav="#/history" aria-label="History">${icons.history}</button>`,
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
  qsa('[data-tpl]').forEach((c) =>
    c.addEventListener('click', () => {
      const plan = DB.planFromTemplate(DB.TEMPLATES[+c.dataset.tpl]);
      DB.savePlan(plan);
      toast('Plan added');
      go('#/plan/' + plan.id);
    }));
  const r = qs('[data-resume]');
  if (r) r.addEventListener('click', () => go('#/plan/' + active.planId + '/run'));
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
            return `
              <div class="card">
                <p class="name" style="margin:0 0 4px;font-weight:620">${esc(e.name || 'Exercise')}</p>
                <p class="desc" style="margin:0;color:var(--muted)">
                  Target ${e.sets}×${e.reps}${e.weight ? ` @ ${e.weight}` : ''}
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
          <span style="text-align:left;color:var(--muted)">name · sets · reps · weight · rest(s)</span>
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
        plan.exercises[i].reps = num(row.querySelector('[data-f=reps]').value, 0);
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
    return `
      <div class="ex-row" data-i="${i}">
        <div class="ex-row-head">
          <input class="input" data-f="name" placeholder="Exercise name" value="${esc(e.name)}" />
          <button class="icon-btn ex-del" data-i="${i}" aria-label="Remove">${icons.trash}</button>
        </div>
        <div class="num-grid">
          <div class="field"><label>Sets</label><input class="input" data-f="sets" inputmode="numeric" value="${esc(e.sets)}" /></div>
          <div class="field"><label>Reps</label><input class="input" data-f="reps" inputmode="numeric" value="${esc(e.reps)}" /></div>
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

  // Build a fresh active session, prefilling each set's placeholder with
  // last-time values so the user only changes what differs.
  const entries = {};
  for (const e of plan.exercises) {
    const last = DB.lastEntryForExercise(e.id, e.name) || [];
    entries[e.id] = {
      exerciseId: e.id,
      name: e.name,
      rest: e.rest ?? DB.DEFAULT_REST,
      targetSets: e.sets,
      targetReps: e.reps,
      sets: Array.from({ length: Math.max(1, e.sets) }, (_, i) => ({
        reps: last[i]?.reps ?? '',
        weight: last[i]?.weight ?? (e.weight || ''),
        done: false,
      })),
    };
  }
  DB.setActive({ planId, planName: plan.name, startedAt: Date.now(), entries });
  go('#/plan/' + planId + '/run');
}

function screenRun(planId) {
  let active = DB.getActive();
  if (!active || active.planId !== planId) return go('#/plan/' + planId);
  const order = DB.getPlan(planId)?.exercises.map((e) => e.id)
    || Object.keys(active.entries);

  // rest-timer state lives outside the DOM so re-renders don't kill it
  const rest = { id: null, remaining: 0, total: 0, exId: null };

  function persist() { DB.setActive(active); }

  function render() {
    const exHtml = order.map((exId) => {
      const en = active.entries[exId];
      if (!en) return '';
      const last = DB.lastEntryForExercise(exId, en.name);
      const lastTxt = last ? summariseSets(last) : 'first time';
      const rows = en.sets.map((s, si) => `
        <div class="set-row ${s.done ? 'done' : ''}" data-ex="${exId}" data-si="${si}">
          <div class="set-n">${si + 1}</div>
          <input class="input" data-f="reps" inputmode="numeric" placeholder="reps" value="${esc(s.reps)}" />
          <input class="input" data-f="weight" inputmode="decimal" placeholder="kg" value="${esc(s.weight)}" />
          <button class="set-check ${s.done ? 'on' : ''}" aria-label="Done">${icons.check}</button>
        </div>`).join('');
      return `
        <div class="card run-ex">
          <p class="name">${esc(en.name)}</p>
          <p class="lasttime">Last time: <b>${esc(lastTxt)}</b></p>
          <div class="hint-cols"><span>#</span><span>Reps</span><span>Weight</span><span></span></div>
          ${rows}
          <button class="btn btn-sm btn-ghost" data-addset="${exId}" style="margin-top:6px">${icons.plus} Add set</button>
        </div>`;
    }).join('');

    mount(`
      <div class="timer-bar">
        <div>
          <div class="label">Elapsed</div>
          <div class="time" id="elapsed">00:00</div>
        </div>
        <button class="btn btn-primary" id="finish">${icons.check} Finish</button>
      </div>
      <main class="screen">
        ${exHtml}
        <div class="spacer"></div>
        <button class="btn btn-danger btn-block" id="discard">Discard workout</button>
        <div class="spacer"></div><div class="spacer"></div>
      </main>
      <div id="rest-host"></div>
    `);

    startElapsed();
    bindRun();
    if (rest.id) drawRest(); // keep showing rest bar across re-render
  }

  /* ---- elapsed (total workout) timer ---- */
  function startElapsed() {
    const elEl = qs('#elapsed');
    const tick = () => {
      const secs = (Date.now() - active.startedAt) / 1000;
      if (elEl) elEl.textContent = fmtClock(secs);
    };
    tick();
    addTicker(setInterval(tick, 1000));
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
      <div style="position:fixed;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px));z-index:40;
                  max-width:var(--maxw);margin:0 auto;padding:0 14px 14px">
        <div class="card" style="margin:0;border-color:var(--accent);display:flex;align-items:center;gap:14px;
                  box-shadow:0 -6px 24px rgba(0,0,0,0.4)">
          <div style="flex:1">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span class="label" style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Rest</span>
              <span style="font-variant-numeric:tabular-nums;font-size:24px;font-weight:700">${fmtClock(rest.remaining)}</span>
            </div>
            <div style="height:6px;background:var(--surface-2);border-radius:3px;margin-top:8px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:var(--accent);transition:width 1s linear"></div>
            </div>
          </div>
          <button class="btn btn-sm" id="rest-add">+15s</button>
          <button class="btn btn-sm btn-primary" id="rest-skip">Skip</button>
        </div>
      </div>`;
    const add = qs('#rest-add');
    const skip = qs('#rest-skip');
    if (add) add.addEventListener('click', () => { rest.remaining += 15; rest.total += 15; drawRest(); });
    if (skip) skip.addEventListener('click', () => { stopRest(); drawRest(); });
  }

  /* ---- event wiring ---- */
  function bindRun() {
    // typing into reps/weight updates state
    qsa('.set-row .input').forEach((inp) =>
      inp.addEventListener('input', () => {
        const row = inp.closest('.set-row');
        const en = active.entries[row.dataset.ex];
        const s = en.sets[+row.dataset.si];
        const f = inp.dataset.f;
        s[f] = inp.value;
        persist();
      }));

    // checking a set off -> mark done + start rest
    qsa('.set-check').forEach((btn) =>
      btn.addEventListener('click', () => {
        const row = btn.closest('.set-row');
        const en = active.entries[row.dataset.ex];
        const s = en.sets[+row.dataset.si];
        s.done = !s.done;
        btn.classList.toggle('on', s.done);
        row.classList.toggle('done', s.done);
        persist();
        if (s.done) startRest(en.rest || DB.DEFAULT_REST, row.dataset.ex);
        else stopRest(), drawRest();
      }));

    // add an extra set to an exercise
    qsa('[data-addset]').forEach((b) =>
      b.addEventListener('click', () => {
        const en = active.entries[b.dataset.addset];
        const prev = en.sets[en.sets.length - 1] || {};
        en.sets.push({ reps: prev.reps ?? '', weight: prev.weight ?? '', done: false });
        persist();
        render();
      }));

    qs('#finish').addEventListener('click', finishWorkout);
    qs('#discard').addEventListener('click', () => {
      if (confirm('Discard this workout? Nothing will be saved.')) {
        stopRest(); DB.setActive(null); go('#/plan/' + planId);
      }
    });
  }

  function finishWorkout() {
    stopRest();
    const endedAt = Date.now();
    const durationSec = Math.round((endedAt - active.startedAt) / 1000);
    const entries = order.map((exId) => {
      const en = active.entries[exId];
      const sets = en.sets
        .filter((s) => s.reps !== '' && s.reps != null)
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
   Router
   ============================================================ */
function router() {
  clearTickers();
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\//, '').split('/'); // ["plan","<id>","run"]

  if (hash === '#/' || hash === '' || hash === '#') return screenHome();
  if (parts[0] === 'history') return screenHistory(null);
  if (parts[0] === 'session') return screenSession(parts[1]);
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
