# Evidence gate

When a claim ("done", "passed", "fixed", "works") counts as a fact, for the agent reporting it and the reviewer or orchestrator accepting it.

## Rule
A claim is a fact only when all four hold:
1. The command that proves it ran on the current code, after the last change to the files in scope. Older output: rerun.
2. The command's scope covers the claim's scope ("all tests pass" needs the full suite, not one file).
3. The output shows the work ran: skipped, filtered or "0 tests ran" proves nothing.
4. A reviewer or the orchestrator read the quoted output; until then a sub-agent's "passed" is a claim.

## Report line (one per claim)
`<OUTCOME> — <command> → exit <n> — "<output line>"`

Quote the line carrying the proof: pass/fail counts, the failing line, or the last line. Command not run: `NOT_VERIFIED — <command> → not run`.

## Outcome (exactly one)
- `VERIFIED`: every claim has quoted evidence of matching scope.
- `NOT_VERIFIED`: a command failed, was not run, or is narrower than the claim. Say which.
- `MANUAL_VERIFY_REQUIRED`: the proof needs a human or an unavailable resource (device, account, paid service). Name the exact check.

## Claim → evidence
| Claim | Required | Not enough |
|---|---|---|
| Tests pass | test command, exit 0, pass/fail counts | earlier run, "should pass" |
| Build succeeds | build command, exit 0 | lint or typecheck passing |
| Lint/types clean | that tool's command, 0 errors | a different tool passing |
| Bug fixed | the original repro, now green; regression test red before, green after | code changed |
| Task done | task's `verify:` output plus `git diff --stat` showing the change | agent says "done" |
| App works | verify-app evidence file (`.workflow/verify-app/`) with `VERIFIED` for the named flow | unit tests passing |

Source: obra/superpowers verification-before-completion (MIT)
Source: gotalab/cc-sdd kiro-verify-completion (MIT)
