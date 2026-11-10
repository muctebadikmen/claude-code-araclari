# .workflow/STATE.md template

Overwrite the file in place: one STATE block, under 80 lines, details in the linked files. Keep all six `##` headings even when empty.

```
# STATE
Updated: <ISO datetime>
Active skill: <my-skill-<name> | none>
Phase: <name> (<n>/<total>)
Goal: <one line>

## Done
- [x] <task or phase> — <one line> (<commit sha | worktree | file path>)
Full suite: <PASS|FAIL> @ <sha>
Verify-app: <OUTCOME> — <path>

## In progress
- [ ] <task> — <agent task name> (<model>) — started <time>

## Remaining
- [ ] <task> — <one line>

## Decisions
| # | Question | Answer | Date |
|---|---|---|---|

## Gotchas
- <something a fresh session would trip on>

## Files
- Audit: .workflow/audit/<file>
- Debug: .workflow/debug/<slug>.md
- Research: .workflow/research/<file>
- Plan: .workflow/plans/<name>/{PLAN,PROMPT,PROGRESS}.md
```

## Owned lines in `## Done`
- `Full suite:` my-skill-execute writes it at Finish: the full-suite outcome and `git rev-parse HEAD` it ran on. my-skill-ship reuses it while HEAD is unchanged.
- `Verify-app:` my-skill-verify-app's outcome and evidence path.
- Omit a line until its owner writes it.

## While a plan runs
Per-task status lives only in the ledger (`progress-template.md`): `## Done` and `## Remaining` hold only the `Progress:` line plus the owned lines; `## In progress` holds blocking notes only.

## Git
- Committed under `.workflow/`: `STATE.md`, `HANDOFF.md`, `PROJECT.md`, `LEARNINGS.md`, open `debug/*.md`, `plans/*/{PLAN,PROMPT,PROGRESS}.md`.
- Scratch, git-ignored: `research/`, `dispatch/`, `audit/`, `runs/`, `vet/`, `persona/`, `verify-app/`, plan `check-*.md`, and root `.worktrees/`.
