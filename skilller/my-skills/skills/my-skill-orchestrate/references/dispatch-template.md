# Dispatch template

Task name `<verb> <object>`; `model` per orchestrate's model routing; `subagent_type` Explore for a read-only lookup, general-purpose when it writes a file. Fill all six slots. Cloudroom: no `subagent_type`, and the SUB-AGENT line goes above ROLE (`cloudroom.md`).

```
ROLE: You are a <role> working on <project> at <absolute path>.
TASK: <one paragraph, one concrete deliverable>.
INPUTS: <paths to read first>. Open others only when these point to them.
CONSTRAINTS: <read-only | may write only under <path>>. Nothing outside <scope> changes; no package installs. Budget: this one deliverable; if it grows well past <rough size>, stop, write what you have and report what remains.
OUTPUT CONTRACT: Write full results to <path>. Return ONLY that path plus ≤10 lines: what you did, key numbers, blockers. No file contents. Cite only file:line you opened. Say "not run" for anything you did not run.
DO NOT: <traps specific to this task> · ask me questions (state assumptions at the end).
```
