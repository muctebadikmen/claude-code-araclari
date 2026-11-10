# PLAN.md template

Dispatch as `Draft plan`. The drafter writes the block below to `.workflow/plans/<name>/PLAN.md`, filling every `<...>`. Labels are literal and lowercase, one field per line under `- id:`.

```
# PLAN <name>
Source: <audit/research/debug path or "user description">
Base: <sha the plan was drafted against: git rev-parse HEAD>
Goal: <one line>
Out of scope: <what this plan deliberately does not do>
Global verify: `<full test suite command>` → expected: <measured by running it, e.g. "312 tests, 0 failures">
Definition of done: <observable conditions>
Verify-app: <one line: screen/flow to smoke-check after the last merge> or none — <reason>
Setup: `<command a fresh worktree needs before tests run, e.g. "npm ci">` or none

## Corrections
<FALSE/PARTIAL input claims a task relies on: "AUD-n says path:line — actual: path:line, <what differs>", or "none">

## Decisions
| # | Question | Answer |
|---|---|---|
| 1 | <question> | <answer from the message or STATE.md> |

## Phase 1: <name>
may-start-early-when: none (first phase)
gate: <full suite | none>

- id: T1
  goal: <one sentence>
  files: <path> (modify lines a–b), <test path> (create)
  change: <what and how; code where non-obvious; exact exception, return value, edge-case behaviour>
  interfaces: produces: <name, signature, file> | consumes: T<n>.<name> | none
  tests: <test file and test names; what each asserts> or none — <reason: config, copy, styling, generated>
  verify: `<exact command running only the tests that cover this task's files and their direct dependents>` → expected: <output>
  model: <sonnet | opus — one-phrase reason | haiku, mechanical work only>
  risk: <opus tasks only, required there: how a mistake could still pass the tests, e.g. "migration ordering">
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
may-start-early-when: <condition, e.g. "T1–T2 merged">
gate: none

- id: T3
  ...
```

## Rules for the drafter (not copied into PLAN.md)

- Before drafting, read `.workflow/PROJECT.md` (its test and run commands go in `verify`/`Setup`) and the repo's rules (CLAUDE.md, lint, architecture and sentinel tests); code, UI strings and file placement obey them.
- ids are T1..Tn, unique. `depends-on` names an earlier id and only a real data dependency, not a shared file.
- Lanes: as many parallel-groups as the work allows; tasks in one group have disjoint `files:` and `tests:`. Sequential edits to one file are ONE task with ordered steps.
- `model:` defaults to sonnet; opus needs the one-phrase reason and a `risk:` line (execute reviews such a task on opus). Never fable.
- Task blocks ≤40 lines, free of audit-trail notes. `files:` lists every file created or modified, tests included.
- `verify` and `Global verify` run in this project as-is (the repo's own interpreter and runner). Run `Global verify` yourself to get its expected result. Execute runs `Global verify` once at Finish; for a large plan (more than ~10 tasks or 3 phases) set `gate: full suite` on the phases later phases build on.
- Every Decision is applied by at least one task; a task touching a decided behaviour restates it.
- Name the concrete case and behaviour everywhere; no placeholders. Only claims verified TRUE appear as facts.
- `interfaces:` on every task. Every consumed name is produced by an earlier task or already exists (cite `path:line`); every produced name is consumed by a task or is the plan's public result.
- Behaviour-changing tasks name a test seam in `tests:` (`my-skill-orchestrate/references/tdd-rule.md`; mobile: ViewModel or pure-function seam).
- Goal asks for full behaviour: split into phases instead of writing "for now", "v1", "stub", "later" or "hardcoded" into a task.
- ≥3 layers touched: T1 is a thin end-to-end slice.
- A choice Decisions do not cover: affects only how to implement → pick the simplest and list it in the reply; changes behaviour, data or an interface → leave it open and list it as `decision needed: <question>`.
- Reply: the PLAN.md path, task count, parallel-groups per phase, opus task ids, choices you made, and every `decision needed:` item.

Source: obra/superpowers writing-plans (MIT) for interfaces and type consistency; mattpocock/skills to-tickets (MIT) for the tracer-bullet slice.
