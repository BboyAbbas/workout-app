# Interval trainer design session

## What happened

The user asked about adding a HIIT interval timer to WorkoutApp, using Timer Place as a reference. The design session ended with six rendered phone screens built from the app stylesheet: home, workout finisher, setup, hard interval, easy interval, and summary. The page was opened for review. No app code changed, and the user had not approved the design when the digest ended.

Treat every feature detail below as a proposal until the user approves it. The digest does not preserve the underlying Timer Place research links, so do not reuse or cite specific competitor findings from this note.

## Proposed flow and screens

- Home card offers standalone interval sessions; finisher card offers an interval block after a normal workout.
- Setup proposal includes 4×4, Sprints, Tabata, 10×1, and Custom presets, a scaled session timeline, adjustable blocks, machine choice, and a speed target.
- Run screen shows current phase, remaining time, target, next phase, and previous/pause/skip controls.
- Hard effort uses green, recovery uses the app's plank-rest blue, and warm-up/cool-down use slate grey.
- Summary proposes saving the completed session and showing the target machine speed and personal-record state.

These are proposed screen contents, not accepted requirements.

## Constraints and unresolved contracts

The assistant summarized the session as foreground use with the phone screen on and sound, vibration, and visual cues. It also judged that no server change was needed. The digest does not show the user's exact answers, so verify these constraints and inspect the current storage/sync path before treating either point as settled.

Before implementation, specify timer behavior during pause, backgrounding, lock, reload, route changes, cancellation, and skipped intervals. Decide how completion and partial sessions save, how speed targets and records are represented, and how the heatmap counts sessions.

## Provisional values

The assistant proposed a weekly target of two sessions, a three-minute finisher warm-up, and one-step progression only after all rounds are complete. Proposed increments were +0.5 km/h on a treadmill and +1 level on another machine. The assistant explicitly invited changes; none were recorded. Do not turn these values into WorkoutApp defaults without user approval.

## Visual review findings

The rendered review found and fixed:
- wrong gear icon;
- finisher card wording that did not match setup;
- treadmill label overflowing its chip;
- history “after Push” tag wrapping badly.

Other screens were checked and rendered correctly. Recheck fixes at the actual target viewport. This supports the general rule: inspect every state, use the app's real assets and copy, and repair visible defects before asking for design approval.