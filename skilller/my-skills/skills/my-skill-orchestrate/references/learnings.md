# .workflow/LEARNINGS.md

Durable project lessons. Committed, ≤60 lines, one line per entry, newest last.

## Entry format
`- <rule, imperative> — why: <what breaks if ignored> — guard: <test path::name | lint rule | AGENTS line | none> — evidence: <path:line | sha> — <YYYY-MM-DD>`

A lesson longer than one line goes to `.workflow/learnings/<slug>.md`; the entry links it. Keep secrets, tokens and personal data out.

## Read
`my-skill-masterplan`, `my-skill-audit`, `my-skill-research` and `my-skill-debug` read it only with `grep -i <keyword> .workflow/LEARNINGS.md`.

## Writers
- `my-skill-debug`, after the fix is green. Evidence = a test path or sha, not the debug file.
- `my-skill-audit`, after the report: a confirmed root cause likely to recur.
- `my-skill-ship`, before commit: at most one entry per run, taken from STATE `## Gotchas`.

## Write
1. Prune first: delete or rewrite every entry that is outdated, duplicated, or whose evidence path or sha no longer exists.
2. Add an entry only if both hold: without it the next agent would repeat the mistake, and the lesson is not already in code, a test or AGENTS.md.
3. Use the most durable form available: regression test > lint/type rule > AGENTS.md line > LEARNINGS line. A keyword that already has an entry lacks its guard: promote it to a test or lint rule.
4. Still over 60 lines: merge or promote entries until it fits.

Source: EveryInc/compound-engineering-plugin ce-compound form.md (MIT), ideas only
