---
name: my-skill-execute
description: Use when a PLAN.md under .workflow/plans should be implemented (usually via its pasted PROMPT.md). Triggers: "execute the plan", "run the plan", "implement PLAN.md", "build it", "planı uygula", "planı çalıştır", "kodla".
---

# Execute

Run non-stop. Never ask the user. Never do the work yourself: you run `git`, write state files, dispatch.

REQUIRED SUB-SKILL: my-skill-orchestrate

## Start

1. Read `.workflow/plans/<name>/{PLAN,PROGRESS}.md` and `.workflow/STATE.md`, nothing else; skip `[x]`/`[-]` tasks. No PROGRESS.md: write it (orchestrate's `progress-template.md`), STATE Done ids `[x]`.
2. If `git status --short --untracked-files=no` prints anything outside `.workflow/`, 🛑 stop: "Uncommitted changes — ship or commit them first, then rerun." Never stash.
3. Stay on the current branch.
4. Gitignore `.worktrees/` and scratch (`my-skill-init` list), not `.workflow/` itself. If that changed `.gitignore`, commit it alone.
5. Write STATE.md (state template; plan run: no task lists), the plan's Decisions copied.

## Loop

6. **Dispatch every runnable task at once** (all `depends-on` merged, or `may-start-early-when` holds). Run `git worktree prune`, then per task `git worktree add .worktrees/<id> -b task/<id>` (reuse an unmerged one without `-b`); note its start sha. Run the plan's `setup:` line once if worktrees need it. Dispatch `Implement <id>` per `references/implementer-prompt.md`, the task's model, `run_in_background: true` (Cloudroom: orchestrate's `cloudroom.md`); mark it `[~]`. Ordered steps stay one task. Never wait for a batch.
7. **Review each return at once.** Dispatch `Review <id>` per `references/reviewer-prompt.md`, `<base>` = its start sha. Sonnet for haiku/sonnet tasks touching ≤2 files, else opus. Nothing merges unreviewed. Any agent over ~25 minutes is re-dispatched on opus with its partial report.
8. **PASS: merge at once**, in dependency order: `git merge --no-ff task/<id> -m "feat(<id>): <goal>"`. No fix round; non-blocking notes go to `## Gotchas`. Conflict: dispatch `Resolve merge conflict <id>` on opus. Then `git worktree remove .worktrees/<id>` and `git branch -d task/<id>`. Dispatch newly runnable tasks.
9. **FAIL:** resume the implementer (Cloudroom: `thread tell`) with the findings. Second FAIL: fresh `Implement <id> (review fixes)` on opus with both reviews. Third FAIL: blocking stop.
10. **Global verify.** A haiku agent runs `Run global verify`, never you: after every merge if it takes under ~2 minutes, else after each parallel group and at phase gates.
11. **Record.** After every merge: ledger `[x]` with sha and deviations, `Progress:` count, `## Files`. Heavy context at a phase gate: invoke `my-skill-handoff`.

## Finish

12. Run global verify. Report branch, shas, deviations, verify tail: measured facts only. 🛑 Offer `my-skill-ship`.

## Blocking stops (only these)

- A verify still failing after the review rounds.
- A decision missing from PLAN.md and the prompt.
- A merge conflict that changes the plan's meaning.

Then mark the task `[!]`, write STATE.md, invoke `my-skill-handoff` skipping its reconcile step, and print its resume prompt.
