# PROMPT.md template

Write the filled block to `.workflow/plans/<name>/PROMPT.md`. It is pasted into an empty chat, so it uses absolute paths and carries the goal and every decision itself. The plan stays in PLAN.md; PROMPT.md points to it.

```
Implement the plan at `<abs path>/.workflow/plans/<name>/PLAN.md` for the project at `<abs path>`.

Goal: <one line from PLAN.md>
Definition of done: <from PLAN.md>
Global verify: `<from PLAN.md>` → expected: <from PLAN.md>
Base: <from PLAN.md>   Verify-app: <from PLAN.md>

Invoke the `my-skill-execute` skill and run non-stop: no pause for confirmation between tasks; stop only on a blocking stop defined in that skill. Ledger: `<abs path>/.workflow/plans/<name>/PROGRESS.md`.

Decisions already made (final, do not re-ask):
<Decisions from PLAN.md, one each: "N. <question> → <answer>">

Corrections already applied (trust PLAN.md, not the original report):
<## Corrections lines from PLAN.md, or "none">

Known plan gaps (also STATE.md `## Gotchas`):
<remaining check items, or "none">

Rules: Do not delete, skip, weaken, or narrow tests to make verification pass. Do not refactor unrelated code or add dependencies the plan does not name. Something unclear or impossible as written: when it only affects how to implement, take the simplest faithful option, record the deviation on the task's PROGRESS.md line, and continue; when it changes behaviour, data or an interface, mark the task `[!]` with the question and continue the independent tasks.

When finished: run the full suite once (Global verify), print the summary with every pending decision question, and offer the `my-skill-ship` skill.
```
