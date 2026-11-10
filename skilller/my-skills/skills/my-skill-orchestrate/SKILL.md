---
name: my-skill-orchestrate
description: Use when the main chat is about to do multi-step codebase work (analysis, research, planning, implementation, review) or dispatch any sub-agent. Triggers: "orchestrate", "use sub-agents", "keep context clean", "delegate", "alt ajan kullan", "context'i temiz tut", "paralel çalış". Required by every other my-skill except my-skill-init.
---

# Orchestrate

You are the orchestrator: decide, dispatch, relay results, keep state. Sub-agents read code, search, analyse, implement, test and review.

## State

1. Read `.workflow/STATE.md` and `.workflow/PROJECT.md` (commands, stack pack). Missing: run `my-skill-init`.
2. Write STATE.md from `references/state-template.md` before the first dispatch, at every 🛑 and after every phase.

## Dispatch

- **Delegate** everything beyond your state and plan files; a check needing more than a few tool calls is a dispatch.
- **Prompt.** Fill `references/dispatch-template.md` and pass `model` (Model routing) on every dispatch.
- **Size.** One deliverable per dispatch, finishable in one sitting. An agent that outgrows it reports what remains; dispatch the remainder on the same model. Resume an agent only to answer its question or hand it review findings.
- **Parallel.** Dispatch every independent part at once, in one message, with no fixed agent cap. Limit only by dependencies, and by machine capacity for heavy local work (simulators, emulators, builds): batch those to fit the machine and queue the rest. Never reduce the requested amount of work. Foreground when the next step needs every result, else background. With agents in flight and nothing else to do, wait inside the turn (dispatch-template, Batch wait).
- **Returns.** Heavy output goes to a `.workflow/` file; the agent returns its path plus ≤10 lines.
- **Caps are hard.** Exceed a declared cap (rounds, retries, batch size) only after a 🛑 where the user chooses. Open-ended work: smallest useful version first.
- **Evidence.** A sub-agent's "passed" is a claim until a reviewer or you saw the command output; "not run" is a valid report (`references/evidence-gate.md`).

## User

- **Stop point (🛑).** Write STATE.md, report found / done / next in three lines, wait. Non-stop skills (execute) skip the wait.
- **Questions.** Agents look up facts and follow dispatch-template's ambiguity rule; ask the user only for decisions: AskUserQuestion, ≤4 per call, recommended answer first, marked "(Recommended)" and worded so "yes" accepts it. Execute, ship and handoff ask nothing.
- **Portals.** Before sending the user to a portal or console, dispatch a diagnosis.
- **Handoff.** On "Context handoff point reached": start nothing new, let running agents finish, run `my-skill-handoff` with the given path, end the turn. Otherwise run it only when the user asks.

## Model routing

Routing is defined only here; a skill may name a cheaper model for its small mode.

- **sonnet** (default, and when in doubt: escalation corrects a wrong guess): reading, mapping, research, implementing a planned task, tests, reviews, verification.
- **opus**: (1) drafting a plan or design, or synthesising conflicting findings; (2) work where a mistake could pass the tests: concurrency, migrations, security, numeric or scheduling logic, cross-module contracts; (3) escalation: a sonnet task that failed review twice or is blocked inside its own scope goes to opus with its report.
- **haiku**: mechanical work only (listing, counting, running one fixed command).
- **fable**: opt-in only, when the user asks (`--fable` or in words).
- **Agent died on 529/5xx:** re-dispatch once on the same model; on a second death switch sonnet↔opus and note it in STATE.md.
- A project `.workflow/MODEL-ROUTING.md` may name extra opus areas; it overrides this list.

## Shared references

`references/evidence-gate.md`, `references/tdd-rule.md`, `references/learnings.md`, `references/progress-template.md`. Stack packs, only the one PROJECT.md names: `references/stack-expo.md`, `references/stack-flutter.md`, `references/stack-android.md`.
