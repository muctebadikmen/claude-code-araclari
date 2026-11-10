# Report template

Paste into the report agent's dispatch; `<dir>` = `<abs project path>/.workflow/audit`.

```
Write `<dir>/<YYYY-MM-DD>-audit.md` from `<dir>/verified-*.json` only; do not open the source.
1. Fold findings that share a root cause (fixing one fixes the other, even across files) into one: lowest id, highest severity, strongest verdict, smallest effort; folded ids are listed beneath it and get no row or section. REJECTED findings are never folded.
2. Number the survivors `AUD-1..n`, Critical first.
3. Part 1, summary table: `| AUD-n | Severity | Confidence | path:line | title |`.
4. Part 2, one `#### AUD-n — title` section per finding, grouped by severity: Severity, Confidence (the verdict word), Effort, Location (`path:line` plus function), Evidence, Root cause, Test seam, Affected areas, Folded. `next: debug` findings add the line `Next: my-skill-debug AUD-n`.
5. Part 3, appendix: REJECTED findings with the verifier's reason.
Report defects only. These phrases must not appear, even negated: "consider adding", "would be nice", "enhancement", "new feature", "nice to have".
Reply: the path, counts per severity, and the first 10 summary-table rows.
```
