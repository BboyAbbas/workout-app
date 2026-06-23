/* Workout sync + push Worker.
   STATE (KV, one JSON doc per user):
     GET  /state?id=<key>            -> { data, updatedAt }   (or {} if none yet)
     PUT  /state?id=<key>            body { data, updatedAt }  -> stores it
   PUSH (Web Push rest-done alert):
     POST /push/subscribe?id=<key>   body <PushSubscription>   -> store subscription
     POST /push/schedule?id=<key>    body { fireAt }           -> DO alarm at fireAt
     POST /push/cancel?id=<key>                                -> clear the DO alarm
   Token-gated (Bearer) + CORS-locked to the app origin. */

const ALLOW_ORIGINS = [
  'https://bboyabbas.github.io',
  'http://127.0.0.1:8099',
  'http://localhost:8099',
];

function corsHeaders(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

/* ---------- push message + Durable Object routing, per alarm kind ---------- */
// Each kind gets its OWN DO instance so a short rest alarm and the long idle /
// auto-finish alarms never overwrite one another's single alarm slot.
function doName(id, kind) { return kind === 'rest' ? id : kind + ':' + id; }
function msgFor(kind) {
  if (kind === 'idle') {
    return { title: 'Hey, are you still there?', body: "Your workout's still running — tap to finish it.", tag: 'workout-watch' };
  }
  if (kind === 'autofinish') {
    return { title: 'Workout auto-finished ✅', body: 'No activity for a while — your logged sets are saved.', tag: 'workout-watch' };
  }
  return { title: 'Rest done 💪', body: 'Time for your next set', tag: 'rest' };
}

/* ---------- base64url helpers ---------- */
function b64urlFromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlFromString(str) {
  return b64urlFromBytes(new TextEncoder().encode(str));
}

/* ---------- VAPID: signed Authorization header for a payload-less push ---------- */
async function vapidHeader(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:admin@example.com',
  };
  const signingInput = b64urlFromString(JSON.stringify(header)) + '.' + b64urlFromString(JSON.stringify(payload));
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
  const jwt = signingInput + '.' + b64urlFromBytes(new Uint8Array(sig)); // WebCrypto returns raw r||s (P1363) = what JWT wants
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`;
}

/** Send a payload-less push to one subscription. Returns the HTTP status. */
async function sendPush(subscription, env) {
  const endpoint = subscription && subscription.endpoint;
  if (!endpoint) return 0;
  const auth = await vapidHeader(endpoint, env);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: auth, TTL: '120' },
  });
  return res.status;
}

/* ============================================================
   Durable Object: one alarm per user that fires the rest-done push.
   ============================================================ */
export class RestAlarm {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/schedule') {
      const { id, fireAt, msg } = await req.json();
      if (!id || !fireAt) return new Response('bad', { status: 400 });
      await this.state.storage.put('id', id);
      await this.state.storage.put('msg', msg || null); // text the SW shows when this alarm fires
      // clamp into the future so a stale clock can't make the alarm never fire
      await this.state.storage.setAlarm(Math.max(Date.now() + 500, fireAt));
      return new Response('ok');
    }
    if (url.pathname === '/cancel') {
      await this.state.storage.deleteAlarm();
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }

  async alarm() {
    const id = await this.state.storage.get('id');
    if (!id) return;
    // stash the message text so the (payload-less) push can be rendered by the SW
    const msg = await this.state.storage.get('msg');
    if (msg) { try { await this.env.WORKOUT_KV.put('notif:' + id, JSON.stringify(msg), { expirationTtl: 600 }); } catch (_) {} }
    const raw = await this.env.WORKOUT_KV.get('push:' + id);
    if (!raw) return;
    let sub; try { sub = JSON.parse(raw); } catch (_) { return; }
    try {
      const status = await sendPush(sub, this.env);
      // subscription gone -> drop it so we stop trying
      if (status === 404 || status === 410) await this.env.WORKOUT_KV.delete('push:' + id);
    } catch (_) { /* transient — let it go, the offline alarm still covers the user */ }
  }
}

/* ============================================================
   Worker entry
   ============================================================ */
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const h = corsHeaders(origin);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const url = new URL(req.url);

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.SYNC_TOKEN || token !== env.SYNC_TOKEN) return json({ error: 'unauthorized' }, 401, h);

    const id = (url.searchParams.get('id') || 'default').slice(0, 64);

    /* ---- sync state (KV) ---- */
    if (url.pathname === '/state') {
      const key = 'state:' + id;
      if (req.method === 'GET') {
        const v = await env.WORKOUT_KV.get(key);
        return json(v ? JSON.parse(v) : {}, 200, h);
      }
      if (req.method === 'PUT') {
        let body;
        try { body = await req.json(); } catch (_) { return json({ error: 'bad json' }, 400, h); }
        if (!body || typeof body !== 'object' || typeof body.updatedAt !== 'number') {
          return json({ error: 'bad payload' }, 400, h);
        }
        await env.WORKOUT_KV.put(key, JSON.stringify({ data: body.data || {}, updatedAt: body.updatedAt }));
        return json({ ok: true, updatedAt: body.updatedAt }, 200, h);
      }
      return json({ error: 'method not allowed' }, 405, h);
    }

    /* ---- push: store this device's subscription ---- */
    if (url.pathname === '/push/subscribe' && req.method === 'POST') {
      let sub;
      try { sub = await req.json(); } catch (_) { return json({ error: 'bad json' }, 400, h); }
      if (!sub || !sub.endpoint) return json({ error: 'bad subscription' }, 400, h);
      await env.WORKOUT_KV.put('push:' + id, JSON.stringify(sub));
      return json({ ok: true }, 200, h);
    }

    /* ---- push: the latest message text for the SW to render (payload-less push) ---- */
    if (url.pathname === '/push/notif' && req.method === 'GET') {
      const raw = await env.WORKOUT_KV.get('notif:' + id);
      return json(raw ? JSON.parse(raw) : {}, 200, h);
    }

    /* ---- push: schedule / cancel a Durable Object alarm, per kind ----
       kinds: 'rest' (rest-done), 'idle' (20-min "still there?"), 'autofinish'
       (50-min auto-finish notice). Each kind is its own DO instance so their
       alarms can coexist. */
    if (url.pathname === '/push/schedule' && req.method === 'POST') {
      let body; try { body = await req.json(); } catch (_) { return json({ error: 'bad json' }, 400, h); }
      const fireAt = Number(body && body.fireAt);
      const kind = String((body && body.kind) || 'rest');
      if (!Number.isFinite(fireAt)) return json({ error: 'bad fireAt' }, 400, h);
      const stub = env.REST_ALARM.get(env.REST_ALARM.idFromName(doName(id, kind)));
      await stub.fetch('https://do/schedule', { method: 'POST', body: JSON.stringify({ id, fireAt, msg: msgFor(kind) }) });
      return json({ ok: true, fireAt, kind }, 200, h);
    }
    if (url.pathname === '/push/cancel' && req.method === 'POST') {
      let body = {}; try { body = await req.json(); } catch (_) {}
      const kind = String((body && body.kind) || 'rest');
      const stub = env.REST_ALARM.get(env.REST_ALARM.idFromName(doName(id, kind)));
      await stub.fetch('https://do/cancel', { method: 'POST' });
      return json({ ok: true, kind }, 200, h);
    }

    return json({ error: 'not found' }, 404, h);
  },
};
