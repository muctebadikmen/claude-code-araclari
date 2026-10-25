---
name: my-skill-orchestrate
description: Use when the main chat is about to do multi-step codebase work (analysis, research, planning, implementation, review) or dispatch any sub-agent. Triggers: "orchestrate", "use sub-agents", "keep context clean", "delegate", "alt ajan kullan", "context'i temiz tut", "paralel çalış". Required by my-skill-audit, my-skill-research, my-skill-masterplan, my-skill-execute, my-skill-handoff, my-skill-ship.
---

# Orchestrate

The main chat decides, dispatches, relays and keeps state; sub-agents do the work. In Cloudroom (`ROOM_THREAD_ID` set), follow `references/cloudroom.md` for dispatches, resumes and questions.

## Rules

- **Delegate heavy work.** Reading code, searching, analysing, implementing, testing and reviewing are sub-agent work. The orchestrator reads its own state and plan files and may check something itself when it takes a handful of tool calls; anything bigger is a dispatch.
- **Right-size, then parallelise.** One agent per independent part or question group, all sent in one message; none for a part the project lacks. Foreground batch when the next step needs every result; background when each result is acted on alone (implement → review → merge).
- **One deliverable per dispatch**, small enough to finish in one sitting. An agent that outgrows it stops, writes what it has and reports what remains; re-dispatch the rest on the same model with that report. Resume an agent only to answer its question or hand it review findings. Fill `references/dispatch-template.md`.
- **Summaries, not dumps.** Heavy output goes to a `.workflow/` file; the agent returns the path plus ≤10 lines.
- **Caps are hard.** A cap a skill declares (rounds, retries, agents) is exceeded only after a 🛑 where the user chooses. Scope open-ended work in a few lines first, smallest useful version first.
- **State.** Read `.workflow/STATE.md` first (none: `my-skill-init`); write it from `references/state-template.md` before the first dispatch, at every 🛑 and after every phase. STATE/PLAN/PROGRESS/HANDOFF.md are committed; scratch is not.
- **Honesty.** Report only what a sub-agent verified; "not run" is valid. Before telling the user to act outside the repo (portal, console), dispatch a diagnosis.
- **Stop points (🛑).** Write STATE.md, report found / done / next in three lines, wait. Non-stop skills (execute) skip the wait.
- **Questions policy.** Research and masterplan ask whatever they need: AskUserQuestion, ≤4 per call, more calls allowed, recommended option first, marked "(Recommended)". Execute, ship and handoff never ask.
- **Long-chat handoff.** With heavy context (≈300K tokens, or after a compaction), finish the phase, invoke `my-skill-handoff`, continue in a new chat. Non-stop skills included.
- **Overload fallback.** An agent dying with a 529/5xx is re-dispatched once; a second failure switches it to the other of sonnet/opus, noted in STATE.md.

## Model routing

The only place routing is defined. Pass `model` on every dispatch.

- **sonnet**, the default for delegated work: reading, mapping, research, implementing a planned task, tests, reviews, verification.
- **opus** only where its extra judgment pays for itself: (1) drafting a plan or design, or synthesising conflicting findings the rest depends on; (2) work where a mistake could still pass the tests: concurrency, persistence/migrations, security, numeric or scheduling logic, cross-module contracts; (3) escalation: a sonnet task failed review twice, or is blocked by something inside its own scope → re-dispatch on opus with its report.
- **haiku**: mechanical work only (listing, counting, running one fixed command and reporting).
- **fable**: only when the user asks (`--fable` or in words).

In doubt: sonnet; escalation makes a wrong guess cheap. A project file (e.g. `.workflow/.../MODEL-ROUTING.md`) may name project-specific opus areas; it overrides this default.
