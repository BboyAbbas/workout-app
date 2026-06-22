/* Workout sync Worker — one JSON document per user key in KV.
   GET  /state?id=<key>  -> { data, updatedAt }   (or {} if none yet)
   PUT  /state?id=<key>  body { data, updatedAt }  -> stores it
   Token-gated (Bearer) + CORS-locked to the app origin. Last-write-wins is
   handled by the client comparing updatedAt; the Worker just stores/returns. */

const ALLOW_ORIGINS = [
  'https://bboyabbas.github.io',
  'http://127.0.0.1:8099',
  'http://localhost:8099',
];

function corsHeaders(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const h = corsHeaders(origin);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const url = new URL(req.url);
    if (url.pathname !== '/state') return json({ error: 'not found' }, 404, h);

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.SYNC_TOKEN || token !== env.SYNC_TOKEN) return json({ error: 'unauthorized' }, 401, h);

    const id = (url.searchParams.get('id') || 'default').slice(0, 64);
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
  },
};
