---
name: designing-app-features
description: Shape substantial WorkoutApp features before implementation through discovery,
  flow design, rendered review, and an approved implementation contract.
---

# Designing App Features

Use this skill for substantial new features and multi-screen flows in WorkoutApp, before implementation.

## Workflow

1. **Inspect the live app.** Read project notes and inspect screens, routes, styles, storage, sync, and shared helpers the feature may touch. Confirm entry points and design patterns from the running app.
2. **Understand the job.** Identify user, context, success, and where the feature fits. If the user names a product or asks for web research, inspect current sources and translate useful interaction patterns to this app.
3. **Resolve choices that change the flow.** Ask concise questions about entry points, session context, foreground or background use, alerts, interruption, data, and integration. Ask only what evidence does not answer. Keep confirmed decisions separate from proposals.
4. **Map the full path.** Cover entry, setup, active states, pause/resume, skip/cancel, completion, summary, and recovery after reload or navigation. Include empty, error, and boundary states when relevant. Trace effects on existing workout, history, heatmap, storage, sync, backup, restore, and reset behavior.
5. **Make a code-native prototype when visual review will resolve open design choices.** Reuse app stylesheet, components, icons, copy patterns, and real screen dimensions. Show every important state together with short notes. Use realistic content and long labels to expose wrapping and containment problems.
6. **Render and inspect before handoff.** Check every prototype screen at target viewport. Fix observed overflow, wrapping, collisions, inconsistent copy, and mismatched assets. Open the finished local prototype with PowerShell Start-Process and verify the page the user will review. Keep workflow documents such as plans, specs, and notes closed; summarize their decisions in chat. Open another file only when the user names it.
7. **Present the design for review.** Summarize user paths, key states, behavior, open questions, and assumptions. Label unconfirmed values as proposals. Ask the user to correct or approve the design before writing the implementation spec or app code, unless the user already authorized both stages.
8. **After approval, write the implementation contract.** Specify timer truth and interruption behavior, state and data lifecycle, storage and sync effects, integration boundaries, accessibility, and verification cases. Match contracts to the actual app architecture; do not assume a server change.

## Persistence and workout safety

Before changing persisted data, trace each affected record through local writes and reads, cloud merge, backup export and import, reset, history, and derived views. Extend every affected path. Preserve existing records and define identity, conflict, and merge rules for new modes or variants. Ensure malformed or unknown entries cannot crash save or sync. Account for clock skew when deciding which copy wins.

For storage changes, verify compatibility with existing data and an export-import round trip. Cover merge, reset, and malformed-entry behavior. When adding a workout mode or record variant, define whether it shares or keeps a separate best; never overwrite an existing personal record by accident.

If the user has an active workout, keep the deployed app unchanged until the workout is saved and progress is confirmed safe through the real storage or backup path. Check live state read-only. If backup or sync proof is unavailable, establish and verify a safe release path before deployment. Follow the user's deployment authorization.

If storage or sync code changes after review, request a fresh adversarial review of the changed diff before release.

## Review standard

Review the experience as a connected flow, not isolated screens. Keep established app language and visual rules unless evidence supports a change. A visual prototype can settle hierarchy and navigation, but it cannot settle persistence, timing, sync, or failure behavior.

For destructive controls in active flows, place Remove beside its matching Add action, confirm only when removal would erase logged or saved work, and enforce the flow's minimum valid item count in both the UI and state transition.

For one interval-training design example and its provisional choices, read [references/interval-trainer-design-session.md](references/interval-trainer-design-session.md).

