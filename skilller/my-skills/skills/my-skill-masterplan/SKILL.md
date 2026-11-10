---
name: my-skill-masterplan
description: Use when the user wants an implementation plan for a feature, bug-fix batch, or multi-step change, especially one to run later in a separate empty chat non-stop. Triggers: "make a plan", "plan this", "plan the fix", "implementation plan", "plan yap", "planla", "uygulama planı".
---

# Masterplan

REQUIRED SUB-SKILL: my-skill-orchestrate

Agents write a plan that another chat executes non-stop in parallel lanes; you decide and relay. Model routing per orchestrate.

Paths: `.workflow/plans/<name>/{PLAN,PROMPT,PROGRESS}.md`, `.workflow/STATE.md`.

## Inputs

An audit, research or debug file under `.workflow/`, or a user description. Also read `.workflow/PROJECT.md` and `grep -i` `.workflow/LEARNINGS.md` for the task's keywords. Plan name: slug of Goal; ask only on a clash. Decisions in the invoking message are final: copy them verbatim into STATE.md `## Decisions` before the first dispatch; never re-ask.

## Modes

- **Small** (≤3 tasks, one parallel-group): skip Collect, Verify and Check; sonnet drafts; go to Prompt.
- **Converge** (input is an existing plan folder, or "check plan vs code"): follow `references/converge-prompt.md`.

## Phases

1. **Collect** (parallel, sonnet), only when the input lacks `file:line` citations (audit, research and debug files have them: Verify checks those directly). One agent per finding group or feature part writes `collect-<n>.md`: files touched (path, role) and every code claim with `file:line`.
2. **Verify** (parallel, sonnet, one per ≤15 claims): check each claim against the file and write `verify-<n>.md`, one line per claim: `claim → TRUE/FALSE/PARTIAL, path:line`. Only TRUE claims enter a task as facts.
3. **Decide** (you): list every fork (architecture, naming, scope, edge cases) the message and STATE.md Decisions leave open. Ask them, recommended option first, in rounds until answers open no new forks; agents look up facts. Put low-risk forks in one "Assumptions, recorded unless you object" block. "Do not ask" means take the recommended option. Record every answer in STATE.md Decisions; no TBD survives.
4. **Draft** (`Draft plan`, opus: the rest depends on it) per `references/plan-template.md`, from the collect/verify files, Decisions and PROJECT.md. Its `decision needed:` items go back to Decide.
5. **Check** (≤2 rounds; a third needs a 🛑): `Check plan` per `references/plan-checker-prompt.md`. On `ISSUES: <n>`, `Fix plan issues` (opus) applies every item, then round 2 rechecks the changed tasks. Stop at `CLEAN`; items left after round 2 go to STATE.md `## Gotchas` and PROMPT.md.
6. **Prompt** (you): write `PROMPT.md` (`references/prompt-template.md`) and `PROGRESS.md` with every task `[ ]` (orchestrate's `progress-template.md`). 🛑 Print phases, task count, parallel groups, paths and the checker's summary; update STATE.md; end with "Next: paste PROMPT.md into an empty chat." Never ask whether to execute.
