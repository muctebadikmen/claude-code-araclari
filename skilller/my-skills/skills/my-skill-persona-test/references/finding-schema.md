# Run file and finding schema

Each persona run writes one file, `.workflow/persona/<date>/<id>.md` (a focused re-run: `<id>-c<n>.md`), with its screenshots beside it:

```
# <id>   Driver: <name@version>   Device: <name, OS>   Profile: <settings applied>
## Goals
G1 <goal> — DONE | BLOCKED | NOT_TRIED — <steps> steps, <confusions> confusions
## Screens reached
<screen names, in order of first visit>
## Step log
<one line per step, format in the run brief>
## Findings
<finding blocks, or "none">
```

A re-run file starts with `Reproduced: yes | no — <finding id>` and holds the same blocks for what it saw.

One finding per block; every field required:

```
id: <persona id>-<nn>
persona: first-time | power | a11y
goal: G<n>
step: <step-log number where it happened>
type: bug | friction
lens: <one lens from the list below; "none" for a bug>
severity: P0 | P1 | P2
screen: <screen name>
element: <element name; "none" for the whole screen>
steps: 1. … 2. …   (driver commands from launch to the finding)
expected: <the EXPECTS text of that step>
observed: <the GOT text of that step>
evidence: <screenshot path>
confidence: observed | inferred
```

- type. bug: the app misbehaves (crash, wrong result, broken control, clipped text). friction: the app works but the persona hesitated, misread or could not find something.
- Findings are major or blocked steps, crashes and wrong results, and the persona's finding triggers. Minor hiccups go to the step log only.
- severity. P0 (critical): the goal ended BLOCKED here, a crash, or lost data. P1 (high): the step was rated major. P2: a persona finding trigger on a smooth or minor step.
- screen, element, type are the match key across personas, so name them from visible text, never from a ref or internal id:
  - screen: the title shown on screen, verbatim; no title: the selected tab's label, else the largest heading.
  - element: the visible label verbatim plus its role, e.g. `"Save" button`; no label: `unlabelled <role>, <position on screen>`.
- evidence: a screenshot taken at that step that shows the observed state. A finding without one is dropped in aggregation.
- confidence. observed: visible in the evidence screenshot. inferred: read from the snapshot tree or the log only; say which in `observed`.
- An accessibility finding read from the tree ends `observed` with "tree-based, not screen-reader verified".
- lens (friction only): status visibility, user's words, control and undo, consistency, error prevention, recognition over recall, shortcuts, clutter, error messages, help.

Lenses and severity scale: ideas from the Nielsen heuristics as used in pbakaus/impeccable critique (Apache-2.0); own wording, simplified.
