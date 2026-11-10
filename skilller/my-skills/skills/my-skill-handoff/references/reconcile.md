# Reconcile state vs reality

Dispatch one agent with orchestrate's dispatch template: task name `Reconcile state vs reality`, `subagent_type: Explore`, `model: sonnet`.

- TASK: compare what `.workflow/STATE.md` (and the plan ledger) claims with what git shows; report the differences.
- INPUTS: `.workflow/STATE.md`, any active `PLAN.md` / `PROGRESS.md`, and the output of `git status --short`, `git log -15 --oneline`, `git log --merges --oneline`, `git worktree list`, `git stash list`, `git diff --stat`.
- CONSTRAINTS: read-only; git commands and the files above only: no source files, no test runs.
- OUTPUT CONTRACT: reply only, ≤15 lines, under four labels (write "none" for an empty one):
  - (a) tasks marked done whose sha is not in `git log`, or whose files show no matching change
  - (b) work in the tree that STATE.md does not mention
  - (c) uncommitted paths
  - (d) every worktree with its branch
