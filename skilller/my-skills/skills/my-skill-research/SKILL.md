---
name: my-skill-research
description: Use when the user asks how to implement a feature or change, which approach or library is best, or the most efficient way to build something in this project. Triggers: "research", "how should we implement", "best way to", "which library", "compare approaches", "araştır", "nasıl yaparız", "en iyi yöntem", "hangi kütüphane". Flags: --code-only, --web-only.
---

# Research

One recommendation for "how should we build X here?" from codebase and web evidence. `my-skill-masterplan` consumes it.

REQUIRED SUB-SKILL: my-skill-orchestrate — read it first; it governs dispatch, model routing (pass `model` explicitly) and `.workflow/STATE.md`.

The orchestrator frames, dispatches and presents; lanes read the source and search the web. Needing context first is not a reason to read code yourself. The deliverable is the file, not the chat reply.

Input: the feature in the user's words. `--code-only` skips the web lane; `--web-only` skips the code lane.

## Phases

### 1. Frame
Write `.workflow/STATE.md`, then `.workflow/research/<slug>.md`: the feature in ≤3 lines and 3–6 questions, from the user's words alone.
Ask the user whatever is unclear before the lanes run — scope, platform, a constraint, which of two readings is meant. Ask per orchestrate's questions policy (AskUserQuestion; if missing, plain chat). Show the questions and wait; if the user's message already answered them, continue.

### 2. Lanes
One foreground batch: one agent per question group per lane, both lanes together, all `sonnet`.
- Code lane (read-only except its output): how the project would accommodate the feature. Existing patterns for the same kind of work, where new code plugs in, constraints (language and framework versions from config and lockfiles, test framework and command, data model), what existing behaviour would change or break. Every answer cites repo-relative `path:line` it opened. Writes `.workflow/research/lane-code-<n>.md` with a final `## Constraints` list. Does not recommend libraries or design; does not read the web lane.
- Web lane (WebSearch, WebFetch): current best practice for the feature in the project's language and framework version (or per major version if unknown). Per candidate: name, version, last release date, license, maintenance signal, official doc URL, known pitfalls, performance. Primary sources first; a blog only when nothing primary exists, and say so. Every claim carries a URL and access date `YYYY-MM-DD`; anything it could not open is marked "unverified". Never invent versions or dates; flag unmaintained libraries. Does not read project code. Writes `.workflow/research/lane-web-<n>.md` with a `## Sources` list.

Agents state assumptions in their file instead of asking, and return the path plus a few lines; never open lane files yourself.

### 3. Synthesize
One `opus` agent reads only the lane files and rewrites `<slug>.md` with exactly these sections, in order: `## Recommendation` (one approach, why), `## Alternatives` (1–2, trade-off table), `## Integration points` (`path:line → change`, one per line, repo-relative), `## Risks`, `## Open questions`, `## Effort` (S/M/L per part), `## Sources` (`URL — accessed YYYY-MM-DD`, copied from the lanes). Opus because the recommendation decides the whole plan and the lanes may disagree; if they plainly agree on one obvious approach, sonnet is enough.
Check every web recommendation against the versions in the code lane's `## Constraints`; a web claim that contradicts the code goes in Risks, never dropped. It returns the path, the one-line recommendation, the alternatives table and the open questions.

### 4. Present
Print the recommendation, alternatives and open questions, and ask the user the decisions only they can answer (same question format as Frame). Update STATE.md. Offer: "Next: `my-skill-masterplan` with this research." A follow-up to build or demo it is open-ended work: scope it first per orchestrate.
