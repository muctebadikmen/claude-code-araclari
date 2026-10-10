# Merge and report prompts (fill <> and dispatch per orchestrate/references/dispatch-template.md)

Two dispatches use this file: `Merge findings` (`model: sonnet`, Verify phase, before the verifiers) and `Write audit report` (`model: opus`, Report phase). Both merge duplicates; they use different keys.

## `Merge findings` (`model: sonnet`)

ROLE: You are a triage engineer merging analyzer output for <project> at <abs path>.
TASK: Read every `.workflow/audit/findings-*.json`. Group entries that describe the SAME DEFECT. Key: same `file` AND `line` values within ±3 of each other AND the same broken behaviour, judged from `evidence` and `root_cause`, never from the title. Titles differ per analyzer: "fields with commas are not quoted", "double quotes are not escaped", "embedded newlines break rows" and "corrupt CSV when title contains a comma" at the same line are ONE defect (to_csv does no escaping). Different defects at one line stay separate: "SQL injection via f-string" and "LIKE wildcards unescaped" at `store.py:35` are two. For each group keep ONE entry: the clearest title, the longest `evidence`, the most specific `root_cause`, the highest `severity_guess`, all `dimension` values comma-joined, the cheapest `reproduce`, and a new field `merged_from` holding the other entries' ids. Then number the survivors `AUD-1`..`AUD-n` in file-then-line order.
INPUTS: `.workflow/audit/findings-*.json` only. Do not open project source.
CONSTRAINTS: Write only `.workflow/audit/all-findings.json`. Do not add, drop, or reword defects beyond the merge. Do not install packages.
OUTPUT CONTRACT: Write the merged JSON array to `.workflow/audit/all-findings.json`. Return only: the path, `raw → merged` counts, and every group of 3+ as `file:line (n)`; ≤5 lines.
DO NOT: merge two defects because they share a line · keep two entries because two analyzers worded one defect differently · verify anything.

## `Write audit report` (`model: opus`)

ROLE: You are the report writer for the audit of <project> at <abs path>.
TASK: Read every `.workflow/audit/verified-<n>.json`. Step 1, fold: two findings share a ROOT CAUSE when fixing one fixes the other, even across lines or files ("page() skips the first item" and "page() drops records", or `rename()` crashing at `:24` and `:25`, are one; "search is injectable" and "connection never closed" are not). Fold each such set into ONE finding: keep the lowest surviving id as its `AUD-n`, the highest severity, the strongest verdict (CONFIRMED > PLAUSIBLE), the smallest effort, and list the other ids on a `Folded:` line. Folded ids get no table row and no section of their own. REJECTED findings are never folded into a surviving one; they go to the appendix. Step 2, write `.workflow/audit/<YYYY-MM-DD>-audit.md` (today's date):
- Part 1 `## Summary`: one table, one row per surviving finding, Critical first, then High, Medium, Low: `| AUD-n | Severity | Confidence | path:line | title |`. The `path:line` cell is the single primary location, no prose.
- Part 2 `## Findings`: sections `### Critical`, `### High`, `### Medium`, `### Low`; each finding as `#### AUD-n — title` followed by lines `Severity:`, `Confidence:` (the verdict word), `Effort:` (S/M/L), `Location:` (`path:line` plus the enclosing function), `Evidence:` (≤3 quoted lines), `Root cause:`, `Affected areas:` (callers, commands, screens, or data touched), `Folded:` (ids or "none").
- Part 3 `## Appendix — Rejected`: id, title, location, verifier's reason.
INPUTS: `.workflow/audit/verified-*.json`; `.workflow/audit/all-findings.json` for `merged_from` ids. Do not open project source.
CONSTRAINTS: Write only the report file. Do not install packages. Severity words only from Critical/High/Medium/Low; confidence words only from CONFIRMED/PLAUSIBLE.
OUTPUT CONTRACT: Write the report. Return only: its path, `surviving / folded / rejected` counts, and the top 10 summary rows verbatim; nothing else.
DO NOT: propose features or "enhancements", even to say none are proposed · use "consider adding", "would be nice", "nice to have", "new feature" anywhere · re-verify findings · renumber ids · give a folded finding its own row or section.
