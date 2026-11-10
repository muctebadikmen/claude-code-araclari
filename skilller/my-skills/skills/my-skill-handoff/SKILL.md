---
name: my-skill-handoff
description: Use when the user wants to stop the current chat and continue the same work in a new empty chat, when the context window is getting full, or when they say "handoff", "save progress", "continue in a new chat", "give me a prompt to continue", "yeni chat'e geç", "devam prompt'u ver", "ilerlemeyi kaydet".
---

# Handoff

Save the work so a fresh chat resumes exactly here without re-asking anything.

REQUIRED SUB-SKILL: my-skill-orchestrate

Run on request, or when a message gives a target path for the continuation prompt ("Context handoff point reached"). No 🛑, no questions: run start to finish. STATE.md is a claim; git is evidence.

## Steps

1. **Reconcile.** Dispatch the agent in `references/reconcile.md`; it does all the inspecting.
2. **Fix state.** Rewrite `.workflow/STATE.md` from the agent's delta, keeping its headings.
   - No ledger: Done = verification passed or a commit exists; otherwise In progress with the reason.
   - Ledger plan (orchestrate's `progress-template.md`): in PROGRESS.md set merge commit → `[x]`, unmerged dispatch → `[~]` with a note, keep `[!]`; make STATE's `Progress:` count match.
3. **Update plan.** Add `Deviations:` to each changed task's PROGRESS.md line.
4. **Write `.workflow/HANDOFF.md`** from the template (never in the repo root).
5. **Commit** (git repo). Make sure HANDOFF.md is not ignored (init's `.gitignore` rule). Commit only HANDOFF.md, STATE.md, the not-ignored files STATE.md `## Files` lists (plan, PROGRESS, debug file) and a changed `.gitignore`. Do not push.
6. **Target path given:** write the filled resume prompt to exactly that path, self-contained: the plan/STATE/PROGRESS paths, the next step, agents and worktrees still in flight, and "continue non-stop". The mod then compacts this chat and submits that file itself.
7. **Print the resume prompt**, filled, in a code block, last in the reply; end the turn.

## HANDOFF.md template

```
# HANDOFF <ISO datetime>
Active skill: <skill> · Phase: <phase> · Next task: <id>
Goal: <one line>
Done this session: <3–6 bullets, each with a commit sha or file path>
Not done / in progress: <bullets; include worktree paths with branch names and uncommitted paths>
Decisions already made (final, do NOT re-ask):
<copy of the STATE.md Decisions rows>
Gotchas: <bullets>
Verification status: <last command run and its result, or "not run">
```

## Resume prompt

```
Continue the work in this repo. First read .workflow/HANDOFF.md and .workflow/STATE.md. Then invoke the `<skill>` skill and resume from <phase or task id>. The decisions in STATE.md are final; do not re-ask them. Do not redo tasks marked done. Follow the my-skill-orchestrate skill. <If skill is my-skill-execute: Run non-stop.>
```
