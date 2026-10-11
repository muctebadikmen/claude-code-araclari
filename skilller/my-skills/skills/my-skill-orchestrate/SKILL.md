---
name: my-skill-orchestrate
description: Use when the main chat is about to do multi-step codebase work (analysis, research, planning, implementation, review) or dispatch any sub-agent. Triggers: "orchestrate", "use sub-agents", "keep context clean", "delegate", "alt ajan kullan", "context'i temiz tut", "paralel çalış". Required by my-skill-audit, my-skill-research, my-skill-masterplan, my-skill-execute, my-skill-handoff, my-skill-ship.
---

# Orchestrate

The main chat decides, dispatches, relays, keeps state; sub-agents do the work.

In Cloudroom (`CLOUDROOM_WORKLOAD` or `ROOM_THREAD_ID` set), dispatches, resumes and questions follow `references/cloudroom.md`.

## Rules

1. **Delegate.** Reading, searching, analysing, implementing, testing, reviewing are sub-agent work. The orchestrator reads only its own state and plan files, plus one known file for one fact.
2. **Right-size, then parallelise.** One agent per independent part or question group, dispatched together, never in sequence. No agent for a part the project lacks.
3. **Dispatch mode.** Foreground batch (all Agent calls in one message, `run_in_background: false`) when the next step needs every result (lanes → synthesis, collect → verify, check rounds). Background (`run_in_background: true`) when each return is acted on alone as it arrives (implement → review → merge).
4. **One deliverable per dispatch**, about 20 minutes and ≤15 files. An agent at its budget stops, writes what it has and reports what remains; the orchestrator re-dispatches the rest, on opus if the agent was sonnet. Resume (SendMessage) only to answer a question or apply review findings. Every dispatch fills all six slots of `references/dispatch-template.md`.
5. **Summaries, not dumps.** Heavy output goes to a `.workflow/` file; the agent returns the path plus ≤10 lines.
6. **Caps are hard.** A cap a skill declares (rounds, retries, agents) is exceeded only after a 🛑 where the user chooses. Open-ended work is scoped in ≤6 lines before the first dispatch, smallest version first.
7. **Model routing.** Pass `model` on every dispatch; table below. In doubt between sonnet and opus: opus.
8. **Overload fallback.** An agent dying with a 529/5xx is re-dispatched once; a second failure drops a model (opus → sonnet), noted in STATE.md.
9. **Task name = `verb object`**, e.g. `Verify auth findings`; model travels in `model`, not the name.
10. **State.** Read `.workflow/STATE.md` first (none: `my-skill-init`); write it from `references/state-template.md` before the first dispatch, at every 🛑, after every phase. Commit STATE.md/PLAN.md/PROGRESS.md/HANDOFF.md, never scratch.
11. **🛑 means stop.** Write STATE.md, report done/next in 3 lines, wait. Non-stop skills (execute) skip the wait.
12. **Questions.** Research and masterplan ask whatever they need: AskUserQuestion, ≤4 per call, more calls allowed, recommended first, marked "(Recommended)". Execute, ship and handoff never ask.
13. **Long chats.** With heavy context (≈300K tokens or after compaction), finish the phase, invoke `my-skill-handoff`, continue in a new chat. Non-stop skills included.
14. **Honesty.** Report only what a sub-agent verified; "not run" is valid. Before telling the user to act outside the repo (portal, console), dispatch a diagnosis.

## Model routing

| Model | Use for |
|---|---|
| haiku | listing, grep sweeps, counting, format-only edits |
| sonnet | mapping one module, web research, bounded implementation, small reviews |
| opus | cross-cutting analysis, verification, synthesis, plan drafting and checking, implementation spanning modules or UI/widget tests, reviews of opus tasks or >2 files, merge conflicts |
| fable | opt-in only: the user's message asks or contains `--fable` |

## Red flags

| Thought | Do instead |
|---|---|
| "This cap is unreasonable" | 🛑, user chooses (rule 6) |
| "I'll wait for the batch" | Background, act per return (rule 3) |
| "One more phase fits here" | Handoff now (rule 13) |
| "The portal needs a manual step" | Diagnose first (rule 14) |
