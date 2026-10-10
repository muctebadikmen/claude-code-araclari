---
name: my-skill-research
description: Use when the user asks how to implement a feature or change, which approach or library is best, or the most efficient way to build something in this project. Triggers: "research", "how should we implement", "best way to", "which library", "compare approaches", "araştır", "nasıl yaparız", "en iyi yöntem", "hangi kütüphane". Flags: --code-only, --web-only.
---

# Research

One recommendation for "how should we build X here?" from codebase and web evidence; `my-skill-masterplan` consumes it.

REQUIRED SUB-SKILL: my-skill-orchestrate

The orchestrator frames, dispatches, presents; lanes read source and search the web (rule 1). "I need context first" is not an exception. The deliverable is the file, not the chat reply.

## Inputs
The feature in the user's words. `--code-only` skips the web lane; `--web-only` skips the code lane.

## Phases

### 1. Frame
Orchestrator writes only; reads STATE.md and `references/lane-prompts.md`. Write `.workflow/STATE.md` with the state-template headings (`## Done`, `## In progress`, `## Remaining`, `## Decisions`, `## Gotchas`, `## Files`; rule 10), then `.workflow/research/<slug>.md`: the feature in ≤3 lines and 3–6 questions, from the user's words alone.
Anything unclear — scope, platform, a constraint, which of two readings is meant — is asked before the lanes (rule 12): AskUserQuestion (Cloudroom: plain chat), ≤4 per call, more calls allowed, recommended option first, marked "(Recommended)".
🛑 Show the questions. If the user's message already answered them, continue without waiting.

### 2. Lanes (every agent in ONE message, `run_in_background: false`, rule 3)
One general-purpose agent per question group, 1–4 per lane (rule 2); both lanes dispatched together.
- Codebase lane, `model: sonnet`: existing patterns, integration points with exact paths, constraints (language and framework versions from config and lockfiles, tests, data model), what would break. Writes `.workflow/research/lane-code-<n>.md`.
- Web lane, `model: sonnet` (WebSearch, WebFetch): approaches, candidate libraries (version, release date, license, maintenance), official docs, pitfalls, performance. Writes `.workflow/research/lane-web-<n>.md`.
A lane that compares platforms or makes a judgement call runs on `model: opus` (rule 7).
Prompts: `references/lane-prompts.md`. Agents return path plus ≤6 lines (rule 5); never open lane files yourself.

### 3. Synthesize
`Synthesize research` (general-purpose, `model: opus`) reads all lane files and rewrites `<slug>.md` with exactly these sections, in order: `## Recommendation` (one approach, why), `## Alternatives` (1–2, trade-off table), `## Integration points` (`path:line → change`, one per line, repo-relative), `## Risks`, `## Open questions`, `## Effort` (S/M/L per part), `## Sources` (`URL — accessed YYYY-MM-DD`). A web claim contradicting the code lane goes in Risks, never dropped. Returns ≤10 lines.

### 4. 🛑 Present
Print the recommendation, alternatives and open questions; ask the user those only they can answer (rule 12). Update STATE.md, same headings. Offer: "Next: `my-skill-masterplan` with this research." A follow-up to build or demo it is open-ended work (rule 6).
