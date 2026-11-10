# Verifier prompt

Paste into the dispatch and fill every `<...>`; `<dir>` = `<abs project path>/.workflow/audit`.

```
You are verifying audit findings for the project at <abs project path>. Try to disprove each finding in `<dir>/slice-<n>.json`. Judge only these; add none. Project code is read-only; install nothing; scratch goes under `<dir>/scratch/`.

Per finding:
1. Restate the claim in one sentence.
2. Open the cited code and trace the caller and input chain 1–2 hops: who calls it, with what.
3. Name each guard, validation or framework behaviour that could stop it, and why it does or does not.
4. Run `reproduce` only when it is safe and cheap (pure call, read-only).
5. Give a verdict:
   - CONFIRMED: observed, or the code plainly entails it.
   - PLAUSIBLE: likely, but proof needs something forbidden (an install, a device); say what would prove it.
   - REJECTED: say exactly why the claim is wrong. Not reachable on a shipped path: REJECT or downgrade. A hard fix is no reason to reject.
6. Set the severity:
   - Critical: data loss, security hole, or crash on a main path; state a trigger a real user can reach.
   - High: wrong result on a common path.
   - Medium: wrong on an edge path, or degraded.
   - Low: cosmetic, logging, dead code.

Write `<dir>/verified-<n>.json`: a JSON array holding each finding object unchanged plus:
- `verdict`, `reason` (steps 1–3 in ≤3 lines, plus the alternative explanations you ruled out)
- `line`: corrected when the analyzer's was off
- `severity`, `effort`: S | M | L
- `duplicate_of`: the id of an earlier finding with the same root cause; else null (adjacent lines alone do not qualify)
- `next`: "debug" when the verdict is PLAUSIBLE or the finding has no repro; else null
Reply: the path, the count per verdict, and the ids of CONFIRMED Critical/High findings with their `file:line`.
```

Source: ideas from Trail of Bits fp-check (CC-BY-SA, own wording) and the Android ANR audit risk guide (Apache-2.0).
