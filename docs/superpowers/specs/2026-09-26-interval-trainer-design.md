# Interval Trainer — design

Date: 2026-09-26 · Status: waiting for Abbas's review · Mockups: [`2026-09-26-interval-trainer-mockups.html`](2026-09-26-interval-trainer-mockups.html) (open it from this folder; it loads the app's real `css/styles.css`).

## 1. Goal

Abbas wants interval sessions (Norwegian 4×4, sprints) inside the Workout app, with a timer like Timer Plus (Uniqo Lab / VGFIT). The goal is better bursts and a high pace for longer.

- He uses a **treadmill or a bike**, with the phone on the stand and the screen on.
- Some days the intervals are a **finisher at the end of a normal workout**. Other days they are a **standalone session**.
- The feature must match the current look: dark screens, one green accent, rings, chips, big green buttons.

Success: he starts a 4×4 in two taps, reads the phase from a metre away, gets a warning 7 s before every switch, and the app tracks his speed so each session has a target to beat.

## 2. Scope

In scope: one new trainer (Interval Trainer) with setup, run and summary screens, a home card, a finisher entry on the live workout screen, its own store and cloud sync field, heatmap credit, sound, voice and vibration cues.

Not in scope:
- Lock-screen alerts for each phase (the screen stays on, so the sync worker needs no change).
- Machines other than Treadmill and Bike.
- Timer Plus "cycles", a stopwatch tab, or unlimited named timers (one Custom slot covers it).
- Heart-rate input, landscape layout.
- The existing "HIIT Bike" exercise in the Cardio plan stays as it is.

## 3. Screens

All screens reuse existing components. New CSS uses the `iv-` prefix.

### 3.1 Home
- The section label "Plank" becomes **"Trainers"**. It holds two cards: **Interval Trainer**, then **Plank Trainer**.
- The block sits where the plank card sits today: after the last cardio-only plan (`app.js` `screenHome`, the `cards.splice(...)` line), and in the no-plans branch.
- The Interval Trainer card has the Plank Trainer card's shape (`.plank-home`): green icon tile (new `pulse` icon), name, one grey line, one big number on the right.
  - Grey line: last session, e.g. `4×4 · 12.5 km/h · 2 days ago`. With no sessions: `Timed intervals for bursts and pace`.
  - Right: `1/2` over `THIS WEEK` — sessions this week against the target of 2.
  - While an interval run is active: accent border and the line `Running · Hard · tap to return` (home does not tick, so it shows no clock).

### 3.2 Live workout (finisher entry)
- A dashed card after the last exercise, before "Session notes": `Add an interval finisher`, line `4×4 · warm-up 3:00 · → 12.5 km/h` (preset last used, speed target if one exists), green play button.
- Tap opens `#/intervals/finisher`. The workout stays active and its clock keeps running.

### 3.3 Setup (`#/intervals`, `#/intervals/finisher`)
Top to bottom:
1. Topbar `Intervals`, sub `N sessions logged`.
2. Preset chips (5 columns): `4×4` `Sprints` `Tabata` `10×1` `Custom`.
3. Finisher mode only: line `Finisher after Push · the workout clock keeps running`.
4. Preset hero card: name, total minutes, one-line purpose, hard minutes, and the **session strip** (every block to scale, in phase colours).
5. `TIMING` card: rows Warm-up, Hard, Easy, Rounds, Cool-down, each with a colour dot, a hint line, and `−` / `+` steppers (`.rest-step`).
6. `MACHINE` chips (2 columns): `Treadmill` `Bike`. The chips carry no unit text.
7. Progress card: last session of this preset on this machine (`12.0 km/h · all 4 rounds`) and the target `→ 12.5` / `TODAY`. With no speed logged: `No speed logged yet for 4×4 on Treadmill`.
8. `Start 4×4` primary button (`.plank-cta`).
9. Stats grid: Sessions · This week `n/2` · Hard time · Best speed (this preset, this machine).
10. History: newest 20, row = date (+ `after Push` tag), `4×4 · Treadmill · 4/4 rounds`, speed on the right, delete button with a confirm.

A `Reset to default` text link shows under the Timing card when the preset differs from its defaults.

### 3.4 Run
- Topbar title = block name (`Warm-up`, `Hard`, `Easy`, `Cool-down`); sub `Round 2 of 4 · 22:12 left`; right: sound toggle (sound / muted icon).
- Live strip: finished blocks faded, current block outlined and filling, future blocks dimmed.
- Ring (`plankRing` reused, larger): stroke, phase word and a soft background glow take the **phase colour**. Centre: phase word (`GO HARD`, `EASY`, `WARM UP`, `COOL DOWN`), countdown `mm:ss` at 76 px, `round 2 of 4`.
- Hard blocks only: pill `Hold 12.5 km/h` (or `Hold L14`) when a target exists.
- Next card: `NEXT · Easy 3:00 · then round 3`, left border in the next block's colour.
- Last 7 s of a block: the Next card lights up in the next block's colour (`GET READY · Hard in 7 · set the speed 12.5 km/h`) and the digits pulse.
- Controls: `⏮` (restart block, or previous block if under 3 s in), `Pause` / `Resume` (primary), `⏭` (skip block).
- `End session` text button, with `confirm('End the session? Rounds you finished are saved.')`.
- Paused: ring and strip dim; no cues.
- Back arrow leaves the screen; the run keeps going and the home card shows it.

Phase colours: warm-up and cool-down `#8b93a7` (slate), hard `var(--accent)` (same as a plank hold), easy `#6aa9ff` (the plank rest blue).

### 3.5 Summary
- Topbar `Intervals done`, sub `Norwegian 4×4 · Treadmill`.
- Banner: all rounds done → green `All 4 rounds done · 16:00 hard`; fewer → neutral `3 of 4 rounds`. A typed speed above the best → a second, gold banner at once, like a plank record.
- Totals card: Hard · Total · Rounds `4/4`.
- Speed card: `Speed on the hard rounds` (bike: `Level on the hard rounds`), `−` input `+`, starts filled with today's target; empty when there is no target. Hint `Last time 12.0 · target → 12.5`.
- Primary: standalone `Save`; finisher `Save · back to Push`. Ghost: `Skip — don't log a speed`.
- The session is already saved when this screen shows (see 5.3). The buttons only add the speed and leave.
- A finished run stays on this screen until Save or Skip, so a reload keeps the speed box. A summary older than 6 hours is dropped on open; its session is already saved.

## 4. Presets and settings

| Preset | Warm-up | Hard | Easy | Rounds | Cool-down | Hard hint | Purpose line |
|---|---|---|---|---|---|---|---|
| `4x4` Norwegian 4×4 | 10:00 | 4:00 | 3:00 | 4 | 5:00 | only a few words out | Raises VO₂ max · 1–2× a week |
| `sprints` Sprints | 10:00 | 0:30 | 1:30 | 8 | 5:00 | all-out | Quick bursts · recover between them |
| `tabata` Tabata | 5:00 | 0:20 | 0:10 | 8 | 5:00 | all-out | 20 s on / 10 s off |
| `10x1` 10×1 | 10:00 | 1:00 | 1:00 | 10 | 5:00 | hard but steady | 1 min hard / 1 min easy |
| `custom` Custom | copy of 4×4 | | | | | hard | Your own mix |

Sources: 4×4 and 10×1 from NTNU CERG (<https://www.ntnu.edu/cerg/advice>: 10 min warm-up and 3 min active breaks at 60–70 % HRmax, 4 × 4 min at 85–95 %, **5 min cool-down at 60–70 %**, 2–3 sessions a week to improve). Sprints from the advice Abbas received (20–30 s all-out, 1–2 min easy, 6–8 times). Tabata: Tabata et al. 1996.

Easy hint follows the machine: treadmill `easy jog or walk`, bike `easy spin`. Warm-up and cool-down hint: `easy pace`.

Ranges and steps:
- Warm-up, cool-down: 0–20 min, step 1 min. 0 removes the block.
- Hard, easy: 5 s–10 min; step 5 s below 1:00, 15 s from 1:00 up.
- Rounds: 1–20.

Each preset remembers its own edited numbers. The chosen preset and machine are remembered.

**Finisher mode:** the warm-up starts at 3:00 for that run (or the preset's own warm-up when that is shorter). Warm-up edits in finisher mode apply to that run only and do not change the preset.

## 5. Behaviour

### 5.1 Blocks
`buildBlocks(cfg)` → warm-up (if > 0), then for each round a hard block and an easy block (no easy block after the last round), then cool-down (if > 0). Each block: `{ kind: 'warm'|'hard'|'easy'|'cool', sec, round }`. 4×4 = 10 + 4×4 + 3×3 + 5 = 40 min, 16 min hard.

### 5.2 Clock (pure state machine)
Same principle as `plankStep`: the clock is worked out from timestamps, never from counted ticks. State (device-local `wt_interval_active_v1`, never synced):

`{ id, preset, machine, cfg, from: {planId, planName}|null, target, startedAt, idx, blockStartAt, pausedAt, spent: [sec per block], seenAt }`

`intervalStep(run, action, now)` returns a new run and a `lastEvent`:
- `tick` — while not paused and the current block's time has run out: `spent[idx] = sec`, `blockStartAt += sec*1000`, `idx++`. Emits `switch`, or `done` after the last block. Catches up any number of blocks at once.
- `pause` / `resume` — resume shifts `blockStartAt` by the paused time.
- `skip` — `spent[idx]` = time run in the block, next block starts now. A skip while paused keeps the run paused.
- `back` — more than 3 s into the block: restart it. Otherwise: go to the previous block and reset its `spent`.
- `end` — `spent[idx]` = time run in the block; run is done.

Reopen (`intervalResume`): paused for more than 30 min → end at `pausedAt`. Not paused and `seenAt` more than 30 min ago → catch up to `seenAt`, then end there. Otherwise `tick(now)`. The run screen writes `seenAt` every 5 s. A short lock or a reload continues the timer exactly.

### 5.3 What counts, what is saved
- A round counts as done when its hard block ran at least 90 % of its length (a skip near the end still counts).
- `hardSec` = time run in hard blocks; `totalSec` = time run in all blocks.
- When the run reaches `done` (last block ends, or End session): if `hardSec ≥ 1` the session is recorded **at once**. Otherwise nothing is recorded and a toast says `Nothing logged — no hard block run`.
- The speed is added afterwards with `setIntervalPace(id, pace)`. Skip leaves it `null`.

### 5.4 Speed target
Per preset **and** machine. Look at the latest session of that pair with a speed:
- It finished every round → target = its speed + one step (treadmill +0.5 km/h, bike +1 level).
- Otherwise → target = its speed.
- No such session → no target.

Speed input: treadmill 1.0–25.0, step 0.5, shown `12.5 km/h`; bike 1–40, step 1, shown `L14`. A typed speed above the previous best for that pair shows a gold `New best 4×4 speed` banner at once, and Save confirms it with a trophy toast and a buzz. The first speed ever for that pair is confirmed with the toast `First speed logged — 12.5 km/h is the one to beat`.

### 5.5 Cues
Per block, from the remaining seconds:
- **7 s left** (blocks longer than 10 s): heads-up tone, `vibrate(150)`, Next card and digits go into the "get ready" state.
- **3, 2, 1** (blocks of 5 s or more): short tick tone each second.
- **Switch:** long tone, `vibrate([400, 120, 400])`, voice line for the new block.
- **Done:** the existing `playBeep` chirps, vibration, voice `Session done.`

The 7 s heads-up also plays before the session ends. Voice lines: warm-up `Warm up. Easy pace.` · hard `Round 2 of 4. Go hard. 12.5.` (bike: `Level 14.`; no target: no number) · easy `Easy. Recover.` · cool-down `Cool down. Easy pace.`

- Tones use the existing Web Audio context (`unlockAudio` on the Start tap). Voice uses `speechSynthesis` (`en-US`). No voice available → skip it silently. The beeps and vibration still mark every switch.
- Mute (topbar toggle, remembered) silences tones and voice. Vibration stays.
- No cues while paused. A cue fires once per block. After a catch-up (reload, background), only the latest switch plays, once.
- Screen wake lock is held for the whole run, pause included, and released at done or on leaving the screen.

### 5.6 Finisher link
`#/intervals/finisher` with no active workout behaves exactly like `#/intervals`. At Start in finisher mode, `from = { planId, planName }` comes from `DB.getActive()`. The session stores `after: planName`. The workout's own data is never changed, except its activity stamp: while a linked run is on screen, it calls the existing `bumpActivity()` on every 5 s heartbeat, so the workout's 50-min idle auto-finish (`AUTO_FINISH_MS`) never ends the workout during the finisher. `Save · back to Push` goes to `#/plan/<planId>/run` when that workout is still active, otherwise to `#/`.

### 5.7 Heatmap and week count
- `consistencyBlock` takes interval sessions as a second input and adds `roundsDone` to that day's set count. Home and Insights both pass them. The block shows when either list has sessions.
- Week count = sessions with `roundsDone ≥ 1` since Monday 00:00 local (the heatmap's week). Target constant `INTERVAL_WEEK_TARGET = 2`.
- Interval sessions never enter plans, the up-next rotation, main History, or strength records.

## 6. Data and sync

Store `wt_intervals_v1`:
```
{
  sessions: [{ id, t, endedAt, preset, machine, cfg: {warmSec, hardSec, easySec, rounds, coolSec},
               roundsDone, hardSec, totalSec, pace: number|null, after: string|null }],
  prefs: { preset: '4x4', machine: 'treadmill', muted: false, cfgs: { [presetId]: cfg } }
}
```
- Cloud field `intervals`, wired exactly like `planks`: `KNOWN_SYNC_FIELDS`, `snapshot()`, `applyRemote()` (`'intervals' in data`; `null` removes it).
- `js/sync.js`: when local data is unpushed, `DB.mergeIntervalDoc(remote, local)` unions sessions by `id`. For the same `id`, the remote copy wins, but a local `pace` fills a remote `null`. Remote `prefs` win. A clean local copy lets a remote delete stick, as with planks.
- The sync worker stores `data` whole, so it needs no change.

## 7. Code layout

| File | Change |
|---|---|
| `js/intervals.js` (new) | Presets, `buildBlocks`, `intervalStep`, `intervalResume`, round and time counting, target rule, week count. Pure functions only, no DOM, no storage. |
| `js/db.js` | Store, prefs, `recordIntervalSession`, `setIntervalPace`, `deleteIntervalSession`, `getIntervalSessions`, active-run get/set, `mergeIntervalDoc`, sync wiring. |
| `js/sync.js` | Merge call for `intervals`. |
| `js/app.js` | `trainersBlock()` (replaces the label inside `plankHomeCard`), finisher card in `screenRun`, `screenIntervals`, routes `#/intervals` and `#/intervals/finisher`, heatmap input, tone and voice helpers. |
| `js/ui.js` | Icons: `pulse`, `sound`, `muted`, `pause`, `next`, `prev`. |
| `css/styles.css` | `.iv-*` classes from the mockup. |
| `sw.js` | Add `js/intervals.js` to `SHELL`; bump `CACHE` `workout-v54` → `workout-v55`. |
| `README.md` | Interval Trainer section; test list. |
| `package.json` | Add `tools/interval_test.mjs` to `npm test`. |

## 8. Tests and proof

- `tools/interval_test.mjs` (in `npm test`): block builder for every preset; `tick` catch-up across many blocks; pause and resume; skip and back at block edges; the 30 min reopen rules; summary kept until Save or Skip and dropped after 6 h; 90 % round rule; save rule; target rule for both machines; week count; `mergeIntervalDoc`; cue schedule (7 s only on blocks > 10 s, ticks only on blocks ≥ 5 s).
- `tools/smoke_test.cjs`: new journey in real Chromium — home card, setup edits remembered, start, skip through blocks, pause, reload mid-run, end, summary speed save, history row, heatmap credit, finisher from a live workout and back to it, sync field pushed.
- `tools/interval_shots.cjs`: phone-size (390×844) screenshots of home, finisher card, setup, run hard, run 7 s heads-up, pause, summary.
- Done only after the screenshots match the mockups on the served app. Sound, voice and vibration can only be confirmed on Abbas's phone; the final report says so.

## 9. Known limits

- If the phone locks during a run despite the wake lock, cues stop until the screen is back. The clock stays exact.
- Voice depends on the phone having a speech voice installed.
- A skip or restart changes the session length. The strip and "left" time follow the real remaining blocks.
