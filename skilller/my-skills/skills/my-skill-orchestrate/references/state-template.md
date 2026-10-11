# .workflow/STATE.md template

Overwrite in place. One STATE block only. Keep under 80 lines; details live in linked files.

During plan execution `## Done` and `## Remaining` carry only `- Progress: .workflow/plans/<name>/PROGRESS.md — <merged>/<total> merged`, and `## In progress` at most blocking notes; per-task status lives in the ledger (`progress-template.md`), never as task lists here.

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
