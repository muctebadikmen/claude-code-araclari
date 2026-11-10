---
name: my-skill-init
description: Use when starting or setting up a project for the my-skills workflow, or when another my-skill finds no .workflow/STATE.md or .workflow/PROJECT.md. Triggers: "init", "project start", "set up this project", "start a new project", "projeyi başlat", "proje kurulumu".
---

# Init

Create the project's workflow files and rules yourself, without sub-agents. Idempotent: a second run changes nothing. Ask one question only when the folder is not a git repo and holds several projects: which one.

Project root = `git rev-parse --show-toplevel`, else the current folder.

1. **Guard.** Run `git status --porcelain -- AGENTS.md CLAUDE.md .gitignore .workflow/STATE.md .workflow/PROJECT.md`. Each listed path holds uncommitted user changes; remember them for step 7.
2. **State.** `.workflow/STATE.md` missing: write it from my-skill-orchestrate's `state-template.md` with `Active skill: none`.
3. **Project.** `.workflow/PROJECT.md` missing: detect the stack and write the file per `references/stack-detect.md`. Present: leave it untouched.
4. **Rules.** In `AGENTS.md` (create if missing) replace the text between the markers with the block below; markers absent: append the block. Leave all text outside the markers as it is.
5. **CLAUDE.md.** Missing: create it containing `@AGENTS.md`. Present without that line: add it at the top.
6. **`.gitignore`.** Add each missing entry: `.workflow/research/`, `.workflow/dispatch/`, `.workflow/audit/`, `.workflow/runs/`, `.workflow/vet/`, `.workflow/persona/`, `.workflow/verify-app/`, `.workflow/plans/*/check-*.md`, `.worktrees/`. Replace any line that ignores the whole folder (`.workflow/`, `.workflow`, `/.workflow/`, `.workflow/*`) with these entries.
7. **Commit** (git repo, files changed): stage only the changed paths and commit with `chore: set up my-skills workflow files`, adding an attribution trailer only if this session supplied one. If a changed path was listed in step 1, commit nothing and say so.
8. **Report** in 3 lines: what changed plus the detected stack and pack; the commit sha or why there is none; next step (`my-skill-masterplan`). Guard hooks not installed: say so in one clause and install nothing.

## AGENTS.md block

```
<!-- my-skills:start -->
## Workflow rules (my-skills)
- Read `.workflow/STATE.md` and `.workflow/PROJECT.md` before starting work.
- When a step changes status or a decision is made, update `.workflow/STATE.md` in the same turn, before replying.
- A step is done only with evidence: a passing test or a commit.
- Bug fix: failing test first.
- Before debugging or planning, grep `.workflow/LEARNINGS.md`.
- Committed: `.workflow/STATE.md`, `PROJECT.md`, `LEARNINGS.md`, `HANDOFF.md`, `debug/*.md`, `plans/*/PLAN.md`, `PROMPT.md`, `PROGRESS.md`. Scratch is git-ignored.
- For multi-step work, follow the `my-skill-orchestrate` skill.
<!-- my-skills:end -->
```
