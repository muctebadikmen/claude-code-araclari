# .workflow/STATE.md template

Overwrite in place; one STATE block, under 80 lines, details in linked files. While a plan runs, `## Done` and `## Remaining` hold only the `Progress:` line and `## In progress` at most blocking notes; per-task status lives in the ledger (`progress-template.md`).

```
# STATE
Updated: <ISO datetime>
Active skill: <my-skill-audit | my-skill-research | my-skill-masterplan | my-skill-execute | my-skill-handoff | my-skill-ship | none>
Phase: <name> (<n>/<total>)
Goal: <one line>

## Done
- [x] <task or phase> — <one line> (<commit sha | worktree | file path>)

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
- Research: .workflow/research/<file>
- Plan: .workflow/plans/<name>/PLAN.md
- Prompt: .workflow/plans/<name>/PROMPT.md
- Progress: .workflow/plans/<name>/PROGRESS.md
```
