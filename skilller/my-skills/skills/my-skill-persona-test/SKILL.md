---
name: my-skill-persona-test
description: Use when the user wants the running app tried the way real users would, to find UX friction and bugs. Triggers: "persona test", "user test the app", "test it like a beginner", "find UX problems", "dogfood the app", "kullanıcı gibi test et", "UX sorunlarını bul", "persona ile dene".
---

# Persona test (v2)

Drive the running app as personas, one run each; re-confirm serious findings; propose UI changes. Report only.

REQUIRED SUB-SKILL: my-skill-orchestrate

## Rules

- Driver and device: as `my-skill-verify-app` (its `drivers.md`). No driver or no device: stop, `MANUAL_VERIFY_REQUIRED`.
- Runs go only through the running app's UI on a simulator, emulator or device. Never read code, never use another run's report.
- One `sonnet` sub-agent per run, session `persona-<id>`. Default personas: first-time, power, a11y. The user may ask for any number (e.g. 20): build the extra personas in the same block format, run every one, never fewer.
- Parallelism: one device per concurrent run; run as many at once as the machine holds, queue the rest in batches. Never cut the persona count.
- Test data only: no real accounts, purchases or outbound messages. Sign-in needed: PROJECT.md `Test account: env <USER_VAR>/<PASS_VAR>` (names only); absent: stop.

## Steps

1. Read `.workflow/PROJECT.md` and the active plan's `Verify-app:` line; no plan: take the app's main task from the user.
2. Goals: each persona gets 2-3 goals of its own, written in that user's plain words (no screen or control names), each with a visible done-condition. If the user gave shared goals, use them for the personas they name, or for all.
3. Per persona, fill the run brief in `references/personas.md` (persona block, goals, app id, driver, device, output paths). Around each run, apply the persona's device profile and restore the defaults.
4. Each run writes `.workflow/persona/<date>/<id>.md` plus screenshots (`references/finding-schema.md`) and returns its path and one counts line.
5. Confirm: for each P0/P1 finding, dispatch one focused re-run (fresh `sonnet`, same persona, only the finding's goal, output `<id>-c<n>.md`). It reports `reproduced` or `not reproduced`. P2 findings need no re-run.
6. Dispatch one `opus` agent with `references/aggregate-prompt.md`. It drops findings without a screenshot, keeps P0/P1 only if reproduced, merges across personas, ranks, and writes one UI change per finding into `.workflow/persona/<date>.md` (git-ignored).
7. Return that path plus the top 5 findings, ≤ 10 lines. Offer `my-skill-masterplan`; do not start it.

## Output rules

- Every reported finding cites an existing screenshot (orchestrate's evidence-gate.md).
- Zero findings: report the coverage (goals, screens reached), never "bug-free".
- Accessibility findings carry "tree-based, not screen-reader verified".
