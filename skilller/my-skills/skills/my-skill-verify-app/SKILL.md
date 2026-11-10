---
name: my-skill-verify-app
description: Use when a change must be seen running on a simulator or emulator, or a plan has a non-none `Verify-app:` line. Triggers: "verify in the simulator", "smoke test the app", "simülatörde dene", "uygulamayı çalıştır ve kontrol et", "gerçekten çalışıyor mu".
---

# Verify app

Run the plan's `Verify-app:` flow in the launched app, report evidence. Edit no code. Outcome: VERIFIED / NOT_VERIFIED / MANUAL_VERIFY_REQUIRED (orchestrate's `evidence-gate.md`).

REQUIRED SUB-SKILL: my-skill-orchestrate

## Rules

- One device per run, on the integration branch, not a task worktree. iOS and Android are separate runs, started together only if the machine holds two emulators.
- Steps 3-8: one foreground `sonnet` sub-agent, briefed with these rules and steps, the surfaces, the PROJECT.md values and the paths of both references and the pack.
- Proof is a visible result (snapshot text, screenshot) or a log line, not a command's "success" return. Every PASS/FAIL cites a screenshot path or quoted log line.
- Human-only checks (Sign in with Apple, push, purchase, permission dialogs): `SKIP` plus the manual instruction.
- Shut down only devices this run booted.
- Under execute: report only; no fix tasks, no questions.

## Steps

1. Read `.workflow/PROJECT.md`: stack, app id, run command, pack. Load only the pack it names (`my-skill-orchestrate/references/<Pack>.md`). No PROJECT.md: `my-skill-init`. App id or Run `unknown`: ask for it; under execute, NOT_VERIFIED and stop.
2. Surfaces: the plan's `Verify-app:` line. `smoke` = first screen reached, no crash in the log. Else `<screen/flow> → <visible result>; …`, max 6.
3. First available driver in `references/drivers.md`.
   - Driver missing: print its install line, try the next. Install only on the user's OK, never under execute.
   - No simulator, emulator or driver: `MANUAL_VERIFY_REQUIRED (no simulator)`.
4. Build, install, launch per PROJECT.md; start log capture. Failure before the first screen: NOT_VERIFIED, quote the log tail.
5. Per surface: act, settle, screenshot to `.workflow/verify-app/<date>-<slug>/NN-<name>.png`, check the expected result, mark PASS / FAIL / SKIP.
6. Read the log; quote crashes, red-box, `FATAL EXCEPTION`, Flutter overflow, failed requests.
7. Stop log capture; close the session.
8. Write `.workflow/verify-app/<date>-<slug>.md` from `references/report-template.md` (slug = plan name or `adhoc`; scratch, git-ignored). Return its path, outcome and surface table, ≤ 10 lines.
9. Orchestrator: add under STATE.md `## Done`: `Verify-app: <OUTCOME> — <that path>`.

## Outcome (first match wins)

1. NOT_VERIFIED: a surface FAIL, a crash in the log, no first screen, or a surface lacking citable evidence (no UI tree).
2. MANUAL_VERIFY_REQUIRED: no simulator or driver, or every unmet surface is a human-only SKIP. Name each check.
3. VERIFIED: every surface PASS, no error lines.
