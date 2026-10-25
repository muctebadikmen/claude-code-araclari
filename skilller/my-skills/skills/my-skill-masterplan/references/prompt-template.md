# PROMPT.md template

Write the filled text to `.workflow/plans/<name>/PROMPT.md`. It is pasted into an empty chat: absolute paths, goal, every decision; nothing may depend on this conversation.

```
Implement the plan at `<abs path>/.workflow/plans/<name>/PLAN.md` for the project at `<abs path>`.

Goal: <one line from PLAN.md>
Definition of done: <from PLAN.md>
Global verify: `<from PLAN.md>` → expected: <from PLAN.md>

Invoke the `my-skill-execute` skill and run non-stop: do not pause for confirmation between tasks; only stop on a blocking failure as defined in that skill. Follow `my-skill-orchestrate`: sub-agents do the work with `model` set, the ledger `.workflow/plans/<name>/PROGRESS.md` and `.workflow/STATE.md` updated after every merge. Implementers run in the background, every runnable task at once, each reviewed on return.

Decisions already made (final, do not re-ask):
<Decisions from PLAN.md, one each: "N. <question> → <answer>">

Corrections already applied (trust PLAN.md, not the original report):
<## Corrections lines from PLAN.md, or "none">

Known plan gaps (also STATE.md `## Gotchas`):
<remaining check items, or "none">

Rules: Do not delete, skip, weaken, or narrow tests to make verification pass. Do not refactor unrelated code or add dependencies the plan does not name. If something is impossible as written, record it under Deviations in STATE.md, take the closest faithful alternative, and continue.

When finished: run the global verify command, print the summary, and offer the `my-skill-ship` skill.
```
