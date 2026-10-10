# Running inside Cloudroom

Cloudroom forbids native sub-agents (Agent tool, SendMessage) and AskUserQuestion. Every orchestrate rule still holds; only the primitive changes.

## Detect the runtime

1. `CLOUDROOM_WORKLOAD` set → Cloud thread, CLI `cloudroom`. Children run in the same sandbox and folder.
2. Else `ROOM_THREAD_ID` set → Local thread, CLI `room-cli` (check `room-cli thread spawn --help`).
3. Else → plain Claude Code: ignore this file.

## Model ids (the one place they are mapped)

| Skill name | Model id |
|---|---|
| haiku | `claude-haiku-5-5` |
| sonnet | `claude-sonnet-5-5` |
| opus | `claude-opus-5-5` |
| fable | `claude-fable-5-1`, opt-in only (orchestrate model routing) |

## Primitive mapping

| Claude Code | Cloudroom |
|---|---|
| Agent dispatch | Write the filled dispatch template to `.workflow/dispatch/<task-name>.md`, then spawn (commands below). Keep the returned thread `id` in STATE.md. |
| `model` | `--model <id>` from the table above, always passed. |
| Task description | `--title "<Verb object>"`. |
| `subagent_type` | None. Explore/read-only → CONSTRAINTS says `read-only`; general-purpose → CONSTRAINTS names where it may write. |
| `run_in_background: true` | Spawn and keep orchestrating; act on each completion message as it arrives. |
| Foreground batch (`run_in_background: false`) | Spawn every thread of the batch, then end your turn (or do orchestrator-only work) until a completion message has arrived for each one. Never poll. |
| SendMessage / resume | `cloudroom thread tell <id> "<text>"` (`room-cli thread tell <id> "<text>"`). Same rule: only to answer a question or apply review findings. |
| Agent result | Arrives automatically as `[Cloudroom] Child thread … completed: <final reply>`. Full text: `cloudroom thread output <id>`. |
| 529/5xx re-dispatch (rule 8) | A child that errors or completes without its output file: `cloudroom thread stop <id>`, spawn a fresh one once; a second failure drops a model. |
| AskUserQuestion | Plain chat: ≤4 numbered questions, each with lettered options, recommended first and marked "(Recommended)". Then end the turn and wait for the reply. |
| Worktrees | Unchanged; children share the filesystem. Give the absolute worktree path in ROLE. |
| TodoWrite / TaskCreate | Unchanged for the orchestrator's own list; STATE.md stays the source of truth. |

## Spawn commands

Cloud thread:

```bash
cloudroom thread spawn --provider claude-code --model claude-opus-5-5 \
  --title "Verify auth findings" --prompt-file .workflow/dispatch/verify-auth-findings.md
```

Prints JSON with `id`. Other commands: `cloudroom thread list | output <id> | tell <id> TEXT | stop <id>`.

Local thread (room-cli has no `--prompt-file`):

```bash
room-cli thread spawn --parent-self --project "$ROOM_PROJECT_ID" --provider claude-code \
  --model claude-opus-5-5 --title "Verify auth findings" --json \
  --prompt "$(cat .workflow/dispatch/verify-auth-findings.md)"
```

If the child must share your folder and lands in another environment, add `--environment <your workspace path or environment id>`.

## The sub-agent line

Children inherit `~/.claude/CLAUDE.md`, which tells them to orchestrate. Every Cloudroom dispatch therefore starts with this line, above ROLE (also in `dispatch-template.md`):

> SUB-AGENT: You are a sub-agent thread spawned by an orchestrator. Do the work yourself: do not spawn threads, do not use my-skill-orchestrate, do not ask questions.

Drop "do not spawn threads" only when the dispatch explicitly allows children. Background tasks inside a child are fine.
