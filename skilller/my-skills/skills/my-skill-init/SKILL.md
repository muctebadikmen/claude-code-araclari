---
name: my-skill-init
description: Use when starting or setting up a project for the my-skills workflow, or when another my-skill finds no .workflow/STATE.md. Triggers: "init", "project start", "set up this project", "start a new project", "projeyi başlat", "proje kurulumu".
---

# Init

Set up the project's workflow files and rules. Idempotent: a second run changes nothing. No sub-agents and no questions, except when the folder is not a git repo and holds several projects: then ask which one.

Project root = `git rev-parse --show-toplevel`, else the current folder. Before editing, note `git status --porcelain -- AGENTS.md CLAUDE.md .gitignore .workflow/STATE.md .workflow/PLAN.md`: a listed path already holds uncommitted user changes.

1. **State.** Missing `.workflow/STATE.md`: write it from my-skill-orchestrate's state template, `Active skill: none`. Write `.workflow/PLAN.md` (`# PLAN`, `Goal:`, `- [ ] T1 — <step>` lines) only if the user described work to plan; otherwise planning is `my-skill-masterplan`'s job.
2. **Rules.** In `AGENTS.md` (create if missing) replace everything between the markers with the block below, or append the block if the markers are absent. Never touch text outside the markers.
3. **CLAUDE.md.** Missing: create it containing `@AGENTS.md`. Present without that line: add it at the top.
4. **`.gitignore`.** Add each missing entry: `.workflow/research/`, `.workflow/dispatch/`, `.workflow/audit/`, `.workflow/runs/`, `.workflow/plans/*/check-*.md`, `.worktrees/`. A line ignoring all of `.workflow` (`.workflow/`, `.workflow`, `/.workflow/`, `.workflow/*`) is replaced by these. Never ignore the whole folder.
5. **Commit** (git repo, files changed): stage and commit only the changed paths with `chore: set up my-skills workflow files`, plus an attribution trailer only if this session supplied one. If a changed path held uncommitted user changes before step 1, commit nothing and say so.
6. **Report** in 3 lines: what changed, commit sha or why none, next step (`my-skill-masterplan`, or the plan's first step).

## AGENTS.md block

```
<!-- my-skills:start -->
## Workflow rules (my-skills)
- Read `.workflow/STATE.md` before starting work.
- When a step changes status or a decision is made, update `.workflow/STATE.md` (and tick `.workflow/PLAN.md`) in the same turn, before replying.
- A step is done only with evidence: a passing test or a commit.
- Plans: `my-skill-masterplan` tasks (`- id: T1`), or checkbox steps with ids (`- [ ] T1 — <step>`) for small hand-written plans. No tables.
- Keep STATE.md ≤80 lines; details go in linked files.
- Plan task status: `.workflow/plans/<name>/PROGRESS.md` (`[ ]`/`[~]`/`[x]`/`[!]`/`[-]`), never task lists in STATE.md; small `.workflow/PLAN.md` plans keep checkboxes.
- `.workflow/PLAN.md`, `STATE.md`, `HANDOFF.md` and `.workflow/plans/*/PLAN.md`, `PROMPT.md`, `PROGRESS.md` are committed. Scratch (`.workflow/research/`, `dispatch/`, `audit/`, `runs/`, plan `check-*.md`, `.worktrees/`) is not.
- For multi-step work, follow the `my-skill-orchestrate` skill.
<!-- my-skills:end -->
```
