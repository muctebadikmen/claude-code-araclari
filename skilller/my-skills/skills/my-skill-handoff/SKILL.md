---
name: my-skill-handoff
description: Use when the user wants to stop the current chat and continue the same work in a new empty chat, when the context window is getting full, or when they say "handoff", "save progress", "continue in a new chat", "give me a prompt to continue", "yeni chat'e geç", "devam prompt'u ver", "ilerlemeyi kaydet".
---

# Handoff

A fresh chat resumes exactly here without re-asking anything.

REQUIRED SUB-SKILL: my-skill-orchestrate

Orchestrate rule 13 invokes this at a phase boundary when context is heavy. No 🛑, no questions (rule 12): run start to finish, ending with the resume prompt. STATE.md is a claim; git is evidence.

## Steps

1. **Reconcile.** Dispatch `Reconcile state vs reality` (Explore, `model: sonnet`). Inputs: `.workflow/STATE.md`, any active `PLAN.md`/`PROGRESS.md`, `git status --short`, `git log -15 --oneline`, `git log --merges --oneline` (ledger shas), `git worktree list`, `git stash list`, `git diff --stat`. Output contract, ≤15 lines: (a) tasks marked done whose sha is absent from `git log` or whose files show no matching change, (b) work in the tree but absent from STATE.md, (c) uncommitted paths, (d) every worktree with its branch. It runs no tests, reads no source; you inspect nothing (rule 1).
2. **Fix state.** Rewrite `.workflow/STATE.md` from the delta, keeping the headings `## Done`/`In progress`/`Remaining`/`Decisions`/`Gotchas`/`Files`. No ledger: Done = verification passed or commit exists, else In progress noting why; one section per task. Ledger (orchestrate's `progress-template.md`): merge commit → `[x]`, unmerged dispatch → `[~]` with note, `[!]` kept, one line each; `Progress:` count matches.
3. **Update plan.** Active PLAN.md: tick completed checkboxes, add a `Deviations:` line under each changed task.
4. **Write `.workflow/HANDOFF.md`** (never the repo root) from the template. Git repo: un-ignore per `my-skill-init`, commit it and STATE.md/PLAN.md/PROGRESS.md alone; never push.
5. **Print the resume prompt** filled from the template, in a code block, last in your reply. No table after it.

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

## Auto mode (otomatik-devir)

Trigger: args start with `auto <file>`. This replaces Steps 1–5; the template and resume prompt below still apply.

- No sub-agent, no question, no orchestrate dispatch. If the mod denies a tool call, continue without it.
- Reconcile yourself with read-only `git status --short`, `git log -10 --oneline` and `git worktree list` (skip outside git).
- If `.workflow/STATE.md` exists, update only its In progress/Remaining lines. No commit, no push.
- Write `<file>` (create dirs), in this order:
  1. First line: `# HANDOFF <ISO datetime> · <handoff id if the mod gave one>`.
  2. The HANDOFF template fields (Active skill … Verification status).
  3. `Yeniden çalıştır:` — each stopped agent: id, description, what to rerun. Omit if none.
  4. `Kullanıcının son mesajı:` — only if the mod gave one.
  5. Last, `## Resume prompt` as plain text starting "Continue the work: first read <file>.", followed by the filled resume prompt line.
- Reply with one line `Devir dosyası yazıldı: <file>`, then follow the mod's next instruction (start_session or end the turn).
