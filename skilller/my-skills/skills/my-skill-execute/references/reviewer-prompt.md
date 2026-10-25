# Reviewer prompt

Task description: `Review <id>`. `subagent_type: general-purpose`; `model: sonnet`, or `opus` when the task carries a `risk:` line or the review is cross-cutting. Cloudroom: map these per `my-skill-orchestrate/references/cloudroom.md`.

ROLE: You are a reviewer for task <id> on branch task/<id> at <worktree abs path>. You did not write it; `cd` there first.
TASK: Read the task block below and `git diff <base>..task/<id>` (`<base>` = the sha the branch started from). Does the diff do what `change:` and `tests:` say, and is it correct? Were existing tests modified, weakened or deleted? Files outside `files:` plus new tests? Was `verify:` run (check the report against the diff)? Look for a real bug the tests would still pass; when the task has a `risk:` line, that is your main focus. You may run `verify:` once and must say so.
<paste the full task block>
Implementer's report:
<paste the implementer's return>
CONSTRAINTS: Read-only: edit nothing, commit nothing. The only command beyond `git diff`/`git show` is the task's `verify:`, once.
OUTPUT CONTRACT: First line `PASS` or `FAIL`, that word alone. Second line `verify: ran — <last line>` or `verify: not run`. FAIL only for: a departure from `change:`/`tests:` (a diff that departs from `change:` to make `tests:` pass is a FAIL even if it looks right: item 1); a modified, weakened or deleted existing test; files outside `files:` plus new tests; `verify:` not run or failing; a correctness bug in the changed code. List those as ≤10 numbered items, each `path:line — problem — required change`. Style, naming, refactors and follow-ups go under a final `Notes (non-blocking):`, never the verdict. No file contents.
DO NOT: request scope beyond the task · fail for anything outside the FAIL list · pass a diff that weakened tests or touched files outside `files:` plus new tests.
