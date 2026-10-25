---
name: my-skill-execute
description: Use when a PLAN.md under .workflow/plans should be implemented (usually via its pasted PROMPT.md). Triggers: "execute the plan", "run the plan", "implement PLAN.md", "build it", "planı uygula", "planı çalıştır", "kodla".
---

# Execute

Run non-stop; never ask the user. Sub-agents implement, review and fix; you run `git`, verify commands and state-file edits yourself. Models follow orchestrate's model routing.

REQUIRED SUB-SKILL: my-skill-orchestrate

## Start

1. Read `.workflow/plans/<name>/{PLAN,PROGRESS}.md` and `.workflow/STATE.md`; skip `[x]`/`[-]` tasks. No PROGRESS.md: write it (orchestrate's `progress-template.md`), tasks STATE.md lists as done marked `[x]`.
2. If `git status --short --untracked-files=no` shows anything outside `.workflow/`, 🛑 stop: "Uncommitted changes — ship or commit them first, then rerun." Never stash.
3. Stay on the current branch. Exception, when the checkout must stay untouched: an integration worktree `.worktrees/_int` on branch `exec/<name>`; task branches start from its tip, merges run there (`git -C .worktrees/_int`), and the report names that branch.
4. Gitignore `.worktrees/` and scratch (`my-skill-init` list), not `.workflow/`; commit a changed `.gitignore` alone.
5. Write STATE.md (state template, no task lists) with the plan's Decisions copied.

## Loop

6. **Dispatch every runnable task at once** (`depends-on` merged, or `may-start-early-when` holds); never wait for a batch. Per task: `git worktree prune`, `git worktree add .worktrees/<id> -b task/<id>` (reuse an unmerged one without `-b`), note the start sha; run the plan's `Setup:` command in a new worktree if it names one. Dispatch `Implement <id>` per `references/implementer-prompt.md` on the task's `model:` (its first word), `run_in_background: true` (Cloudroom: orchestrate's `cloudroom.md`); mark it `[~]`.
7. **Review each return at once**: `Review <id>` per `references/reviewer-prompt.md`, `<base>` = start sha, model as that prompt says. Nothing merges unreviewed. An agent that returns partial or stalls is resumed (or re-dispatched) on the same model with its partial report.
8. **PASS: merge at once**, in dependency order: `git merge --no-ff task/<id> -m "feat(<id>): <goal>"`; non-blocking notes go to `## Gotchas`. Conflict: dispatch `Resolve merge conflict <id>`. Then remove worktree and branch, dispatch newly runnable tasks.
9. **FAIL:** resume the implementer (Cloudroom: `thread tell`) with the findings. A second FAIL, or an implementer blocked inside its own scope: fresh `Implement <id> (review fixes)` on opus with all reports. A third FAIL: blocking stop.
10. **Verify.** Run the plan's global verify yourself (keep only the tail) after merges when fast; when slow, after each parallel group and at phase gates.
11. **Record.** After every merge: ledger `[x]` with sha and deviations, `Progress:` count, `## Files`. Heavy context at a phase gate: invoke `my-skill-handoff`.

## Finish

12. Run global verify. Report branch, shas, deviations, verify tail: measured facts only. 🛑 Offer `my-skill-ship`.

## Blocking stops (only these)

- A verify still failing after the review rounds.
- A decision missing from PLAN.md and the prompt.
- A merge conflict that changes the plan's meaning.

Then mark the task `[!]`, write STATE.md, invoke `my-skill-handoff` skipping its reconcile step, and print its resume prompt.
