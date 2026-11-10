---
name: my-skill-research
description: Use when the user asks how to implement a feature or change, which approach or library is best, or the most efficient way to build something in this project. Triggers: "research", "how should we implement", "best way to", "which library", "compare approaches", "araştır", "nasıl yaparız", "en iyi yöntem", "hangi kütüphane". Flags: --code-only, --web-only.
---

# Research

Answer "how should we build X here?" with one recommendation from codebase and web evidence, written to `.workflow/research/<slug>.md` for `my-skill-masterplan`.

REQUIRED SUB-SKILL: my-skill-orchestrate

You frame, dispatch and present; lanes read the code and search the web. Input: the feature in the user's words. `--code-only` skips the web lane; `--web-only` skips the code lane.

## Phases

### 0. Size gate
One obvious path, ≤2 files affected, no library choice: answer in chat with `path:line`. No lanes, no file.

### 1. Frame
1. Write `.workflow/STATE.md`. Read `.workflow/PROJECT.md` (stack, commands) if present; grep `.workflow/LEARNINGS.md` for the feature's keywords.
2. Write `.workflow/research/<slug>.md`: the feature in ≤3 lines and 3–6 questions.
3. Ask only decisions and real ambiguity the message left open (scope, a constraint, which reading is meant), per orchestrate's questions policy. Facts (platform, framework, test runner, versions) are lane work.

### 2. Lanes
One foreground batch, all `sonnet`, one agent per question group per lane, briefs from `references/lane-prompts.md`:
- Code lane → `.workflow/research/lane-code-<n>.md`: how the project accommodates the feature, cited `path:line`, ending in `## Constraints`.
- Web lane → `.workflow/research/lane-web-<n>.md`: current best practice for the project's stack version, cited URL plus access date, ending in `## Sources`.

Each returns its path plus ≤5 lines. Lane files are input for the synthesizer, not for you.

### 3. Synthesize
One `opus` agent (`sonnet` when the lanes plainly agree) gets the Synthesis brief from `references/lane-prompts.md`: it reads only the lane files and rewrites `<slug>.md`. It returns the path, the one-line recommendation, the alternatives table and the open questions.

### 4. Present
1. Print "Facts found: …" (one line), then the recommendation, alternatives and open questions.
2. Ask the user only the decisions, recommended option first.
3. Update STATE.md. Offer: "Next: `my-skill-masterplan` with this research."

A follow-up to build or demo it is open-ended work: scope it first per orchestrate.
