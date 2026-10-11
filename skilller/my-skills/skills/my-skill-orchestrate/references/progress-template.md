# .workflow/plans/<name>/PROGRESS.md template

The plan ledger: the single per-task status source while a `my-skill-masterplan` plan runs. Masterplan writes it with the plan (every task `[ ]`, plan order); execute and handoff edit it. STATE.md never lists plan tasks: its `## Done` and `## Remaining` hold one line, `Progress: .workflow/plans/<name>/PROGRESS.md — <merged>/<total> merged`, updated with the ledger (merged = `[x]` lines, total = lines not `[-]`).

```
# <name> progress
Ledger for .workflow/plans/<name>/PLAN.md. One line per task, plan order; edit the marker in place.
- [ ] T1 — <goal>
- [~] T2 — <goal> — <agent task name> (<model>)
- [x] T3 — <short sha> — <deviations | none>
- [!] T4 — BLOCKED: <reason>
- [-] T5 — dropped: <reason>
```

## Markers

- `[ ]` pending.
- `[~]` running: dispatched, not merged (execute dispatch; handoff for unmerged work, with a note).
- `[x]` merged; the merge's `git rev-parse --short HEAD` sha is required.
- `[!]` blocked: blocking stop or third review FAIL.
- `[-]` dropped or retired, with the reason.

## Rules

- Each task has exactly one line; edit its marker and tail in place, never add a second line for the same id.
- A merged task is never left `[~]`.
- Deviations stay one short clause here; longer detail goes to STATE.md (Deviations, `## Gotchas`).
- Small hand-written `.workflow/PLAN.md` plans (`- [ ] T1 — <step>`) keep their checkboxes in PLAN.md and need no ledger.
- Committed with STATE.md and PLAN.md, never ignored.
