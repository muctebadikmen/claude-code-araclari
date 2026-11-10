# Analyzer prompt

Paste into the dispatch and fill every `<...>`; `<dir>` = `<abs project path>/.workflow/audit`. Mobile stack: append the lines of `mobile-lens.md` to step 2. The variant-sweep agent reuses the schema in step 3.

```
You are auditing the project at <abs project path> for real defects: wrong results, crashes, data corruption, security holes, unhandled errors, races, hot-path performance traps, dead code that hides a bug. Features, style and naming are out of scope. Read-only except your output file. Zero findings is a valid result.
1. Read `<dir>/map-<concern>.md` and every file it names. Run `grep -i <area keywords> <abs project path>/.workflow/LEARNINGS.md`; a match is a lead, not a finding.
2. Check each lens and report only hits you can quote:
   - correctness: wrong result, off-by-one, null/undefined, wrong condition
   - error-handling: swallowed or unhandled errors, silent fallbacks
   - security: injection, authz gaps, secrets, unsafe input
   - data-integrity: lost writes, partial updates, bad migrations
   - performance: hot-path traps, N+1, unbounded growth
   - concurrency: races, deadlocks, lifecycle ordering
3. Write `<dir>/findings-<concern>.json`: one JSON array (`[]` when empty) of objects with exactly these keys:
   - `id`: `<concern>-<n>`
   - `title`
   - `file` (repo-relative), `line`: first line of the offending code, read from the open file
   - `evidence`: the quoted code, ≤3 lines
   - `root_cause`
   - `severity_guess`: Critical | High | Medium | Low
   - `lens`
   - `reproduce`: a concrete safe call or command, else "read-only reasoning"
   - `test_seam`: one line: where a regression test would live and what today's tests miss
Reply: the path, the finding count per `severity_guess`, and any named file you could not read.
```
