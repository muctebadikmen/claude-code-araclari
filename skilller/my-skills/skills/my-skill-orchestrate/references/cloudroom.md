# Running inside Cloudroom

Cloudroom hides native sub-agents (Agent tool, SendMessage), so never use them there. Every orchestrate rule still holds; only the primitive changes.

## Detect the runtime

- `ROOM_THREAD_ID` set → Cloudroom thread: Cloud if `CLOUDROOM_WORKLOAD` is also set, else Local.
- Unset → plain Claude Code: ignore this file.

The CLI is `room-cli` in both; use the legacy `cloudroom` name only if `room-cli` is missing.

## Model ids (the one place they are mapped)

| Skill name | Model id |
|---|---|
| haiku | `claude-haiku-5-5` |
| sonnet | `claude-sonnet-5-5` |
| opus | `claude-opus-5-5` |
| fable | `claude-fable-5-1`, opt-in only (orchestrate's model routing) |

## Primitive mapping

| Claude Code | Cloudroom |
|---|---|
| Agent dispatch | Write the filled dispatch template to `.workflow/dispatch/<task-name>.md`, spawn it (below), keep the returned thread `id` in STATE.md. |
| `model` | `--model <id>` from the table above, always passed. |
| Task description | `--title "<Verb object>"`. |
| `subagent_type` | None: CONSTRAINTS says `read-only` or names where it may write. |
| Background | Spawn and keep orchestrating; act on each completion message as it arrives. |
| Foreground batch | Spawn every thread of the batch, then end your turn (or do orchestrator-only work) until each has reported. Never poll (`room-cli thread wait` exists; don't use it). |
| SendMessage / resume | `room-cli thread tell <id> "<text>"` (Cloud queues it); only to answer a question or hand over review findings. |
| Agent result | Arrives as a message with the child's final reply. Full text: `room-cli thread output <id>`. |
| Overload fallback | A child that errors or finishes without its output (own-sandbox Cloud child: no pushed branch or results in its reply): `room-cli thread stop <id>`, spawn a fresh one once; a second failure switches model. |
| AskUserQuestion | Use it as usual; Cloudroom shows a question card. If the tool is missing: plain chat, ≤4 numbered questions with lettered options, recommended first and marked "(Recommended)", then end the turn and wait. |
| Worktrees | Unchanged when the child shares your folder; give the absolute worktree path in ROLE. |
| TodoWrite / TaskCreate | Unchanged for the orchestrator's own list; STATE.md stays the source of truth. |

## Spawn command

Same for Local and Cloud (there is no `--prompt-file`):

```bash
room-cli thread spawn --parent-self --project "$ROOM_PROJECT_ID" --provider claude-code \
  --model claude-sonnet-5-5 --title "Verify auth findings" --json \
  --prompt "$(cat .workflow/dispatch/verify-auth-findings.md)"
```

Prints JSON with `id`. Also: `room-cli thread output <id> | tell <id> TEXT | stop <id> | list --parent-thread <id>`.

- Local: add `--environment "$ROOM_ENVIRONMENT_ID"` so the child works in your folder.
- Cloud: a child gets its own sandbox with a copy of your code (commits and uncommitted changes) on its own branch. Add `--shared-sandbox` when it writes shared `.workflow/` files or code in place (the usual case). Without it the child cannot write your files, so its OUTPUT CONTRACT says commit and push, or return the results in its reply.

## The sub-agent line

Children inherit `~/.claude/CLAUDE.md`, which tells them to orchestrate, so every Cloudroom dispatch starts with this line above ROLE:

> SUB-AGENT: You are a sub-agent thread spawned by an orchestrator. Do the work yourself: do not spawn threads, do not use my-skill-orchestrate, do not ask questions.

Drop "do not spawn threads" only when the dispatch explicitly allows children. Background tasks inside a child are fine.
