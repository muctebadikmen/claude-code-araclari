---
name: my-skill-handoff
description: Use when the user wants to stop the current chat and continue the same work in a new empty chat, when the context window is getting full, or when they say "handoff", "save progress", "continue in a new chat", "give me a prompt to continue", "yeni chat'e geç", "devam prompt'u ver", "ilerlemeyi kaydet".
---

# Handoff

A fresh chat resumes exactly here without re-asking anything.

REQUIRED SUB-SKILL: my-skill-orchestrate

Used when the user asks for a new chat; long chats otherwise rely on auto-compaction. No 🛑, no questions: run start to finish, ending with the resume prompt. STATE.md is a claim; git is evidence.

## Steps

1. **Reconcile.** Dispatch `Reconcile state vs reality` (Explore, `model: sonnet`) over `.workflow/STATE.md`, any active `PLAN.md`/`PROGRESS.md`, `git status --short`, `git log -15 --oneline`, `git log --merges --oneline`, `git worktree list`, `git stash list`, `git diff --stat`. It reads no source and runs no tests; you inspect nothing yourself. It returns ≤15 lines: (a) tasks marked done whose sha is not in `git log` or whose files show no matching change, (b) work in the tree absent from STATE.md, (c) uncommitted paths, (d) every worktree with its branch.
2. **Fix state.** Rewrite `.workflow/STATE.md` from the delta, keeping its headings. No ledger: Done means verification passed or a commit exists, otherwise In progress with the reason. Ledger plan (orchestrate's progress template): merge commit → `[x]`, unmerged dispatch → `[~]` with a note, `[!]` kept, and the `Progress:` count matches.
3. **Update plan.** Checkbox plan: tick done boxes. Ledger plan: PROGRESS.md. Add `Deviations:` per changed task.
4. **Write `.workflow/HANDOFF.md`** (never the repo root) from the template. In a git repo make sure it is not ignored (init's `.gitignore` rule), commit it with STATE.md/PLAN.md/PROGRESS.md and nothing else, never push.
5. **Print the resume prompt**, filled, in a code block, last in the reply. No table after it.

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

## Resume prompt

```
Continue the work in this repo. First read .workflow/HANDOFF.md and .workflow/STATE.md. Then invoke the `<skill>` skill and resume from <phase or task id>. The decisions listed there are final; do not re-ask them. Do not redo tasks marked done. Follow the my-skill-orchestrate skill. <If skill is my-skill-execute: Run non-stop.>
```
