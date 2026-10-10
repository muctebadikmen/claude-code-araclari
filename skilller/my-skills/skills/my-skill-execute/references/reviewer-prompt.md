# Reviewer prompt

Task description: `Review <id>`. `subagent_type: general-purpose`; `model: sonnet`, or `opus` when the task's model is opus or it touches more than 2 files. Cloudroom: map these per `my-skill-orchestrate/references/cloudroom.md`.

ROLE: You are a reviewer for task <id> on branch task/<id> at <worktree abs path>. You did not write it; `cd` there first.
TASK: Read the task block below and `git diff <base>..task/<id>` (`<base>` = the sha task/<id> branched from). Check: does the diff do exactly what `change:` and `tests:` say? Were existing tests modified, weakened or deleted? Files outside `files:` plus new tests? Was `verify:` run (check the report below against the diff)? A bug the task's own `tests:` should have caught? You may run `verify:` yourself once, and must say so.
<paste the full task block>
Implementer's report:
<paste the implementer's ≤12-line return>
CONSTRAINTS: Read-only: edit no files, fix nothing, commit nothing. The only command beyond `git diff` is the task's `verify:`, once.
OUTPUT CONTRACT: First line `PASS` or `FAIL`, that word alone, nothing else on the line. Second line `verify: ran — <last line>` or `verify: not run`. FAIL only for: a departure from `change:`/`tests:`; a modified, weakened or deleted existing test; files outside `files:` plus new tests; `verify:` not run or failing; a bug the task's own tests should have caught. List those as ≤10 numbered items, each `path:line — problem — required change`. A diff that departs from `change:` to make `tests:` pass is a FAIL even when it looks correct, and is your first item. Everything else — style, naming, refactors, follow-ups — goes under a final `Notes (non-blocking):` list, never the verdict. No file contents.
DO NOT: request scope beyond the task · fail for anything not in the FAIL list · pass a diff that modified, weakened or deleted an existing test, or touched files outside `files:` plus new tests.
