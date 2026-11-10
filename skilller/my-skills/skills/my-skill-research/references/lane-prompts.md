# Research lane prompts

Paste the matching block into the dispatch and fill every `<...>`. `<dir>` = `<abs project path>/.workflow/research`.

## Code lane (sonnet)
```
Map how the project at <abs project path> can accommodate this feature: <feature>.
Answer: <questions>.
1. Find existing patterns for the same kind of work, where new code plugs in, and what existing behaviour would change or break.
2. Collect constraints: language and framework versions (config, lockfiles), test framework and command, data model, repo rules (CLAUDE.md, lint, sentinel tests), min OS/SDK, permissions, privacy manifest, store-policy impact.
3. Write `<dir>/lane-code-<n>.md`: one section per question, every answer citing a repo-relative `path:line` you opened; then `## Assumptions`; last section `## Constraints` (bullets).
Read project code only; write only that file. Report facts: library and design choices belong to synthesis. Assume instead of asking and list it under `## Assumptions`; an ambiguity that changes behaviour, data or an interface goes there as `decision needed: <question>`.
Reply: the path, then ≤5 lines: main plug-in point, hardest constraint, anything not found.
```

## Web lane (sonnet; WebSearch, WebFetch)
```
Research current best practice for this feature: <feature>.
Answer: <questions>.
Stack and versions: <from PROJECT.md, or "unknown: cover each major version">.
1. Per candidate: name, version, last release date, license, maintenance signal (flag unmaintained), official doc URL, known pitfalls, performance.
2. Use primary sources (official docs, registry, repo); a blog only when nothing primary exists, labelled as such.
3. Confirm each package name on its official registry before recommending it (typo-squat guard).
4. Every claim carries its URL and access date `YYYY-MM-DD`. Mark anything you could not open "unverified"; never invent a version or date.
5. Write `<dir>/lane-web-<n>.md`: one section per question; `## Assumptions`; last section `## Sources`, one `URL — accessed YYYY-MM-DD` per line.
Web only, no project code; write only that file. Assume instead of asking and list it under `## Assumptions`; an ambiguity that changes behaviour, data or an interface goes there as `decision needed: <question>`.
Reply: the path, then ≤5 lines: top candidate with version, runner-up, biggest pitfall, count of unverified claims.
```

## Synthesis (opus; sonnet when the lanes agree)
```
Feature: <feature>. Read only `<dir>/lane-*.md`. Rewrite `<dir>/<slug>.md` with exactly these parts, in order:
- Header lines `Goal:` / `Non-goals:` / `Success signal:`
- `## Recommendation` (one approach, why)
- `## Alternatives` (1–2, trade-off table)
- `## Integration points` (`path:line → change`, one per line, repo-relative)
- `## Risks`
- `## Open questions` (decisions for the user, recommended answer first, including every lane `decision needed:` line)
- `## Effort` (S/M/L per part)
- `## Sources` (`URL — accessed YYYY-MM-DD`, copied from the lanes with their "unverified" marks)
Check every web recommendation against the code lanes' `## Constraints`: a contradiction goes in Risks, never dropped.
Reply: the path, the one-line recommendation, the alternatives table, the open questions.
```

Source: obra/superpowers brainstorming, Fission-AI/OpenSpec (MIT) for the Goal/Non-goals/Success header; open-gsd/gsd-core `gsd-phase-researcher` (MIT) for the registry check; mattpocock/skills grilling (MIT) for facts-vs-decisions; EveryInc/compound-engineering-plugin ce-plan (MIT) for the size gate.
