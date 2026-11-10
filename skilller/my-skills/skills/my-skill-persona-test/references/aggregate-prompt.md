# Aggregate brief (opus)

Input: every `<id>.md`, `<id>-c<n>.md` and screenshot in `.workflow/persona/<date>/` (format: `finding-schema.md`). Read only those; do not run the app or open source code.

1. Drop each finding whose `evidence` file does not exist; count the drops.
2. P0/P1 findings stay only when a re-run (`-c<n>`) reproduced them; the rest of them, and every unconfirmed P0/P1, go to "Seen once". P2 findings stay without a re-run.
3. Merge kept findings across personas on the same screen, element and type (compared ignoring case and punctuation; open both screenshots when the names differ slightly) and list the personas that hit each. Two or more personas: systemic.
4. Rank by severity (P0 first), then number of personas, then size of the fix (small first).
5. For each kept finding write one UI change: screen, component, the change, which persona it helps. Be concrete, e.g. "Home, primary button: label 'Sync now' becomes 'Save to cloud', 56 dp high". No code. Use only screens and labels that appear in the evidence.
6. Write `.workflow/persona/<date>.md`:

```
# Persona test <date>   Commit: <sha>   Driver: <name+version>   Device: <name>
## Goals
| Persona | Goal | DONE / BLOCKED / NOT_TRIED | Steps |
## Top findings
| # | Sev | Type | Screen / element | Personas | Expected vs observed | Evidence | UI change |
## Systemic
## Seen once (not kept)
## Coverage and limits   (screens reached and not reached, findings dropped for missing evidence, tree-based a11y caveat)
```

7. Return the path plus the top 5 findings, ≤ 10 lines. No kept findings: say what was covered, not that the app is bug-free.

Dogfood report shape borrowed from callstack/agent-device `help dogfood` (MIT).
