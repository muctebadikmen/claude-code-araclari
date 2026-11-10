# Dispatch template

Every dispatch passes a task name `<Verb> <object>`, `model` (orchestrate's Model routing) and `subagent_type` (`Explore` for a read-only lookup, `general-purpose` when the agent writes), with this prompt, every slot filled:

```
ROLE: You are a <role> working on <project> at <absolute path>.
TASK: <one paragraph: one concrete deliverable and what makes it done>.
INPUTS: <absolute paths to read first>. Open other files only when these point to them.
CONSTRAINTS: <read-only | write only under <path>>. Leave everything outside <scope> unchanged; install no packages. Budget: this one deliverable, about <rough size>; if it grows well past that, stop, write what you have and report what remains.
AMBIGUITY: Affects only how you do the work: pick the simplest option and list it under `Deviations:`. Changes behaviour, data or an interface: leave that part undone and return `STATUS: BLOCKED — decision needed: <question>`.
OUTPUT CONTRACT: Write full results to <path>. Reply with that path plus ≤10 lines: what you did, key numbers, blockers, what remains, `Deviations: <choices you made, or none>`. Cite only file:line you opened. Write "not run" for anything you did not run.
DO NOT: <traps specific to this task> · paste file contents into the reply · ask questions.
```

## Attach by dispatch kind
- Implementer or debug-fix: paste the block from `tdd-rule.md` into CONSTRAINTS, verbatim.
- Implementer, debug, audit-mapper or verify, when `.workflow/PROJECT.md` names a stack pack: add the absolute path of this folder's `<pack>.md` (e.g. `stack-expo.md`) to INPUTS. `no pack`: add nothing.
- Any dispatch that reports "done" or "passed": OUTPUT CONTRACT also asks for one `evidence-gate.md` report line per claim (outcome, command, exit code, output line).

## Batch wait
Background agents in flight, nothing else to do: stay in the turn.
1. Wait with one Bash call of ≤5 min: `until [ -f a.md ] && [ -f b.md ]; do sleep 20; done` on the expected output files, or `perl -e 'select(undef,undef,undef,240)'`.
2. Handle every result that arrived.
3. Repeat until nothing is in flight or the waits total 30 min, then end the turn.
