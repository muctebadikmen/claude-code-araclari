---
name: my-skill-audit
description: Use when the user wants to find bugs, defects, mistakes, or risks in an existing project without proposing features. Triggers: "find bugs", "audit", "what's broken", "find problems", "review the whole project for issues", "hataları bul", "sorunları bul", "projeyi denetle", "bug ara", "neler bozuk".
---

# Audit

Find every real problem, prove it, rank it. Never propose a feature.

REQUIRED SUB-SKILL: my-skill-orchestrate
Read it first; fill all six dispatch slots.

## Inputs
Cwd; optional scope. `.workflow/STATE.md` per orchestrate rule 10.

## Phases
Foreground batches (rule 3); models per rule 7.

### 1. Map — `model: sonnet`, general-purpose
One mapper per concern present: `screens-routes`, `data-models`, `services-integrations`, `state-dataflow`, `build-test-config`. Skip a concern the project lacks (a CLI has no screens), noting it in STATE.md `## Gotchas`. Under ~15 source files: one mapper for all. Each writes `.workflow/audit/map-<concern>.md` (≤150 lines: components, entry points, key files), returns ≤8 lines.
Relay one line per concern. 🛑 (rule 11) only if the project is far larger than expected, or the user asks to pick a scope.

### 2. Analyze
- Area analyzers, `model: sonnet`, one per map file; input: that map and the files it names.
- Dimension analyzers, `model: opus`: `correctness`, `error-handling`, `security`, `data-integrity`, `performance`, `concurrency`. Input: all map files; under ~15 source files pair them: `correctness+error-handling`, `security+data-integrity`, `performance+concurrency`.

Prompt `references/analyzer-prompt.md`, schema `references/finding-schema.md`. Each writes `.workflow/audit/findings-<name>.json`, returns ≤5 lines with counts.

### 3. Verify
`Merge findings` (`model: sonnet`, `references/report-prompt.md`) merges `findings-*.json` into `all-findings.json`: one entry per defect (same file, same broken behaviour, lines ±3), not per title. Then one `Verify findings <n>` (`model: opus`, `references/verifier-prompt.md`) per 10 findings → `verified-<n>.json`. Verdicts: CONFIRMED, PLAUSIBLE, REJECTED (with reason).

### 4. Report
`Write audit report` (`model: opus`, same prompt file) writes `.workflow/audit/YYYY-MM-DD-audit.md`. Findings sharing a root cause fold into one `AUD-n`: highest severity, folded ids beneath, no row or section. Part 1, summary table, Critical first, one row per survivor: `| AUD-n | Severity | Confidence | path:line | title |`. Part 2, `#### AUD-n — title` sections by severity: Severity, Confidence (verdict word), Effort, Location `path:line`, Evidence, Root cause, Affected areas, Folded. Rejected findings in an appendix. Returns the path and top 10 rows, relayed unopened.
🛑 Offer: "Next: `my-skill-masterplan` with this report as input."

## Hard rules
- No feature suggestions. Banned anywhere in the report, even negated: "consider adding", "would be nice", "enhancement", "new feature", "nice to have".
- Refactor suggestions only where behaviour is wrong.
- Every finding cites `path:line`. No citation, no finding.
- Severity: Critical = data loss, security hole, or crash on a main path. High = wrong result on a common path. Medium = wrong on an edge path or degraded. Low = cosmetic, logging, dead code.
