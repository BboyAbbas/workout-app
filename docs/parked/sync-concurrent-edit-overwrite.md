# Sync: two devices editing before either syncs can overwrite records

**Status:** PARKED — not started.
**Parked:** 2026-09-26
**Wake:** on your say-so

## Goal
Abbas wants his workout data safe across devices ("i want my data and progress to remain safe", 2026-09-26). An adversarial review of the Interval Trainer sync changes (Codex `gpt-6-astra`, 2026-09-26) found a data-loss race that predates that work and affects every synced field.

## Decided
- **Not fixed inside the Interval Trainer release** — the fix changes how every field merges on pull and push; it needs its own design and tests, not a patch under deploy pressure.
- **The related clock-skew hole was fixed** (commit "fix(sync): merged pull pushes newer than the cloud…", 2026-09-26): a pull that merges local work back in now stamps it cloud+1.

## The race (js/sync.js `pull()` / `push()`, as of 2026-09-26)
1. Phone and laptop are in sync at t=100.
2. Phone records A, pushes at t=200.
3. Laptop, without having pulled t=200, records B at t=300 (its `wt_updated_at` = 300).
4. Laptop pulls: remote 200 is not newer than local 300 → `stale` → no merge.
5. Laptop pushes its snapshot at t=300 — it has B but not A. Cloud now lacks A.
6. Phone has no unpushed work, pulls 300, applies it as-is → A is gone everywhere.

Same for workout sessions, weigh-ins, plank sets and interval sessions. The window is small (pull runs on load, focus and visibility), so it needs two devices both changing data between syncs.

## Rejected
- **Trigger the merge on `remote.updatedAt > pushed` instead of `> localUpdated`** — merges records, but then applies remote over plans/goal/prefs, which would drop a NEWER local plan edit. Swaps one loss for another.
- **Field-level last-write-wins without per-record stamps** — the doc has one `updatedAt`; per-field recency is not knowable today.

## Open — not decided
1. Per-record `updatedAt` (sessions, entries, plans) plus a union-by-id merge on BOTH pull and push, with tombstones for deletes?
2. Or a server-side merge in the Worker (it already sees every PUT) with the same rules?
3. How do deletes survive a union merge (tombstone list, and for how long)?

## Catches
- Deletes: a pure union merge resurrects anything deleted on one device while another device still holds it.
- Older app versions keep pushing whole snapshots until they update.
- `wt_updated_at` comes from each device's own clock; skew matters.

## Size
Medium: sync.js + db.js merge helpers + Worker possibly, plus a two-device test harness (the smoke test only stubs one device).

## When it goes live
Root `C:\Users\Abbas\Downloads\Coding3\WorkoutApp`, design in Claude (Opus), build in Codex `--lane code` high.
