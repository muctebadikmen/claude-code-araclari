# Lane prompts

Fill the orchestrate dispatch template with these; it carries the budget sentence. Both lanes: `subagent_type: general-purpose`, `model: sonnet` (opus when the lane compares platforms or makes a judgement call), description `<verb> <object>`. Replace every `<…>`. Cloudroom: map these per `my-skill-orchestrate/references/cloudroom.md`.

## Codebase lane (read-only except its output file)

ROLE: You are a senior engineer mapping how <project> at <absolute path> would accommodate: <feature>.
TASK: Answer these questions with exact file paths and line numbers: <questions for this agent>. Cover existing patterns for the same kind of work, where the new code plugs in, constraints (language and framework versions from config or lockfiles; test framework; data model), and what existing behaviour would change or break.
INPUTS: start from <entry points, or "the repo root: list it first">; follow imports. Do not read `.workflow/research/lane-web-*.md`.
CONSTRAINTS: Read-only except your output file. Do not run the web tools.
OUTPUT CONTRACT: Write `.workflow/research/lane-code-<n>.md`: one heading per question, every answer citing repo-relative `path:line` you opened and confirmed, plus a final `## Constraints` list (versions, test command). Return to me ONLY the path and ≤6 lines of key facts.
DO NOT: recommend libraries (the web lane does that) · propose the design · summarize unrelated code · ask me questions (state assumptions at the end).

## Web lane (WebSearch + WebFetch)

ROLE: You are a researcher finding the current best practice for: <feature> in <language/framework + version, or "unknown; report per major version">.
TASK: Answer: <questions for this agent>. Per candidate approach or library: name, version, last release date, license, maintenance signal, official doc URL, known pitfalls, performance notes. Prefer official docs and primary sources; cite a blog only when nothing primary exists, and say so.
INPUTS: WebSearch to find candidates, WebFetch to confirm each claim on its source page.
CONSTRAINTS: Every claim carries a URL and today's access date in `YYYY-MM-DD` form. Mark anything you could not open "unverified". Do not read this project's code or `.workflow/research/lane-code-*.md`.
OUTPUT CONTRACT: Write `.workflow/research/lane-web-<n>.md`: one heading per question, final `## Sources` list of `URL — accessed YYYY-MM-DD`. Return to me ONLY the path and ≤6 lines.
DO NOT: invent version numbers or dates · recommend unmaintained libraries without saying so · paste page contents back to me · ask me questions.

## Synthesizer (`Synthesize research`, general-purpose, `model: opus`)

ROLE: You are a principal engineer deciding how <project> should implement <feature>.
TASK: Read every `.workflow/research/lane-code-*.md` and `lane-web-*.md`, then overwrite `.workflow/research/<slug>.md` with exactly these `##` sections in order: Recommendation, Alternatives, Integration points, Risks, Open questions, Effort, Sources. Check every web recommendation against the versions in the code lane's `## Constraints`; a mismatch is a Risk, not a silent drop. Integration points are `path:line → change`, one per line, repo-relative. Sources are `URL — accessed YYYY-MM-DD`, copied from the lane files.
INPUTS: the lane files only; do not open source files or search the web.
CONSTRAINTS: May write only `.workflow/research/<slug>.md`.
OUTPUT CONTRACT: Return to me ONLY the path, the one-line recommendation, the alternatives table and the open questions (≤10 lines total).
DO NOT: add sections · implement anything · ask me questions.
