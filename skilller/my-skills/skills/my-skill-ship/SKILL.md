---
name: my-skill-ship
description: Use when work is complete and the user wants it committed and pushed, or says "ship it", "ship", "commit and push", "push safely", "sync to GitHub", "gönder", "commit at", "push et", "GitHub'a yükle", "değişiklikleri gönder". Also right after execute finishes.
---

# Ship

Scan, verify, commit, push. Never ask the user; a 🛑 is found, done, next in three lines, then stop.

REQUIRED SUB-SKILL: my-skill-orchestrate

"Ship this branch to main" / "main'e al": after step 7, follow `references/branch-to-main.md`.

## Steps

1. **State.** Write `.workflow/STATE.md` (`Active skill: my-skill-ship`). Read only `git status --short`, `git diff --stat`, `git log -5 --oneline`.
2. **Scan.** One `Run secret gate` agent (`model: haiku`): run `bash <absolute path of this skill>/scripts/secret-gate.sh` and return its output verbatim.
3. **Handle** every gate line (formats: `references/secret-patterns.md`), then stop on any 🛑:
   - `commit <sha> …`: 🛑 with that file's commit-hit message.
   - `<path> — sensitive file`: `.gitignore` it; `git rm --cached` if tracked.
   - `path:line — <name>`: 🛑 with that line; "move it to an environment variable".
   - `fallback:` line: mention only.
   - `GATE: clean`: report `Scan clean`. `GATE: error`: 🛑 with that line.
4. **Verify.** Read `Full suite: <PASS|FAIL> @ <sha>` under STATE.md `## Done`. PASS and `git diff --quiet <sha> HEAD -- . ':!.workflow'` succeeds (no code change since): skip the suite. Otherwise run it once (the plan's `Global verify`, else the project test command; `model: sonnet` agent unless quick). Failure: 🛑, last 10 lines.
   Read `Verify-app: <OUTCOME> — <path>` under `## Done`; never rerun it. NOT_VERIFIED: 🛑. MANUAL_VERIFY_REQUIRED: continue; report first.
5. **Worktrees.** Merge and remove finished execute worktrees; report the rest.
6. **Learn.** Prune `.workflow/LEARNINGS.md` first, then append at most one entry for a lasting lesson in STATE `## Gotchas` (orchestrate's `learnings.md`).
7. **Commit.** Set `Active skill: none`. Stage by name (never `git add .` or `-A`): this work's paths plus the existing `.workflow/` PLAN, STATE, HANDOFF, PROGRESS, PROMPT, PROJECT and LEARNINGS files. Leave out scratch, flagged paths and other uncommitted files. Message: imperative subject, task ids in body, the supplied attribution trailer.
8. **Push.** `git push -u origin <branch>`.
   - Detached HEAD: push `HEAD:refs/heads/<name>` if one was named, else 🛑.
   - No remote: offer `gh repo create`; the user runs it.
   - Rejected: `git pull --rebase=merges` once, re-verify, push. Conflict: 🛑.
9. **Report.** Verify-app outcome first, then files, commit message, branch, remote URL, untouched uncommitted files.

## Rules

- Name a secret only as `path:line — <name>`; no part of its value appears anywhere.
- Never commit `.env`, keys or certificates, even "fake" ones.
- Never force-push, rewrite history, resolve a conflict, stash or reset.
