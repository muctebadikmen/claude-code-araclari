# PLAN.md template

Copy the block below into `.workflow/plans/<name>/PLAN.md` and fill every `<...>`. Labels are literal and lowercase, one field per line under `- id:`.

```
# PLAN <name>
Source: <audit/research path or "user description">
Goal: <one line>
Global verify: `<command that must pass after merges>` → expected: <measured by running it, e.g. "312 tests, 0 failures">
Definition of done: <observable conditions>

## Corrections
<FALSE/PARTIAL input claims a task relies on: "AUD-n says path:line — actual: path:line, <what differs>", or "none">

## Decisions
| # | Question | Answer |
|---|---|---|
| 1 | <question> | <answer from the message or STATE.md> |

## Phase 1: <name>
may-start-early-when: none (first phase)

- id: T1
  goal: <one sentence>
  files: <path> (modify lines a–b), <test path> (create)
  change: <what and how; code where non-obvious; exact exception, return value, edge-case behaviour>
  tests: <test file and test names; what each asserts>
  verify: `<exact command>` → expected: <output>
  model: <haiku|sonnet|opus>
  depends-on: none
  parallel-group: A

- id: T2                          # one file, ordered edits
  goal: <one sentence covering every step>
  change:
    step 1 — <change>; verify: `<command>` → <output>
    step 2 — <change>; verify: `<command>` → <output>
  ...
  parallel-group: B

## Phase 2: <name>
may-start-early-when: <condition, e.g. "T1–T2 merged, global verify green">

- id: T3
  ...
```

## Rules for the drafter (do not copy this section into PLAN.md)

- ids are T1..Tn, unique; `depends-on` names an earlier id, only for a real data dependency, never for a shared file.
- Lanes: as many parallel-groups as the work allows; tasks in one group have disjoint `files:` and `tests:`.
- Sequential edits to one file are ONE task with ordered steps, each naming its change and verify line, never a depends-on chain; otherwise one task per finding or feature part.
- Task blocks ≤40 lines; no audit-trail notes ("per check-2 #7") in bodies.
- `files:` lists every file the task creates or modifies, tests included.
- `verify` and `Global verify` run in this project as-is (the repo's own interpreter and test runner; `python3` if `python` is absent). `Global verify`'s expected result comes from running it, never from commit messages.
- UI strings, code and file placement obey the repo's own rules (CLAUDE.md, lint, architecture and sentinel tests), read before drafting.
- Every Decision is applied by at least one task; a task touching a decided behaviour restates it.
- No placeholders: name the concrete case and behaviour.
- Only TRUE claims appear as facts. `## Corrections` lists only the FALSE/PARTIAL input claims a task relies on, with the actual location; other drift stays in `verify-<n>.md`.
