/* Claude's helper to read/modify Abbas's live workout data in the cloud.
   The app syncs the same document, so changes here appear in the app on next
   open/focus.

   Usage:
     node tools/claude_sync.mjs get                 # print the current doc
     node tools/claude_sync.mjs get > data.json      # save it for analysis
     node tools/claude_sync.mjs put data.json        # upload {plans,sessions}, bumps updatedAt

   `put` expects a JSON file shaped { "plans": [...], "sessions": [...] }
   (the same shape `get` returns under .data). updatedAt is set to now so the
   app treats it as the newest version and pulls it. */

const ENDPOINT = 'https://workout-sync.bboy-abbass.workers.dev/state';
const TOKEN = '0287ce3007c80cc07c109b8317cc541bc546912489b0b652';
const ID = process.env.WT_SYNC_ID || 'abbas-main';
const url = `${ENDPOINT}?id=${encodeURIComponent(ID)}`;
const headers = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };

const cmd = process.argv[2];

if (cmd === 'get') {
  const r = await fetch(url, { headers });
  if (!r.ok) { console.error('GET failed:', r.status, await r.text()); process.exit(1); }
  const doc = await r.json();
  process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
} else if (cmd === 'put') {
  const fs = await import('node:fs');
  const file = process.argv[3];
  if (!file) { console.error('usage: put <file.json>'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const payload = { data: { plans: data.plans || [], sessions: data.sessions || [] }, updatedAt: Date.now() };
  const r = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) });
  if (!r.ok) { console.error('PUT failed:', r.status, await r.text()); process.exit(1); }
  console.log('uploaded; updatedAt =', payload.updatedAt, '(app will pull on next open)');
} else {
  console.error('usage: node tools/claude_sync.mjs get | put <file.json>');
  process.exit(1);
}
