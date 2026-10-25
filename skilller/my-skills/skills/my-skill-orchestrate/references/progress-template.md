# .workflow/plans/<name>/PROGRESS.md template

The plan ledger: the only per-task status source while a `my-skill-masterplan` plan runs. Masterplan writes it with the plan (every task `[ ]`, plan order); execute and handoff edit it. STATE.md never lists plan tasks: its `## Done` and `## Remaining` carry one line, `Progress: .workflow/plans/<name>/PROGRESS.md — <merged>/<total> merged` (merged = `[x]` lines, total = lines not `[-]`), updated with the ledger.

```
# <name> progress
Ledger for .workflow/plans/<name>/PLAN.md. One line per task, plan order; edit the marker in place.
- [ ] T1 — <goal>
- [~] T2 — <goal> — <agent task name> (<model>)
- [x] T3 — <short sha> — <deviations | none>
- [!] T4 — BLOCKED: <reason>
- [-] T5 — dropped: <reason>
```

- `[ ]` pending · `[~]` dispatched, not merged · `[x]` merged, with the merge's `git rev-parse --short HEAD` sha · `[!]` blocked (blocking stop or third review FAIL) · `[-]` dropped, with the reason.
- One line per task id, edited in place; a merged task is never left `[~]`.
- Deviations stay one short clause; longer detail goes to STATE.md `## Gotchas`.
- Small hand-written `.workflow/PLAN.md` plans (`- [ ] T1 — <step>`) keep their checkboxes in PLAN.md and need no ledger.
- Committed with STATE.md and PLAN.md, never ignored.
