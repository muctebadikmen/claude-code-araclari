# Verify-app report template

Report: `.workflow/verify-app/<date>-<slug>.md` (git-ignored). Screenshots: `.workflow/verify-app/<date>-<slug>/NN-<name>.png`.

```
# Verify-app <date>-<slug>
Outcome: VERIFIED | NOT_VERIFIED | MANUAL_VERIFY_REQUIRED (<reason>)
Commit: <sha>   Plan: <path>   Verify-app line: <quoted>
Stack: <from PROJECT.md>   Driver: <name + version>   Device: <name, OS>   Booted by run: yes|no

| # | Surface | Expected | Result | Evidence |
|---|---------|----------|--------|----------|
| 1 | <screen/flow> | <visible result> | PASS/FAIL/SKIP | 01-name.png |

## Log errors
<file:line — quoted line>   (or "none in <N> lines read")

## SKIP (human-only)
<surface — exact manual instruction>

## Limits
<tree-less driver, canvas UI, unasserted pixels>
```

- Outcome: SKILL.md "Outcome". It follows from the evidence, whichever driver was used.
- Under each FAIL row add `Observed: <what appeared>` and the commands that reproduce it.
