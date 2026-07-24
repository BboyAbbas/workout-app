/* ============================================================
   sync.js — cloud sync via the Cloudflare Worker + KV.
   The whole dataset is one JSON document keyed by `id`. The app pulls on
   load / focus and pushes (debounced) whenever plans or sessions change.
   Last-write-wins by updatedAt. localStorage stays the offline source of
   truth; the cloud is the shared copy that Claude can also read/edit.

   The token is a low-stakes gate (this is personal workout data) and is
   necessarily visible in the client. The Worker also locks CORS to the app
   origin. Not high security — just keeps the endpoint from being wide open.
   ============================================================ */

import * as DB from './db.js';

const ENDPOINT = 'https://workout-sync.bboy-abbass.workers.dev/state';
const TOKEN = '0287ce3007c80cc07c109b8317cc541bc546912489b0b652';
// One shared document across all of Abbas's devices. Overridable for testing.
const USER_ID = localStorage.getItem('wt_sync_id') || 'abbas-main';
const KEY_PUSHED = 'wt_pushed_at';

let onApplied = null;   // re-render callback after a remote pull is applied
let pushTimer = null;
let pulling = false;

function headers() {
  return { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
}
function url() { return `${ENDPOINT}?id=${encodeURIComponent(USER_ID)}`; }

/** Pull remote; if it's newer than local, apply it and re-render.
 *  Resolves to how it went: 'applied' | 'stale' | 'empty' | 'error' | 'busy'.
 *  Callers may only seed defaults on 'empty' (cloud CONFIRMED empty) — a
 *  failed pull on a fresh device must never lead to seeding + pushing
 *  starter plans over the real shared doc. */
export async function pull() {
  if (pulling) return 'busy';
  pulling = true;
  try {
    // 10s timeout: a fetch that never settles (seen live right after a service
    // worker update) would otherwise leave `pulling` stuck true, so every later
    // focus-pull returns 'busy' and the tab never syncs until a manual reload.
    const r = await fetch(url(), { headers: headers(), signal: AbortSignal.timeout(10000) });
    if (!r.ok) return 'error';
    const remote = await r.json();
    const localUpdated = DB.getUpdatedAt();
    if (remote && remote.updatedAt && remote.updatedAt > localUpdated) {
      const data = remote.data || {};
      // Local work that never reached the cloud (a workout logged offline while
      // another device / Claude updated the doc) must survive the pull: union any
      // local session the remote copy lacks, then push the merged doc back up.
      // A clean local copy applies remote as-is, so a session deleted on another
      // device still stays deleted here.
      const pushed = Number(localStorage.getItem(KEY_PUSHED)) || 0;
      let mergedIn = 0;
      if (localUpdated && localUpdated !== pushed) {
        const local = DB.snapshot();
        if (Array.isArray(data.sessions)) {
          const have = new Set(data.sessions.map((s) => s && s.id));
          const missing = (local.sessions || []).filter((s) => s && s.id && !have.has(s.id));
          if (missing.length) { data.sessions = data.sessions.concat(missing); mergedIn += missing.length; }
        }
        // same union for weight entries logged offline (weights is one object,
        // so without this a remote pull would drop an unpushed weigh-in)
        const mineW = local.weights;
        if (mineW && Array.isArray(mineW.entries) && mineW.entries.length) {
          if (data.weights && Array.isArray(data.weights.entries)) {
            const haveW = new Set(data.weights.entries.map((e) => e && e.id));
            const missW = mineW.entries.filter((e) => e && e.id && !haveW.has(e.id));
            if (missW.length) {
              data.weights.entries = data.weights.entries.concat(missW).sort((a, b) => a.t - b.t);
              mergedIn += missW.length;
            }
          } else if (!data.weights) {
            data.weights = mineW; mergedIn += mineW.entries.length;
          }
        }
      }
      DB.applyRemote(data, remote.updatedAt);
      localStorage.setItem(KEY_PUSHED, String(remote.updatedAt)); // already matches cloud
      if (onApplied) onApplied();
      if (mergedIn) { DB.markDirty(); push(); } // cloud lacks what we kept — send it up
      return 'applied';
    }
    return remote && remote.updatedAt ? 'stale' : 'empty';
  } catch (_) { return 'error'; /* offline — stay on local, retry next focus/change */ }
  finally { pulling = false; }
}

/** Push local to the cloud if it changed since the last successful push. */
export async function push() {
  const updatedAt = DB.getUpdatedAt();
  if (!updatedAt || String(updatedAt) === localStorage.getItem(KEY_PUSHED)) return;
  try {
    const r = await fetch(url(), {
      method: 'PUT', headers: headers(),
      body: JSON.stringify({ data: DB.snapshot(), updatedAt }),
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) localStorage.setItem(KEY_PUSHED, String(updatedAt));
  } catch (_) { /* offline — will retry on next change */ }
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 1500); // debounce bursts of edits
}

/** Wire up sync. `onRemoteApplied` re-renders the current screen after a pull.
 *  Returns the initial pull promise so the caller can seed defaults if, after
 *  pulling, there's still no data. */
export function initSync(onRemoteApplied) {
  onApplied = onRemoteApplied;
  window.addEventListener('wt-changed', schedulePush);
  window.addEventListener('focus', pull);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pull();
  });
  // flush a pending push before the app is hidden/closed
  window.addEventListener('pagehide', push);
  // Pull newest on startup. The first pull of a visit is fragile: a just-updated
  // service worker claims the page and self-reloads, aborting it, and the retry
  // can hang until the fetch timeout. Retry a failed/busy first pull a few times
  // so the screen fills without the user having to reload.
  const initial = pull();
  let tries = 0;
  const ensureFirstPull = (st) => {
    if ((st === 'error' || st === 'busy') && tries++ < 3) {
      setTimeout(() => pull().then(ensureFirstPull), 6000);
    }
  };
  initial.then(ensureFirstPull);
  schedulePush();           // and push anything local that isn't in the cloud yet
  return initial;
}
