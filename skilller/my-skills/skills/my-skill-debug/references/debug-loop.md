# Debug loop

## State file `.workflow/debug/<slug>.md`
```
status: loop | reproduced | hypothesizing | fixing | verifying | blocked
next_action: <one concrete step; OVERWRITE before every action>
## Symptom      immutable: expected / actual / error text / since
## Loop         the one command + last output line (redacted)
## Hypotheses   H1..H3, each with its prediction
## Eliminated   append-only: hypothesis + evidence
## Evidence     append-only: checked / found / implication
## Root cause   causal chain with file:line
## Fix & test   files, test path::name, red-run line, green-run line
## Why not caught / Guard / Siblings
```
A handoff or compaction resumes from `next_action`. The file is committed while the debug is open and deleted when it closes (SKILL step 13).

## Repro ladder (best first)
1. Failing unit test at a pure-logic or ViewModel seam.
2. Replay of a captured payload or fixture.
3. Targeted test command for one test or file (see the stack pack named in PROJECT.md).
4. Simulator/emulator script: deep link, then screenshot or log assert (flags `(unverified)`; see the stack pack).
5. Human-in-the-loop: the user does a few taps, a script captures the log.

Done when: one command, already run once, red on the user's exact symptom, deterministic, seconds not minutes.

By bug class:
- Wrong result: unit seam.
- UI or state: replay or simulator script.
- Hang, ANR, slow: measure a baseline first; logs lie about timing.
- Flaky or race: raise the repro rate before anything else.
- "Worked last release": `git bisect` with the repro command.
- Crash: `references/crash-mode.md`.

## Sub-agent briefs (sonnet, read-only; fill `<...>`)
Falsifier, one per hypothesis (step 6):
```
Project: <abs path>. Read `<abs path>/.workflow/debug/<slug>.md`. Try to falsify <H n>: "<hypothesis and its prediction>". Run only the repro command and read-only commands; edit nothing.
Reply: line 1 `ELIMINATED` or `SURVIVES`, alone; then ≤5 lines: what you checked, what you found (`file:line` or command -> output line), what it implies.
```
Disprover (step 7):
```
Project: <abs path>. Claimed causal chain for the bug in `<abs path>/.workflow/debug/<slug>.md`:
<chain, one hop per line with file:line>
Try to break it. Open every hop. Look for a hop the code does not entail, a guard that stops it, or another cause that explains the symptom as well. Read-only; you may run the repro command.
Reply: line 1 `HOLDS` or `BROKEN`, alone; then per weak hop `file:line — why it fails — what would prove it`.
```
ELIMINATED goes to `## Eliminated`. BROKEN returns the work to step 5.

## One-task fix plan
Write `.workflow/plans/fix-<slug>/PLAN.md` from `my-skill-masterplan/references/plan-template.md` with exactly one task:
- `tests:` the test's path::name plus its body or an exact description. The test is not left in the tree: the implementer writes it RED first.
- `verify:` the repro command.
- `Out of scope:` everything else; a `Verify-app:` line.
- `model:` opus only in an opus area (concurrency, persistence, security, numeric).

Sources: mattpocock/skills diagnosing-bugs (MIT), EveryInc/compound-engineering-plugin ce-debug (MIT), obra/superpowers systematic-debugging (MIT), open-gsd/gsd-core debugger file protocol (MIT). Disprover and siblings: ideas from Trail of Bits fp-check and variant-analysis (CC-BY-SA), own wording.
