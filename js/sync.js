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

/** Pull remote; if it's newer than local, apply it and re-render. */
export async function pull() {
  if (pulling) return;
  pulling = true;
  try {
    const r = await fetch(url(), { headers: headers() });
    if (!r.ok) return;
    const remote = await r.json();
    if (remote && remote.updatedAt && remote.updatedAt > DB.getUpdatedAt()) {
      DB.applyRemote(remote.data || {}, remote.updatedAt);
      localStorage.setItem(KEY_PUSHED, String(remote.updatedAt)); // already matches cloud
      if (onApplied) onApplied();
    }
  } catch (_) { /* offline — stay on local, retry next focus/change */ }
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
  const initial = pull();   // pull newest on startup
  schedulePush();           // and push anything local that isn't in the cloud yet
  return initial;
}
