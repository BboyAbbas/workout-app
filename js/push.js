/* ============================================================
   push.js — Web Push: the ONLINE rest-done alert.
   When a rest starts, we ask the sync Worker to fire a push notification at the
   rest-end time. The Worker (a Durable Object alarm) sends a payload-less push
   that wakes the service worker even when the PWA is closed / backgrounded /
   screen-locked, and sw.js shows the "Rest done" notification (its buzz + sound
   are governed by the phone's own notification settings). This is the reliable
   path when online; the offline audio alarm in app.js is the fallback.
   Everything here is best-effort — every failure is swallowed so a flaky network
   can never break a workout.
   ============================================================ */

const BASE = 'https://workout-sync.bboy-abbass.workers.dev';
const TOKEN = '0287ce3007c80cc07c109b8317cc541bc546912489b0b652';
const USER_ID = localStorage.getItem('wt_sync_id') || 'abbas-main';
// VAPID application server public key (uncompressed P-256 point, base64url).
// Public by design — the matching private key lives only as a Worker secret.
const VAPID_PUBLIC = 'BK8B5p_0dzZGU9Bpgd9YAaCZIF_MdAu02raGS7JlcD2xPFT7gsawqjA_bs6LkQ3vT4JeOpwN4yzaswctUDb-Es4';

let subscribing = false;

function authHeaders() { return { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }; }
function url(path) { return `${BASE}${path}?id=${encodeURIComponent(USER_ID)}`; }
function b64urlToU8(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Subscribe this device to push and register it server-side (idempotent).
 *  No-op unless notification permission is already granted. */
export async function ensurePushSubscribed() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    if (!('Notification' in window) || Notification.permission !== 'granted') return null;
    if (subscribing) return null;
    subscribing = true;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToU8(VAPID_PUBLIC),
      });
    }
    await fetch(url('/push/subscribe'), {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(sub),
    });
    return sub;
  } catch (_) { return null; }
  finally { subscribing = false; }
}

/** True only when we can actually show a notification — gates all scheduling so
 *  we never arm a server alarm that can't be delivered (and so tests, which have
 *  no permission, never touch the live alarm). */
function granted() { return typeof Notification !== 'undefined' && Notification.permission === 'granted'; }

/** Ask the server to fire a rest-done push at `endAtMs` (absolute ms). */
export async function scheduleServerRestAlert(endAtMs) {
  if (!granted() || !Number.isFinite(endAtMs)) return;
  try {
    await ensurePushSubscribed();
    await fetch(url('/push/schedule'), {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ fireAt: Math.round(endAtMs), kind: 'rest' }),
    });
  } catch (_) {}
}

/** Cancel a pending server rest alert (rest skipped / finished early / on-screen). */
export async function cancelServerRestAlert() {
  try {
    await fetch(url('/push/cancel'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ kind: 'rest' }) });
  } catch (_) {}
}

/* ---- idle watchdog: a "still there?" nudge, then a later auto-finish notice ----
   Two independent server alarms (separate from the rest alarm), re-armed off the
   user's last activity and cancelled when the workout ends. The actual save at
   auto-finish happens in the app (the server can't touch local data) — these just
   deliver the heads-up so the user returns and the app finalises on open. */
export async function scheduleWorkoutWatchdog(idleAtMs, finishAtMs) {
  if (!granted()) return;
  try {
    await ensurePushSubscribed();
    if (Number.isFinite(idleAtMs)) {
      await fetch(url('/push/schedule'), {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ fireAt: Math.round(idleAtMs), kind: 'idle' }),
      });
    }
    if (Number.isFinite(finishAtMs)) {
      await fetch(url('/push/schedule'), {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ fireAt: Math.round(finishAtMs), kind: 'autofinish' }),
      });
    }
  } catch (_) {}
}

export async function cancelWorkoutWatchdog() {
  try {
    await fetch(url('/push/cancel'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ kind: 'idle' }) });
    await fetch(url('/push/cancel'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ kind: 'autofinish' }) });
  } catch (_) {}
}
