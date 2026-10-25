---
name: my-skill-audit
description: Use when the user wants to find bugs, defects, mistakes, or risks in an existing project without proposing features. Triggers: "find bugs", "audit", "what's broken", "find problems", "review the whole project for issues", "hataları bul", "sorunları bul", "projeyi denetle", "bug ara", "neler bozuk".
---

# Audit

Find every real problem, prove it, rank it. Never propose a feature.

REQUIRED SUB-SKILL: my-skill-orchestrate — read it first; it governs dispatch, model routing (pass `model` explicitly) and `.workflow/STATE.md`.

Input: cwd, optional scope. Foreground batches (all agents of a phase in one message). Scratch lives in `.workflow/audit/`.

## Phases

### 1. Map
One `sonnet` mapper per concern the project actually has: `screens-routes`, `data-models`, `services-integrations`, `state-dataflow`, `build-test-config` (a CLI has no screens; note skipped concerns in STATE.md `## Gotchas`). A small project gets one mapper. Each writes `map-<concern>.md` (components, entry points, key files; short) and returns a few lines. Stop for the user only if the project is far larger than expected or they want to pick a scope.

### 2. Analyze
All `sonnet`, all read-only, each writing `findings-<name>.json`:
- Area analyzers, one per map file, reading that map and the files it names.
- Dimension analyzers, reading all maps: `correctness`, `error-handling`, `security`, `data-integrity`, `performance`, `concurrency`. On a small project pair them.

Brief: you are auditing for real defects — wrong results, crashes, data corruption, security holes, unhandled errors, races, hot-path performance traps, dead code that hides a bug. Report nothing else: no features, no style or naming. Zero findings is a valid result.

Finding schema, a JSON array of objects:
`id` (`<area>-<dimension>-<n>`), `title`, `file`, `line` (first line of the offending code; open the file, never guess), `evidence` (quote, ≤3 lines), `root_cause`, `severity_guess`, `dimension`, `reproduce` (a concrete safe call or command, else "read-only reasoning").

### 3. Verify
A `sonnet` agent merges `findings-*.json` into `all-findings.json`: one entry per defect, not per title — same file, lines within ±3, same broken behaviour judged from evidence and root cause (different defects at one line stay separate). It keeps the clearest title, strongest evidence, highest severity, joins dimensions, records `merged_from`, and numbers survivors `AUD-1..n`. It reads only the findings files.

Then `sonnet` verifiers, one per slice of about ten findings, write `verified-<n>.json`. They are adversarial: try to disprove each finding by opening the cited code and its callers, and run `reproduce` only if it is safe and cheap (pure call, read-only). Verdict plus reason per finding: CONFIRMED (observed, or the code plainly entails it), PLAUSIBLE (likely, but proof needs something forbidden such as an install; say what would prove it), REJECTED (say exactly why the claim is wrong). Fix an off line number; keep or adjust severity by the rules below; add `effort` (S/M/L). Verifiers never modify project code or install anything; scratch goes under `.workflow/audit/scratch/`. They don't add findings, trust the analyzer's word, or reject because a fix is hard.

### 4. Report
One `opus` agent writes `.workflow/audit/YYYY-MM-DD-audit.md` from the `verified-*.json` files (not the source). Opus here because folding findings by root cause and ranking them is a judgement across the whole system; on a small audit sonnet is enough.
- Fold findings that share a root cause (fixing one fixes the other, even across files) into one `AUD-n`: lowest id, highest severity, strongest verdict, smallest effort, folded ids listed beneath, no row or section of their own. Rejected findings are never folded; they go to the appendix.
- Part 1, summary table, Critical first: `| AUD-n | Severity | Confidence | path:line | title |`.
- Part 2, `#### AUD-n — title` sections grouped by severity: Severity, Confidence (verdict word), Effort, Location (`path:line` plus function), Evidence, Root cause, Affected areas, Folded.
- Part 3, appendix of rejected findings with the verifier's reason.

It returns the path and the top 10 table rows; relay them unopened. Offer: "Next: `my-skill-masterplan` with this report as input."

## Hard rules
- Verified findings only; every finding cites `path:line`. No citation, no finding.
- No feature suggestions anywhere in the report, even negated ("consider adding", "would be nice", "enhancement", "new feature", "nice to have" are banned). Suggest a refactor only where behaviour is wrong.
- Severity: Critical = data loss, security hole, or crash on a main path. High = wrong result on a common path. Medium = wrong on an edge path or degraded. Low = cosmetic, logging, dead code.
