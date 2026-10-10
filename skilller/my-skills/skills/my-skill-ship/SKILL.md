---
name: my-skill-ship
description: Use when work is complete and the user wants it committed and pushed, or says "ship it", "ship", "commit and push", "push safely", "sync to GitHub", "gönder", "commit at", "push et", "GitHub'a yükle", "değişiklikleri gönder". Also right after execute finishes.
---

# Ship

Scan, test, commit, push the current branch. No secret value enters the main chat.

REQUIRED SUB-SKILL: my-skill-orchestrate

## Steps

1. **State.** Write `.workflow/STATE.md` from my-skill-orchestrate's state template, all six headings, `Active skill: my-skill-ship`. Gitignore scratch per `my-skill-init`, never all of `.workflow/`. Look only at `git status --short`, `git diff --stat`, `git log -5 --oneline`. Never read a content diff or grep for secrets yourself.
2. **Scan.** Send two Explore agents in one message, in parallel:
   - `Find sensitive files` (`model: haiku`): the globs in `references/secret-patterns.md`.
   - `Grep for hardcoded secrets` (`model: sonnet`): that file's regex table and exclusions.
   Each returns up to 10 lines of `path:line — <pattern name>`, or `clean`. Never any part of the value.
3. **Handle.**
   - Sensitive file: add it to `.gitignore`; if tracked, `git rm --cached <path>`. Just do it.
   - Secret in source: 🛑. Report `path:line — <pattern name>` and whether the file is committed or only modified (per `git status --short`). Tell the user to move it to an environment variable. Stop.
   - Nothing found: say `Scan clean`.
4. **Test.** Send a `Run verify` agent (`model: sonnet`). It runs the active PLAN.md's `Global verify`, else `npm test`, `python3 -m pytest -q`, `go test ./...`, `cargo test` or `swift test`. Never run tests yourself. Fail → 🛑 with the last 10 lines.
5. **Worktrees.** In `git worktree list`, merge and remove a finished execute worktree; leave and report an unfinished one.
6. **Commit.** Set STATE.md `Active skill: none`. Stage changed paths by name, including `.workflow/` PLAN.md, STATE.md, HANDOFF.md and plan files; never scratch folders. Never `git add .` or `-A`. Never stage a path a scan agent flagged. Imperative summary line; task ids in the body if a plan ran. Add an attribution trailer only if this session supplied one, verbatim. Never invent a model name.
7. **Push.** `git push -u origin <current branch>`.
   - No remote: say so and offer `gh repo create`. Don't run it.
   - Rejected: `git pull --rebase` once, rerun step 4, push.
   - Conflict: 🛑.
8. **Report.** Files, commit message, branch, remote URL.

## Rules

- Never print a secret or any piece of it.
- Never force-push. Never resolve a conflict.
- Never commit `.env`, keys or certificates, even "fake" ones.
- Never ask the user a question. A 🛑 ends in three lines: found, done, next.
