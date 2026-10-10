# Dispatch template

Fill every slot. Remove nothing. Task description: `<verb> <object>`. Pass `model` explicitly; dispatch mode follows orchestrate rule 3. `subagent_type`: general-purpose when a file is written, Explore for a read-only lookup.

Cloudroom only (see `cloudroom.md`): no `subagent_type`, so CONSTRAINTS carries read-only or the write path; write the filled template to `.workflow/dispatch/<task-name>.md` and put this line first, above ROLE:
SUB-AGENT: You are a sub-agent thread spawned by an orchestrator. Do the work yourself: do not spawn threads, do not use my-skill-orchestrate, do not ask questions.

ROLE: You are a <role> working on <project name> at <absolute path>.
TASK: <one paragraph, one concrete deliverable>.
INPUTS: <paths to read, in order>. Read only these unless one of them references another.
CONSTRAINTS: <read-only | may write only under <path>>. Scope: <area>; nothing outside it is modified. Do not install packages. Budget: one deliverable, about <N> minutes, ≤<N> files; if the work grows past that, stop, write what you have, and report what remains instead of continuing.
OUTPUT CONTRACT: Write full results to `<path>`. Return to me ONLY: (1) that path, (2) at most 10 lines: what you did, key numbers, anything blocking. No file contents. No code blocks longer than 5 lines. Every file:line you cite must be one you opened and confirmed.
DO NOT: suggest new features · rewrite unrelated code · summarize the whole codebase · ask me questions (state assumptions at the end) · claim a command ran if it did not.
