---
name: my-skill-masterplan
description: Use when the user wants an implementation plan for a feature, bug-fix batch, or multi-step change, especially one to run later in a separate empty chat non-stop. Triggers: "make a plan", "plan this", "plan the fix", "implementation plan", "plan yap", "planla", "uygulama planı".
---

# Masterplan

REQUIRED SUB-SKILL: my-skill-orchestrate

A plan another chat executes non-stop in parallel lanes.

Fixed paths: `.workflow/plans/<name>/{PLAN,PROMPT,PROGRESS}.md`, `.workflow/STATE.md` (rule 10). Agents write the plan (rule 1).

## Inputs

`.workflow/audit/<file>.md`, `.workflow/research/<file>.md`, or a user description. Plan name: ask once. Decisions in the invoking message are final: copy verbatim into STATE.md `## Decisions` before the first dispatch; never re-ask.

## Phases

### 1. Collect (parallel, `model: sonnet`) — only when the input lacks `file:line`
Input already citing lines (audit report; research synthesis with `## Integration points`): skip, verify its claims directly. Otherwise one agent per finding group or feature part, one message (rule 3), writing `collect-<n>.md`: files touched (path, role) and every code claim with file:line.

### 2. Verify (parallel, `model: opus`)
One verifier per ≤15 claims, checked against the file into `verify-<n>.md`: `claim → TRUE/FALSE/PARTIAL, path:line`. A wrong line is PARTIAL; nothing false enters a task. `## Corrections` carries only FALSE/PARTIAL input claims a task relies on; other drift stays in `verify-<n>.md`.

### 3. Decide (orchestrator)
List every fork: architecture, naming, scope, edge cases. Drop those the invoking message or STATE.md Decisions answer; ask the rest (rule 12) in as many rounds as answers open new forks. "Do not ask" ⇒ recommended option, recorded. Answers go to STATE.md Decisions; no "TBD" survives.

### 4. Draft
`Draft plan` (opus). Inputs: collect/verify files, Decisions, `references/plan-template.md`. Nine fields per task: id, goal, files, change, tests, verify, model, depends-on, parallel-group; every phase declares `may-start-early-when:`. As many parallel-groups with disjoint `files:` as the work allows; sequential edits to one file are ONE task with ordered steps, each naming its change and verify line; `depends-on` only for a real data dependency. Task blocks ≤40 lines, no audit-trail notes. UI strings and code obey repo rules (CLAUDE.md, lint, sentinel tests), read first. `Global verify`'s expected result comes from running it.

### 5. Check (2 rounds max, rule 6)
`Check plan` (opus, fresh context) per `references/plan-checker-prompt.md`: only defects that would make execution fail. `Fix plan issues` (opus) applies every item in task bodies. Round 2 rechecks only changed tasks plus round-1 items. Stop at `CLEAN`; otherwise remaining items go to STATE.md `## Gotchas` and into PROMPT.md, and a third round needs a 🛑.

### 6. Prompt (orchestrator)
Write `PROMPT.md` (`references/prompt-template.md`) and `PROGRESS.md`, all `[ ]` (orchestrate's `progress-template.md`).
🛑 Print phases, task count, parallel groups, paths. Update STATE.md. End with "Next: paste PROMPT.md into an empty chat." Never ask whether to execute.
