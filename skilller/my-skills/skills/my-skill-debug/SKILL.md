---
name: my-skill-debug
description: Use when one specific bug (error, crash, wrong result, hang, slow path, pasted stack trace, or an AUD-n) needs a root cause and fix. Triggers: "debug", "why does X fail", "crash", "find the root cause", "hata ayıkla", "neden çalışmıyor", "çöküyor", "hatayı bul".
---

# Debug

Repro, root cause, red test, smallest fix.

REQUIRED SUB-SKILL: my-skill-orchestrate

Input: bug text, log, stack trace, or AUD-n. The investigator is a `sonnet` agent. State: `.workflow/debug/<slug>.md` (template in `references/debug-loop.md`), updated before every action and committed while open so a handoff can resume. List it in STATE.md `## Files`.

## Steps
1. Intake: redact secrets. Write expected/actual/since. `grep -i` `.workflow/LEARNINGS.md` for the symptom (a lead, not a verdict). Uncommitted changes are suspect #1.
2. Crash log or stack trace as input: follow `references/crash-mode.md` first.
3. Build ONE deterministic command that is red on the exact symptom (ladder: `references/debug-loop.md`). None: 🛑 list what was tried, ask for a log or recording.
4. Minimise the repro.
5. List ≤3 ranked, falsifiable hypotheses ("if X, then changing Y removes the symptom").
6. Test one at a time, cheapest first: trace backward from the bad value; bisect regressions; tag probes `[DBG-<slug>]`; log each result in the file. With 3+ independent hypotheses, fan out ≤3 read-only `sonnet` falsifiers instead.
7. Gate: a causal chain from trigger to symptom with `file:line` at every hop; "somehow" is a gap. A fresh `sonnet` disprover, not the investigator, tries to break it. Briefs for steps 6–7: `references/debug-loop.md`.
8. Draft the regression test (orchestrate's `tdd-rule.md`) in scratch worktree `.worktrees/dbg-<slug>`; run it red for the root-cause reason, quote the red line, remove the worktree. No seam: record a finding.
9. Write the one-task `.workflow/plans/fix-<slug>/PLAN.md` (`references/debug-loop.md`). More than one task: `my-skill-masterplan` with the debug file.
10. Clean the tree, last step before execute: remove every probe; `grep -r DBG-<slug>` empty; `git status --short` clean outside `.workflow/`.
11. Run `my-skill-execute`.
12. Verify: new test, step-3 command and fast suite green. Search the root-cause pattern elsewhere; list siblings.
13. Record: prune LEARNINGS first, then add one entry (orchestrate's `learnings.md`; evidence = test path or sha). Delete the debug file and its STATE.md `## Files` line; commit. Offer `my-skill-ship`.

## Escalation
- 2 hypotheses eliminated: switch the investigator to `opus`, passing the debug file.
- 3 failed fixes: 🛑 diagnosis or architecture is wrong. Write state, ask.

## Hard rules
- No hypothesis before a red, deterministic repro. No fix before the test is red. One change at a time.
- Fix the root cause. No refactors.
- Done = measured output quoted per orchestrate's `evidence-gate.md`.
