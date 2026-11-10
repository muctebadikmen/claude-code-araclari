# .workflow/plans/<name>/PROGRESS.md template

The plan ledger: the only per-task status source while a `my-skill-masterplan` plan runs. Masterplan writes it with the plan (every task `[ ]`, plan order); execute and handoff edit it. Committed with STATE.md and PLAN.md.

```
# <name> progress
Ledger for .workflow/plans/<name>/PLAN.md. One line per task, plan order; edit the marker in place.
- [ ] T1 — <goal>
- [~] T2 — <goal> — <agent task name> (<model>)
- [x] T3 — <short sha> — <deviations | none>
- [!] T4 — BLOCKED: <decision needed: <question> | reason after the third failed attempt>
- [-] T5 — dropped: <reason>

## Notes
- T3: <≤3 lines a later task needs: an interface, a gotcha, a changed name>
```

## Rules
- Markers: `[ ]` pending, `[~]` dispatched, `[x]` merged (sha = `git rev-parse --short HEAD` of the merge), `[!]` blocked, `[-]` dropped.
- One line per task id, edited in place; on merge change `[~]` to `[x]` at once.
- Deviations: one short clause; longer detail goes to STATE.md `## Gotchas`.
- `## Notes`: execute appends each merged task's notes (≤3 lines) and pastes the last 5 into later dispatches.
- STATE.md lists no plan tasks. Its `## Done` and `## Remaining` each carry `Progress: .workflow/plans/<name>/PROGRESS.md — <merged>/<total> merged` (merged = `[x]` lines, total = lines not `[-]`); update it with every ledger edit.
