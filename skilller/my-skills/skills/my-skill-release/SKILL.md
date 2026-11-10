---
name: my-skill-release
description: Use when the user wants to know if a build is ready for TestFlight, Play, or the stores. v1 is a read-only preflight. Triggers: "release", "ready to release", "preflight", "check before upload", "TestFlight", "Play internal track", "submit for review", "mağazaya hazır mı", "TestFlight'a at", "release öncesi kontrol".
---

# Release (v1: read-only preflight)

Report whether a build is ready for a store. v1 only reads: no build, upload, store write, install or settings change.

REQUIRED SUB-SKILL: my-skill-orchestrate

## Rules

- A request to build, upload, submit, edit store metadata or touch accounts is v2: list it under "v2, needs explicit yes" and stop.
- Signing and secret files: existence only (`test -e`); never open or print them.
- Store tools (`references/tools.md`, unverified): only one already installed, only its read-only commands. Otherwise the check is UNKNOWN.
- Every status cites `file:line` or a command with its exit code (orchestrate's `evidence-gate.md`). A check not run is UNKNOWN.

## Steps

1. Read `.workflow/PROJECT.md` (stack, app id). Target from the user's message (TestFlight, Play internal); else both.
2. Dispatch one `sonnet` sub-agent with these rules, the stack, app id, target and both reference files. It runs every row of the `references/checks.md` table that applies to the stack:
   - version and build number, against the last uploaded build when a store tool is available
   - signing config
   - store metadata: privacy manifest, permission strings, target SDK, app id, release notes
   - changelog
   - verify-app evidence
   - git: clean and pushed
3. It writes `.workflow/runs/release/<ts>.md` in the `references/checks.md` report format and returns the path, the verdict and each FAIL or UNKNOWN check with its evidence, ≤ 8 lines.
4. Relay the verdict and the by-hand fixes. Fix nothing.

## Verdict (first match wins)

1. BLOCKED: a check is FAIL. Name each fix.
2. UNKNOWN: a check could not run (tool absent, no account). List what to run by hand.
3. READY: every check OK.

## v2, needs explicit yes

Build and sign; upload to TestFlight or Play internal; edit store text or screenshots; submit for review; promote or roll out. Each needs its own yes in chat; public submission needs a second yes.
