---
name: my-skill-masterplan
description: Use when the user wants an implementation plan for a feature, bug-fix batch, or multi-step change, especially one to run later in a separate empty chat non-stop. Triggers: "make a plan", "plan this", "plan the fix", "implementation plan", "plan yap", "planla", "uygulama planı".
---

# Masterplan

REQUIRED SUB-SKILL: my-skill-orchestrate

A plan another chat executes non-stop in parallel lanes. Agents write it; you decide and relay. Models follow orchestrate's model routing.

Fixed paths: `.workflow/plans/<name>/{PLAN,PROMPT,PROGRESS}.md`, `.workflow/STATE.md`.

## Inputs

`.workflow/audit/<file>.md`, `.workflow/research/<file>.md`, or a user description. Plan name: ask once. Decisions in the invoking message are final: copy them verbatim into STATE.md `## Decisions` before the first dispatch; never re-ask.

## Phases

1. **Collect** (parallel, sonnet), only when the input lacks `file:line` citations (audit reports and research syntheses with `## Integration points` have them: verify those claims directly). One agent per finding group or feature part writes `collect-<n>.md`: files touched (path, role) and every code claim with file:line.
2. **Verify** (parallel, sonnet; one per ≤15 claims): check each claim against the file into `verify-<n>.md`: `claim → TRUE/FALSE/PARTIAL, path:line`. Nothing false enters a task. `## Corrections` carries only FALSE/PARTIAL input claims a task relies on; other drift stays in the verify file.
3. **Decide** (you): list every fork (architecture, naming, scope, edge cases), drop what the invoking message or STATE.md Decisions already answer, ask the rest in as many rounds as answers open new forks. "Do not ask" means take the recommended option and record it. Answers go to STATE.md Decisions; no "TBD" survives.
4. **Draft** (`Draft plan`, opus: the rest depends on it). Inputs: collect/verify files, Decisions, `references/plan-template.md`. Maximise parallel-groups with disjoint `files:`; sequential edits to one file are ONE task with ordered steps; `depends-on` only for a real data dependency. Each task's `model:` follows orchestrate's model routing (sonnet unless a one-phrase reason justifies opus); an opus task also gets a `risk:` line naming the hazard, which makes execute review it on opus. Task blocks ≤40 lines; code and UI strings obey the repo's rules (CLAUDE.md, lint, sentinel tests), read first. `Global verify`'s expected result comes from running it.
5. **Check** (≤2 rounds; a third needs a 🛑). `Check plan` per `references/plan-checker-prompt.md`: fresh context, sonnet by default, opus for a big or cross-cutting plan; only defects that would make execution fail. `Fix plan issues` applies every item in task bodies (same model choice). Round 2 rechecks only changed tasks plus round-1 items. Stop at `CLEAN`; otherwise remaining items go to STATE.md `## Gotchas` and into PROMPT.md.
6. **Prompt** (you): write `PROMPT.md` (`references/prompt-template.md`) and `PROGRESS.md`, all `[ ]` (orchestrate's `progress-template.md`). 🛑 Print phases, task count, parallel groups, paths; update STATE.md; end with "Next: paste PROMPT.md into an empty chat." Never ask whether to execute.
