---
name: my-skill-execute
description: Use when a .workflow/plans PLAN.md should be implemented. Triggers: "execute the plan", "implement PLAN.md", "build it", "planı uygula", "planı çalıştır", "kodla".
---

# Execute

Run non-stop; never ask. Sub-agents implement, review, fix, test; you run `git`, edit state.

REQUIRED SUB-SKILL: my-skill-orchestrate

## Start

1. Read `{PLAN,PROGRESS}.md`, STATE.md; skip `[x]`/`[-]`. No PROGRESS.md: write it (orchestrate's `progress-template.md`).
2. `git status --short --untracked-files=no` shows changes outside `.workflow/`: 🛑 "Uncommitted changes — ship or commit first." No stash.
3. Stay on the current branch, or use worktree `.worktrees/_int` on `exec/<name>` (task branches start and merge there).
4. Gitignore `.worktrees/` and scratch (init's list); commit a changed `.gitignore` alone.
5. Write STATE.md (no task lists) with the plan's Decisions.

## Loop

6. **Dispatch every runnable task at once** (dependencies merged or `may-start-early-when` holds):
   - `git worktree prune`; `git worktree add .worktrees/<id> -b task/<id>` (unmerged one: reuse, no `-b`); note start sha; run `Setup:`.
   - `Implement <id>` per `references/implementer-prompt.md`, task's `model:`, background. Paste the last 5 `## Notes` lines on its `files:` or dependencies. Mark `[~]`.
7. **Review as reports arrive.** No `STATUS:`/`RED:`/`GREEN:` lines: resume once; still none: a failed attempt. `BLOCKED — decision needed`: `[!]` with the question, no retry. Other `BLOCKED`: a failed attempt. Else `Review <id>` per `references/reviewer-prompt.md`.
8. **PASS: merge at once** (dependency order): `git merge --no-ff task/<id> -m "feat(<id>): <goal>"`. Conflict: `Resolve merge conflict <id>`. Ledger `[x]` with sha and deviations; append its `Notes:` to `## Notes`; update `Progress:`. Remove worktree, branch.
9. **Failed attempt** (cap 3 per task): first, resume the implementer with the findings; second, fresh `Implement <id> (review fixes)` on opus with all reports, only if they add something new, else `[!]`; third, `[!]`, unmerged. Continue independent tasks.
10. **Phase gate** (`gate: full suite`, phase merged): `Run global verify` (haiku). Red: bisect merges since the last green sha; one `Fix integration <ids>` round on opus with the tail and their reports. Red at the start sha: pre-existing, report it.

## Finish

11. No runnable task left: `Run global verify` once (full suite; red: step 10's fix round). Write `Full suite: <PASS|FAIL> @ <git rev-parse HEAD>` under STATE.md `## Done`.
12. Plan `Verify-app:` not `none`: `my-skill-verify-app` once, on the integration branch. Not VERIFIED: report it, suggest `my-skill-debug`, continue.
13. Report branch, shas, deviations, full-suite tail, outcome, `[!]` tasks with each pending "decision needed" question. 🛑 Offer `my-skill-ship`.

## Blocking stops (only these)

- Step 2.
- Full suite red after the fix round.
- `[!]` tasks remain after step 11.

Then write STATE.md, give step 13's report, run `my-skill-handoff` (skip reconcile), print its resume prompt.
