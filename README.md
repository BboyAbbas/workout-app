# Workout

A minimal, offline-first workout tracker. Installable on Android (and iOS) as a
home-screen app — no app store, no account, no login. `localStorage` is the
source of truth and everything works with no network; a small Cloudflare Worker
holds one shared JSON copy so the same data follows you across devices.

## Features

- **Plans** — create, edit, delete workout plans; each holds exercises with
  target sets / a rep range / weight and a per-exercise rest length.
- **Starter plans** — Push, Legs, Pull, Upper and Lower load themselves on a
  fresh device.
- **Live workout** — running total timer, log reps + weight per set; add or remove sets for this workout only (removing a logged set asks first, never below one set).
- **Progressive overload** — each exercise shows last session's actual numbers
  with a green "→ N" target: beat the reps, then the weight goes up a real,
  loadable step.
- **Rest timer** — logging a set starts a rest countdown; the phone buzzes when
  rest ends, backgrounded or locked. Skip or nudge ±15s.
- **Up next** — the plan due next in the rotation is highlighted. Cardio-only
  plans and the plank trainer sit outside the rotation.
- **Plank Trainer** — its own section under the cardio plan (see below).
- **Interval Trainer** — timed intervals (Norwegian 4×4, sprints, Tabata, 10×1, custom) under "Trainers", or as a finisher from a live workout (see below).
- **Weight** — weigh-in log, chart with a target line, and progress against a
  goal with a countdown. The chart follows aktiBMI: up to 90 days it plots one
  point per day (that day's last weigh-in); Year and All plot one point per
  calendar month (that month's last weigh-in), over shaded day/month/quarter/year
  bands with a dotted "Target" line.
- **Waist** — a second tab on the weight screen: waist log in cm, chart with the
  goal line, and a "goal under X cm" that counts as reached only below X. Shows
  waist ÷ height against the NICE bands (under 0.50 healthy, 0.50–0.59 increased
  risk, 0.60+ high risk); height is stored once in the weights doc (`heightCm`).
  Waist entries live in the same doc (`weights.waist`) and merge offline logs on
  sync like weigh-ins.
- **History & insights** — every workout with per-set detail, records, stalls,
  muscle split, and a consistency heatmap.
- Works fully offline (service worker app shell).

## Plank Trainer

A stopwatch for holds, with the record on screen the whole time.

- Pick the number of sets (1–5) and the rest between them (30s–2:00); the choice
  is remembered for next time.
- **Hold** — a big live clock inside a ring that fills toward your all-time best.
  The record and the gap to it (`Best 1:32 · 1:30 to go`) stay visible for every
  second of the hold; passing it turns the ring gold and calls it out.
- **Rest** — a countdown ring with ±15s and a skip, then the next set.
- **Summary** — every hold, the total, and a personal-best banner.
- Each finished hold is saved the moment you stop the clock, so an interrupted
  session keeps everything you actually held. A hold under a second is treated
  as a mis-tap and is never recorded. A run left open for over 30 minutes is
  dropped rather than credited.
- Plank data lives in its own store (`wt_planks_v1`) and its own cloud-sync
  field — never a plan and never a workout session, so it can't reach the up-next
  rotation or the strength records.

**Side mode** pairs a left hold with a 5-second switch countdown, then a right
hold before the normal rest. Start the right side early with one tap. Each side
has its own record; the summary shows both holds, totals and balance. Side history
and progress stay separate from Front, with the chart tracking the weaker side.
The mode choice syncs with your plank settings; countdowns and holds survive reloads.

## Interval Trainer

A Timer Plus-style interval timer for the treadmill or the bike.

- Presets: Norwegian 4×4 (10:00 warm-up · 4:00 hard / 3:00 easy × 4 · 5:00 cool-down, per NTNU CERG), Sprints, Tabata, 10×1, and one Custom slot. Each preset remembers your edits.
- The run screen paints the phase colour (hard = green, easy = blue, warm-up/cool-down = slate), shows the whole session as a strip, and the speed to hold.
- Cues: a heads-up tone and buzz 7 s before every switch, 3-2-1 ticks, then a tone, a buzz and a spoken line. Mute keeps the buzz.
- Pause, restart / previous block, skip. The clock is worked out from timestamps, so a reload or a short lock never loses your place; a run left paused or unseen for 30 min ends and keeps what you did.
- The session is saved the moment it ends. On the summary you add the speed (km/h) or level you held; next time the setup shows a target one step up if you finished every round.
- From a live workout, "Add an interval finisher" starts with a 3:00 warm-up, keeps the workout clock running, and returns to the workout.
- Data lives in its own store (`wt_intervals_v1`) and cloud-sync field `intervals`. Each finished hard round counts as one set on the Consistency heatmap; sessions never enter plans, workout history, up-next or strength records.

## Data & sync

`localStorage` is authoritative and the app is fully usable offline. When
online it pulls on load/focus and pushes changes (debounced) to a Cloudflare
Worker + KV, last-write-wins by `updatedAt`. Work done offline is merged back in
rather than overwritten, and fields written by a newer version of the app are
preserved verbatim instead of being stripped.

## Run locally

```bash
python -m http.server 8099 --bind 127.0.0.1
# open http://127.0.0.1:8099
```

## Install on your phone

1. Open the deployed URL in Chrome on Android.
2. Menu (⋮) → **Add to Home screen** / **Install app**.
3. Launch from the new icon — runs fullscreen, works offline.

## Project layout

```
index.html              app shell + service-worker registration
css/styles.css          all styles (dark, single accent, big tap targets)
js/db.js                data layer (localStorage; swap to IndexedDB later)
js/ui.js                formatting, icons, toast (pure helpers)
js/sync.js              cloud pull/push + offline merge
js/push.js              web push (rest-done + idle alerts)
js/app.js               router + screens + interaction
manifest.webmanifest    PWA manifest
sw.js                   offline service worker (bump CACHE on release)
icons/                  app icons (generated by tools/make_icons.py)
sync-worker/            the Cloudflare Worker behind cloud sync
tools/                  icon generator + tests + screenshot helpers (dev only)
```

## Update / redeploy

Edit files, bump `CACHE` in `sw.js` (so phones pull fresh code), commit and push —
GitHub Pages redeploys automatically.

## Tests

Unit tests (no browser, no server):

```bash
npm test        # rec_test + ui_test + analytics_test + plank_test + interval_test + body_test
```

End-to-end, drives a real Chromium through the app:

```bash
python -m http.server 8099 --bind 127.0.0.1 &   # serve first
node tools/smoke_test.cjs
node tools/plank_shots.cjs                      # screenshots of the plank states
node tools/interval_shots.cjs                   # screenshots of the interval states
node tools/session_edit_shot.cjs <outDir>       # screenshots of history view/edit/saved
```
