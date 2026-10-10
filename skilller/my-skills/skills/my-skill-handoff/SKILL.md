---
name: my-skill-handoff
description: Use when the user wants to stop the current chat and continue the same work in a new empty chat, when the context window is getting full, or when they say "handoff", "save progress", "continue in a new chat", "give me a prompt to continue", "yeni chat'e geç", "devam prompt'u ver", "ilerlemeyi kaydet".
---

# Handoff

A fresh chat resumes exactly here without re-asking anything.

REQUIRED SUB-SKILL: my-skill-orchestrate

Orchestrate rule 13 invokes this at a phase boundary when context is heavy, execute included. No 🛑, no questions (rule 12): run start to finish, ending with the resume prompt. STATE.md is a claim; git is evidence.

## Steps

1. **Reconcile.** Dispatch `Reconcile state vs reality` (Explore, read-only, `model: sonnet`). Inputs: `.workflow/STATE.md`, the active `PLAN.md` if any, `git status --short`, `git log -15 --oneline`, `git worktree list`, `git stash list`, `git diff --stat`. Output contract, ≤15 lines: (a) tasks marked done whose sha is absent from `git log` or whose files show no matching change, (b) work in the tree but absent from STATE.md, (c) uncommitted paths, (d) every worktree with its branch. It runs no tests, reads no source; you inspect nothing (rule 1).
2. **Fix state.** Rewrite `.workflow/STATE.md` from the delta, keeping the headings `## Done`, `## In progress`, `## Remaining`, `## Decisions`, `## Gotchas`, `## Files`. Done = verification passed or commit exists; otherwise In progress with a note why. Each task in one section only.
3. **Update plan.** If a PLAN.md is active, tick completed tasks and add a `Deviations:` line under each changed task.
4. **Write `.workflow/HANDOFF.md`** (never the repo root) from the template below. Git repo: un-ignore per `my-skill-init`, commit it, STATE.md and PLAN.md alone; never push.
5. **Print the resume prompt** filled from the template, in a code block, as the last thing in your reply. No status table after it.

## HANDOFF.md template

```
# HANDOFF <ISO datetime>
Active skill: <skill> · Phase: <phase> · Next task: <id>
Goal: <one line>
Done this session: <3–6 bullets, each with a commit sha or file path>
Not done / in progress: <bullets; include worktree paths with branch names and uncommitted paths>
Decisions already made (do NOT re-ask):
<copy of the STATE.md Decisions table>
Gotchas: <bullets>
Verification status: <last command run and its result, or "not run">
```

## Resume prompt (print verbatim, filled)

```
Continue the work in this repo. First read .workflow/HANDOFF.md and .workflow/STATE.md. Then invoke the `<skill>` skill and resume from <phase or task id>. The decisions listed there are final; do not re-ask them. Do not redo tasks marked done. Follow the my-skill-orchestrate skill (sub-agents, `model` set on each dispatch, parallel dispatch). <If skill is my-skill-execute: Run non-stop.>
```
