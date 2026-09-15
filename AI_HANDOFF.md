# AI Handoff Context

This document stores fork-specific context that should survive across chats and across different AI tools. It is a snapshot, not a substitute for live GitHub verification.

## Read order for a new AI session

1. `AGENTS.md`
2. `AI_HANDOFF.md`
3. `FORK_MAINTENANCE.md`
4. `NEW_BUG_PROMPT.md` for bug work, or `NEW_FEATURE_PROMPT.md` for feature work
5. `.github/copilot-instructions.md` when applicable
6. Files directly relevant to the task
7. Upstream `funnycups/Luker:release` and the latest relevant official Android Actions build metadata

## Current repository model

- Upstream repository: `funnycups/Luker`
- User fork: `ZZZdragondYNGPHX/Luker`
- Fork default / mirror branch: `release`
- Personal integration branch: `custom-release`
- Per-bug branches: `fix/*`
- Per-feature branches: `feat/*`

The `release` branch is intentionally kept clean so it can track upstream without private changes. The `custom-release` branch is where verified personal patches/features and these AI-maintenance documents live.

## Current verified private fix

### Orchestrator character/global preset visibility

Branch:

`fix/orchestrator-character-global-presets`

Known fix commit:

`9ff33cc27e94a55c8d9663cfc770b5d66bb4be20`

Purpose:

- Keep global orchestrator presets visible/accessible while inside a character card.
- Default preset creation inside a character context to character scope.
- Allow a character-scoped preset to be copied/saved as a global preset without deleting the character copy.
- Prevent editor refresh/late character hydration from automatically forcing the displayed scope back to Character after the user explicitly selects Global.

Important historical root cause:

The orchestrator UI had coupled *character override existence* to *which scope the preset editor should display*. Character hydration could therefore cause the UI to render Global first and later switch to Character, making global presets appear to disappear. The fix separates user-visible scope choice from the mere existence of character overrides and exposes both libraries in character context.

Integration state:

- The isolated fix branch exists for upstream PR purposes.
- `custom-release` includes this private fix.
- Do not use this fix branch as the base for unrelated bugs or features.

### Storage Inspector extension leaf navigation

Branch:

`fix/storage-inspector-extension-drilldown`

Known isolated fix head:

`c2dd5e831747f91911dfdebff5f7ec50df9b0a29`

Custom integration commits:

- `23ff6be1d5dea1e815f0fa6c03e9167f21f95427` — reconcile the leaf-navigation fix with the existing `custom-release` Storage Inspector UI changes.
- `d298e7176f2458f3f21d40f607a12965e8b46e1b` — add the custom-branch end-to-end regression.

Purpose:

- Prevent the Storage Inspector from attempting to navigate below categories that the backend marks as `isLeaf: true`, especially `extensions`.
- Hide summary drill UI, row chevrons, and click navigation for leaf responses.
- Preserve the existing `custom-release` retry/error handling and backup/leaf-summary behavior.

Important historical root cause:

The backend correctly treats `extensions` as a leaf category, but its generic directory enumeration can still mark individual extension directories with `canDrill: true`. The frontend previously trusted the row-level flag and requested paths such as `["extensions", "<extension>"]`, which the backend rejects with `E_INVALID_PATH: extensions category is a leaf`. The fix makes response-level `isLeaf` authoritative.

Integration state:

- The isolated fix branch remains available for upstream-compatible review.
- `custom-release` includes the reconciled private integration of this fix.
- The integration regression seeds a real extension directory and verifies that no deeper navigation UI or error path is exposed.
- Do not use this fix branch as the base for unrelated bugs or features.

## Last known official baseline snapshot

At the time this handoff was originally written:

- Upstream `funnycups/Luker:release` HEAD: `bb8ab49ed2c1dbad0fb8a12e362ef3fc0085b964`
- Fork `ZZZdragondYNGPHX/Luker:release` matched that SHA.
- The latest checked successful official Android `Build Android APK` run also used that SHA.
- `package.json` reported version `2.7.0`.

**This snapshot will become stale. Every new task must re-check live upstream and Actions state before choosing a baseline.**

## How to handle a new bug

When the user reports a new bug, follow `NEW_BUG_PROMPT.md`.

In short:

1. Verify live upstream `release` and official Android build SHA.
2. Synchronize the fork mirror if required.
3. Create a fresh `fix/<bug-name>` from fork `release`.
4. Investigate the failure path and root cause.
5. Implement and test the minimal isolated fix.
6. Keep fork-only AI docs out of the upstream PR.
7. After the user verifies the fix works, integrate it into `custom-release` as a separate, traceable change and update this handoff.

If a bug exists only because of a private patch already in `custom-release`, state that explicitly and base the work on the relevant private integration state rather than pretending it is an upstream bug.

## How to handle a new feature

When the user requests new functionality, follow `NEW_FEATURE_PROMPT.md`.

In short:

1. Verify live upstream `release` and official Android build SHA.
2. Synchronize the fork mirror if required.
3. Create a fresh `feat/<feature-name>` from fork `release`.
4. Inspect existing architecture before coding and identify the correct module/state/service/UI/persistence path.
5. Prefer reuse and a minimal coherent implementation over parallel infrastructure.
6. Test the feature and report Web/Android or persistence implications.
7. Keep fork-only AI docs out of an upstream PR.
8. After user verification, integrate the feature into `custom-release` as a traceable change and update this handoff.

If the feature explicitly depends on private behavior already in `custom-release`, document that dependency before implementation and state whether the feature can still be separated for upstream.

## What to tell the user after each task

Always report:

- upstream baseline SHA used;
- latest checked official Android build SHA;
- branch name;
- root cause for bugs, or architecture/design summary for features;
- changed files;
- persistent data/config changes or migration status when relevant;
- Web/Android differences when relevant;
- tests/checks actually run;
- resulting commit SHA;
- whether the change is upstream-compatible;
- upstream PR status;
- whether it has been integrated into `custom-release`;
- whether any existing private patch became obsolete, conflicting, or redundant.

## Maintenance warning

Never treat this document's SHA/version snapshot as permanently current. Its purpose is to preserve architecture, branch policy, and historical private-work context. Live repository state must still be queried at the start of every new task.
