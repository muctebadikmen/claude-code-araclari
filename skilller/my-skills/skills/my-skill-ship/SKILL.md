---
name: my-skill-ship
description: Use when work is complete and the user wants it committed and pushed, or says "ship it", "ship", "commit and push", "push safely", "sync to GitHub", "gönder", "commit at", "push et", "GitHub'a yükle", "değişiklikleri gönder". Also right after execute finishes.
---

# Ship

Scan, verify, commit, push. Two forms: ship the current branch (default), or land a finished feature branch on main ("ship this branch to main", "main'e al"). No secret value ever enters the main chat; ship never asks the user anything.

REQUIRED SUB-SKILL: my-skill-orchestrate

## Steps

1. **State.** Write `.workflow/STATE.md` from orchestrate's state template, `Active skill: my-skill-ship`; gitignore scratch per `my-skill-init`. Look only at `git status --short`, `git diff --stat`, `git log -5 --oneline`; never read a content diff or grep for secrets yourself.
2. **Scan.** Two Explore agents in one message, following `references/secret-patterns.md`: `Find sensitive files` (`model: haiku`, the file globs) and `Grep for hardcoded secrets` (`model: sonnet`, the regexes; it also classifies hits that are plainly not secrets, without printing values). Each returns `path:line — <pattern name>` lines or `clean`, never any part of a value. For a branch-to-main ship, scan the whole branch diff against main.
3. **Handle.** Sensitive file: add to `.gitignore`, and `git rm --cached` if tracked. Secret in source: 🛑 with `path:line — <pattern name>`, whether the file is committed or only modified, and "move it to an environment variable". Nothing: say `Scan clean`.
4. **Verify.** The active PLAN.md's `Global verify`, else the project's own test command. A `Run verify` agent (`model: sonnet`) runs it; when the verify is a quick single command the orchestrator may run it itself. Failure: 🛑 with the last 10 lines.
5. **Worktrees.** Merge and remove a finished execute worktree; leave and report an unfinished one.
6. **Commit.** Set STATE.md `Active skill: none`. Stage by name the paths that belong to this work (including the `.workflow/` PLAN, STATE, HANDOFF and plan files); never scratch, never `git add .`/`-A`, never a path a scan flagged, and never the user's other uncommitted files: leave them as they are and list them in the report. Imperative summary line, task ids in the body if a plan ran, an attribution trailer only if this session supplied one, verbatim.
7. **Push.** `git push -u origin <branch>`. No remote: say so and offer `gh repo create`, don't run it. Rejected: `git pull --rebase=merges` once (keeps execute's merge commits), re-verify, push. Conflict: 🛑.
8. **Report.** Files, commit message, branch, remote URL, any untouched uncommitted files.

## Branch to main

Steps 1-6 run on the feature branch, so its work is committed there first. Then:

1. `git fetch origin main`. If `origin/main` is not an ancestor of the branch, merge it into the branch once (no rebase); on conflict `git merge --abort` and 🛑. Re-run step 4 if that merged anything.
2. Fast-forward main to the branch tip, history only, no merge commit, and without moving the user's checkout or touching their uncommitted files: if main is checked out in some worktree, `git -C <that worktree> merge --ff-only <branch>` (git refuses if uncommitted changes overlap: then 🛑, never stash or force); otherwise `git fetch . <branch>:main`.
3. `git push origin main`. Rejected: fetch and repeat from 1 once, then 🛑.
4. Report the new main sha. Don't delete the feature branch; mention it.

## Rules

- Never print a secret or any piece of it.
- Never force-push, never resolve a conflict, never stash or reset the user's files.
- Never commit `.env`, keys or certificates, even "fake" ones.
- A 🛑 ends in three lines: found, done, next.
