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

if (cmd === 'backups') {          // list daily snapshot dates
  const r = await fetch(`${ENDPOINT.replace('/state', '/backups')}?id=${encodeURIComponent(ID)}`, { headers });
  if (!r.ok) { console.error('backups failed:', r.status, await r.text()); process.exit(1); }
  console.log(JSON.stringify(await r.json(), null, 2));
} else if (cmd === 'backup') {    // print one snapshot: backup <YYYY-MM-DD>
  const date = process.argv[3];
  if (!date) { console.error('usage: backup <YYYY-MM-DD>'); process.exit(1); }
  const r = await fetch(`${ENDPOINT.replace('/state', '/backup')}?id=${encodeURIComponent(ID)}&date=${date}`, { headers });
  if (!r.ok) { console.error('backup failed:', r.status, await r.text()); process.exit(1); }
  process.stdout.write(JSON.stringify(await r.json(), null, 2) + '\n');
} else if (cmd === 'restore') {   // restore a snapshot as the live doc: restore <YYYY-MM-DD>
  const date = process.argv[3];
  if (!date) { console.error('usage: restore <YYYY-MM-DD>'); process.exit(1); }
  const r = await fetch(`${ENDPOINT.replace('/state', '/backup/restore')}?id=${encodeURIComponent(ID)}`,
    { method: 'POST', headers, body: JSON.stringify({ date }) });
  if (!r.ok) { console.error('restore failed:', r.status, await r.text()); process.exit(1); }
  console.log('restored; app pulls it on next open:', JSON.stringify(await r.json()));
} else if (cmd === 'get') {
  const r = await fetch(url, { headers });
  if (!r.ok) { console.error('GET failed:', r.status, await r.text()); process.exit(1); }
  const doc = await r.json();
  process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
} else if (cmd === 'put') {
  const fs = await import('node:fs');
  const file = process.argv[3];
  if (!file) { console.error('usage: put <file.json>'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  // pass the WHOLE object through — never rebuild from a known-field list, so a
  // field this script predates can't be silently stripped from the cloud doc
  const payload = { data: { ...data, plans: data.plans || [], sessions: data.sessions || [] }, updatedAt: Date.now() };
  const r = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(payload) });
  if (!r.ok) { console.error('PUT failed:', r.status, await r.text()); process.exit(1); }
  console.log('uploaded; updatedAt =', payload.updatedAt, '(app will pull on next open)');
} else {
  console.error('usage: node tools/claude_sync.mjs get | put <file.json> | backups | backup <date> | restore <date>');
  process.exit(1);
}
