---
name: my-skill-audit
description: Use when the user wants to find bugs, defects, mistakes, or risks in an existing project without proposing features. Triggers: "find bugs", "audit", "what's broken", "find problems", "review the whole project for issues", "hataları bul", "sorunları bul", "projeyi denetle", "bug ara", "neler bozuk".
---

# Audit

Find every real problem, prove it, rank it. Never propose a feature.

REQUIRED SUB-SKILL: my-skill-orchestrate

Input: cwd, optional scope. Each phase is one foreground batch, all `sonnet` unless noted. Scratch: `.workflow/audit/`. Read `.workflow/PROJECT.md` for the stack.

## Phases

### 1. Map
One mapper per concern the project has: `screens-routes`, `data-models`, `services-integrations`, `state-dataflow`, `build-test-config`; a small project gets one mapper. Each writes a short `map-<concern>.md` (components, entry points, key files) and returns its path. Note skipped concerns in STATE.md `## Gotchas`.

### 2. Analyze
One read-only analyzer per map, briefed with `references/analyzer-prompt.md` (lenses and finding schema; no per-lens agents), plus `references/mobile-lens.md` when PROJECT.md names a mobile stack. Each writes `findings-<concern>.json` and returns its path and counts. Zero findings is a valid result.

### 3. Verify
1. Merge: `jq -s 'add|sort_by(.file,.line)' .workflow/audit/findings-*.json > .workflow/audit/all.json`.
2. Slice it with `jq` into `slice-<n>.json`, about ten findings each, keeping a file's findings together so duplicates meet.
3. Verifiers, briefed with `references/verifier-prompt.md`, write `verified-<n>.json` and return counts per verdict plus the CONFIRMED Critical/High ids.

PLAUSIBLE and no-repro findings carry `next: debug`; the report renders it as `Next: my-skill-debug AUD-n`.

### 4. Variant sweep
One pass, no loop. For CONFIRMED Critical/High root causes (≤4 per agent), an agent writes the exact pattern, searches every area for siblings and returns new hits in the finding schema. New hits go through a verifier.

### 5. Report
One `opus` agent (`sonnet` on a small audit) writes `.workflow/audit/YYYY-MM-DD-audit.md` from the `verified-*.json` files, not the source, per `references/report-template.md`. It returns the path and the top 10 table rows; relay them unopened. Offer: "Next: `my-skill-masterplan` with this report as input."

### 6. Learn
Prune `.workflow/LEARNINGS.md` first (orchestrate's `learnings.md`), then add at most one entry for a CONFIRMED root-cause pattern that recurs across areas.

## Hard rules
- Verified findings only, each citing `path:line`. No citation, no finding.
- No feature suggestions anywhere, even negated. Suggest a refactor only where behaviour is wrong.
- Audit agents never modify project code.
