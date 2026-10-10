# .workflow/STATE.md template

Overwrite in place. One STATE block only. Keep under 80 lines; details live in linked files.

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
