# Converge mode (plan vs code drift check)

Input: an existing `.workflow/plans/<name>/` folder (`<plan dir>`). The scan replaces Collect and Verify.

## 1. Scan
One `Converge scan` agent per phase (sonnet, fresh context):

```
ROLE: You are checking phase <N> of `<plan dir>/PLAN.md` against the code at <abs path>.
TASK: Read PLAN.md (Goal, Definition of done, Decisions, each task's `change:` and `files:`), PROGRESS.md and the code at HEAD. Judge the present state only; ignore git history. Give each task of the phase and each Decision one status with `path:line` evidence: IMPLEMENTED, PARTIAL, MISSING or DRIFTED (code contradicts the plan). Run a task's `verify:` when it is cheap.
CONSTRAINTS: Read-only except `<plan dir>/converge-<N>.md`.
OUTPUT CONTRACT: Write there one line per item that is not IMPLEMENTED: `<T<n> or Decision #> — status — path:line — what remains`. Reply: the path plus the count per status, or `NO DRIFT` alone.
```

## 2. Act
- Every scan `NO DRIFT`: change nothing, report "no drift".
- Otherwise run Decide (new forks only), then Draft, Check and Prompt with these limits:
  - Draft appends one `## Phase N: Convergence` to PLAN.md, its `Base:` = current HEAD. New tasks get new ids; existing tasks keep their ids and text.
  - Check covers the new tasks only.
  - Prompt writes a fresh PROMPT.md.
- Converge never modifies application code.

Source: github/spec-kit `converge` (MIT), append-only rule and statuses reworded; google/elephant-goldfish-model egm-drift-report (Apache-2.0), idea only.
